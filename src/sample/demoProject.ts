import JSZip from "jszip"

export const SAMPLE_INVENTORY_NAME = "sample-spools.json"
export const SAMPLE_MODEL_NAME = "sample-owl.3mf"

/**
 * A small owned-spool list that is not tied to 3DFilamentProfiles. The parser
 * only needs a color plus optional brand, material, and name.
 */
export const SAMPLE_INVENTORY = [
  {
    id: "bambu-orange",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Orange",
    rgb: "#FF6A13",
    remaining_grams: 720,
  },
  {
    id: "bambu-ivory",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Ivory White",
    rgb: "#F0E6D2",
    remaining_grams: 640,
  },
  {
    id: "bambu-black",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Black",
    rgb: "#1A1A1A",
    remaining_grams: 800,
  },
  {
    id: "bambu-teal",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Teal",
    rgb: "#00897B",
    remaining_grams: 410,
  },
  {
    id: "polymaker-orange",
    brand: "Polymaker",
    material: "PLA",
    material_type: "Matte",
    color: "Fox Orange",
    rgb: "#E85D04",
    remaining_grams: 380,
  },
  {
    id: "generic-orange-petg",
    brand: "Generic",
    material: "PETG",
    material_type: "Basic",
    color: "Safety Orange",
    rgb: "#FF5A1F",
    remaining_grams: 550,
  },
  {
    id: "bambu-green",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Bambu Green",
    rgb: "#00AE42",
    remaining_grams: 200,
  },
] as const

export function sampleInventoryText(): string {
  return `${JSON.stringify(SAMPLE_INVENTORY, null, 2)}\n`
}

function boxMesh(
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  start = 0,
): {
  vertices: string
  triangles: string
  next: number
} {
  const corners: Array<[number, number, number]> = [
    [x, y, z],
    [x + sx, y, z],
    [x + sx, y + sy, z],
    [x, y + sy, z],
    [x, y, z + sz],
    [x + sx, y, z + sz],
    [x + sx, y + sy, z + sz],
    [x, y + sy, z + sz],
  ]
  const faces: Array<[number, number, number]> = [
    [0, 1, 2],
    [0, 2, 3],
    [4, 6, 5],
    [4, 7, 6],
    [0, 4, 5],
    [0, 5, 1],
    [3, 2, 6],
    [3, 6, 7],
    [0, 3, 7],
    [0, 7, 4],
    [1, 5, 6],
    [1, 6, 2],
  ]
  return {
    vertices: corners.map(([vx, vy, vz]) => `<vertex x="${vx}" y="${vy}" z="${vz}"/>`).join(""),
    triangles: faces
      .map(([a, b, c]) => `<triangle v1="${start + a}" v2="${start + b}" v3="${start + c}" />`)
      .join(""),
    next: start + 8,
  }
}

function modelFile(
  objectId: string,
  boxes: Array<[number, number, number, number, number, number]>,
): string {
  let start = 0
  const vertices: string[] = []
  const triangles: string[] = []
  for (const box of boxes) {
    const mesh = boxMesh(...box, start)
    vertices.push(mesh.vertices)
    triangles.push(mesh.triangles)
    start = mesh.next
  }
  return `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="${objectId}" type="model"><mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh></object></resources></model>`
}

/**
 * A freely redistributable two-plate owl built from boxes. Geometry stays
 * tiny so first-time visitors can open the matching UI without uploading files.
 */
export async function createSampleProject(): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /><Default Extension="config" ContentType="application/xml" /></Types>`,
  )
  zip.file(
    "Metadata/project_settings.config",
    JSON.stringify({
      filament_colour: ["#FF6A13", "#F0E6D2", "#1A1A1A", "#00897B"],
      filament_type: ["PLA", "PLA", "PLA", "PLA"],
      filament_vendor: ["Bambu Lab", "Bambu Lab", "Bambu Lab", "Bambu Lab"],
      filament_settings_id: [
        "PLA Basic @ Bambu Lab A1",
        "PLA Basic @ Bambu Lab A1",
        "PLA Basic @ Bambu Lab A1",
        "PLA Basic @ Bambu Lab A1",
      ],
      filament_multi_colour: ["#FF6A13", "#F0E6D2", "#1A1A1A", "#00897B"],
    }),
  )
  zip.file(
    "3D/3dmodel.model",
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><metadata name="Title">Sample owl</metadata><resources><object id="1"><components><component p:path="/3D/Objects/body.model" objectid="11" /></components></object><object id="2"><components><component p:path="/3D/Objects/belly.model" objectid="12" /></components></object><object id="3"><components><component p:path="/3D/Objects/eyes.model" objectid="13" /></components></object><object id="4"><components><component p:path="/3D/Objects/beak.model" objectid="14" /></components></object></resources><build><item objectid="1" /><item objectid="2" /><item objectid="3" /><item objectid="4" /></build></model>`,
  )
  zip.file(
    "Metadata/model_settings.config",
    `<config>
      <object id="1">
        <metadata key="name" value="Body" />
        <metadata key="extruder" value="1" />
      </object>
      <object id="2">
        <metadata key="name" value="Belly" />
        <metadata key="extruder" value="2" />
      </object>
      <object id="3">
        <metadata key="name" value="Eyes" />
        <metadata key="extruder" value="3" />
      </object>
      <object id="4">
        <metadata key="name" value="Beak" />
        <metadata key="extruder" value="4" />
      </object>
      <plate>
        <metadata key="plater_id" value="1" />
        <metadata key="plater_name" value="Body" />
        <metadata key="object_id" value="1" />
        <metadata key="object_id" value="2" />
      </plate>
      <plate>
        <metadata key="plater_id" value="2" />
        <metadata key="plater_name" value="Details" />
        <metadata key="object_id" value="3" />
        <metadata key="object_id" value="4" />
      </plate>
    </config>`,
  )
  zip.file("3D/Objects/body.model", modelFile("11", [[8, 6, 0, 28, 20, 26]]))
  zip.file("3D/Objects/belly.model", modelFile("12", [[14, 2, 4, 16, 8, 16]]))
  zip.file(
    "3D/Objects/eyes.model",
    modelFile("13", [
      [14, 22, 16, 6, 5, 6],
      [24, 22, 16, 6, 5, 6],
    ]),
  )
  zip.file("3D/Objects/beak.model", modelFile("14", [[20, 20, 10, 5, 6, 5]]))
  return zip.generateAsync({ type: "uint8array" })
}
