import { describe, expect, it } from "vitest"
import { demotionReason } from "./format"
import { defaultSelection, rankSpools, topAlternatives } from "./matching"
import type { LogicalFilament, PhysicalSpool } from "./types"

const filament: LogicalFilament = {
  index: 1,
  hex: "#FF0000",
  material: "PLA",
  vendor: "Bambu Lab",
  label: "PLA Basic Red",
  source: "fixture",
}

function spool(id: string, overrides: Partial<PhysicalSpool> = {}): PhysicalSpool {
  return {
    id,
    brand: "Owned",
    material: "PLA",
    materialType: "Basic",
    colorName: id,
    hex: "#FF0000",
    remainingGrams: 500,
    raw: {},
    ...overrides,
  }
}

describe("spool matching", () => {
  it("ranks compatible recommendations before closer explicit overrides", () => {
    const matches = rankSpools(filament, [
      spool("exact-petg", { material: "PETG" }),
      spool("near-pla", { hex: "#770000" }),
    ])

    expect(matches.map((match) => match.spool.id)).toEqual(["near-pla", "exact-petg"])
    expect(matches.map((match) => match.rank)).toEqual([0, 1])
    expect(matches[0]).toMatchObject({ materialOk: true, defaultable: true })
    expect(matches[1]).toMatchObject({ materialOk: false, defaultable: false })
    expect(defaultSelection(matches)).toBe("near-pla")
    expect(topAlternatives(matches, 3).map((match) => match.spool.id)).toEqual(["near-pla"])
  })

  it("recognizes decorated material names as the same base polymer", () => {
    const [match] = rankSpools(filament, [spool("pla-plus", { material: "PLA+/Pro" })])

    expect(match).toMatchObject({ materialOk: true, defaultable: true })
  })

  it("surfaces a neutral finish difference without penalizing an unspecified profile", () => {
    const [match] = rankSpools({ ...filament, label: "PLA" }, [
      spool("matte", { materialType: "Matte" }),
    ])

    expect(match).toMatchObject({
      score: match.deltaE,
      finishMismatch: true,
      materialOk: true,
      defaultable: true,
    })
  })

  it("treats Basic as the absence of a special finish", () => {
    const [match] = rankSpools({ ...filament, label: "Generic PETG", material: "PETG" }, [
      spool("basic", { material: "PETG", materialType: "Basic" }),
    ])

    expect(match.finishMismatch).toBe(false)
    expect(match.score).toBe(match.deltaE)
  })

  it("surfaces a specialty finish against a Basic profile without over-penalizing it", () => {
    const [match] = rankSpools({ ...filament, label: "PLA Basic" }, [
      spool("matte", { materialType: "Matte" }),
    ])

    expect(match.finishMismatch).toBe(true)
    expect(match.score).toBe(match.deltaE)
  })

  it("does not auto-select support or multicolor stock for an ordinary part", () => {
    const matches = rankSpools(filament, [
      spool("support", { materialType: "Support" }),
      spool("multicolor", { raw: { rgb: "#FF0000,#0000FF" } }),
    ])

    expect(matches.every((match) => !match.defaultable)).toBe(true)
    expect(defaultSelection(matches)).toBeNull()
    expect(topAlternatives(matches, 3)).toEqual([])
  })

  it("does not auto-select ordinary stock for a requested support filament", () => {
    const supportFilament = {
      ...filament,
      label: "Support for PLA",
    }
    const matches = rankSpools(supportFilament, [
      spool("ordinary"),
      spool("support", { materialType: "Support" }),
    ])

    expect(matches.map((match) => match.spool.id)).toEqual(["support", "ordinary"])
    expect(matches.map((match) => match.defaultable)).toEqual([true, false])
    expect(defaultSelection(matches)).toBe("support")
    expect(demotionReason(supportFilament, matches[1].spool)).toBe("Support filament required")
  })

  it("requires a multicolor spool when the project requests one", () => {
    const multiColorFilament = {
      ...filament,
      label: "PLA Basic Multi-color",
    }
    const matches = rankSpools(multiColorFilament, [
      spool("ordinary"),
      spool("multicolor", { raw: { rgb: "#FF0000,#0000FF" } }),
    ])

    expect(matches.map((match) => match.spool.id)).toEqual(["multicolor", "ordinary"])
    expect(defaultSelection(matches)).toBe("multicolor")
    expect(demotionReason(multiColorFilament, matches[1].spool)).toBe("Multi-color spool required")
  })

  it("uses remaining weight and then color name as stable tie breakers", () => {
    const matches = rankSpools(filament, [
      spool("low", { remainingGrams: 100, colorName: "Zulu" }),
      spool("high", { remainingGrams: 900, colorName: "Alpha" }),
    ])

    expect(matches.map((match) => match.spool.id)).toEqual(["high", "low"])
  })

  it("ranks a large inventory without changing the winner for an exact color", () => {
    const inventory = Array.from({ length: 2500 }, (_, index) =>
      spool(`spool-${index}`, {
        hex:
          index === 1842
            ? "#FF0000"
            : `#${(0x100000 + index).toString(16).slice(-6).toUpperCase()}`,
        remainingGrams: index === 1842 ? 900 : 10,
      }),
    )
    const matches = rankSpools(filament, inventory)
    expect(defaultSelection(matches)).toBe("spool-1842")
    expect(matches[0]).toMatchObject({ spool: { id: "spool-1842" }, deltaE: 0 })
  })

  it("collapses duplicate products only in the short alternatives list", () => {
    const matches = rankSpools(filament, [
      spool("first"),
      spool("second", { colorName: "first" }),
      spool("different", { colorName: "Crimson", hex: "#CC0000" }),
    ])

    expect(matches).toHaveLength(3)
    expect(topAlternatives(matches, 3).map((match) => match.spool.id)).toEqual([
      "first",
      "different",
    ])
  })

  it("does not collapse multicolor products with different secondary colors", () => {
    const matches = rankSpools({ ...filament, label: "PLA Multi-color" }, [
      spool("red-blue", {
        colorName: "Dual",
        raw: { rgb: "#FF0000,#0000FF" },
      }),
      spool("red-green", {
        colorName: "Dual",
        raw: { rgb: "#FF0000,#00FF00" },
      }),
    ])

    expect(topAlternatives(matches, 3).map((match) => match.spool.id)).toEqual([
      "red-blue",
      "red-green",
    ])
  })
})
