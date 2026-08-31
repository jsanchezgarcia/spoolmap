export {
  SAMPLE_INVENTORY_NAME,
  SAMPLE_MODEL_NAME,
  SAMPLE_PROJECT_TITLE,
  SAMPLE_SOURCE_NAME,
  SAMPLE_SOURCE_URL,
  SAMPLE_SOURCE_WORK,
} from "./identity"

/**
 * A small owned-spool list that is not tied to 3DFilamentProfiles. White,
 * black, and red match the 3MF exactly. Orange and teal sit a visible ΔE off
 * so the split preview shows original vs owned without looking like a miss.
 */
export const SAMPLE_INVENTORY = [
  {
    id: "bambu-white",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Jade White",
    rgb: "#FFFFFF",
    remaining_grams: 800,
  },
  {
    id: "bambu-black",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Black",
    rgb: "#000000",
    remaining_grams: 780,
  },
  {
    id: "bambu-orange",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Orange",
    rgb: "#FFC04D",
    remaining_grams: 640,
  },
  {
    id: "bambu-teal",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Teal",
    rgb: "#1F9A8A",
    remaining_grams: 410,
  },
  {
    id: "bambu-red",
    brand: "Bambu Lab",
    material: "PLA",
    material_type: "Basic",
    color: "Maroon Red",
    rgb: "#9D2235",
    remaining_grams: 520,
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

let sampleProject: Promise<Uint8Array> | undefined

/**
 * Jov3DPrint's Heihei 3MF, shipped unmodified (CC BY-ND). The archive is
 * fetched once and reused for later clicks in the same session.
 */
export function createSampleProject(): Promise<Uint8Array> {
  sampleProject ??= loadSampleProject()
  return sampleProject
}

async function loadSampleProject(): Promise<Uint8Array> {
  const href = new URL("./heihei.3mf", import.meta.url)
  if (import.meta.env.MODE === "test") {
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    return new Uint8Array(await readFile(fileURLToPath(href)))
  }
  const response = await fetch(href)
  if (!response.ok) {
    throw new Error("The sample project could not be loaded.")
  }
  return new Uint8Array(await response.arrayBuffer())
}
