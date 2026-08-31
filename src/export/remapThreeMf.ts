import JSZip from "jszip"
import { normalizeHex } from "../color/hex"

const PROJECT_SETTINGS = "Metadata/project_settings.config"
const MIME_TYPE = "application/vnd.ms-package.3dmanufacturing-3dmodel+xml"
const MAX_SOURCE_BYTES = 100 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 5_000
const MAX_DECLARED_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
const MAX_SETTINGS_BYTES = 16 * 1024 * 1024

type SizedZipEntry = JSZip.JSZipObject & {
  _data?: { uncompressedSize?: number }
}

function declaredSize(entry: JSZip.JSZipObject): number | null {
  const size = (entry as SizedZipEntry)._data?.uncompressedSize
  return typeof size === "number" && Number.isFinite(size) ? size : null
}

export type FilamentColorRemap = {
  /** One-based Bambu/Orca filament slot (F01, F02, ...). */
  index: number
  /** Primary color shown for this filament slot. */
  hex: string
  /**
   * Every ordered color on the selected spool. Multi-color spools use a
   * space-separated color pack in `filament_multi_colour`, matching Bambu
   * Studio's own parser; single-color callers may omit this and the primary
   * color is used.
   */
  colors?: readonly string[]
}

export type RemappedThreeMf = {
  blob: Blob
  fileName: string
  changedFiles: string[]
}

function matchingBracket(source: string, start: number): number {
  let depth = 0
  let quoted = false
  let escaped = false

  for (let cursor = start; cursor < source.length; cursor++) {
    const char = source[cursor]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === "[") depth++
    else if (char === "]" && --depth === 0) return cursor
  }
  return -1
}

function replaceStringArray(
  source: string,
  key: string,
  replacements: ReadonlyMap<number, string>,
): { source: string; found: boolean } {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error(`The ${key} list in project settings is not readable.`)
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The project settings are not a JSON object.")
  }
  const current = (parsed as Record<string, unknown>)[key]
  if (current === undefined) return { source, found: false }
  if (!Array.isArray(current) || !current.every((value) => typeof value === "string")) {
    throw new Error(`The ${key} value in project settings is not a string list.`)
  }

  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const property = new RegExp(`"${escaped}"\\s*:\\s*\\[`).exec(source)
  if (!property) {
    throw new Error(`The ${key} list in project settings is not readable.`)
  }
  const start = source.indexOf("[", property.index)
  const end = matchingBracket(source, start)
  if (end < 0) return { source, found: false }

  const next = current.map((value, zeroBasedIndex) => {
    const replacement = replacements.get(zeroBasedIndex + 1)
    return replacement ?? value
  })
  return {
    source: source.slice(0, start) + JSON.stringify(next) + source.slice(end + 1),
    found: true,
  }
}

export function remappedFileName(originalName: string): string {
  const base = originalName.replace(/\.3mf$/i, "")
  return `${base || "project"}-matched.3mf`
}

/**
 * Rebuilds a 3MF while changing only its project filament color definitions.
 * Meshes, object extruders, paint_color selectors, and slicer profile ids are
 * copied through untouched, so their one-based filament indexes remain valid.
 */
export async function remapThreeMf(
  source: ArrayBuffer | Uint8Array,
  originalName: string,
  remaps: readonly FilamentColorRemap[],
): Promise<RemappedThreeMf> {
  if (source.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("This 3MF is larger than the 100 MB export safety limit.")
  }
  const zip = await JSZip.loadAsync(source)
  const entries = Object.values(zip.files).filter(({ dir }) => !dir)
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error("This 3MF contains too many archive entries to export safely.")
  }
  const declaredTotal = entries.reduce(
    (total, archiveEntry) => total + (declaredSize(archiveEntry) ?? 0),
    0,
  )
  if (declaredTotal > MAX_DECLARED_UNCOMPRESSED_BYTES) {
    throw new Error("This 3MF expands beyond Spoolmap's 256 MB export safety limit.")
  }
  const entry = zip.file(PROJECT_SETTINGS)
  if (!entry) {
    throw new Error("This 3MF has no Bambu/Orca project filament settings.")
  }
  const settingsSize = declaredSize(entry)
  if (settingsSize !== null && settingsSize > MAX_SETTINGS_BYTES) {
    throw new Error("The project filament settings exceed the export safety limit.")
  }

  const primaryReplacements = new Map<number, string>()
  const multiColorReplacements = new Map<number, string>()
  for (const remap of remaps) {
    if (!Number.isInteger(remap.index) || remap.index <= 0) continue

    const primary = normalizeHex(remap.hex)
    if (!primary) {
      throw new Error(`Filament slot ${remap.index} has an invalid primary color.`)
    }
    const colors = (remap.colors?.length ? remap.colors : [primary]).map((value) =>
      normalizeHex(value),
    )
    if (colors.some((value) => value === null)) {
      throw new Error(`Filament slot ${remap.index} has an invalid multi-color value.`)
    }

    primaryReplacements.set(remap.index, primary)
    multiColorReplacements.set(remap.index, colors.join(" "))
  }
  let settings = await entry.async("text")
  const colors = replaceStringArray(settings, "filament_colour", primaryReplacements)
  if (!colors.found) {
    throw new Error("This 3MF has no filament_colour list to remap.")
  }
  settings = colors.source

  // Bambu projects commonly mirror the visible slot colors here. Keeping the
  // mirror in sync avoids stale swatches without changing multi-color mode.
  settings = replaceStringArray(settings, "filament_multi_colour", multiColorReplacements).source

  // Without this JSZip would add a `Metadata/` folder entry the original lacks.
  zip.file(PROJECT_SETTINGS, settings, { createFolders: false })
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: MIME_TYPE,
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })

  return {
    blob,
    fileName: remappedFileName(originalName),
    changedFiles: [PROJECT_SETTINGS],
  }
}

export function downloadThreeMf(file: RemappedThreeMf): void {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement("a")
  link.href = url
  link.download = file.fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
