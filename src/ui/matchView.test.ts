import { describe, expect, it } from "vitest"
import { rankSpools } from "../matching"
import { SAMPLE_PROJECT_TITLE, SAMPLE_SOURCE_NAME, SAMPLE_SOURCE_URL } from "../sample/identity"
import type { FilamentChoice, LogicalFilament, PhysicalSpool, ProjectPlate } from "../types"
import { createMatchView, matchesSearchTerms, normalizedSearch, searchTerms } from "./matchView"

const filament = (index: number, overrides: Partial<LogicalFilament> = {}): LogicalFilament => ({
  index,
  hex: "#FF0000",
  material: "PLA",
  vendor: "Fixture",
  label: "PLA Basic",
  source: "fixture",
  ...overrides,
})

const spool = (id: string, overrides: Partial<PhysicalSpool> = {}): PhysicalSpool => ({
  id,
  brand: "Fixture Brand",
  material: "PLA",
  materialType: "Basic",
  colorName: id,
  hex: "#FF0000",
  remainingGrams: 500,
  raw: {},
  ...overrides,
})

const plate: ProjectPlate = {
  id: "1",
  name: "Plate 1",
  filamentIndexes: [1],
  objectIds: [],
  objectNames: [],
  thumbnail: null,
}

function matchView(
  choices: FilamentChoice[],
  inventory: PhysicalSpool[],
  selectedPlateId: string | null = "1",
  openSpoolMenu: number | null = 1,
  title = "Fixture",
) {
  const project = {
    fileName: "fixture.3mf",
    title,
    filaments: choices.map(({ filament: item }) => item),
    plates: [plate],
    thumbnail: null,
  }
  const visible = () =>
    selectedPlateId === null
      ? choices
      : choices.filter(({ filament: item }) => plate.filamentIndexes.includes(item.index))

  return createMatchView({
    state: {
      project,
      inventory,
      choices,
      selectedPlateId,
      openSpoolMenu,
      exportAction: null,
    },
    activePlate: () => (selectedPlateId === plate.id ? plate : undefined),
    visibleChoices: visible,
    scopeLabel: () => (selectedPlateId ? plate.name : "Whole model"),
    metaGroup: (parts) => parts.filter(Boolean).join(" · "),
    fileMark: (name) => name,
  })
}

function render(
  choices: FilamentChoice[],
  inventory: PhysicalSpool[],
  selectedPlateId: string | null = "1",
  openSpoolMenu: number | null = 1,
  title = "Fixture",
): string {
  return matchView(choices, inventory, selectedPlateId, openSpoolMenu, title).renderMatches()
}

describe("match view", () => {
  it("filters across color, brand, and material terms independent of punctuation", () => {
    // The rendered index is folded once, exactly as renderPicker folds it, so
    // this exercises both halves of the live path rather than a parallel one.
    const indexed = normalizedSearch("Señal Red · Polymaker · PLA-CF · Matte")
    const matches = (query: string) => matchesSearchTerms(indexed, searchTerms(query))

    expect(indexed).toBe("senal red polymaker pla cf matte")
    expect(matches("polymaker pla")).toBe(true)
    expect(matches("senal matte")).toBe(true)
    expect(matches("señal")).toBe(true)
    expect(matches("PLA-CF")).toBe(true)
    expect(matches("")).toBe(true)
    expect(matches("PETG")).toBe(false)
  })

  it("renders a searchable listbox indexed by color, brand, and material", () => {
    const requested = filament(1)
    const inventory = [
      spool("Signal Red", { brand: "Polymaker", materialType: "Matte" }),
      spool("Ocean", {
        brand: "Bambu Lab",
        material: "PETG",
        materialType: "Basic",
      }),
    ]
    const matches = rankSpools(requested, inventory)
    const html = render(
      [{ filament: requested, matches, selectedSpoolId: matches[0].spool.id }],
      inventory,
    )

    expect(html).toContain('data-spool-filter="1"')
    expect(html).toContain('placeholder="Color, brand, or material"')
    expect(html).toContain('data-spool-filter-value="signal red polymaker pla matte"')
    expect(html).toContain('data-spool-filter-value="ocean bambu lab petg basic"')
    expect(html).toContain("0 is an exact color match; above ~10 is a visible miss")
    expect(html).toContain("Download for Bambu Studio or Orca")
    expect(html).toContain('id="spool-menu-options-1" role="listbox"')
    expect(html).toContain('role="group" aria-label="Matches PLA; recommended"')
    expect(html).toContain('aria-controls="spool-menu-options-1"')
    expect(html).toContain('data-spool-popup="spool-menu-1"')
  })

  it("names the brand even when every spool is from the same vendor", () => {
    const requested = filament(1)
    const inventory = [
      spool("Signal Red", { brand: "Bambu Lab" }),
      spool("Jade", { brand: "Bambu Lab", hex: "#00AA66" }),
    ]
    const matches = rankSpools(requested, inventory)
    const html = render(
      [{ filament: requested, matches, selectedSpoolId: matches[0].spool.id }],
      inventory,
    )

    expect(html).toContain("Bambu Lab")
    expect(html).toContain("Signal Red")
  })

  it("shows a neutral finish difference even when it carries no score penalty", () => {
    const requested = filament(1, { label: "PLA" })
    const inventory = [spool("Signal Red", { materialType: "Matte" })]
    const matches = rankSpools(requested, inventory)
    const html = render(
      [{ filament: requested, matches, selectedSpoolId: inventory[0].id }],
      inventory,
    )

    expect(matches[0].score).toBe(matches[0].deltaE)
    expect(html).toContain('<span class="tag">Matte</span>')
    expect(html).toContain("finish differs")
  })

  it("keeps hidden colors in scope context and names the mismatched profiles", () => {
    const first = filament(1, { label: "PLA Matte" })
    const second = filament(2)
    const wrongSpool = spool("Orange", {
      material: "PETG",
      materialType: "Basic",
    })
    const firstMatches = rankSpools(first, [wrongSpool])
    const secondMatches = rankSpools(second, [spool("Red")])
    const html = render(
      [
        {
          filament: first,
          matches: firstMatches,
          selectedSpoolId: wrongSpool.id,
        },
        {
          filament: second,
          matches: secondMatches,
          selectedSpoolId: secondMatches[0].spool.id,
        },
      ],
      [wrongSpool, secondMatches[0].spool],
    )

    expect(html).toContain("1 elsewhere in the project")
    expect(html).toContain("F01 profile differs: PETG Basic selected for PLA Matte")
    expect(html).not.toContain("outside the visible plate")
  })

  it("can fill a closed picker menu without re-rendering the rest of the row", () => {
    const requested = filament(1)
    const inventory = [spool("Signal Red")]
    const matches = rankSpools(requested, inventory)
    const view = matchView(
      [{ filament: requested, matches, selectedSpoolId: matches[0].spool.id }],
      inventory,
      "1",
      null,
    )

    expect(view.renderMatches()).not.toContain('data-spool-filter="1"')
    expect(view.renderSpoolMenu(1)).toContain('data-spool-filter="1"')
    expect(view.renderSpoolMenu(1)).toContain("Signal Red")
    expect(view.renderSpoolMenu(99)).toBe("")
  })

  it("credits the bundled sample model's creator", () => {
    const requested = filament(1)
    const inventory = [spool("White")]
    const matches = rankSpools(requested, inventory)
    const html = render(
      [{ filament: requested, matches, selectedSpoolId: matches[0].spool.id }],
      inventory,
      "1",
      1,
      SAMPLE_PROJECT_TITLE,
    )

    expect(html).toContain(SAMPLE_SOURCE_NAME)
    expect(html).toContain(SAMPLE_SOURCE_URL)
    expect(html).not.toContain("Model by Fixture")
  })
})
