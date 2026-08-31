import { describe, expect, it } from "vitest"
import { parseSpoolExport } from "./spools"

describe("inventory import", () => {
  it("accepts wrapped exports and normalizes common field variants", () => {
    const [spool] = parseSpoolExport(
      JSON.stringify({
        data: [
          {
            id: "42",
            vendor: "Maker",
            material: "PLA",
            type: "Matte",
            color_name: "Forest",
            color_hex: "0x1a2b3c, #ffffff",
            remaining_weight: "321.5",
          },
        ],
      }),
    )

    expect(spool).toMatchObject({
      id: "42",
      brand: "Maker",
      material: "PLA",
      materialType: "Matte",
      colorName: "Forest",
      hex: "#1A2B3C",
      remainingGrams: 321.5,
    })
  })

  it("skips malformed rows while retaining usable spools", () => {
    const spools = parseSpoolExport(
      JSON.stringify([
        null,
        { id: "bad", rgb: "not-a-color" },
        { short_code: "ok", rgb: "abc", color: "Tiny hex" },
      ]),
    )

    expect(spools).toHaveLength(1)
    expect(spools[0]).toMatchObject({ id: "ok", hex: "#AABBCC" })
  })

  it("gives duplicate source identifiers stable unique selection keys", () => {
    const spools = parseSpoolExport(
      JSON.stringify([
        { short_code: "same", rgb: "#112233", color: "First" },
        { short_code: "same", rgb: "#445566", color: "Second" },
      ]),
    )

    expect(spools.map(({ id }) => id)).toEqual(["same", "same#2"])
    expect(spools.map(({ colorName }) => colorName)).toEqual(["First", "Second"])
  })

  it("reports invalid JSON, missing lists, and lists with no usable colors", () => {
    expect(() => parseSpoolExport("not json")).toThrow("not valid JSON")
    expect(() => parseSpoolExport("{}")).toThrow("find a spool list")
    expect(() => parseSpoolExport('[{"rgb":"nope"}]')).toThrow("No spools with usable RGB colors")
  })
})
