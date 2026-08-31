import type { Rgb } from "../types"

export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null
  let value = String(input).trim()
  if (!value) return null
  if (value.startsWith("0x") || value.startsWith("0X")) value = value.slice(2)
  if (!value.startsWith("#")) value = `#${value}`
  const hex = value.slice(1).replace(/[^0-9a-fA-F]/g, "")
  if (hex.length === 3) {
    const [r, g, b] = hex
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase()
  }
  if (hex.length === 6 || hex.length === 8) {
    return `#${hex.slice(0, 6).toUpperCase()}`
  }
  return null
}

export function hexToRgb(hex: string): Rgb | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  }
}
