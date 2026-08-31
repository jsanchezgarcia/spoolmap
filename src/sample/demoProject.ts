import JSZip from "jszip"
import { SAMPLE_PROJECT_TITLE } from "./identity"

export {
  SAMPLE_INVENTORY_NAME,
  SAMPLE_MODEL_NAME,
  SAMPLE_PROJECT_TITLE,
} from "./identity"

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

type Vec3 = [number, number, number]
type Profile = Array<[number, number]>

function fmt(value: number): string {
  return (Math.round(value * 1000) / 1000).toFixed(3)
}

class MeshBuilder {
  private readonly vertices: string[] = []
  private readonly triangles: string[] = []
  private next = 0

  vertex(x: number, y: number, z: number): number {
    const id = this.next++
    this.vertices.push(`<vertex x="${fmt(x)}" y="${fmt(y)}" z="${fmt(z)}"/>`)
    return id
  }

  tri(a: number, b: number, c: number): void {
    this.triangles.push(`<triangle v1="${a}" v2="${b}" v3="${c}" />`)
  }

  /** Revolves an (radius, z) profile around +Z. */
  lathe(profile: Profile, segments: number): void {
    const rings = profile.map(([radius, z]) => {
      const ring: number[] = []
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        ring.push(this.vertex(Math.cos(angle) * radius, Math.sin(angle) * radius, z))
      }
      return ring
    })
    for (let ring = 0; ring < rings.length - 1; ring++) {
      const a = rings[ring]
      const b = rings[ring + 1]
      const [r0] = profile[ring]
      const [r1] = profile[ring + 1]
      for (let i = 0; i < segments; i++) {
        const j = (i + 1) % segments
        if (r0 > 0.001 && r1 > 0.001) {
          this.tri(a[i], b[i], b[j])
          this.tri(a[i], b[j], a[j])
        } else if (r1 > 0.001) {
          this.tri(a[i], b[i], b[j])
        } else if (r0 > 0.001) {
          this.tri(a[i], b[j], a[j])
        }
      }
    }
  }

  disc(radius: number, z: number, segments: number, upward: boolean): void {
    const center = this.vertex(0, 0, z)
    const rim: number[] = []
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      rim.push(this.vertex(Math.cos(angle) * radius, Math.sin(angle) * radius, z))
    }
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments
      if (upward) this.tri(center, rim[i], rim[j])
      else this.tri(center, rim[j], rim[i])
    }
  }

  sphere(center: Vec3, radius: number, segments: number, rings: number): void {
    const [cx, cy, cz] = center
    const grid: number[][] = []
    for (let ring = 0; ring <= rings; ring++) {
      const phi = (ring / rings) * Math.PI
      const row: number[] = []
      const ringRadius = Math.sin(phi) * radius
      const z = cz + Math.cos(phi) * radius
      for (let i = 0; i < segments; i++) {
        const theta = (i / segments) * Math.PI * 2
        row.push(
          this.vertex(cx + Math.cos(theta) * ringRadius, cy + Math.sin(theta) * ringRadius, z),
        )
      }
      grid.push(row)
    }
    for (let ring = 0; ring < rings; ring++) {
      for (let i = 0; i < segments; i++) {
        const j = (i + 1) % segments
        const a = grid[ring][i]
        const b = grid[ring + 1][i]
        const c = grid[ring + 1][j]
        const d = grid[ring][j]
        if (ring > 0) this.tri(a, b, c)
        if (ring < rings - 1) this.tri(a, c, d)
      }
    }
  }

  toModel(objectId: string): string {
    return `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="${objectId}" type="model"><mesh><vertices>${this.vertices.join("")}</vertices><triangles>${this.triangles.join("")}</triangles></mesh></object></resources></model>`
  }
}

const SEG = 28

function capMesh(): string {
  const mesh = new MeshBuilder()
  const profile: Profile = []
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    const phi = t * (Math.PI / 2)
    profile.push([Math.sin(phi) * 18, 22 + Math.cos(phi) * 11])
  }
  profile.push([16.2, 21.4], [0, 21.4])
  mesh.lathe(profile, SEG)
  return mesh.toModel("11")
}

function stemMesh(): string {
  const mesh = new MeshBuilder()
  mesh.lathe(
    [
      [0, 2],
      [7.2, 2],
      [6.4, 6],
      [5.6, 22],
      [5.2, 24.5],
      [0, 24.5],
    ],
    SEG,
  )
  return mesh.toModel("12")
}

function spotsMesh(): string {
  const mesh = new MeshBuilder()
  const spots: Array<[Vec3, number]> = [
    [[0, 8.4, 30.6], 3.3],
    [[-9.2, 2.4, 28.8], 2.7],
    [[8.6, 4.8, 29.4], 2.9],
    [[-4.4, -9.6, 28.2], 2.5],
    [[7.2, -7.8, 27.6], 2.2],
  ]
  for (const [center, radius] of spots) mesh.sphere(center, radius, 16, 10)
  return mesh.toModel("13")
}

function potMesh(): string {
  const mesh = new MeshBuilder()
  mesh.lathe(
    [
      [0, 0],
      [11.5, 0],
      [13.6, 9],
      [14.4, 11.2],
      [13.2, 12],
      [12.2, 11.2],
      [11.4, 9.4],
      [0, 9.4],
    ],
    SEG,
  )
  return mesh.toModel("14")
}

function soilMesh(): string {
  const mesh = new MeshBuilder()
  mesh.lathe(
    [
      [0, 9.4],
      [11.2, 9.4],
      [10.6, 11],
      [0, 11],
    ],
    SEG,
  )
  return mesh.toModel("15")
}

type Rgb = [number, number, number]

function crcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[i] = value >>> 0
  }
  return table
}

const CRC_TABLE = crcTable()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let a = 1
  let b = 0
  for (const byte of bytes) {
    a = (a + byte) % 65521
    b = (b + a) % 65521
  }
  return ((b << 16) | a) >>> 0
}

function u32(value: number): Uint8Array {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  )
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const label = Uint8Array.from(type, (char) => char.charCodeAt(0))
  const body = concat([label, data])
  return concat([u32(data.length), body, u32(crc32(body))])
}

function deflateStore(data: Uint8Array): Uint8Array {
  const max = 65535
  const blocks: Uint8Array[] = [Uint8Array.of(0x78, 0x01)]
  for (let offset = 0; offset < data.length; offset += max) {
    const slice = data.subarray(offset, Math.min(offset + max, data.length))
    const last = offset + slice.length >= data.length
    const len = slice.length
    blocks.push(
      Uint8Array.of(last ? 1 : 0, len & 0xff, (len >> 8) & 0xff, ~len & 0xff, (~len >> 8) & 0xff),
      slice,
    )
  }
  blocks.push(u32(adler32(data)))
  return concat(blocks)
}

function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgb,
): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y)
      const i = row + 1 + x * 3
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
    }
  }
  const ihdr = concat([u32(width), u32(height), Uint8Array.of(8, 2, 0, 0, 0)])
  return concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateStore(raw)),
    chunk("IEND", new Uint8Array()),
  ])
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function insideCircle(x: number, y: number, cx: number, cy: number, radius: number): boolean {
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

function insideEllipse(
  x: number,
  y: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): boolean {
  const dx = (x - cx) / rx
  const dy = (y - cy) / ry
  return dx * dx + dy * dy <= 1
}

const PAPER: Rgb = [32, 39, 41]
const ORANGE: Rgb = [255, 106, 19]
const IVORY: Rgb = [240, 230, 210]
const BLACK: Rgb = [26, 26, 26]
const TEAL: Rgb = [0, 137, 123]
const SOIL: Rgb = [42, 42, 42]

function paintScene(
  width: number,
  height: number,
  parts: "toadstool" | "planter" | "both",
): Uint8Array {
  const cx = width * 0.5
  return encodePng(width, height, (x, y) => {
    let color: Rgb = mix(PAPER, [20, 25, 27], y / height)
    const potTop = height * 0.72
    const potBottom = height * 0.9
    const stemTop = height * 0.58
    const capCy = height * 0.4
    if (parts !== "toadstool") {
      if (y >= potTop && y <= potBottom) {
        const t = (y - potTop) / (potBottom - potTop)
        const half = width * (0.2 + t * 0.05)
        if (Math.abs(x - cx) <= half) color = mix(TEAL, [0, 90, 82], t)
      }
      if (insideEllipse(x, y, cx, potTop, width * 0.2, height * 0.045)) color = SOIL
    }
    if (parts !== "planter") {
      const stemHalf = width * 0.055
      const stemBottom = parts === "both" ? potTop - 2 : height * 0.82
      if (x >= cx - stemHalf && x <= cx + stemHalf && y >= stemTop && y <= stemBottom) {
        color = mix(IVORY, [220, 208, 186], (y - stemTop) / Math.max(stemBottom - stemTop, 1))
      }
      if (insideEllipse(x, y, cx, capCy, width * 0.24, height * 0.16)) color = ORANGE
      if (insideEllipse(x, y, cx, capCy + height * 0.07, width * 0.2, height * 0.07) && y > capCy) {
        color = mix(ORANGE, [210, 80, 16], 0.35)
      }
      const spots: Array<[number, number, number]> = [
        [cx, capCy - height * 0.03, width * 0.04],
        [cx - width * 0.1, capCy + height * 0.02, width * 0.032],
        [cx + width * 0.09, capCy + height * 0.01, width * 0.035],
        [cx + width * 0.03, capCy + height * 0.07, width * 0.028],
      ]
      for (const [sx, sy, r] of spots) {
        if (insideCircle(x, y, sx, sy, r)) color = BLACK
      }
    }
    return color
  })
}

let sampleProject: Promise<Uint8Array> | undefined

/**
 * A freely redistributable two-plate toadstool. The first plate is the whole
 * mushroom so first-time visitors see four colors on a recognizable shape.
 * The archive is built once and reused for later clicks in the same session.
 */
export function createSampleProject(): Promise<Uint8Array> {
  sampleProject ??= buildSampleProject()
  return sampleProject
}

async function buildSampleProject(): Promise<Uint8Array> {
  const zip = new JSZip()
  const toadstoolThumb = paintScene(220, 160, "toadstool")
  const planterThumb = paintScene(220, 160, "planter")
  const projectThumb = paintScene(220, 160, "both")
  zip.file(
    "[Content_Types].xml",
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" /><Default Extension="config" ContentType="application/xml" /><Default Extension="png" ContentType="image/png" /></Types>`,
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
    `<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><metadata name="Title">${SAMPLE_PROJECT_TITLE}</metadata><resources><object id="1"><components><component p:path="/3D/Objects/cap.model" objectid="11" /></components></object><object id="2"><components><component p:path="/3D/Objects/stem.model" objectid="12" /></components></object><object id="3"><components><component p:path="/3D/Objects/spots.model" objectid="13" /></components></object><object id="4"><components><component p:path="/3D/Objects/pot.model" objectid="14" /></components></object><object id="5"><components><component p:path="/3D/Objects/soil.model" objectid="15" /></components></object></resources><build><item objectid="1" /><item objectid="2" /><item objectid="3" /><item objectid="4" /><item objectid="5" /></build></model>`,
  )
  zip.file(
    "Metadata/model_settings.config",
    `<config>
      <object id="1">
        <metadata key="name" value="Cap" />
        <metadata key="extruder" value="1" />
      </object>
      <object id="2">
        <metadata key="name" value="Stem" />
        <metadata key="extruder" value="2" />
      </object>
      <object id="3">
        <metadata key="name" value="Spots" />
        <metadata key="extruder" value="3" />
      </object>
      <object id="4">
        <metadata key="name" value="Pot" />
        <metadata key="extruder" value="4" />
      </object>
      <object id="5">
        <metadata key="name" value="Soil" />
        <metadata key="extruder" value="3" />
      </object>
      <plate>
        <metadata key="plater_id" value="1" />
        <metadata key="plater_name" value="Toadstool" />
        <metadata key="thumbnail_file" value="Metadata/plate_1.png" />
        <metadata key="object_id" value="1" />
        <metadata key="object_id" value="2" />
        <metadata key="object_id" value="3" />
      </plate>
      <plate>
        <metadata key="plater_id" value="2" />
        <metadata key="plater_name" value="Planter" />
        <metadata key="thumbnail_file" value="Metadata/plate_2.png" />
        <metadata key="object_id" value="4" />
        <metadata key="object_id" value="5" />
      </plate>
    </config>`,
  )
  zip.file("3D/Objects/cap.model", capMesh())
  zip.file("3D/Objects/stem.model", stemMesh())
  zip.file("3D/Objects/spots.model", spotsMesh())
  zip.file("3D/Objects/pot.model", potMesh())
  zip.file("3D/Objects/soil.model", soilMesh())
  zip.file("Metadata/plate_1.png", toadstoolThumb)
  zip.file("Metadata/plate_2.png", planterThumb)
  zip.file("Auxiliaries/.thumbnails/thumbnail_small.png", projectThumb)
  return zip.generateAsync({ type: "uint8array" })
}
