import JSZip from "jszip"

type ComponentDefinition = {
  rootId: string
  objectId: string
  path: string
  transform: number[]
  filamentIndex: number
}

type GeometryGroup = { start: number; count: number; filamentIndex: number }

type GeometryResult = {
  rootId: string
  objectId: string
  transform: number[]
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  groups: GeometryGroup[]
  triangleCount: number
}

type WorkerRequest =
  | { type: "initialize"; bytes: ArrayBuffer }
  | { type: "plate"; requestId: number; objectIds: string[] }

type WorkerResponse =
  | { type: "ready" }
  | {
      type: "progress"
      requestId: number
      message: string
      triangles?: number
    }
  | { type: "plate"; requestId: number; geometries: GeometryResult[] }
  | { type: "error"; requestId?: number; message: string }

type WorkerScope = {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (message: WorkerResponse, transfer?: Transferable[]) => void
}

type ZipByteStream = {
  on: {
    (event: "data", callback: (chunk: Uint8Array) => void): ZipByteStream
    (event: "error", callback: (error: Error) => void): ZipByteStream
    (event: "end", callback: () => void): ZipByteStream
  }
  pause: () => ZipByteStream
  resume: () => ZipByteStream
}

type StreamableZipEntry = {
  internalStream: (type: "uint8array") => ZipByteStream
  _data?: { compressedSize?: number; uncompressedSize?: number }
}

type GeometryBudget = {
  vertices: number
  triangles: number
  decodedBytes: number
}

type ParsedComponent = {
  geometry: GeometryResult
  vertexCount: number
  decodedBytes: number
}

const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 4_096
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
const MAX_METADATA_BYTES = 16 * 1024 * 1024
const MAX_COMPONENT_BYTES = 192 * 1024 * 1024
const MAX_PLATE_DECODED_BYTES = 256 * 1024 * 1024
const MAX_PLATE_COMPONENTS = 128
const MAX_PLATE_VERTICES = 1_000_000
const MAX_PLATE_TRIANGLES = 1_000_000
const MAX_REQUESTED_OBJECTS = 256
const MAX_XML_TAG_CHARS = 64 * 1024
const MAX_PATH_CHARS = 512
const MAX_PAINT_CHARS = 4_096
const MAX_COORDINATE = 1_000_000

const scope = self as unknown as WorkerScope
let zip: JSZip | null = null
let modelXml = ""
let modelSettings = ""

function zipSize(entry: JSZip.JSZipObject): number {
  if (entry.dir) return 0
  const value = (entry as unknown as StreamableZipEntry)._data?.uncompressedSize
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("The project contains an archive entry with an invalid size.")
  }
  return value
}

function validObjectId(value: string): boolean {
  return /^[1-9]\d{0,9}$/.test(value)
}

function componentPath(raw: string): string {
  if (
    !raw ||
    raw.length > MAX_PATH_CHARS ||
    raw.includes("\\") ||
    raw.includes("\0") ||
    /[?#]/.test(raw)
  ) {
    throw new Error("The project contains an invalid component path.")
  }
  const path = raw.startsWith("/") ? raw.slice(1) : raw
  const parts = path.split("/")
  if (
    parts.length < 2 ||
    parts.length > 32 ||
    parts.some((part) => !part || part === "." || part === "..") ||
    parts[0].toLowerCase() !== "3d" ||
    !/\.model$/i.test(parts.at(-1) ?? "")
  ) {
    throw new Error("The project contains an invalid component path.")
  }
  return parts.join("/")
}

function finiteBoundedNumber(raw: string, kind: string): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
    throw new Error(`The project contains an invalid ${kind}.`)
  }
  return value
}

function boundedIndex(raw: string): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("The project contains an invalid triangle index.")
  }
  return value
}

function filamentIndex(raw: string, fallback: number): number {
  if (!raw.trim()) return fallback
  const value = Number(raw)
  // Studio writes zero on some root/part records to mean “use the inherited
  // extruder”; it is a sentinel, not a one-based filament slot.
  if (value === 0) return fallback
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_024) {
    throw new Error("The project contains an invalid filament index.")
  }
  return value
}

async function boundedText(archive: JSZip, name: string, required: boolean): Promise<string> {
  const entry = archive.file(name)
  if (!entry) {
    if (required) throw new Error("The 3MF is missing its main model file.")
    return ""
  }
  if (zipSize(entry) > MAX_METADATA_BYTES) {
    throw new Error("The 3MF metadata is too large to preview safely.")
  }
  const text = await entry.async("text")
  if (text.length > MAX_METADATA_BYTES) {
    throw new Error("The 3MF metadata is too large to preview safely.")
  }
  return text
}

function attr(tag: string, name: string): string {
  let marker = `${name}="`
  let start = tag.indexOf(marker)
  let quote = '"'
  if (start < 0) {
    marker = `${name}='`
    start = tag.indexOf(marker)
    quote = "'"
  }
  if (start < 0) return ""
  start += marker.length
  const end = tag.indexOf(quote, start)
  return end < 0 ? "" : tag.slice(start, end)
}

function matrix(value: string): number[] {
  if (!value.trim()) return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
  const values = value.trim().split(/\s+/).map(Number)
  if (
    values.length !== 12 ||
    values.some((entry) => !Number.isFinite(entry) || Math.abs(entry) > MAX_COORDINATE)
  ) {
    throw new Error("The project contains an invalid component transform.")
  }
  return values
}

function multiplyTransform(a: number[], b: number[]): number[] {
  const out = new Array<number>(12).fill(0)
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      out[column * 3 + row] =
        a[row] * b[column * 3] + a[3 + row] * b[column * 3 + 1] + a[6 + row] * b[column * 3 + 2]
    }
    out[9 + row] = a[row] * b[9] + a[3 + row] * b[10] + a[6 + row] * b[11] + a[9 + row]
  }
  if (out.some((entry) => !Number.isFinite(entry) || Math.abs(entry) > MAX_COORDINATE)) {
    throw new Error("The project contains an invalid combined transform.")
  }
  return out
}

function objectBlock(xml: string, objectId: string): string {
  for (const match of xml.matchAll(/(<object\b[^>]*>)([\s\S]*?)<\/object>/gi)) {
    if (attr(match[1], "id") === objectId) return match[2]
  }
  return ""
}

function metadataValue(block: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return (
    block.match(
      new RegExp(`<metadata\\s+key=["']${escaped}["']\\s+value=["']([^"']*)["']`, "i"),
    )?.[1] ?? ""
  )
}

function componentDefinitions(rootIds: string[]): ComponentDefinition[] {
  const definitions: ComponentDefinition[] = []
  for (const rootId of rootIds) {
    const root = objectBlock(modelXml, rootId)
    const settings = objectBlock(modelSettings, rootId)
    const rootExtruder = filamentIndex(metadataValue(settings, "extruder"), 1)
    const buildTag = [...modelXml.matchAll(/<item\b[^>]*>/gi)].find(
      ([tag]) => attr(tag, "objectid") === rootId,
    )?.[0]
    const buildTransform = matrix(attr(buildTag ?? "", "transform"))

    const partSettings = new Map<string, { subtype: string; filamentIndex: number }>()
    for (const part of settings.matchAll(
      /<part\s+id=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/part>/gi,
    )) {
      partSettings.set(part[1], {
        subtype: attr(part[2], "subtype") || "normal_part",
        filamentIndex: filamentIndex(metadataValue(part[3], "extruder"), rootExtruder),
      })
    }

    for (const component of root.matchAll(/<component\b[^>]*>/gi)) {
      const tag = component[0]
      const objectId = attr(tag, "objectid")
      const part = partSettings.get(objectId)
      if (!objectId || part?.subtype === "negative_part" || part?.subtype === "support_blocker") {
        continue
      }
      if (!validObjectId(objectId)) {
        throw new Error("The project contains an invalid component object ID.")
      }
      if (definitions.length >= MAX_PLATE_COMPONENTS) {
        throw new Error("This plate has too many parts to preview safely.")
      }
      definitions.push({
        rootId,
        objectId,
        path: componentPath(attr(tag, "p:path")),
        transform: multiplyTransform(buildTransform, matrix(attr(tag, "transform"))),
        filamentIndex: part?.filamentIndex ?? rootExtruder,
      })
    }
  }
  return definitions
}

/**
 * Bambu stores a triangle subdivision tree right-to-left in hexadecimal
 * nibbles. Most painted faces are a single leaf; for uncommon subdivided faces
 * the dominant leaf color is used for the whole source triangle.
 */
function paintFilament(value: string, fallback: number): number {
  if (value.length > MAX_PAINT_CHARS || !/^[0-9a-f]*$/i.test(value)) {
    throw new Error("The project contains invalid painted-face metadata.")
  }
  let cursor = value.length - 1
  const counts = new Map<number, number>()
  const nextNibble = (): number => {
    const parsed = Number.parseInt(value[cursor--] ?? "", 16)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  const walk = (depth: number): void => {
    if (cursor < 0 || depth > 24) return
    const code = nextNibble()
    const splitSides = code & 0b11
    if (splitSides) {
      for (let child = 0; child <= splitSides; child++) walk(depth + 1)
      return
    }
    let state = code >> 2
    if (state === 3 && cursor >= 0) state = nextNibble() + 3
    if (state > 0) counts.set(state, (counts.get(state) ?? 0) + 1)
  }
  while (cursor >= 0) walk(0)
  let selected = fallback
  let selectedCount = 0
  for (const [filament, count] of counts) {
    if (count > selectedCount) {
      selected = filament
      selectedCount = count
    }
  }
  return selected
}

async function parseComponent(
  definition: ComponentDefinition,
  requestId: number,
  budget: GeometryBudget,
): Promise<ParsedComponent> {
  const entry = zip?.file(definition.path)
  if (!entry) {
    throw new Error("A component mesh referenced by the project is missing.")
  }
  const declaredBytes = zipSize(entry)
  if (declaredBytes > MAX_COMPONENT_BYTES || declaredBytes > budget.decodedBytes) {
    throw new Error("A component mesh is too large to preview safely.")
  }

  const positions: number[] = []
  const groupedIndices = new Map<number, number[]>()
  let insideObject = false
  let triangleCount = 0
  let vertexCount = 0
  let decodedBytes = 0
  let carry = ""
  const decoder = new TextDecoder()

  const processTags = (text: string): void => {
    for (const match of text.matchAll(/<[^>]+>/g)) {
      const tag = match[0]
      if (tag.length > MAX_XML_TAG_CHARS) {
        throw new Error("The project contains malformed component XML.")
      }
      if (/^<object\b/i.test(tag)) {
        insideObject = attr(tag, "id") === definition.objectId
      } else if (/^<\/object/i.test(tag)) {
        insideObject = false
      } else if (insideObject && /^<vertex\b/i.test(tag)) {
        vertexCount++
        if (vertexCount > budget.vertices) {
          throw new Error("This plate has too many vertices to preview safely.")
        }
        positions.push(
          finiteBoundedNumber(attr(tag, "x"), "vertex coordinate"),
          finiteBoundedNumber(attr(tag, "y"), "vertex coordinate"),
          finiteBoundedNumber(attr(tag, "z"), "vertex coordinate"),
        )
      } else if (insideObject && /^<triangle\b/i.test(tag)) {
        const painted = attr(tag, "paint_color")
        const filamentIndex = painted
          ? paintFilament(painted, definition.filamentIndex)
          : definition.filamentIndex
        const indices = groupedIndices.get(filamentIndex) ?? []
        indices.push(
          boundedIndex(attr(tag, "v1")),
          boundedIndex(attr(tag, "v2")),
          boundedIndex(attr(tag, "v3")),
        )
        groupedIndices.set(filamentIndex, indices)
        triangleCount++
        if (triangleCount > budget.triangles) {
          throw new Error("This plate has too many triangles to preview safely.")
        }
        if (triangleCount % 200000 === 0) {
          scope.postMessage({
            type: "progress",
            requestId,
            message: `Reading ${triangleCount.toLocaleString()} triangles…`,
            triangles: triangleCount,
          })
        }
      }
    }
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const stream = (entry as unknown as StreamableZipEntry).internalStream("uint8array")
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      stream.pause()
      reject(error)
    }
    stream
      .on("data", (chunk: Uint8Array) => {
        if (settled) return
        try {
          decodedBytes += chunk.byteLength
          if (decodedBytes > MAX_COMPONENT_BYTES || decodedBytes > budget.decodedBytes) {
            fail(new Error("A component mesh is too large to preview safely."))
            return
          }
          carry += decoder.decode(chunk, { stream: true })
          const boundary = carry.lastIndexOf(">")
          if (boundary < 0) {
            if (carry.length > MAX_XML_TAG_CHARS) {
              fail(new Error("The project contains malformed component XML."))
            }
            return
          }
          processTags(carry.slice(0, boundary + 1))
          carry = carry.slice(boundary + 1)
          if (carry.length > MAX_XML_TAG_CHARS) {
            fail(new Error("The project contains malformed component XML."))
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Could not read mesh."))
        }
      })
      .on("error", fail)
      .on("end", () => {
        if (settled) return
        try {
          carry += decoder.decode()
          if (carry.length > MAX_XML_TAG_CHARS) {
            throw new Error("The project contains malformed component XML.")
          }
          processTags(carry)
          settled = true
          resolve()
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Could not read mesh."))
        }
      })
      .resume()
  })

  for (const values of groupedIndices.values()) {
    if (values.some((value) => value >= vertexCount)) {
      throw new Error("The project contains a triangle with an invalid vertex reference.")
    }
  }

  const positionArray = new Float32Array(positions)
  const normalArray = new Float32Array(positionArray.length)
  const groups: GeometryGroup[] = []
  const indexArray = new Uint32Array(triangleCount * 3)
  let indexOffset = 0
  for (const [filamentIndex, values] of groupedIndices) {
    indexArray.set(values, indexOffset)
    groups.push({
      start: indexOffset,
      count: values.length,
      filamentIndex,
    })
    indexOffset += values.length
  }

  for (let offset = 0; offset < indexArray.length; offset += 3) {
    const ia = indexArray[offset] * 3
    const ib = indexArray[offset + 1] * 3
    const ic = indexArray[offset + 2] * 3
    const abx = positionArray[ia] - positionArray[ib]
    const aby = positionArray[ia + 1] - positionArray[ib + 1]
    const abz = positionArray[ia + 2] - positionArray[ib + 2]
    const cbx = positionArray[ic] - positionArray[ib]
    const cby = positionArray[ic + 1] - positionArray[ib + 1]
    const cbz = positionArray[ic + 2] - positionArray[ib + 2]
    const nx = cby * abz - cbz * aby
    const ny = cbz * abx - cbx * abz
    const nz = cbx * aby - cby * abx
    normalArray[ia] += nx
    normalArray[ia + 1] += ny
    normalArray[ia + 2] += nz
    normalArray[ib] += nx
    normalArray[ib + 1] += ny
    normalArray[ib + 2] += nz
    normalArray[ic] += nx
    normalArray[ic + 1] += ny
    normalArray[ic + 2] += nz
  }
  for (let offset = 0; offset < normalArray.length; offset += 3) {
    const length = Math.hypot(normalArray[offset], normalArray[offset + 1], normalArray[offset + 2])
    if (!length) continue
    normalArray[offset] /= length
    normalArray[offset + 1] /= length
    normalArray[offset + 2] /= length
  }

  return {
    vertexCount,
    decodedBytes,
    geometry: {
      rootId: definition.rootId,
      objectId: definition.objectId,
      transform: definition.transform,
      positions: positionArray,
      normals: normalArray,
      indices: indexArray,
      groups,
      triangleCount,
    },
  }
}

scope.onmessage = (event) => {
  const message = event.data
  if (message.type === "initialize") {
    void (async () => {
      try {
        zip = null
        modelXml = ""
        modelSettings = ""
        if (message.bytes.byteLength > MAX_ARCHIVE_BYTES) {
          throw new Error("This project is too large to preview safely.")
        }
        const archive = await JSZip.loadAsync(message.bytes)
        const entries = Object.values(archive.files)
        if (entries.length > MAX_ARCHIVE_ENTRIES) {
          throw new Error("This project has too many archive entries to preview safely.")
        }
        let expandedBytes = 0
        for (const entry of entries) {
          if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) {
            throw new Error("The project contains an unsafe archive path.")
          }
          expandedBytes += zipSize(entry)
          if (
            !Number.isSafeInteger(expandedBytes) ||
            expandedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES
          ) {
            throw new Error("This project expands beyond the safe preview limit.")
          }
        }
        modelXml = await boundedText(archive, "3D/3dmodel.model", true)
        modelSettings = await boundedText(archive, "Metadata/model_settings.config", false)
        zip = archive
        scope.postMessage({ type: "ready" })
      } catch (error) {
        scope.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : "Could not open 3MF.",
        })
      }
    })()
    return
  }

  void (async () => {
    try {
      if (!zip) throw new Error("The 3MF preview is not ready yet.")
      if (
        message.objectIds.length > MAX_REQUESTED_OBJECTS ||
        message.objectIds.some((id) => !validObjectId(id))
      ) {
        throw new Error("The plate contains invalid object references.")
      }
      const rootIds = [...new Set(message.objectIds)]
      const definitions = componentDefinitions(rootIds)
      const geometries: GeometryResult[] = []
      const budget: GeometryBudget = {
        vertices: MAX_PLATE_VERTICES,
        triangles: MAX_PLATE_TRIANGLES,
        decodedBytes: MAX_PLATE_DECODED_BYTES,
      }
      for (let index = 0; index < definitions.length; index++) {
        scope.postMessage({
          type: "progress",
          requestId: message.requestId,
          message: `Reading part ${index + 1} of ${definitions.length}…`,
        })
        const parsed = await parseComponent(definitions[index], message.requestId, budget)
        budget.vertices -= parsed.vertexCount
        budget.triangles -= parsed.geometry.triangleCount
        budget.decodedBytes -= parsed.decodedBytes
        geometries.push(parsed.geometry)
      }
      const transfer = geometries.flatMap(({ positions, normals, indices }) => [
        positions.buffer,
        normals.buffer,
        indices.buffer,
      ])
      scope.postMessage({ type: "plate", requestId: message.requestId, geometries }, transfer)
    } catch (error) {
      scope.postMessage({
        type: "error",
        requestId: message.requestId,
        message: error instanceof Error ? error.message : "Could not read plate geometry.",
      })
    }
  })()
}
