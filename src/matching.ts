import { deltaE00, hexToLab } from "./color/ciede2000"
import { isMultiColor, spoolColors } from "./format"
import type { Lab, LogicalFilament, PhysicalSpool, SpoolMatch } from "./types"

/**
 * Base polymers, longest first so a prefix test always resolves to the most
 * specific family rather than to whichever entry happened to be listed first.
 */
const FAMILIES = ["PETG", "HIPS", "PLA", "ABS", "ASA", "TPU", "PVA", "PA", "PC"].sort(
  (a, b) => b.length - a.length,
)

/** Finishes a slicer profile and a spool label can meaningfully disagree about. */
const FINISHES = [
  "matte",
  "silk",
  "translucent",
  "transparent",
  "glow",
  "marble",
  "wood",
  "sparkle",
  "metal",
]

/**
 * Penalties are in ΔE units so they compare directly against color distance.
 * ΔE 10 is roughly where a color stops being usable, so a different base
 * polymer has to be more than a full usability band closer before it outranks
 * the right material — but it is no longer barred outright, because a
 * near-exact color in the wrong material is worth showing the operator.
 */
const FAMILY_PENALTY = 16
const FINISH_PENALTY = 4

/**
 * Support and multi-color spools stay in the list so they can still be chosen
 * deliberately, but they sink below every ordinary spool and are never
 * auto-selected for a part that did not ask for them.
 */
const WRONG_PURPOSE_PENALTY = 60

/**
 * The base polymer behind a material string. Vendors decorate the polymer name
 * ("PLA+", "PLA+/Pro", "PLA Plus") while Bambu and Orca 3MFs only ever write
 * the bare polymer ("PLA"), so both sides have to collapse to one family.
 */
function materialFamily(value: string): string {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
  return FAMILIES.find((family) => normalized.startsWith(family)) ?? normalized
}

function finishOf(value: string): string | null {
  const text = value.toLowerCase()
  return FINISHES.find((finish) => text.includes(finish)) ?? null
}

function productKey(spool: PhysicalSpool): string {
  return [
    spool.brand,
    spool.material,
    spool.materialType,
    spool.colorName,
    spoolColors(spool).join(","),
  ]
    .join("|")
    .toLowerCase()
}

type FilamentPurpose = "ordinary" | "support" | "multi-color"

function purposeOf(value: string, multiColor: boolean): FilamentPurpose {
  const normalized = value.toLowerCase()
  if (normalized.includes("support")) return "support"
  if (multiColor || normalized.includes("multi-color") || normalized.includes("multicolor")) {
    return "multi-color"
  }
  return "ordinary"
}

type PreparedSpool = {
  spool: PhysicalSpool
  lab: Lab | null
  family: string
  finish: string | null
  purpose: FilamentPurpose
}

const preparedSpools = new WeakMap<PhysicalSpool, PreparedSpool>()

function prepareSpool(spool: PhysicalSpool): PreparedSpool {
  const cached = preparedSpools.get(spool)
  if (cached) return cached
  const prepared: PreparedSpool = {
    spool,
    lab: hexToLab(spool.hex),
    family: materialFamily(spool.material),
    finish: finishOf(`${spool.material} ${spool.materialType}`),
    purpose: purposeOf(`${spool.material} ${spool.materialType}`, isMultiColor(spool)),
  }
  preparedSpools.set(spool, prepared)
  return prepared
}

function scoreSpool(
  filamentLab: Lab | null,
  wantedFamily: string,
  wantedFinish: string | null,
  wantedPurpose: FilamentPurpose,
  prepared: PreparedSpool,
): Omit<SpoolMatch, "rank"> {
  const deltaE = filamentLab && prepared.lab ? deltaE00(filamentLab, prepared.lab) : 999
  const rightPurpose = prepared.purpose === wantedPurpose
  const rightFamily = prepared.family === wantedFamily
  const finishMismatch =
    rightFamily &&
    wantedFinish !== prepared.finish &&
    (wantedFinish !== null || prepared.finish !== null)

  let score = deltaE
  if (!rightPurpose) score += WRONG_PURPOSE_PENALTY
  if (!rightFamily) score += FAMILY_PENALTY
  else if (wantedFinish && prepared.finish && prepared.finish !== wantedFinish) {
    score += FINISH_PENALTY
  }

  return {
    spool: prepared.spool,
    deltaE,
    score,
    materialOk: rightFamily && rightPurpose,
    // A different polymer may still be useful as an explicit substitution,
    // but silently choosing it can produce an unprintable mapping. Keep it
    // visible in the picker without making that decision for the operator.
    defaultable: rightFamily && rightPurpose,
    finishMismatch,
  }
}

/**
 * Every owned spool, best first. Nothing is dropped: a spool the operator owns
 * has to stay reachable, so unsuitable stock is pushed down by score instead of
 * being filtered out and made invisible.
 */
export function rankSpools(filament: LogicalFilament, spools: PhysicalSpool[]): SpoolMatch[] {
  const wantedFamily = materialFamily(filament.material)
  const wantedFinish = finishOf(`${filament.label} ${filament.material}`)
  const wantedPurpose = purposeOf(`${filament.label} ${filament.material}`, false)
  const filamentLab = hexToLab(filament.hex)

  return spools
    .map((spool) =>
      scoreSpool(filamentLab, wantedFamily, wantedFinish, wantedPurpose, prepareSpool(spool)),
    )
    .sort(
      (a, b) =>
        // A list presented as recommendations must begin with the spool the
        // app is actually willing to recommend. Incompatible overrides remain
        // ranked by their score, but never acquire a contradictory "Best"
        // label by beating safe stock on color alone.
        Number(b.defaultable) - Number(a.defaultable) ||
        a.score - b.score ||
        a.deltaE - b.deltaE ||
        (b.spool.remainingGrams ?? -1) - (a.spool.remainingGrams ?? -1) ||
        a.spool.colorName.localeCompare(b.spool.colorName),
    )
    .map((match, rank) => ({ ...match, rank }))
}

/**
 * The short recommendation strip. It contains only choices that are safe to
 * recommend automatically; incompatible stock remains reachable in the full
 * picker without ever receiving a "Best" badge. Duplicate spools of one
 * product collapse to a single entry here, because two identical blacks are
 * not two suggestions.
 */
export function topAlternatives(matches: SpoolMatch[], limit: number): SpoolMatch[] {
  const seen = new Set<string>()
  return matches
    .filter(({ spool, defaultable }) => {
      if (!defaultable) return false
      const key = productKey(spool)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, limit)
}

/**
 * The opening choice. Only a material- and purpose-compatible spool may be
 * selected automatically. Incompatible stock remains available for a
 * deliberate override in the full picker.
 */
export function defaultSelection(matches: SpoolMatch[]): string | null {
  return matches.find((match) => match.defaultable)?.spool.id ?? null
}
