import { describe, expect, it } from "vitest"
import { APP_VERSION } from "../version"
import { createAppView } from "./appView"

function view(overrides: Partial<Parameters<typeof createAppView>[0]["state"]> = {}) {
  return createAppView({
    staleAfter: 7 * 24 * 60 * 60 * 1000,
    state: {
      inventory: [],
      inventoryName: null,
      inventoryImportedAt: null,
      project: null,
      history: [],
      sessionId: null,
      loading: new Set(),
      dragging: null,
      ...overrides,
    },
  })
}

describe("app view", () => {
  it("exposes the release version testers should report", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("explains the JSON inventory format and offers paste when empty", () => {
    const html = view().renderDropzone("inventory")

    expect(html).toContain("Export JSON from 3DFilamentProfiles")
    expect(html).toContain("https://3dfilamentprofiles.com/my/spools")
    expect(html).toContain("data-paste-inventory")
    expect(html).toContain("Paste JSON")
    expect(html).toContain("rgb")
    expect(html).toContain("hex")
    expect(html).toContain("data-inventory-format")
    expect(html).toContain("Choose JSON")
    expect(html).not.toContain("station-help")
  })

  it("hides paste and states the imported spool count when inventory is loaded", () => {
    const html = view({
      inventory: [
        {
          id: "orange",
          brand: "Bambu Lab",
          material: "PLA",
          materialType: "Basic",
          colorName: "Orange",
          hex: "#FF6A13",
          remainingGrams: 720,
          raw: {},
        },
      ],
      inventoryName: "sample-spools.json",
      inventoryImportedAt: Date.now(),
    }).renderDropzone("inventory")

    expect(html).toContain("1 spool")
    expect(html).toContain("sample-spools.json")
    expect(html).toContain("Re-import")
    expect(html).toContain("Clear inventory")
    expect(html).toContain("Ready")
    expect(html).not.toContain("data-paste-inventory")
  })

  it("calls out a stale inventory so missing spools cannot be matched quietly", () => {
    const html = view({
      inventory: [
        {
          id: "orange",
          brand: "Bambu Lab",
          material: "PLA",
          materialType: "Basic",
          colorName: "Orange",
          hex: "#FF6A13",
          remainingGrams: 720,
          raw: {},
        },
      ],
      inventoryImportedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    }).renderDropzone("inventory")

    expect(html).toContain("Check age")
    expect(html).toContain("Added spools since then?")
  })

  it("describes an empty 3MF station and a loaded project station", () => {
    const empty = view().renderDropzone("model")
    expect(empty).toContain("Bambu Studio or OrcaSlicer .3mf")
    expect(empty).toContain("Choose 3MF")
    expect(empty).not.toContain("data-paste-inventory")

    const loaded = view({
      project: {
        fileName: "sample-owl.3mf",
        title: "Sample owl",
        filaments: [
          {
            index: 1,
            hex: "#FF6A13",
            material: "PLA",
            vendor: "Bambu Lab",
            label: "PLA Basic",
            source: "fixture",
          },
        ],
        plates: [
          {
            id: "1",
            name: "Body",
            filamentIndexes: [1],
            objectIds: ["1"],
            objectNames: ["Body"],
            thumbnail: null,
          },
        ],
        thumbnail: null,
      },
    }).renderDropzone("model")
    expect(loaded).toContain("1 color")
    expect(loaded).toContain("1 plate")
    expect(loaded).toContain("Replace")
    expect(loaded).toContain("Clear project")
  })

  it("renders recents on the home page and a drawer once a project is open", () => {
    const entry = {
      id: "session-1",
      savedAt: Date.now(),
      modelName: "sample-owl.3mf",
      projectTitle: "Sample owl",
      filamentCount: 4,
      plateCount: 2,
      selectedPlateId: "1",
      inventoryName: "sample-spools.json",
      inventoryCount: 7,
      inventoryImportedAt: Date.now(),
      selections: [],
      swatches: ["#FF6A13"],
      hasPayload: true,
    }
    const home = view({ history: [entry] }).renderHistory()
    expect(home).toContain("Recents")
    expect(home).toContain("Sample owl")
    expect(home).toContain("Restore")
    expect(home).toContain("4 colors")

    const open = view({
      history: [entry],
      sessionId: "session-1",
      project: {
        fileName: "sample-owl.3mf",
        title: "Sample owl",
        filaments: [],
        plates: [],
        thumbnail: null,
      },
    }).renderHistory()
    expect(open).toContain("Recent projects")
    expect(open).toContain("Open now")
    expect(open).toContain("1 saved in this browser")
  })
})
