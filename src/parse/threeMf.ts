import JSZip from "jszip"
import { normalizeHex } from "../color/hex"
import type { LogicalFilament, ProjectPlate } from "../types"
import { extractStringArray } from "./jsonArrays"
import { createXmlTagReader } from "./xmlStream"

const MAX_ARCHIVE_ENTRIES = 5_000
const MAX_DECLARED_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_METADATA_BYTES = 16 * 1024 * 1024
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
// Real Bambu projects can store one densely painted object as a 100+ MB XML
// component even when the compressed 3MF is modest. Keep this aligned with the
// worker's per-component ceiling while the stricter 256 MB archive-wide limit
// still bounds total expansion.
const MAX_MESH_BYTES = 192 * 1024 * 1024
const MAX_XML_TAG_CHARS = 1024 * 1024
const MAX_PLATES = 200
const MAX_COMPONENTS = 10_000

type SizedZipEntry = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number }
}

function declaredSize(entry: JSZip.JSZipObject): number | null {
  const size = (entry as SizedZipEntry)._data?.uncompressedSize
  return typeof size === "number" && Number.isFinite(size) ? size : null
}

function enforceEntryLimit(entry: JSZip.JSZipObject, maximum: number, label: string): void {
  const size = declaredSize(entry)
  if (size !== null && size > maximum) {
    throw new Error(`${label} exceeds Spoolmap's safety limit.`)
  }
}

export type ThreeMfProject = {
  fileName: string
  title: string
  filaments: LogicalFilament[]
  plates: ProjectPlate[]
  thumbnail: string | null
}

function arrayAt(values: string[], index: number): string {
  return values[index]?.trim() ?? ""
}

function metadataValue(xml: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = xml.match(
    new RegExp(`<metadata\\s+name=["']${escaped}["']\\s*>([\\s\\S]*?)<\\/metadata>`, "i"),
  )
  if (!match) return null

  const decoded = match[1]
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
  return decoded.replace(/<[^>]*>/g, "").trim() || null
}

async function readText(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path)
  if (!entry) return ""
  enforceEntryLimit(entry, MAX_METADATA_BYTES, path)
  return entry.async("text")
}

async function readThumbnail(zip: JSZip): Promise<string | null> {
  const candidates = [
    "Auxiliaries/.thumbnails/thumbnail_small.png",
    "Auxiliaries/.thumbnails/thumbnail_middle.png",
    "Auxiliaries/.thumbnails/thumbnail_3mf.png",
    "Metadata/plate_1.png",
  ]
  for (const path of candidates) {
    const entry = zip.file(path)
    if (!entry) continue
    enforceEntryLimit(entry, MAX_IMAGE_BYTES, path)
    const blob = await entry.async("blob")
    return URL.createObjectURL(blob)
  }
  return null
}

function attribute(block: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return (
    block.match(
      new RegExp(`<metadata\\s+key=["']${escaped}["']\\s+value=["']([^"']*)["']`, "i"),
    )?.[1] ?? ""
  )
}

/**
 * Decodes one Bambu/Orca `paint_color` triangle-selector string.
 *
 * Nibbles are read right to left. The low two bits of a nibble say how many
 * sides were split (0 means the triangle is a leaf); the high two bits hold
 * the filament state, where 3 escapes to the next nibble plus 3. A state of 0
 * means unpainted, so only positive states name a filament.
 */
function decodePaintStates(value: string, into: Set<number>): void {
  let cursor = value.length - 1
  const nextNibble = (): number => {
    const parsed = Number.parseInt(value[cursor--] ?? "", 16)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  const walk = (depth: number): void => {
    if (cursor < 0 || depth > 24) return
    const code = nextNibble()
    const splitSides = code & 0b11
    if (splitSides !== 0) {
      for (let child = 0; child <= splitSides; child++) walk(depth + 1)
      return
    }
    let state = code >> 2
    if (state === 3 && cursor >= 0) state = nextNibble() + 3
    if (state > 0) into.add(state)
  }
  while (cursor >= 0) walk(0)
}

type ZipByteStream = {
  on: {
    (event: "data", callback: (chunk: Uint8Array) => void): ZipByteStream
    (event: "error", callback: (error: Error) => void): ZipByteStream
    (event: "end", callback: () => void): ZipByteStream
  }
  resume: () => ZipByteStream
}

type StreamableZipEntry = {
  internalStream: (type: "uint8array") => ZipByteStream
}

function tagAttribute(tag: string, name: string): string {
  for (const quote of ['"', "'"]) {
    const marker = `${name}=${quote}`
    const start = tag.indexOf(marker)
    if (start < 0) continue
    const valueStart = start + marker.length
    const end = tag.indexOf(quote, valueStart)
    if (end >= 0) return tag.slice(valueStart, end)
  }
  return ""
}

function meshEntryName(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path
}

function paintedLookupKey(path: string): string {
  return path.startsWith("/") ? path : `/${path}`
}

/**
 * Painted filaments per mesh, keyed by component path then component object id.
 * Only meshes referenced by the project are streamed, so leftover objects in
 * the archive never become a huge JavaScript string.
 */
async function readPaintedStates(
  zip: JSZip,
  referenced: ReadonlyMap<string, ReadonlySet<string>>,
): Promise<Map<string, Map<string, Set<number>>>> {
  const painted = new Map<string, Map<string, Set<number>>>()

  for (const [path, objectIds] of referenced) {
    const entryName = meshEntryName(path)
    const entry = zip.file(entryName)
    if (!entry || objectIds.size === 0) continue
    enforceEntryLimit(entry, MAX_MESH_BYTES, entryName)
    const perObject = new Map<string, Set<number>>()
    const decoder = new TextDecoder()
    let owner = ""
    let failed = false
    const reader = createXmlTagReader(
      MAX_XML_TAG_CHARS,
      (tag) => {
        if (/^<object\b/i.test(tag)) {
          owner = tagAttribute(tag, "id")
        } else if (/^<\/object/i.test(tag)) {
          owner = ""
        } else if (owner && objectIds.has(owner) && tag.includes("paint_color=")) {
          const states = perObject.get(owner) ?? new Set<number>()
          decodePaintStates(tagAttribute(tag, "paint_color"), states)
          perObject.set(owner, states)
        }
      },
      () => new Error(`${entryName} contains an overlong XML tag.`),
    )

    await new Promise<void>((resolve, reject) => {
      ;(entry as unknown as StreamableZipEntry)
        .internalStream("uint8array")
        .on("data", (chunk: Uint8Array) => {
          if (failed) return
          try {
            reader.push(decoder.decode(chunk, { stream: true }))
          } catch (error) {
            failed = true
            reject(error instanceof Error ? error : new Error(`${entryName} could not be read.`))
          }
        })
        .on("error", reject)
        .on("end", () => {
          if (failed) return
          try {
            reader.finish(decoder.decode())
            resolve()
          } catch (error) {
            failed = true
            reject(error instanceof Error ? error : new Error(`${entryName} could not be read.`))
          }
        })
        .resume()
    })
    if (perObject.size) painted.set(paintedLookupKey(path), perObject)
  }

  return painted
}

/** Root object id to the meshes it is assembled from. */
function parseComponents(modelXml: string): Map<string, Array<{ path: string; objectId: string }>> {
  const components = new Map<string, Array<{ path: string; objectId: string }>>()
  for (const match of modelXml.matchAll(/(<object\b[^>]*>)([\s\S]*?)<\/object>/gi)) {
    const [, openingTag, body] = match
    const id = tagAttribute(openingTag, "id")
    if (!/^\d+$/.test(id)) continue
    const parts: Array<{ path: string; objectId: string }> = []
    for (const tag of body.matchAll(/<component\b[^>]*>/gi)) {
      const path = tag[0].match(/p:path=["']([^"']+)["']/i)?.[1]
      const objectId = tag[0].match(/objectid=["'](\d+)["']/i)?.[1]
      if (path && objectId) parts.push({ path, objectId })
      if (parts.length > MAX_COMPONENTS) {
        throw new Error("This 3MF contains too many mesh components to inspect safely.")
      }
    }
    components.set(id, parts)
  }
  return components
}

async function readImage(zip: JSZip, path: string): Promise<string | null> {
  const entry = path ? zip.file(path.replace(/^\//, "")) : null
  if (!entry) return null
  try {
    enforceEntryLimit(entry, MAX_IMAGE_BYTES, path)
    return URL.createObjectURL(await entry.async("blob"))
  } catch {
    // A missing or unreadable preview must not fail the whole import.
    return null
  }
}

async function parsePlates(
  zip: JSZip,
  modelSettings: string,
  modelXml: string,
): Promise<ProjectPlate[]> {
  const components = parseComponents(modelXml)
  const referenced = new Map<string, Set<string>>()
  for (const parts of components.values()) {
    for (const { path, objectId } of parts) {
      const objects = referenced.get(path) ?? new Set<string>()
      objects.add(objectId)
      referenced.set(path, objects)
    }
  }
  const painted = await readPaintedStates(zip, referenced)

  const objectUsage = new Map<string, { name: string; filamentIndexes: number[] }>()
  for (const match of modelSettings.matchAll(/(<object\b[^>]*>)([\s\S]*?)<\/object>/gi)) {
    const [, openingTag, block] = match
    const id = tagAttribute(openingTag, "id")
    if (!id) continue
    const used = new Set<number>()
    // The object's own extruder plus any per-part override.
    for (const entry of block.matchAll(
      /<metadata\s+key=["']extruder["']\s+value=["'](\d+)["']/gi,
    )) {
      used.add(Number(entry[1]))
    }
    // Filaments painted onto the mesh, which no metadata key records.
    for (const component of components.get(id) ?? []) {
      const states = painted.get(component.path)?.get(component.objectId)
      states?.forEach((state) => used.add(state))
    }
    objectUsage.set(id, {
      name: attribute(block, "name") || `Object ${id}`,
      filamentIndexes: [...used].sort((a, b) => a - b),
    })
  }

  const blocks = [...modelSettings.matchAll(/<plate>([\s\S]*?)<\/plate>/gi)]
  if (blocks.length > MAX_PLATES) {
    throw new Error("This 3MF contains too many plates to inspect safely.")
  }
  return Promise.all(
    blocks.map(async (match, index) => {
      const block = match[1]
      const plateId = attribute(block, "plater_id") || String(index + 1)
      const objectIds = [
        ...block.matchAll(/<metadata\s+key=["']object_id["']\s+value=["']([^"']+)["']/gi),
      ].map((entry) => entry[1])
      const objects = objectIds
        .map((id) => objectUsage.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))

      const thumbnail =
        (await readImage(zip, attribute(block, "thumbnail_file"))) ??
        (await readImage(zip, `Metadata/plate_${plateId}.png`)) ??
        (await readImage(zip, attribute(block, "thumbnail_no_light_file"))) ??
        (await readImage(zip, `Metadata/plate_no_light_${plateId}.png`))

      return {
        id: plateId,
        name: attribute(block, "plater_name") || `Plate ${plateId}`,
        filamentIndexes: [...new Set(objects.flatMap((object) => object.filamentIndexes))].sort(
          (a, b) => a - b,
        ),
        objectIds,
        objectNames: objects.map((object) => object.name),
        thumbnail,
      }
    }),
  )
}

/** Releases every blob URL a project holds. Call before replacing a project. */
export function revokeProjectUrls(project: ThreeMfProject): void {
  if (project.thumbnail) URL.revokeObjectURL(project.thumbnail)
  for (const plate of project.plates) {
    if (plate.thumbnail) URL.revokeObjectURL(plate.thumbnail)
  }
}

export async function parseThreeMfData(
  data: ArrayBuffer | Uint8Array,
  fileName: string,
): Promise<ThreeMfProject> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new Error("This file is not a readable 3MF archive.")
  }

  const entries = Object.values(zip.files).filter(({ dir }) => !dir)
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("This 3MF contains too many archive entries to inspect safely.")
  }
  const declaredTotal = entries.reduce((total, entry) => total + (declaredSize(entry) ?? 0), 0)
  if (declaredTotal > MAX_DECLARED_UNCOMPRESSED_BYTES) {
    throw new Error("This 3MF expands beyond Spoolmap's 256 MB safety limit.")
  }

  const settings = await readText(zip, "Metadata/project_settings.config")
  const modelXml = await readText(zip, "3D/3dmodel.model")
  const modelSettings = await readText(zip, "Metadata/model_settings.config")
  if (!settings && !modelXml) {
    throw new Error("No Bambu/Orca project metadata was found in this 3MF.")
  }

  const colors = extractStringArray(settings, "filament_colour")
  const materials = extractStringArray(settings, "filament_type")
  const vendors = extractStringArray(settings, "filament_vendor")
  const profiles = extractStringArray(settings, "filament_settings_id")

  const filaments = colors.flatMap((value, index): LogicalFilament[] => {
    const hex = normalizeHex(value)
    if (!hex) return []
    const profile = arrayAt(profiles, index)
    return [
      {
        index: index + 1,
        hex,
        material: arrayAt(materials, index) || "Unknown",
        vendor: arrayAt(vendors, index),
        label: profile || `Filament ${index + 1}`,
        source: "Metadata/project_settings.config",
      },
    ]
  })

  if (filaments.length === 0) {
    throw new Error("The 3MF opened, but no project filament colors could be extracted.")
  }

  return {
    fileName,
    title: metadataValue(modelXml, "Title") || fileName.replace(/\.3mf$/i, ""),
    filaments,
    plates: await parsePlates(zip, modelSettings, modelXml),
    thumbnail: await readThumbnail(zip),
  }
}
