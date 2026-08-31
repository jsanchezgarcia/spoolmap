import { describe, expect, it } from "vitest"
import { parseSpoolExport } from "../parse/spools"
import { INVENTORY_FORMAT_EXAMPLE, inventoryFormatExample } from "./inventoryFormat"

describe("inventory format example", () => {
  it("parses as a two-spool list using rgb and hex", () => {
    const spools = parseSpoolExport(inventoryFormatExample())
    expect(INVENTORY_FORMAT_EXAMPLE).toContain("rgb")
    expect(spools).toHaveLength(2)
    expect(spools[0]).toMatchObject({
      brand: "Bambu Lab",
      material: "PLA",
      colorName: "Orange",
      hex: "#FF6A13",
    })
    expect(spools[1]).toMatchObject({ hex: "#F0E6D2" })
  })
})
