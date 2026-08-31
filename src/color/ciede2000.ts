import type { Lab, Rgb } from "../types"
import { hexToRgb, normalizeHex } from "./hex"

const labByHex = new Map<string, Lab>()

function srgbToLinear(channel: number): number {
  const v = channel / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function rgbToLab(rgb: Rgb): Lab {
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)

  let x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100
  let y = (r * 0.2126729 + g * 0.7151522 + b * 0.072175) * 100
  let z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) * 100

  const xn = 95.047
  const yn = 100
  const zn = 108.883
  const delta = 6 / 29
  const f = (t: number) => (t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta * delta) + 4 / 29)

  const fx = f(x / xn)
  const fy = f(y / yn)
  const fz = f(z / zn)

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  }
}

/** CIEDE2000 (Sharma, Wu, Dalal). Smaller is closer. */
export function deltaE00(lab1: Lab, lab2: Lab): number {
  const { l: l1, a: a1, b: b1 } = lab1
  const { l: l2, a: a2, b: b2 } = lab2
  const deg360 = 2 * Math.PI
  const deg180 = Math.PI
  const pow25To7 = 25 ** 7

  const c1 = Math.hypot(a1, b1)
  const c2 = Math.hypot(a2, b2)
  const cMean = (c1 + c2) / 2
  const cMean7 = cMean ** 7
  const g = 0.5 * (1 - Math.sqrt(cMean7 / (cMean7 + pow25To7)))

  const a1p = (1 + g) * a1
  const a2p = (1 + g) * a2
  const c1p = Math.hypot(a1p, b1)
  const c2p = Math.hypot(a2p, b2)

  const hPrime = (ap: number, b: number) => {
    if (ap === 0 && b === 0) return 0
    let h = Math.atan2(b, ap)
    if (h < 0) h += deg360
    return h
  }

  const h1p = hPrime(a1p, b1)
  const h2p = hPrime(a2p, b2)
  const deltaLp = l2 - l1
  const deltaCp = c2p - c1p

  let deltahp = 0
  if (c1p * c2p !== 0) {
    const diff = h2p - h1p
    if (Math.abs(diff) <= deg180) deltahp = diff
    else if (diff > deg180) deltahp = diff - deg360
    else deltahp = diff + deg360
  }
  const deltaHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(deltahp / 2)

  const lpMean = (l1 + l2) / 2
  const cpMean = (c1p + c2p) / 2
  let hpMean = h1p + h2p
  if (c1p * c2p !== 0) {
    const diff = Math.abs(h1p - h2p)
    const sum = h1p + h2p
    if (diff <= deg180) hpMean = sum / 2
    else if (sum < deg360) hpMean = (sum + deg360) / 2
    else hpMean = (sum - deg360) / 2
  }

  const t =
    1 -
    0.17 * Math.cos(hpMean - deg180 / 6) +
    0.24 * Math.cos(2 * hpMean) +
    0.32 * Math.cos(3 * hpMean + deg180 / 30) -
    0.2 * Math.cos(4 * hpMean - (63 * deg180) / 180)

  const lpMinus50 = (lpMean - 50) ** 2
  const sL = 1 + (0.015 * lpMinus50) / Math.sqrt(20 + lpMinus50)
  const sC = 1 + 0.045 * cpMean
  const sH = 1 + 0.015 * cpMean * t
  const cpMean7 = cpMean ** 7
  const rC = 2 * Math.sqrt(cpMean7 / (cpMean7 + pow25To7))
  const dTheta =
    (deg180 / 6) * Math.exp(-((hpMean - (275 * deg180) / 180) ** 2) / ((25 * deg180) / 180) ** 2)
  const rT = -Math.sin(2 * dTheta) * rC

  const dL = deltaLp / sL
  const dC = deltaCp / sC
  const dH = deltaHp / sH
  return Math.sqrt(dL * dL + dC * dC + dH * dH + rT * dC * dH)
}

/** Cached sRGB → Lab. Matching ranks every filament against every spool. */
export function hexToLab(hex: string): Lab | null {
  const normalized = normalizeHex(hex)
  if (!normalized) return null
  const cached = labByHex.get(normalized)
  if (cached) return cached
  const rgb = hexToRgb(normalized)
  if (!rgb) return null
  const lab = rgbToLab(rgb)
  labByHex.set(normalized, lab)
  return lab
}

export function hexDeltaE(hexA: string, hexB: string): number {
  const a = hexToLab(hexA)
  const b = hexToLab(hexB)
  if (!a || !b) return 999
  return deltaE00(a, b)
}
