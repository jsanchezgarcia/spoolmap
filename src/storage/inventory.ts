import type { PhysicalSpool } from "../types"

function isStoredSpool(value: unknown): value is PhysicalSpool {
  if (!value || typeof value !== "object") return false
  const row = value as Partial<PhysicalSpool>
  return (
    typeof row.id === "string" &&
    typeof row.hex === "string" &&
    typeof row.material === "string" &&
    row.raw !== null &&
    typeof row.raw === "object"
  )
}

/** Filters browser-cached data before it is allowed back into app state. */
export function readStoredSpools(value: unknown): PhysicalSpool[] {
  return Array.isArray(value) ? value.filter(isStoredSpool) : []
}
