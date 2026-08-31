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
    expect(() => parseSpoolExport("not json")).toThrow("not valid JSON or CSV")
    expect(() => parseSpoolExport("{}")).toThrow("find a spool list")
    expect(() => parseSpoolExport('[{"rgb":"nope"}]')).toThrow("No spools with usable RGB colors")
  })

  it("reads nested Spoolman-style JSON by lifting filament fields", () => {
    const [spool] = parseSpoolExport(
      JSON.stringify([
        {
          id: 17,
          remaining_weight: 640,
          filament: {
            name: "Signal Red",
            material: "PLA",
            color_hex: "FF0000",
            vendor: { name: "Bambu Lab" },
          },
        },
      ]),
    )

    expect(spool).toMatchObject({
      id: "17",
      brand: "Bambu Lab",
      material: "PLA",
      colorName: "Signal Red",
      hex: "#FF0000",
      remainingGrams: 640,
    })
  })

  it("reads a 3DFilamentProfiles-style CSV and a semicolon spreadsheet", () => {
    const [fromComma] = parseSpoolExport(
      "brand,material,material_type,color,rgb,remaining_grams\nMaker,PLA,Matte,Forest,#1a2b3c,321.5\n",
    )
    expect(fromComma).toMatchObject({
      brand: "Maker",
      material: "PLA",
      materialType: "Matte",
      colorName: "Forest",
      hex: "#1A2B3C",
      remainingGrams: 321.5,
    })

    const [fromSemi] = parseSpoolExport(
      "Manufacturer;Material;Colour Hex;Name\nPrusament;PETG;00ff00;Galaxy\n",
    )
    expect(fromSemi).toMatchObject({
      brand: "Prusament",
      material: "PETG",
      colorName: "Galaxy",
      hex: "#00FF00",
    })
  })

  it("keeps quoted CSV commas inside a field", () => {
    const [spool] = parseSpoolExport('brand,color,hex\n"Maker, Inc",Red,#ff0000\n')
    expect(spool).toMatchObject({ brand: "Maker, Inc", colorName: "Red", hex: "#FF0000" })
  })
})
