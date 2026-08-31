import { normalizeHex } from "./color/hex"
import type { LogicalFilament, PhysicalSpool } from "./types"

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

/**
 * Downloaded 3MFs keep the URL encoding of their source page, so names arrive
 * as "Brick+Men+-+Peach.3mf". Only the display form is cleaned; the real file
 * name is still what gets written back out on export.
 */
export function displayFileName(name: string): string {
  const spaced = name.replaceAll("+", " ")
  try {
    return decodeURIComponent(spaced).replace(/\s+/g, " ").trim()
  } catch {
    return spaced.replace(/\s+/g, " ").trim()
  }
}

/**
 * File names carry their identity at both ends: the model name at the front,
 * the "(2)" download suffix and the extension at the back. Cutting the middle
 * is the only cut that keeps both, which is why Finder has done it since 1992.
 * The untruncated name always stays available in a `title`.
 */
export function truncateMiddle(value: string, max: number): string {
  // Below three hidden characters the ellipsis costs more than it saves.
  if (max < 10 || value.length < max + 2) return value
  const head = Math.ceil((max - 1) / 2)
  const tail = max - 1 - head
  return `${value.slice(0, head).trimEnd()}…${value.slice(value.length - tail).trimStart()}`
}

/** The precise moment behind a relative time, for tooltips and `datetime`. */
export function exactTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function relativeTime(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  /*
   * An inventory goes stale at seven days, so the ages that matter most are
   * the ones just past it. A bare date makes the reader do the subtraction;
   * one coarse unit answers "how old is this?" on sight.
   */
  const weeks = Math.round(days / 7)
  if (weeks < 9) return `${weeks} wk ago`
  const months = Math.round(days / 30)
  if (months < 18) return `${months} mo ago`
  return new Date(timestamp).toLocaleDateString()
}

/** Full material identity of an owned spool, e.g. "PLA Matte" or "PLA Silk+". */
export function materialIdentity(spool: PhysicalSpool): string {
  return [spool.material, spool.materialType].filter(Boolean).join(" ")
}

/**
 * Every color printed on a spool. Bambu multi-color spools list several
 * comma-separated hexes in one field, which the parser flattens to the first.
 */
export function spoolColors(spool: PhysicalSpool): string[] {
  const source = spool.raw.rgb ?? spool.raw.color_hex ?? spool.raw.hex
  if (typeof source !== "string") return [spool.hex]
  const colors = source
    .split(",")
    .map((part) => normalizeHex(part))
    .filter((part): part is string => Boolean(part))
  return colors.length > 0 ? colors : [spool.hex]
}

export function isMultiColor(spool: PhysicalSpool): boolean {
  return spoolColors(spool).length > 1
}

export function swatchBackground(colors: string[]): string {
  if (colors.length < 2) return colors[0] ?? "#D7DADD"
  const step = 100 / colors.length
  const stops = colors
    .map((color, index) => `${color} ${index * step}% ${(index + 1) * step}%`)
    .join(", ")
  return `linear-gradient(135deg, ${stops})`
}

/**
 * Why a spool was demoted. Ranking itself lives in matching.ts; this only
 * turns an already-computed `materialOk: false` into words for the operator.
 */
export function demotionReason(filament: LogicalFilament, spool: PhysicalSpool): string {
  const requested = `${filament.label} ${filament.material}`.toLowerCase()
  const offered = `${spool.material} ${spool.materialType}`.toLowerCase()
  const requestsSupport = requested.includes("support")
  const offersSupport = offered.includes("support")
  if (requestsSupport !== offersSupport) {
    return offersSupport ? "Support filament" : "Support filament required"
  }
  const requestsMultiColor = requested.includes("multi-color") || requested.includes("multicolor")
  const offersMultiColor =
    isMultiColor(spool) || offered.includes("multi-color") || offered.includes("multicolor")
  if (requestsMultiColor !== offersMultiColor) {
    return offersMultiColor ? "Multi-color spool" : "Multi-color spool required"
  }
  const wanted = filament.material.trim().toUpperCase()
  const owned = spool.material.trim().toUpperCase()
  if (wanted && owned && !owned.startsWith(wanted) && !wanted.startsWith(owned)) {
    return `${spool.material}, not ${filament.material}`
  }
  return "Different material"
}
