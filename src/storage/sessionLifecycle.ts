import {
  clearSessions,
  deleteSession,
  listSessions,
  saveSession,
  updateSession,
  type SessionPayload,
  type SessionSummary,
} from "./history"

const UPDATE_DELAY = 700

export type SessionDraft = {
  summary: SessionSummary
  payload: Omit<SessionPayload, "id">
}

type SessionLifecycleSnapshot = {
  sessionId: string | null
  history: SessionSummary[]
}

type SessionLifecycleDependencies = {
  buildDraft: (id: string) => SessionDraft | null
  onChange: (snapshot: SessionLifecycleSnapshot) => void
}

function randomSessionId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"))
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`
}

/**
 * Owns session identity, persistence timing, and invalidation. Applying a
 * restored payload remains the caller's job because it owns the project,
 * viewer, focus, and render lifecycle.
 */
export function createSessionLifecycle({ buildDraft, onChange }: SessionLifecycleDependencies) {
  let generation = 0
  let sessionId: string | null = null
  let history: SessionSummary[] = []
  let updateTimer: ReturnType<typeof setTimeout> | undefined

  function publish(): void {
    onChange({ sessionId, history })
  }

  function cancelScheduledUpdate(): void {
    clearTimeout(updateTimer)
    updateTimer = undefined
  }

  function beginPlanChange(): number {
    cancelScheduledUpdate()
    sessionId = null
    publish()
    return ++generation
  }

  function isCurrent(candidate: number): boolean {
    return candidate === generation
  }

  async function refresh(): Promise<void> {
    try {
      history = await listSessions()
    } catch {
      history = []
    }
    publish()
  }

  async function startSession(candidate = generation): Promise<boolean> {
    const draft = buildDraft(randomSessionId())
    if (!draft) return false
    try {
      const stored = await saveSession(draft.summary, draft.payload)
      if (!isCurrent(candidate)) {
        await deleteSession(stored.id).catch(() => undefined)
        return false
      }
      sessionId = stored.id
      publish()
      await refresh()
      return true
    } catch {
      // History is a convenience; a storage failure must not block planning.
      return false
    }
  }

  /** Keeps the active entry current without notifying the render lifecycle. */
  function scheduleUpdate(): void {
    if (!sessionId) return
    clearTimeout(updateTimer)
    updateTimer = setTimeout(() => {
      updateTimer = undefined
      const id = sessionId
      if (!id) return
      const draft = buildDraft(id)
      if (!draft) return
      const existing = history.find((entry) => entry.id === id)
      const merged = {
        ...draft.summary,
        hasPayload: existing?.hasPayload ?? false,
      }
      void updateSession(merged).then(
        () => {
          history = history.map((entry) => (entry.id === id ? merged : entry))
          publish()
        },
        () => undefined,
      )
    }, UPDATE_DELAY)
  }

  function adoptSession(id: string): void {
    sessionId = id
    publish()
  }

  async function forgetSession(id: string): Promise<void> {
    try {
      await deleteSession(id)
      if (sessionId === id) sessionId = null
    } catch {
      // The refresh below remains the source of truth after a failed delete.
    }
    await refresh()
  }

  async function clearHistory(): Promise<void> {
    await clearSessions()
    history = []
    sessionId = null
    publish()
  }

  return {
    adoptSession,
    beginPlanChange,
    clearHistory,
    forgetSession,
    isCurrent,
    refresh,
    scheduleUpdate,
    startSession,
  }
}
