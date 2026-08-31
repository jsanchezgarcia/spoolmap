import { describe, expect, it } from "vitest"
import { parseSpoolExport } from "../parse/spools"
import { parseThreeMfData, revokeProjectUrls } from "../parse/threeMf"
import {
  SAMPLE_INVENTORY,
  SAMPLE_MODEL_NAME,
  SAMPLE_PROJECT_TITLE,
  createSampleProject,
  sampleInventoryText,
} from "./demoProject"

describe("sample project", () => {
  it("parses as a plain JSON spool array without a 3DFilamentProfiles wrapper", () => {
    const spools = parseSpoolExport(sampleInventoryText())
    expect(spools).toHaveLength(SAMPLE_INVENTORY.length)
    expect(spools.map(({ colorName }) => colorName)).toContain("Orange")
    expect(spools.some(({ brand }) => brand === "Polymaker")).toBe(true)
  })

  it("opens as a two-plate Bambu-style 3MF with four design colors", async () => {
    const project = await parseThreeMfData(await createSampleProject(), SAMPLE_MODEL_NAME)
    expect(project.title).toBe(SAMPLE_PROJECT_TITLE)
    expect(project.fileName).toBe(SAMPLE_MODEL_NAME)
    expect(project.filaments).toHaveLength(4)
    expect(project.plates.map(({ name }) => name)).toEqual(["Toadstool", "Planter"])
    expect(project.plates[0]?.filamentIndexes).toEqual([1, 2, 3])
    expect(project.plates[1]?.filamentIndexes).toEqual([3, 4])
    expect(project.thumbnail).toBeTruthy()
    expect(project.plates.every(({ thumbnail }) => Boolean(thumbnail))).toBe(true)
    revokeProjectUrls(project)
  })
})
