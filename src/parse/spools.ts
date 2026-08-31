import { normalizeHex } from "../color/hex"
import type { PhysicalSpool } from "../types"

type UnknownRecord = Record<string, unknown>
const MAX_SOURCE_CHARACTERS = 10 * 1024 * 1024
const MAX_SPOOL_ROWS = 100_000

function text(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function firstColor(value: unknown): string | null {
  const first = text(value).split(",")[0]
  return normalizeHex(first)
}

function hasText(row: UnknownRecord, key: string): boolean {
  return text(row[key]) !== ""
}

function firstText(row: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = text(row[key])
    if (value) return value
  }
  return ""
}

function firstValue(row: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && text(row[key]) !== "") return row[key]
  }
  return undefined
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

/** Lifts nested tracker fields (Spoolman `filament.color_hex`) onto the flat keys the rest of the parser already reads. */
function flattenTrackerRow(row: UnknownRecord): UnknownRecord {
  const flat: UnknownRecord = { ...row }
  const filament = asRecord(row.filament)
  if (filament) {
    for (const [key, value] of Object.entries(filament)) {
      if (flat[key] === undefined) flat[key] = value
    }
    const vendor = filament.vendor
    if (typeof vendor === "string" && !hasText(flat, "vendor")) flat.vendor = vendor
    const vendorName = asRecord(vendor)?.name
    if (typeof vendorName === "string") {
      if (!hasText(flat, "vendor")) flat.vendor = vendorName
      if (!hasText(flat, "brand")) flat.brand = vendorName
    }
    if (!hasText(flat, "color") && hasText(filament, "name")) flat.color = filament.name
  }
  return flat
}

function applyFieldAliases(row: UnknownRecord): UnknownRecord {
  const aliased: UnknownRecord = { ...row }
  const fill = (canonical: string, aliases: string[]): void => {
    if (hasText(aliased, canonical)) return
    const value = firstValue(aliased, aliases)
    if (value !== undefined) aliased[canonical] = value
  }

  fill("color_hex", [
    "colour_hex",
    "colorhex",
    "color_hex_code",
    "filament_color_hex",
    "multi_color_hexes",
    "multicolor",
  ])
  fill("brand", ["manufacturer", "make", "filament_vendor", "filament_vendor_name"])
  fill("vendor", ["filament_vendor", "filament_vendor_name", "manufacturer"])
  fill("material", ["filament_material", "material_name"])
  fill("material_type", ["variant", "finish", "filament_type"])
  fill("color", ["colour", "filament_name", "name", "filament"])
  fill("color_name", ["colour_name", "filament_name", "name"])
  fill("remaining_weight", [
    "remaining_weight_g",
    "remaining_weight_(g)",
    "weight_remaining",
    "left_g",
  ])
  fill("id", ["spool_id", "sku", "label"])
  return aliased
}

function rowsFromJson(source: string): unknown[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error("This inventory file is not valid JSON.")
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? ((parsed as UnknownRecord).spools ??
        (parsed as UnknownRecord).filaments ??
        (parsed as UnknownRecord).data ??
        (parsed as UnknownRecord).items)
      : null

  if (!Array.isArray(rows)) {
    throw new Error("Could not find a spool list in this JSON export.")
  }
  return rows
}

function countUnquoted(line: string, delimiter: string): number {
  let count = 0
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (!inQuotes && character === delimiter) count += 1
  }
  return count
}

function detectDelimiter(headerLine: string): "," | ";" | "\t" {
  const candidates = [
    [",", countUnquoted(headerLine, ",")] as const,
    [";", countUnquoted(headerLine, ";")] as const,
    ["\t", countUnquoted(headerLine, "\t")] as const,
  ]
  candidates.sort((left, right) => right[1] - left[1])
  return candidates[0][1] > 0 ? candidates[0][0] : ","
}

function parseCsvRecords(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "")
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ""
  const delimiter = detectDelimiter(firstLine)
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false

  const pushRow = (): void => {
    row.push(field)
    field = ""
    if (row.some((cell) => cell.trim() !== "")) rows.push(row)
    row = []
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
          continue
        }
        inQuotes = false
        continue
      }
      field += character
      continue
    }
    if (character === '"') {
      inQuotes = true
      continue
    }
    if (character === delimiter) {
      row.push(field)
      field = ""
      continue
    }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1
      pushRow()
      continue
    }
    field += character
  }
  pushRow()
  return rows
}

function normalizeHeader(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
}

function rowsFromCsv(source: string): unknown[] {
  const records = parseCsvRecords(source)
  const headers = records[0]?.map(normalizeHeader) ?? []
  if (headers.length === 0 || !headers.some(Boolean)) {
    throw new Error("This inventory file is not a valid CSV export.")
  }
  return records.slice(1).map((cells) => {
    const row: UnknownRecord = {}
    headers.forEach((header, index) => {
      if (!header) return
      row[header] = cells[index] ?? ""
    })
    return row
  })
}

function looksLikeJson(source: string): boolean {
  const start = source.trimStart()
  return start.startsWith("{") || start.startsWith("[")
}

function looksLikeCsv(source: string): boolean {
  const header =
    source
      .replace(/^\uFEFF/, "")
      .trimStart()
      .split(/\r?\n/, 1)[0] ?? ""
  return (
    countUnquoted(header, ",") > 0 ||
    countUnquoted(header, ";") > 0 ||
    countUnquoted(header, "\t") > 0
  )
}

function rowsToSpools(rows: unknown[]): PhysicalSpool[] {
  if (rows.length > MAX_SPOOL_ROWS) {
    throw new Error("This inventory export contains too many spool records.")
  }

  const seenIds = new Map<string, number>()
  const spools = rows.flatMap((row, position): PhysicalSpool[] => {
    if (!row || typeof row !== "object") return []
    const raw = applyFieldAliases(flattenTrackerRow(row as UnknownRecord))
    const hex = firstColor(raw.rgb ?? raw.color_hex ?? raw.hex)
    if (!hex) return []

    const sourceId =
      firstText(raw, ["short_code", "id", "spool_url"]) ||
      `${firstText(raw, ["brand", "vendor"])}-${firstText(raw, ["color", "color_name"])}-${position}`
    const occurrence = (seenIds.get(sourceId) ?? 0) + 1
    seenIds.set(sourceId, occurrence)
    // Selection and saved-session identity must be unique even when an export
    // contains duplicate source identifiers. The suffix is deterministic for
    // a stable export and stays internal; the original row remains in `raw`.
    const id = occurrence === 1 ? sourceId : `${sourceId}#${occurrence}`

    return [
      {
        id,
        brand: firstText(raw, ["brand", "vendor"]) || "Unknown brand",
        material: text(raw.material) || "Unknown",
        materialType: firstText(raw, ["material_type", "type"]),
        colorName: firstText(raw, ["color", "color_name"]) || hex,
        hex,
        remainingGrams: numberOrNull(raw.remaining_grams ?? raw.remaining_weight ?? raw.remaining),
        raw,
      },
    ]
  })

  if (spools.length === 0) {
    throw new Error("No spools with usable RGB colors were found in this export.")
  }

  return spools
}

export function parseSpoolExport(source: string): PhysicalSpool[] {
  if (source.length > MAX_SOURCE_CHARACTERS) {
    throw new Error("This inventory export exceeds Spoolmap's 10 MB safety limit.")
  }
  if (looksLikeJson(source)) return rowsToSpools(rowsFromJson(source))
  if (looksLikeCsv(source)) return rowsToSpools(rowsFromCsv(source))
  throw new Error("This inventory file is not valid JSON or CSV.")
}
