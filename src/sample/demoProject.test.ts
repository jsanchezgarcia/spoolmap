import { describe, expect, it } from "vitest"
import { defaultSelection, rankSpools } from "../matching"
import { parseSpoolExport } from "../parse/spools"
import { parseThreeMfData, revokeProjectUrls } from "../parse/threeMf"
import {
  SAMPLE_INVENTORY,
  SAMPLE_MODEL_NAME,
  SAMPLE_PROJECT_TITLE,
  SAMPLE_SOURCE_NAME,
  SAMPLE_SOURCE_URL,
  createSampleProject,
  sampleInventoryText,
} from "./demoProject"

describe("sample project", () => {
  it("parses as a plain JSON spool array without a 3DFilamentProfiles wrapper", () => {
    const spools = parseSpoolExport(sampleInventoryText())
    expect(spools).toHaveLength(SAMPLE_INVENTORY.length)
    expect(spools.map(({ colorName }) => colorName)).toContain("Orange")
    expect(spools.some(({ brand }) => brand === "Polymaker")).toBe(true)
    expect(spools.map(({ hex }) => hex)).toEqual(
      expect.arrayContaining(["#FFFFFF", "#000000", "#FFC04D", "#1F9A8A", "#9D2235"]),
    )

    const orange = rankSpools(
      {
        index: 3,
        hex: "#FF9016",
        material: "PLA",
        vendor: "Bambu Lab",
        label: "PLA Basic",
        source: "sample",
      },
      spools,
    )
    const teal = rankSpools(
      {
        index: 4,
        hex: "#14676D",
        material: "PLA",
        vendor: "Bambu Lab",
        label: "PLA Basic",
        source: "sample",
      },
      spools,
    )
    expect(defaultSelection(orange)).toBe("bambu-orange")
    expect(orange[0]?.deltaE).toBeGreaterThan(12)
    expect(defaultSelection(teal)).toBe("bambu-teal")
    expect(teal[0]?.deltaE).toBeGreaterThan(18)
  })

  it("reuses the bundled archive for later clicks in the same session", async () => {
    const first = createSampleProject()
    const second = createSampleProject()
    expect(second).toBe(first)
    expect(await second).toBe(await first)
  })

  it("credits the unmodified MakerWorld 3MF", () => {
    expect(SAMPLE_SOURCE_NAME).toBe("Jov3DPrint")
    expect(SAMPLE_SOURCE_URL).toContain("makerworld.com/en/models/3020508")
  })

  it("opens as a single-plate painted Bambu 3MF with five design colors", async () => {
    const project = await parseThreeMfData(await createSampleProject(), SAMPLE_MODEL_NAME)
    expect(project.title).toBe(SAMPLE_PROJECT_TITLE)
    expect(project.fileName).toBe(SAMPLE_MODEL_NAME)
    expect(project.filaments.map(({ hex }) => hex)).toEqual([
      "#FFFFFF",
      "#000000",
      "#FF9016",
      "#14676D",
      "#9D2235",
    ])
    expect(project.plates).toHaveLength(1)
    expect(project.plates[0]?.name).toBe("Plate 1")
    expect(project.plates[0]?.filamentIndexes).toEqual([1, 2, 3, 4, 5])
    expect(project.thumbnail).toBeTruthy()
    expect(project.plates.every(({ thumbnail }) => Boolean(thumbnail))).toBe(true)
    revokeProjectUrls(project)
  })
})
