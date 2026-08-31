const DB_NAME = "spoolmap"
const DB_VERSION = 1
const SESSIONS = "sessions"
const PAYLOADS = "payloads"

/** Metadata is cheap, so more sessions are listed than can hold their files. */
const SESSION_LIMIT = 10
const PAYLOAD_LIMIT = 5
const MAX_PAYLOAD_BYTES = 80 * 1024 * 1024

type SessionSelection = { filamentIndex: number; spoolId: string | null }

export type SessionSummary = {
  id: string
  savedAt: number
  modelName: string
  projectTitle: string
  filamentCount: number
  plateCount: number
  selectedPlateId: string | null
  inventoryName: string
  inventoryCount: number
  /** Original inventory import time, not the session's last edit time. */
  inventoryImportedAt: number | null
  selections: SessionSelection[]
  swatches: string[]
  hasPayload: boolean
}

export type SessionPayload = {
  id: string
  modelName: string
  modelBytes: ArrayBuffer
  inventoryText: string
}

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser has no IndexedDB, so history is off."))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: "id" })
      }
      if (!db.objectStoreNames.contains(PAYLOADS)) {
        db.createObjectStore(PAYLOADS, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error("History storage could not be opened."))
  })

  databasePromise.catch(() => {
    databasePromise = null
  })
  return databasePromise
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("History storage request failed."))
  })
}

function isSummary(value: unknown): value is SessionSummary {
  if (!value || typeof value !== "object") return false
  const row = value as Partial<SessionSummary>
  return (
    typeof row.id === "string" &&
    typeof row.savedAt === "number" &&
    typeof row.modelName === "string" &&
    Array.isArray(row.selections)
  )
}

export async function listSessions(): Promise<SessionSummary[]> {
  const db = await openDatabase()
  const store = db.transaction(SESSIONS, "readonly").objectStore(SESSIONS)
  const rows = await settle(store.getAll() as IDBRequest<unknown[]>)
  return rows.filter(isSummary).sort((a, b) => b.savedAt - a.savedAt)
}

export async function deleteSession(id: string): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction([SESSIONS, PAYLOADS], "readwrite")
  tx.objectStore(SESSIONS).delete(id)
  tx.objectStore(PAYLOADS).delete(id)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("Could not remove session."))
  })
}

export async function clearSessions(): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction([SESSIONS, PAYLOADS], "readwrite")
  tx.objectStore(SESSIONS).clear()
  tx.objectStore(PAYLOADS).clear()
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("Could not clear history."))
  })
}

async function put(store: string, value: unknown): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction(store, "readwrite")
  tx.objectStore(store).put(value)
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("Could not write session."))
  })
}

/** Trim to the newest sessions, and drop file bytes for all but the newest few. */
async function prune(): Promise<void> {
  const sessions = await listSessions()

  for (const session of sessions.slice(SESSION_LIMIT)) {
    await deleteSession(session.id)
  }

  const db = await openDatabase()
  for (const session of sessions.slice(PAYLOAD_LIMIT, SESSION_LIMIT)) {
    if (!session.hasPayload) continue
    const tx = db.transaction(PAYLOADS, "readwrite")
    tx.objectStore(PAYLOADS).delete(session.id)
    await put(SESSIONS, { ...session, hasPayload: false })
  }
}

/**
 * Saves a session. If the project is too large or storage is full, the
 * metadata is still kept so the entry can be restored by re-picking the file.
 */
export async function saveSession(
  summary: SessionSummary,
  payload: Omit<SessionPayload, "id"> | null,
): Promise<SessionSummary> {
  let hasPayload = false
  if (payload && payload.modelBytes.byteLength <= MAX_PAYLOAD_BYTES) {
    try {
      await put(PAYLOADS, { ...payload, id: summary.id })
      hasPayload = true
    } catch {
      hasPayload = false
    }
  }

  const stored: SessionSummary = { ...summary, hasPayload }
  await put(SESSIONS, stored)
  await prune().catch(() => undefined)
  return stored
}

export async function updateSession(summary: SessionSummary): Promise<void> {
  await put(SESSIONS, summary)
}

export async function loadPayload(id: string): Promise<SessionPayload | null> {
  const db = await openDatabase()
  const store = db.transaction(PAYLOADS, "readonly").objectStore(PAYLOADS)
  const row = await settle(store.get(id) as IDBRequest<unknown>)
  if (!row || typeof row !== "object") return null
  const payload = row as Partial<SessionPayload>
  if (!(payload.modelBytes instanceof ArrayBuffer)) return null
  if (typeof payload.inventoryText !== "string") return null
  return payload as SessionPayload
}
