import { normalizeHex } from "../color/hex"
import type { PhysicalSpool } from "../types"

type UnknownRecord = Record<string, unknown>
const MAX_SOURCE_CHARACTERS = 10 * 1024 * 1024
const MAX_SPOOL_ROWS = 100_000

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
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

export function parseSpoolExport(source: string): PhysicalSpool[] {
  if (source.length > MAX_SOURCE_CHARACTERS) {
    throw new Error("This inventory export exceeds Spoolmap's 10 MB safety limit.")
  }
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
        (parsed as UnknownRecord).data ??
        (parsed as UnknownRecord).items)
      : null

  if (!Array.isArray(rows)) {
    throw new Error("Could not find a spool list in this JSON export.")
  }
  if (rows.length > MAX_SPOOL_ROWS) {
    throw new Error("This inventory export contains too many spool records.")
  }

  const seenIds = new Map<string, number>()
  const spools = rows.flatMap((row, position): PhysicalSpool[] => {
    if (!row || typeof row !== "object") return []
    const raw = row as UnknownRecord
    const hex = firstColor(raw.rgb ?? raw.color_hex ?? raw.hex)
    if (!hex) return []

    const sourceId =
      text(raw.short_code) ||
      text(raw.id) ||
      text(raw.spool_url) ||
      `${text(raw.brand)}-${text(raw.color)}-${position}`
    const occurrence = (seenIds.get(sourceId) ?? 0) + 1
    seenIds.set(sourceId, occurrence)
    // Selection and saved-session identity must be unique even when an export
    // contains duplicate source identifiers. The suffix is deterministic for
    // a stable export and stays internal; the original row remains in `raw`.
    const id = occurrence === 1 ? sourceId : `${sourceId}#${occurrence}`

    return [
      {
        id,
        brand: text(raw.brand) || text(raw.vendor) || "Unknown brand",
        material: text(raw.material) || "Unknown",
        materialType: text(raw.material_type) || text(raw.type),
        colorName: text(raw.color) || text(raw.color_name) || hex,
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
