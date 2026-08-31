/** Minimal inventory a visitor can type or paste without 3DFilamentProfiles. */
export const INVENTORY_FORMAT_EXAMPLE = `[
  {
    "brand": "Bambu Lab",
    "material": "PLA",
    "color": "Orange",
    "rgb": "#FF6A13"
  },
  {
    "hex": "#F0E6D2"
  }
]
`

export function inventoryFormatExample(): string {
  return INVENTORY_FORMAT_EXAMPLE
}
