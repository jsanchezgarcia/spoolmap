import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import {
  clearSessions,
  listSessions,
  loadPayload,
  saveSession,
  type SessionSummary,
} from "./history"

function summary(index: number): SessionSummary {
  return {
    id: `session-${index}`,
    savedAt: index,
    modelName: `model-${index}.3mf`,
    projectTitle: `Model ${index}`,
    filamentCount: 2,
    plateCount: 1,
    selectedPlateId: "1",
    inventoryName: "spools.json",
    inventoryCount: 3,
    inventoryImportedAt: 1234,
    selections: [],
    swatches: ["#000000"],
    hasPayload: false,
  }
}

beforeEach(async () => {
  await clearSessions()
})

describe("local session history", () => {
  it("round-trips payloads and inventory provenance", async () => {
    const stored = await saveSession(summary(1), {
      modelName: "model-1.3mf",
      modelBytes: new Uint8Array([1, 2, 3]).buffer,
      inventoryText: "[]",
    })

    expect(stored).toMatchObject({ hasPayload: true, inventoryImportedAt: 1234 })
    await expect(loadPayload(stored.id)).resolves.toMatchObject({
      modelName: "model-1.3mf",
      inventoryText: "[]",
    })
  })

  it("keeps ten summaries and payloads only for the newest five", async () => {
    for (let index = 1; index <= 12; index++) {
      await saveSession(summary(index), {
        modelName: `model-${index}.3mf`,
        modelBytes: new Uint8Array([index]).buffer,
        inventoryText: "[]",
      })
    }

    const sessions = await listSessions()
    expect(sessions).toHaveLength(10)
    expect(sessions.map(({ id }) => id)).toEqual(
      Array.from({ length: 10 }, (_, offset) => `session-${12 - offset}`),
    )
    expect(sessions.filter(({ hasPayload }) => hasPayload)).toHaveLength(5)
    await expect(loadPayload("session-7")).resolves.toBeNull()
    await expect(loadPayload("session-8")).resolves.not.toBeNull()
  })

  it("clears summaries and stored files together", async () => {
    await saveSession(summary(1), {
      modelName: "model-1.3mf",
      modelBytes: new Uint8Array([1]).buffer,
      inventoryText: "[]",
    })

    await clearSessions()

    await expect(listSessions()).resolves.toEqual([])
    await expect(loadPayload("session-1")).resolves.toBeNull()
  })
})
