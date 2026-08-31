import JSZip from "jszip"

export type ThreeMfFixtureOptions = {
  settings?: string
  model?: string
  modelSettings?: string
  extraFiles?: Record<string, string | Uint8Array>
}

export async function threeMfFixture(options: ThreeMfFixtureOptions = {}): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /></Types>`,
  )
  zip.file(
    "Metadata/project_settings.config",
    options.settings ??
      JSON.stringify({
        filament_colour: ["#ff0000", "00ff00"],
        filament_type: ["PLA", "PETG"],
        filament_vendor: ["Bambu Lab", "Generic"],
        filament_settings_id: ["PLA Basic Red", "PETG Green"],
        filament_multi_colour: ["#ff0000", "#00ff00"],
      }),
  )
  zip.file(
    "3D/3dmodel.model",
    options.model ??
      `<model>
        <metadata name="Title">Fixture &amp; Friends</metadata>
        <resources />
        <build />
      </model>`,
  )
  zip.file(
    "Metadata/model_settings.config",
    options.modelSettings ??
      `<config>
        <object id="7">
          <metadata key="name" value="Body" />
          <metadata key="extruder" value="2" />
        </object>
        <plate>
          <metadata key="plater_id" value="3" />
          <metadata key="plater_name" value="Main plate" />
          <metadata key="object_id" value="7" />
        </plate>
      </config>`,
  )
  for (const [path, contents] of Object.entries(options.extraFiles ?? {})) {
    zip.file(path, contents)
  }
  return zip.generateAsync({ type: "uint8array" })
}
