import { describe, expect, it } from "vitest"
import { readStoredSpools } from "./inventory"

describe("stored inventory validation", () => {
  it("rejects cached spools whose raw source row is null", () => {
    expect(
      readStoredSpools([
        {
          id: "valid",
          hex: "#112233",
          material: "PLA",
          raw: { id: "valid" },
        },
        {
          id: "invalid",
          hex: "#445566",
          material: "PETG",
          raw: null,
        },
      ]),
    ).toEqual([
      {
        id: "valid",
        hex: "#112233",
        material: "PLA",
        raw: { id: "valid" },
      },
    ])
  })
})
