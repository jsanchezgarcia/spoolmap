import JSZip from "jszip"
import { describe, expect, it } from "vitest"
import { threeMfFixture } from "../test/threeMfFixture"
import { withDeclaredUncompressedSize } from "../test/zipDeclaredSize"
import { parseThreeMfData } from "./threeMf"

describe("3MF project import", () => {
  it("extracts normalized filament definitions and per-plate usage", async () => {
    const project = await parseThreeMfData(await threeMfFixture(), "sample.3mf")

    expect(project).toMatchObject({
      fileName: "sample.3mf",
      title: "Fixture & Friends",
      thumbnail: null,
    })
    expect(project.filaments).toEqual([
      {
        index: 1,
        hex: "#FF0000",
        material: "PLA",
        vendor: "Bambu Lab",
        label: "PLA Basic Red",
        source: "Metadata/project_settings.config",
      },
      {
        index: 2,
        hex: "#00FF00",
        material: "PETG",
        vendor: "Generic",
        label: "PETG Green",
        source: "Metadata/project_settings.config",
      },
    ])
    expect(project.plates).toEqual([
      {
        id: "3",
        name: "Main plate",
        filamentIndexes: [2],
        objectIds: ["7"],
        objectNames: ["Body"],
        thumbnail: null,
      },
    ])
  })

  it("keeps source slot indexes when an invalid color is skipped", async () => {
    const data = await threeMfFixture({
      settings: JSON.stringify({
        filament_colour: ["not-a-color", "#123456"],
        filament_type: ["PLA", "ABS"],
        filament_vendor: ["One", "Two"],
        filament_settings_id: ["First", "Second"],
      }),
    })

    const project = await parseThreeMfData(data, "slots.3mf")

    expect(project.filaments).toEqual([
      expect.objectContaining({ index: 2, hex: "#123456", material: "ABS" }),
    ])
  })

  it("includes filaments painted onto component meshes in plate usage", async () => {
    const data = await threeMfFixture({
      model: `<model xmlns:p="fixture">
        <resources>
          <object type="model" id="7">
            <components>
              <component p:path="/3D/Objects/body.model" objectid="20" />
            </components>
          </object>
        </resources>
      </model>`,
      extraFiles: {
        "3D/Objects/body.model": `<model><object type="model" id="20"><mesh><triangles>
          <triangle v1="0" v2="1" v3="2" paint_color="4" />
        </triangles></mesh></object></model>`,
      },
    })

    const project = await parseThreeMfData(data, "painted.3mf")

    expect(project.plates[0]?.filamentIndexes).toEqual([1, 2])
  })

  it("rejects unreadable archives and projects without filament colors", async () => {
    await expect(
      parseThreeMfData(new TextEncoder().encode("not a zip"), "bad.3mf"),
    ).rejects.toThrow("not a readable 3MF archive")

    const empty = await threeMfFixture({ settings: "{}" })
    await expect(parseThreeMfData(empty, "empty.3mf")).rejects.toThrow("no project filament colors")
  })

  it("rejects an unterminated XML tag before its carry buffer can grow unchecked", async () => {
    const data = await threeMfFixture({
      extraFiles: { "3D/Objects/hostile.model": `<${"x".repeat(1024 * 1024)}` },
    })
    await expect(parseThreeMfData(data, "hostile.3mf")).rejects.toThrow(
      "contains an overlong XML tag",
    )
  })

  it("rejects archives whose numeric JSZip size declarations exceed the expansion limit", async () => {
    const entryName = "3D/3dmodel.model"
    const hostile = withDeclaredUncompressedSize(
      await threeMfFixture(),
      entryName,
      257 * 1024 * 1024,
    )
    const archive = await JSZip.loadAsync(hostile)
    const declaredSize = (
      archive.file(entryName) as JSZip.JSZipObject & {
        _data?: { uncompressedSize?: unknown }
      }
    )._data?.uncompressedSize

    expect(typeof declaredSize).toBe("number")
    expect(declaredSize).toBe(257 * 1024 * 1024)
    await expect(parseThreeMfData(hostile, "oversized.3mf")).rejects.toThrow(
      "expands beyond Spoolmap's 256 MB safety limit",
    )
  })
})
