import { describe, expect, it } from "vitest"
import type { FilamentChoice, LogicalFilament, PhysicalSpool } from "../types"
import { exportReadiness } from "./readiness"

const filament = (index: number): LogicalFilament => ({
  index,
  hex: "#000000",
  material: "PLA",
  vendor: "Fixture",
  label: "PLA",
  source: "fixture",
})

const spool = (id: string): PhysicalSpool => ({
  id,
  brand: "Fixture",
  material: "PLA",
  materialType: "Basic",
  colorName: id,
  hex: "#000000",
  remainingGrams: 500,
  raw: {},
})

const choice = (
  index: number,
  spoolId: string | null,
  materialOk = true,
  profiles: { requested?: string; selectedMaterial?: string; selectedType?: string } = {},
): FilamentChoice => ({
  filament: { ...filament(index), label: profiles.requested ?? "PLA" },
  selectedSpoolId: spoolId,
  matches: spoolId
    ? [
        {
          spool: {
            ...spool(spoolId),
            material: profiles.selectedMaterial ?? "PLA",
            materialType: profiles.selectedType ?? "Basic",
          },
          rank: 0,
          deltaE: 0,
          score: 0,
          materialOk,
          defaultable: materialOk,
          finishMismatch: false,
        },
      ]
    : [],
})

describe("export readiness", () => {
  it("blocks incomplete plans and reports hidden and incompatible choices", () => {
    const result = exportReadiness(
      [
        choice(1, "a"),
        choice(2, null),
        choice(3, "b", false, {
          requested: "PLA Matte",
          selectedMaterial: "PETG",
          selectedType: "Basic",
        }),
      ],
      [
        {
          id: "one",
          name: "One",
          filamentIndexes: [1],
          objectIds: [],
          objectNames: [],
          thumbnail: null,
        },
      ],
      "one",
    )

    expect(result).toMatchObject({
      selectedCount: 2,
      totalCount: 3,
      unresolvedIndexes: [2],
      incompatibleIndexes: [3],
      incompatibleSelections: [
        {
          filamentIndex: 3,
          requestedProfile: "PLA Matte",
          selectedProfile: "PETG Basic",
        },
      ],
      hiddenCount: 2,
      canExport: false,
    })
  })

  it("warns when one physical spool fills simultaneous logical slots", () => {
    const result = exportReadiness(
      [choice(1, "shared"), choice(2, "shared")],
      [
        {
          id: "one",
          name: "One",
          filamentIndexes: [1, 2],
          objectIds: [],
          objectNames: [],
          thumbnail: null,
        },
      ],
      null,
    )

    expect(result.canExport).toBe(true)
    expect(result.reusedSpools).toEqual([{ spoolId: "shared", filamentIndexes: [1, 2] }])
  })
})
