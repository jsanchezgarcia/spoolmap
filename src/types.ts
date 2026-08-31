export type Rgb = { r: number; g: number; b: number }

export type Lab = { l: number; a: number; b: number }

export type LogicalFilament = {
  index: number
  hex: string
  material: string
  vendor: string
  label: string
  source: string
}

export type ProjectPlate = {
  id: string
  name: string
  /** Union of default extruders and painted (MMU) filaments used on the plate. */
  filamentIndexes: number[]
  /** Root 3MF build objects assigned to this physical plate. */
  objectIds: string[]
  objectNames: string[]
  thumbnail: string | null
}

export type PhysicalSpool = {
  id: string
  brand: string
  material: string
  materialType: string
  colorName: string
  hex: string
  remainingGrams: number | null
  raw: Record<string, unknown>
}

export type SpoolMatch = {
  spool: PhysicalSpool
  /** Zero-based position in the complete ranked inventory. */
  rank: number
  deltaE: number
  /**
   * Color distance plus material and purpose penalties. Lower ranks higher
   * within the compatible or explicit-override group.
   */
  score: number
  /** Right base polymer and right purpose, so it needs no caveat. */
  materialOk: boolean
  /** True only when this spool is safe to auto-select for this filament. */
  defaultable: boolean
  /**
   * The profile and spool name different finishes, or only one names a finish.
   * This is informational: an unspecified finish stays selectable and carries
   * no ranking penalty.
   */
  finishMismatch: boolean
}

export type FilamentChoice = {
  filament: LogicalFilament
  matches: SpoolMatch[]
  selectedSpoolId: string | null
}
