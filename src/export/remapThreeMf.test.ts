import JSZip from "jszip"
import { describe, expect, it } from "vitest"
import { threeMfFixture } from "../test/threeMfFixture"
import { withDeclaredUncompressedSize } from "../test/zipDeclaredSize"
import { remappedFileName, remapThreeMf } from "./remapThreeMf"

describe("3MF color remapping", () => {
  it("updates requested one-based slots and preserves unrelated archive data", async () => {
    const source = await threeMfFixture({
      extraFiles: { "3D/Objects/mesh.model": "mesh bytes stay untouched" },
    })

    const result = await remapThreeMf(source, "dragon.3MF", [
      {
        index: 2,
        hex: "#abcdef",
        colors: ["#abcdef", "#123456", "789abc"],
      },
      { index: 99, hex: "#112233" },
      { index: 0, hex: "#000000" },
    ])
    const output = await JSZip.loadAsync(await result.blob.arrayBuffer())
    const settings = JSON.parse(
      await output.file("Metadata/project_settings.config")!.async("text"),
    ) as Record<string, string[]>

    expect(result).toMatchObject({
      fileName: "dragon-matched.3mf",
      changedFiles: ["Metadata/project_settings.config"],
    })
    expect(settings.filament_colour).toEqual(["#ff0000", "#ABCDEF"])
    expect(settings.filament_multi_colour).toEqual(["#ff0000", "#ABCDEF #123456 #789ABC"])
    await expect(output.file("3D/Objects/mesh.model")!.async("text")).resolves.toBe(
      "mesh bytes stay untouched",
    )
  })

  it("handles extensionless and empty source names", () => {
    expect(remappedFileName("project")).toBe("project-matched.3mf")
    expect(remappedFileName(".3mf")).toBe("project-matched.3mf")
  })

  it("rejects archives without a readable filament color list", async () => {
    const missing = await threeMfFixture({
      settings: JSON.stringify({ filament_type: ["PLA"] }),
    })
    await expect(remapThreeMf(missing, "missing.3mf", [])).rejects.toThrow(
      "no filament_colour list",
    )

    const malformed = await threeMfFixture({
      settings: `{"filament_colour": ["#fff", ]}`,
    })
    await expect(remapThreeMf(malformed, "broken.3mf", [])).rejects.toThrow(
      "filament_colour list in project settings is not readable",
    )

    const wrongType = await threeMfFixture({
      settings: JSON.stringify({
        filament_colour: "not an array",
        unrelated: ["#112233"],
      }),
    })
    await expect(remapThreeMf(wrongType, "wrong-type.3mf", [])).rejects.toThrow(
      "filament_colour value in project settings is not a string list",
    )
  })

  it("rejects invalid remap colors instead of corrupting project settings", async () => {
    const source = await threeMfFixture()

    await expect(
      remapThreeMf(source, "invalid.3mf", [{ index: 1, hex: "not-a-color" }]),
    ).rejects.toThrow("Filament slot 1 has an invalid primary color")

    await expect(
      remapThreeMf(source, "invalid.3mf", [
        { index: 1, hex: "#123456", colors: ["#123456", "broken"] },
      ]),
    ).rejects.toThrow("Filament slot 1 has an invalid multi-color value")
  })

  it("rejects archives with oversized declared expansion before exporting", async () => {
    const hostile = withDeclaredUncompressedSize(
      await threeMfFixture(),
      "3D/3dmodel.model",
      257 * 1024 * 1024,
    )

    await expect(remapThreeMf(hostile, "oversized.3mf", [])).rejects.toThrow(
      "expands beyond Spoolmap's 256 MB export safety limit",
    )
  })
})
