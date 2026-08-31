import { hexToRgb } from "./hex"

type Hsl = { h: number; s: number; l: number }

function rgbToHsl(r: number, g: number, b: number): Hsl {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  const l = (max + min) / 2

  if (delta === 0) return { h: 0, s: 0, l }

  const s = delta / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === red) h = ((green - blue) / delta) % 6
  else if (max === green) h = (blue - red) / delta + 2
  else h = (red - green) / delta + 4

  h *= 60
  if (h < 0) h += 360
  return { h, s, l }
}

const hueNames: Array<[number, string]> = [
  [12, "red"],
  [38, "orange"],
  [52, "amber"],
  [68, "yellow"],
  [90, "lime"],
  [150, "green"],
  [175, "teal"],
  [195, "cyan"],
  [215, "azure"],
  [250, "blue"],
  [275, "indigo"],
  [295, "violet"],
  [320, "purple"],
  [345, "magenta"],
  [360, "red"],
]

function hueName(hue: number): string {
  return hueNames.find(([limit]) => hue < limit)?.[1] ?? "red"
}

function neutralName(l: number): string {
  if (l < 0.06) return "Black"
  if (l < 0.22) return "Near black"
  if (l < 0.42) return "Charcoal gray"
  if (l < 0.62) return "Mid gray"
  if (l < 0.82) return "Light gray"
  if (l < 0.95) return "Off white"
  return "White"
}

/** A short, human-readable sense of a color, so a hex string is not the only cue. */
export function describeColor(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return "Unknown color"

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b)
  if (s < 0.12 || l > 0.97) return neutralName(l)

  const hue = hueName(h)

  if (l > 0.86) {
    if (h >= 8 && h < 45) return "Pale peach"
    if (h >= 45 && h < 72) return "Cream"
    if (h >= 310 || h < 8) return "Blush pink"
    return `Pale ${hue}`
  }
  if (h >= 310 && l > 0.62) return "Pink"
  if (h >= 340 && l > 0.55) return "Rose"
  if (l > 0.72) return `Light ${hue}`
  if (l < 0.18) return `Deep ${hue}`
  if (l < 0.34) return `Dark ${hue}`
  if (s < 0.32) return `Muted ${hue}`
  if (s > 0.75) return `Vivid ${hue}`
  return hue.charAt(0).toUpperCase() + hue.slice(1)
}
