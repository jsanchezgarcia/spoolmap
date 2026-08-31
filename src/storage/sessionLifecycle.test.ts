import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { clearSessions, listSessions, type SessionSummary } from "./history"
import { createSessionLifecycle, type SessionDraft } from "./sessionLifecycle"

function draft(id: string): SessionDraft {
  const summary: SessionSummary = {
    id,
    savedAt: 1,
    modelName: "model.3mf",
    projectTitle: "Model",
    filamentCount: 1,
    plateCount: 1,
    selectedPlateId: "1",
    inventoryName: "spools.json",
    inventoryCount: 1,
    inventoryImportedAt: 1234,
    selections: [{ filamentIndex: 1, spoolId: "spool-1" }],
    swatches: ["#112233"],
    hasPayload: false,
  }
  return {
    summary,
    payload: {
      modelName: summary.modelName,
      modelBytes: new Uint8Array([1, 2, 3]).buffer,
      inventoryText: "[]",
    },
  }
}

beforeEach(async () => {
  await clearSessions()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("session lifecycle", () => {
  it("deletes a save that completes after a newer plan starts", async () => {
    const snapshots: Array<{ sessionId: string | null }> = []
    const lifecycle = createSessionLifecycle({
      buildDraft: draft,
      onChange: (snapshot) => snapshots.push(snapshot),
    })

    const firstGeneration = lifecycle.beginPlanChange()
    const saving = lifecycle.startSession(firstGeneration)
    lifecycle.beginPlanChange()

    await expect(saving).resolves.toBe(false)
    await expect(listSessions()).resolves.toEqual([])
    expect(snapshots.at(-1)?.sessionId).toBeNull()
  })

  it("adopts a current save and publishes refreshed history", async () => {
    const snapshots: Array<{ sessionId: string | null; history: SessionSummary[] }> = []
    const lifecycle = createSessionLifecycle({
      buildDraft: draft,
      onChange: (snapshot) => snapshots.push(snapshot),
    })

    const generation = lifecycle.beginPlanChange()

    await expect(lifecycle.startSession(generation)).resolves.toBe(true)
    expect(snapshots.at(-1)).toMatchObject({
      sessionId: expect.any(String),
      history: [expect.objectContaining({ projectTitle: "Model", hasPayload: true })],
    })
  })

  it("cancels a pending metadata update when the plan changes", async () => {
    let savedAt = 1
    const lifecycle = createSessionLifecycle({
      buildDraft: (id) => {
        const next = draft(id)
        next.summary.savedAt = savedAt
        return next
      },
      onChange: () => undefined,
    })
    const generation = lifecycle.beginPlanChange()
    await lifecycle.startSession(generation)

    vi.useFakeTimers()
    savedAt = 2
    lifecycle.scheduleUpdate()
    lifecycle.beginPlanChange()
    await vi.advanceTimersByTimeAsync(700)
    vi.useRealTimers()

    await expect(listSessions()).resolves.toEqual([expect.objectContaining({ savedAt: 1 })])
  })
})
