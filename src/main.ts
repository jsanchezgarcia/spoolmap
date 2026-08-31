import "./style.css"
import { downloadThreeMf } from "./export/remapThreeMf"
import { remapThreeMfInWorker } from "./export/remapInWorker"
import { displayFileName, escapeHtml, fileSize, spoolColors } from "./format"
import { defaultSelection, rankSpools } from "./matching"
import { parseSpoolExport } from "./parse/spools"
import { parseThreeMfData, revokeProjectUrls, type ThreeMfProject } from "./parse/threeMf"
import { loadPayload, type SessionSummary } from "./storage/history"
import { readStoredSpools } from "./storage/inventory"
import { createSessionLifecycle } from "./storage/sessionLifecycle"
import { exportReadiness } from "./planning/readiness"
import type { FilamentChoice, PhysicalSpool } from "./types"
import {
  SAMPLE_INVENTORY_NAME,
  SAMPLE_MODEL_NAME,
  createSampleProject,
  sampleInventoryText,
} from "./sample/demoProject"
import { createAppView } from "./ui/appView"
import { createConfirmDialog } from "./ui/confirmDialog"
import { createFeedbackDialog } from "./ui/feedbackDialog"
import { createMatchView, filterSpoolMenu } from "./ui/matchView"
import { createPasteInventoryDialog } from "./ui/pasteInventoryDialog"
import { APP_VERSION } from "./version"
import type { PlateViewer, ViewPreset } from "./viewer/plateViewer"

const STORAGE_KEY = "spoolmap.inventory.v1"
const NAME_KEY = `${STORAGE_KEY}.name`
const IMPORTED_AT_KEY = `${STORAGE_KEY}.importedAt`

/**
 * Past this age the cached inventory is called out as possibly behind the
 * spool list on 3dfilamentprofiles.com. Matching can only ever be as current
 * as the last import, so the operator has to be told how old it is.
 */
const STALE_AFTER = 7 * 24 * 60 * 60 * 1000
const MAX_INVENTORY_BYTES = 10 * 1024 * 1024
const MAX_PROJECT_BYTES = 100 * 1024 * 1024

/**
 * `hold` keeps a success notice on screen because it carries an instruction the
 * operator still has to act on, rather than just confirming what they watched
 * happen.
 */
type Notice = { kind: "error" | "success"; text: string }
type AppState = {
  inventory: PhysicalSpool[]
  inventoryName: string | null
  inventoryText: string | null
  inventoryImportedAt: number | null
  project: ThreeMfProject | null
  modelBytes: ArrayBuffer | null
  choices: FilamentChoice[]
  selectedPlateId: string | null
  openSpoolMenu: number | null
  sessionId: string | null
  history: SessionSummary[]
  notice: Notice | null
  loading: Set<"inventory" | "model" | "restore">
  dragging: "inventory" | "model" | null
  exportAction: "download" | null
}

function storedValue(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function removeStoredValues(...keys: string[]): void {
  try {
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // Browser policy may disable storage entirely; in-memory state still works.
  }
}

function restoreInventory(): PhysicalSpool[] {
  try {
    const saved = storedValue(STORAGE_KEY)
    const parsed: unknown = saved ? JSON.parse(saved) : null
    return readStoredSpools(parsed)
  } catch {
    removeStoredValues(STORAGE_KEY)
    return []
  }
}

function restoreImportedAt(): number | null {
  const saved = Number(storedValue(IMPORTED_AT_KEY))
  return Number.isFinite(saved) && saved > 0 ? saved : null
}

const startingInventory = restoreInventory()

const state: AppState = {
  inventory: startingInventory,
  inventoryName: storedValue(NAME_KEY),
  inventoryText: startingInventory.length
    ? JSON.stringify(startingInventory.map((spool) => spool.raw))
    : null,
  inventoryImportedAt: startingInventory.length ? restoreImportedAt() : null,
  project: null,
  modelBytes: null,
  choices: [],
  selectedPlateId: null,
  openSpoolMenu: null,
  sessionId: null,
  history: [],
  notice: null,
  loading: new Set(),
  dragging: null,
  exportAction: null,
}

const app = document.querySelector<HTMLDivElement>("#app")!
const confirmAction = createConfirmDialog()
const openFeedback = createFeedbackDialog()
const pasteInventory = createPasteInventoryDialog()
let plateViewer: PlateViewer | null = null
let plateViewerPromise: Promise<PlateViewer> | null = null

async function ensurePlateViewer(): Promise<PlateViewer> {
  if (plateViewer) return plateViewer
  plateViewerPromise ??= import("./viewer/plateViewer").then(
    ({ PlateViewer: Viewer }) => new Viewer(),
  )
  plateViewer = await plateViewerPromise
  return plateViewer
}

/** Long enough to read one line without turning a confirmation into a chore. */
const NOTICE_LIFETIME = 8000

let noticeTimer: number | undefined
let noticeSerial = 0

/**
 * Every notice change takes a new serial, so a timer that is already queued can
 * tell it belongs to a notice that has since been replaced or dismissed and
 * retire without touching the current one. Errors are never given a timer: a
 * failure has to be read and acted on.
 */
function setNotice(notice: Notice | null): void {
  const serial = ++noticeSerial
  window.clearTimeout(noticeTimer)
  noticeTimer = undefined
  state.notice = notice
  if (!notice || notice.kind === "error") return
  noticeTimer = window.setTimeout(() => {
    if (serial !== noticeSerial) return
    state.notice = null
    // Retiring on a timer is the one state change nobody asked for, so it lifts
    // the element out instead of re-rendering: a full render remounts the
    // viewer canvas and would break an orbit drag in progress.
    document.querySelector(".notice")?.remove()
  }, NOTICE_LIFETIME)
}

function noticeMarkup(): string {
  return state.notice
    ? `<div class="notice ${state.notice.kind}" role="${state.notice.kind === "error" ? "alert" : "status"}">
        <span aria-hidden="true">${state.notice.kind === "error" ? "!" : "✓"}</span>
        <p>${escapeHtml(state.notice.text)}</p>
        <button type="button" data-dismiss aria-label="Dismiss message">×</button>
      </div>`
    : '<div class="sr-only" aria-live="polite"></div>'
}

function refreshNotice(): void {
  const current = document.querySelector("main > .notice, main > .sr-only")
  if (!current) return
  current.insertAdjacentHTML("beforebegin", noticeMarkup())
  current.remove()
}

function setExportButtonBusy(busy: boolean): void {
  const button = document.querySelector<HTMLButtonElement>("[data-export]")
  const label = button?.querySelector("strong")
  if (!button || !label) return
  button.disabled = busy
  label.innerHTML = busy
    ? '<i class="spinner"></i>Preparing download…'
    : "Download for Bambu Studio or Orca"
}

/**
 * `importedAt` is when this spool list was read off disk, not when it was
 * cached, so reopening a session keeps the age of the export it was planned
 * with rather than looking freshly imported.
 */
function saveInventory(importedAt: number | null): boolean {
  state.inventoryImportedAt = importedAt
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.inventory))
    if (importedAt === null) localStorage.removeItem(IMPORTED_AT_KEY)
    else localStorage.setItem(IMPORTED_AT_KEY, String(importedAt))
    if (state.inventoryName) localStorage.setItem(NAME_KEY, state.inventoryName)
    else localStorage.removeItem(NAME_KEY)
    return true
  } catch {
    // A partial cache is worse than no cache: it could restore an inventory
    // with the wrong filename or age on the next visit. In-memory work remains
    // valid for the current session regardless of browser storage availability.
    try {
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(NAME_KEY)
      localStorage.removeItem(IMPORTED_AT_KEY)
    } catch {
      // Storage may be entirely unavailable (privacy mode / policy).
    }
    return false
  }
}

function rebuildChoices(keepSelections = true): void {
  state.openSpoolMenu = null
  if (!state.project) {
    state.choices = []
    return
  }
  const previous = new Map(
    state.choices.map((choice) => [choice.filament.index, choice.selectedSpoolId]),
  )
  state.choices = state.project.filaments.map((filament) => {
    const matches = rankSpools(filament, state.inventory)
    const carried = keepSelections ? previous.get(filament.index) : undefined
    const stillValid = carried && matches.some(({ spool }) => spool.id === carried)
    return {
      filament,
      matches,
      selectedSpoolId: stillValid ? carried : defaultSelection(matches),
    }
  })
}

function activePlate() {
  return state.project?.plates.find(({ id }) => id === state.selectedPlateId)
}

/** Rows follow the current scope: whole model or one plate. */
function visibleChoices(): FilamentChoice[] {
  const plate = activePlate()
  if (!plate || plate.filamentIndexes.length === 0) return state.choices
  const wanted = new Set(plate.filamentIndexes)
  return state.choices.filter(({ filament }) => wanted.has(filament.index))
}

function scopeLabel(): string {
  const plate = activePlate()
  return plate ? plate.name : "Whole model"
}

function originalViewerColors(): Map<number, string> {
  return new Map(state.choices.map(({ filament }) => [filament.index, filament.hex]))
}

function spoolViewerColors(): Map<number, string> {
  return new Map(
    state.choices.map((choice) => {
      const selected = choice.matches.find(({ spool }) => spool.id === choice.selectedSpoolId)
      return [choice.filament.index, selected?.spool.hex ?? choice.filament.hex]
    }),
  )
}

function selectedColorRemaps(): Array<{
  index: number
  hex: string
  colors: string[]
}> {
  return state.choices.flatMap((choice) => {
    const selected = choice.matches.find(({ spool }) => spool.id === choice.selectedSpoolId)
    return selected
      ? [
          {
            index: choice.filament.index,
            hex: selected.spool.hex,
            colors: spoolColors(selected.spool),
          },
        ]
      : []
  })
}

async function exportProject(): Promise<void> {
  if (!state.project || !state.modelBytes || state.exportAction) return
  const readiness = exportReadiness(state.choices, state.project.plates, state.selectedPlateId)
  if (!readiness.canExport) {
    setNotice({
      kind: "error",
      text: `Assign a spool to ${filamentCodes(readiness.unresolvedIndexes)} before exporting the whole project.`,
    })
    render()
    return
  }

  state.exportAction = "download"
  setNotice(null)
  refreshNotice()
  setExportButtonBusy(true)

  try {
    const file = await remapThreeMfInWorker(
      state.modelBytes,
      state.project.fileName,
      selectedColorRemaps(),
    )
    downloadThreeMf(file)
    setNotice({
      kind: "success",
      text: `${displayFileName(file.fileName)} downloaded. Open it in Studio and confirm the final filament profiles and AMS slots.`,
    })
    refreshNotice()
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === "AbortError"
    setNotice(
      aborted
        ? null
        : {
            kind: "error",
            text:
              error instanceof Error
                ? `The remapped 3MF could not be created. ${error.message}`
                : "The remapped 3MF could not be created.",
          },
    )
    refreshNotice()
  } finally {
    state.exportAction = null
    setExportButtonBusy(false)
  }
}

/* ---------------------------------------------------------------- history */

function buildSummary(id: string): SessionSummary | null {
  if (!state.project || state.inventory.length === 0) return null
  return {
    id,
    savedAt: Date.now(),
    modelName: state.project.fileName,
    projectTitle: state.project.title,
    filamentCount: state.project.filaments.length,
    plateCount: state.project.plates.length,
    selectedPlateId: state.selectedPlateId,
    inventoryName: state.inventoryName ?? "inventory.json",
    inventoryCount: state.inventory.length,
    inventoryImportedAt: state.inventoryImportedAt,
    selections: state.choices.map((choice) => ({
      filamentIndex: choice.filament.index,
      spoolId: choice.selectedSpoolId,
    })),
    swatches: state.project.filaments.slice(0, 9).map(({ hex }) => hex),
    hasPayload: false,
  }
}

let inventoryRequest = 0
let modelRequest = 0
let restoreRequest = 0

const sessionLifecycle = createSessionLifecycle({
  buildDraft: (id) => {
    const summary = buildSummary(id)
    if (!summary || !state.modelBytes || !state.inventoryText) return null
    return {
      summary,
      payload: {
        modelName: summary.modelName,
        modelBytes: state.modelBytes,
        inventoryText: state.inventoryText,
      },
    }
  },
  onChange: (snapshot) => {
    state.sessionId = snapshot.sessionId
    state.history = snapshot.history
  },
})

const refreshHistory = (): Promise<void> => sessionLifecycle.refresh()
const beginPlanChange = (): number => sessionLifecycle.beginPlanChange()

async function startSession(generation: number): Promise<void> {
  if (await sessionLifecycle.startSession(generation)) render()
}

function scheduleSessionUpdate(): void {
  sessionLifecycle.scheduleUpdate()
}

async function restoreSession(id: string): Promise<void> {
  const entry = state.history.find((session) => session.id === id)
  if (!entry) return

  const request = ++restoreRequest
  ++inventoryRequest
  ++modelRequest
  const generation = beginPlanChange()
  state.loading.add("restore")
  setNotice(null)
  render()

  try {
    const payload = entry.hasPayload ? await loadPayload(id) : null
    if (!payload) {
      if (request !== restoreRequest || !sessionLifecycle.isCurrent(generation)) return
      setNotice({
        kind: "error",
        text: `The files for “${entry.projectTitle}” are no longer stored. Choose the 3MF and inventory again to rebuild this plan.`,
      })
      return
    }

    const inventory = parseSpoolExport(payload.inventoryText)
    const project = await parseThreeMfData(payload.modelBytes, payload.modelName)
    if (request !== restoreRequest || !sessionLifecycle.isCurrent(generation)) {
      revokeProjectUrls(project)
      return
    }
    const viewer = await ensurePlateViewer()
    if (request !== restoreRequest || !sessionLifecycle.isCurrent(generation)) {
      revokeProjectUrls(project)
      return
    }

    if (state.project) revokeProjectUrls(state.project)
    state.inventory = inventory
    state.inventoryText = payload.inventoryText
    state.inventoryName = entry.inventoryName
    state.project = project
    state.modelBytes = payload.modelBytes
    viewer.openProject(payload.modelBytes.slice(0))
    state.selectedPlateId =
      entry.selectedPlateId && project.plates.some(({ id }) => id === entry.selectedPlateId)
        ? entry.selectedPlateId
        : (project.plates[0]?.id ?? null)
    saveInventory(typeof entry.inventoryImportedAt === "number" ? entry.inventoryImportedAt : null)

    rebuildChoices(false)
    for (const { filamentIndex, spoolId } of entry.selections) {
      const choice = state.choices.find(({ filament }) => filament.index === filamentIndex)
      if (!choice || !spoolId) continue
      if (choice.matches.some(({ spool }) => spool.id === spoolId)) {
        choice.selectedSpoolId = spoolId
      }
    }
    sessionLifecycle.adoptSession(entry.id)
    setNotice({
      kind: "success",
      text: `Reopened “${project.title}” · ${inventory.length} spools · saved choices`,
    })
  } catch (error) {
    if (request !== restoreRequest || !sessionLifecycle.isCurrent(generation)) return
    setNotice({
      kind: "error",
      text:
        error instanceof Error
          ? `That session could not be reopened. ${error.message}`
          : "That session could not be reopened.",
    })
  } finally {
    if (request === restoreRequest && sessionLifecycle.isCurrent(generation)) {
      state.loading.delete("restore")
      await refreshHistory()
      render()
      document.getElementById("matches")?.scrollIntoView({ block: "start" })
    }
  }
}

async function forgetSession(id: string): Promise<void> {
  await sessionLifecycle.forgetSession(id)
  render()
}

function forgetInventory(): void {
  ++inventoryRequest
  ++restoreRequest
  const generation = beginPlanChange()
  state.loading.delete("inventory")
  state.loading.delete("restore")
  state.inventory = []
  state.inventoryName = null
  state.inventoryText = null
  state.inventoryImportedAt = null
  removeStoredValues(STORAGE_KEY, NAME_KEY, IMPORTED_AT_KEY)
  rebuildChoices(false)
  if (state.project) void startSession(generation)
  setNotice({ kind: "success", text: "Spool inventory cleared" })
  render()
}

async function goHome(): Promise<void> {
  if (!state.project && !state.loading.size) {
    window.scrollTo({ top: 0, behavior: "smooth" })
    return
  }
  if (
    await confirmAction({
      title: "Return to the start?",
      body: "This clears the open 3MF so you can start again. Your spool inventory and saved recents stay.",
      confirmLabel: "Go to start",
    })
  ) {
    clearProject()
    window.scrollTo({ top: 0 })
  }
}

async function pasteInventoryList(): Promise<void> {
  const text = await pasteInventory()
  if (text === null) return
  const file = new File([text], "pasted-spools.json", { type: "application/json" })
  await importInventory(file)
}

async function loadSample(): Promise<void> {
  if (state.loading.size) return
  const requestInventory = ++inventoryRequest
  const requestModel = ++modelRequest
  ++restoreRequest
  state.loading.delete("restore")
  state.loading.add("inventory")
  state.loading.add("model")
  setNotice(null)
  render()
  try {
    const inventory = parseSpoolExport(sampleInventoryText())
    const bytes = await createSampleProject()
    const project = await parseThreeMfData(bytes, SAMPLE_MODEL_NAME)
    if (requestInventory !== inventoryRequest || requestModel !== modelRequest) {
      revokeProjectUrls(project)
      return
    }
    const viewer = await ensurePlateViewer()
    if (requestInventory !== inventoryRequest || requestModel !== modelRequest) {
      revokeProjectUrls(project)
      return
    }
    const generation = beginPlanChange()
    if (state.project) revokeProjectUrls(state.project)
    state.inventory = inventory
    state.inventoryText = sampleInventoryText()
    state.inventoryName = SAMPLE_INVENTORY_NAME
    const saved = saveInventory(Date.now())
    state.project = project
    state.modelBytes = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    viewer.openProject(state.modelBytes.slice(0))
    state.selectedPlateId = project.plates[0]?.id ?? null
    rebuildChoices(false)
    setNotice({
      kind: saved ? "success" : "error",
      text: saved
        ? `Sample owl loaded · ${inventory.length} spools saved on this device`
        : `Sample owl loaded · ${inventory.length} spools; this browser would not save them`,
    })
    void startSession(generation)
  } catch (error) {
    if (requestInventory !== inventoryRequest || requestModel !== modelRequest) return
    setNotice({
      kind: "error",
      text: error instanceof Error ? error.message : "The sample project could not be loaded.",
    })
  } finally {
    if (requestInventory === inventoryRequest) state.loading.delete("inventory")
    if (requestModel === modelRequest) state.loading.delete("model")
    if (requestInventory === inventoryRequest && requestModel === modelRequest) render()
  }
}

function clearProject(): void {
  ++modelRequest
  ++restoreRequest
  beginPlanChange()
  state.loading.delete("model")
  state.loading.delete("restore")
  if (state.project) revokeProjectUrls(state.project)
  state.project = null
  state.modelBytes = null
  state.choices = []
  state.selectedPlateId = null
  plateViewer?.closeProject()
  setNotice({ kind: "success", text: "Project cleared; your inventory is still available" })
  render()
}

async function clearLocalHistory(): Promise<void> {
  try {
    await sessionLifecycle.clearHistory()
    setNotice({ kind: "success", text: "Saved project history cleared from this browser" })
  } catch (error) {
    setNotice({
      kind: "error",
      text: error instanceof Error ? error.message : "Saved history could not be cleared.",
    })
  }
  render()
}

/* ----------------------------------------------------------------- render */

const { metaGroup, fileMark, fitFileNames, renderDropzone, renderHistory } = createAppView({
  state,
  staleAfter: STALE_AFTER,
})
function filamentCodes(indexes: number[]): string {
  return indexes.map((index) => `F${String(index).padStart(2, "0")}`).join(", ")
}

const { renderExportActions, renderMatches, renderMatchRow, renderReadiness } = createMatchView({
  state,
  activePlate,
  visibleChoices,
  scopeLabel,
  metaGroup,
  fileMark,
})

function focusSelector(element: Element | null): string | null {
  if (!(element instanceof HTMLElement)) return null
  const pairs: Array<[string, string | undefined]> = [
    ["data-spool-menu", element.dataset.spoolMenu],
    ["data-plate", element.dataset.plate],
    ["data-select-spool", element.dataset.selectSpool],
    ["data-restore", element.dataset.restore],
    ["data-forget", element.dataset.forget],
    ["data-viewer-view", element.dataset.viewerView],
  ]
  for (const [attribute, value] of pairs) {
    if (value === undefined) continue
    const base = `[${attribute}="${CSS.escape(value)}"]`
    return attribute === "data-select-spool" && element.dataset.filament
      ? `${base}[data-filament="${CSS.escape(element.dataset.filament)}"]`
      : base
  }
  for (const attribute of [
    "data-viewer-recenter",
    "data-dismiss",
    "data-clear-inventory",
    "data-clear-model",
    "data-clear-history",
    "data-load-sample",
    "data-paste-inventory",
  ]) {
    if (element.hasAttribute(attribute)) return `[${attribute}]`
  }
  return null
}

function render(): void {
  const restoreFocus = focusSelector(document.activeElement)
  const recentWasOpen = document.querySelector<HTMLDetailsElement>(".recent-drawer")?.open
  app.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/" aria-label="Spoolmap home">
        <picture>
          <source srcset="/spoolmap-logo-dark.svg" media="(prefers-color-scheme: dark)">
          <img class="brand-logo" src="/spoolmap-logo.svg" alt="Spoolmap">
        </picture>
        <small>Choose spools before loading the AMS</small>
      </a>
      <nav class="topbar-actions" aria-label="Project links">
        <button class="feedback-link" type="button" data-feedback>Feedback</button>
        <a class="source-link-header" href="https://github.com/jsanchezgarcia/spoolmap" target="_blank" rel="noreferrer" aria-label="View source on GitHub" title="View source on GitHub">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.24c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.16 1.18a10.96 10.96 0 0 1 5.76 0c2.19-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.79 1.07.79 2.16v3.26c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z"/></svg>
        </a>
      </nav>
    </header>
    <main id="main">
      ${
        state.project
          ? ""
          : `<section class="intro">
        <div class="intro-copy">
          <span class="eyebrow">Bambu / Orca 3MF</span>
          <h1>Choose your spools before loading the AMS.</h1>
          <p>Match every 3MF color against the filament you own, plate by plate. Download the result for Bambu Studio, then confirm the final AMS slots there.</p>
        </div>
        <div class="intro-guide">
          <p class="local-note"><span class="local-dot" aria-hidden="true"></span><span><strong>Local-first.</strong> Your source files and spool list stay in this browser.</span></p>
          <ol class="workflow" aria-label="How Spoolmap works">
            <li><span>1</span><strong>Import</strong><small>3MF + spool list</small></li>
            <li><span>2</span><strong>Choose</strong><small>Spools for each plate</small></li>
            <li><span>3</span><strong>Confirm</strong><small>AMS slots in Studio</small></li>
          </ol>
          <button class="sample-action" type="button" data-load-sample ${state.loading.size ? "disabled" : ""}>Try a sample project</button>
        </div>
      </section>`
      }

      <section class="inputs ${state.project ? "is-compact" : ""}" aria-label="Input files">
        ${renderDropzone("inventory")}
        ${renderDropzone("model")}
      </section>

      ${noticeMarkup()}

      ${state.project ? renderMatches() : ""}
      ${renderHistory()}
    </main>
    <footer class="site-footer">
      <p>Spoolmap ${APP_VERSION} <span class="meta-sep" aria-hidden="true">·</span> <a href="https://github.com/jsanchezgarcia/spoolmap/blob/main/LICENSE">MIT</a> <span class="meta-sep" aria-hidden="true">·</span> Files stay in this browser</p>
      <p>Unofficial — not affiliated with Bambu Lab, OrcaSlicer, or 3DFilamentProfiles</p>
    </footer>`
  bindFileControls()
  fitFileNames()
  const viewerHost = document.querySelector<HTMLElement>("[data-plate-viewer]")
  if (viewerHost) {
    void ensurePlateViewer().then((viewer) => {
      if (!viewerHost.isConnected || !state.project) return
      viewer.mount(viewerHost)
      const plate = activePlate()
      viewer.setColors(originalViewerColors(), spoolViewerColors())
      viewer.showPlate(plate?.id ?? null, plate?.objectIds ?? [])
    })
  }
  if (recentWasOpen) {
    const recent = document.querySelector<HTMLDetailsElement>(".recent-drawer")
    if (recent) recent.open = true
  }
  if (restoreFocus) {
    document.querySelector<HTMLElement>(restoreFocus)?.focus({ preventScroll: true })
  }
}

function renderPreservingScroll(): void {
  const x = window.scrollX
  const y = window.scrollY
  render()
  window.scrollTo(x, y)
}

/** Refresh selection-dependent UI without destroying and remounting the viewer. */
function renderSpoolSelection(filamentIndex: number): void {
  const row = document.querySelector<HTMLElement>(`[data-match-row="${filamentIndex}"]`)
  const nextRow = renderMatchRow(filamentIndex)
  if (row && nextRow) row.outerHTML = nextRow

  const readiness = document.querySelector<HTMLElement>(".readiness")
  if (readiness) readiness.outerHTML = renderReadiness()

  const exportActions = document.querySelector<HTMLElement>(".export-actions")
  if (exportActions) exportActions.outerHTML = renderExportActions()

  plateViewer?.setColors(originalViewerColors(), spoolViewerColors())
}

/* ---------------------------------------------------------------- imports */

async function importInventory(file: File): Promise<void> {
  const request = ++inventoryRequest
  ++restoreRequest
  state.loading.delete("restore")
  state.loading.add("inventory")
  setNotice(null)
  render()
  try {
    if (file.size > MAX_INVENTORY_BYTES) {
      throw new Error("This inventory export is larger than the 10 MB safety limit.")
    }
    const text = await file.text()
    const inventory = parseSpoolExport(text)
    if (request !== inventoryRequest) return
    const generation = beginPlanChange()
    state.inventory = inventory
    state.inventoryText = text
    state.inventoryName = file.name
    const saved = saveInventory(Date.now())
    rebuildChoices()
    setNotice({
      kind: saved ? "success" : "error",
      text: saved
        ? `${inventory.length} spool${inventory.length === 1 ? "" : "s"} saved on this device`
        : `${inventory.length} spool${inventory.length === 1 ? "" : "s"} loaded; this browser would not save them`,
    })
    if (state.project) void startSession(generation)
  } catch (error) {
    if (request !== inventoryRequest) return
    setNotice({
      kind: "error",
      text: error instanceof Error ? error.message : "The inventory could not be read.",
    })
  } finally {
    if (request === inventoryRequest) {
      state.loading.delete("inventory")
      render()
    }
  }
}

async function importModel(file: File): Promise<void> {
  if (!/\.3mf$/i.test(file.name)) {
    setNotice({ kind: "error", text: "Choose a .3mf project file." })
    render()
    return
  }
  const request = ++modelRequest
  ++restoreRequest
  state.loading.delete("restore")
  state.loading.add("model")
  setNotice(null)
  render()
  try {
    if (file.size > MAX_PROJECT_BYTES) {
      throw new Error("This project is larger than the 100 MB safety limit.")
    }
    const bytes = await file.arrayBuffer()
    const project = await parseThreeMfData(bytes, file.name)
    if (request !== modelRequest) {
      revokeProjectUrls(project)
      return
    }
    const viewer = await ensurePlateViewer()
    if (request !== modelRequest) {
      revokeProjectUrls(project)
      return
    }
    const generation = beginPlanChange()
    if (state.project) revokeProjectUrls(state.project)
    state.project = project
    state.modelBytes = bytes
    viewer.openProject(bytes.slice(0))
    // A plate is the unit people actually print, so start there, not at everything.
    state.selectedPlateId = project.plates[0]?.id ?? null
    rebuildChoices(false)
    setNotice({
      kind: "success",
      text: `${project.filaments.length} design color${project.filaments.length === 1 ? "" : "s"} · ${displayFileName(file.name)} · ${fileSize(file.size)}`,
    })
    if (state.inventory.length) void startSession(generation)
  } catch (error) {
    if (request !== modelRequest) return
    setNotice({
      kind: "error",
      text: error instanceof Error ? error.message : "The 3MF could not be read.",
    })
  } finally {
    if (request === modelRequest) {
      state.loading.delete("model")
      render()
    }
  }
}

function bindFileControls(): void {
  document.querySelectorAll<HTMLInputElement>("[data-file]").forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files?.[0]
      if (!file) return
      if (input.dataset.file === "inventory") void importInventory(file)
      else void importModel(file)
    })
  })

  document.querySelectorAll<HTMLElement>("[data-drop]").forEach((zone) => {
    const kind = zone.dataset.drop as "inventory" | "model"
    zone.addEventListener("dragover", (event) => {
      event.preventDefault()
      state.dragging = kind
      zone.classList.add("is-dragging")
    })
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget as Node | null)) {
        state.dragging = null
        zone.classList.remove("is-dragging")
      }
    })
    zone.addEventListener("drop", (event) => {
      event.preventDefault()
      state.dragging = null
      const file = event.dataTransfer?.files[0]
      if (!file) return
      if (kind === "inventory") void importInventory(file)
      else void importModel(file)
    })
  })
}

function closeSpoolMenus(): void {
  state.openSpoolMenu = null
  document
    .querySelectorAll<HTMLButtonElement>("[data-spool-menu][aria-expanded='true']")
    .forEach((button) => {
      button.setAttribute("aria-expanded", "false")
      const menu = document.getElementById(button.dataset.spoolPopup ?? "")
      if (!menu) return
      menu.hidden = true
      menu.classList.remove("opens-upward")
      menu.replaceChildren()
    })
}

app.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement

  if (target.closest("[data-feedback]")) {
    openFeedback()
    return
  }

  if (target.closest("[data-load-sample]")) {
    void loadSample()
    return
  }

  if (target.closest("[data-paste-inventory]")) {
    void pasteInventoryList()
    return
  }

  const brand = target.closest<HTMLAnchorElement>(".brand")
  if (brand) {
    event.preventDefault()
    void goHome()
    return
  }

  const spoolMenuTrigger = target.closest<HTMLButtonElement>("[data-spool-menu]")
  if (spoolMenuTrigger) {
    const index = Number(spoolMenuTrigger.dataset.spoolMenu)
    const willOpen = state.openSpoolMenu !== index
    state.openSpoolMenu = willOpen ? index : null
    renderPreservingScroll()
    const renderedTrigger = document.querySelector<HTMLButtonElement>(
      `[data-spool-menu="${index}"]`,
    )
    const menu = document.getElementById(`spool-menu-${index}`)
    if (menu) {
      if (willOpen) {
        const rect = renderedTrigger?.getBoundingClientRect() ?? menu.getBoundingClientRect()
        const below = window.innerHeight - rect.bottom
        const desiredHeight = Math.min(390, window.innerHeight * 0.58)
        menu.classList.toggle("opens-upward", below < desiredHeight && rect.top > below)
        menu.querySelector<HTMLInputElement>("[data-spool-filter]")?.focus({ preventScroll: true })
      }
    }
    return
  }

  if (!target.closest("[data-spool-picker]")) closeSpoolMenus()

  if (target.closest("[data-clear-inventory]")) {
    if (
      await confirmAction({
        title: "Clear spool inventory?",
        body: "This removes the saved inventory from this device. You can import it again anytime.",
        confirmLabel: "Clear inventory",
      })
    ) {
      forgetInventory()
    }
    return
  }

  if (target.closest("[data-clear-model]")) {
    if (
      await confirmAction({
        title: "Clear project?",
        body: "This removes the open 3MF from this screen. Your spool inventory and saved recents stay.",
        confirmLabel: "Clear project",
      })
    ) {
      clearProject()
    }
    return
  }

  if (target.closest("[data-clear-history]")) {
    if (
      await confirmAction({
        title: "Clear saved projects?",
        body: "This removes all recent projects and stored 3MF files from this device. Your spool inventory stays.",
        confirmLabel: "Clear projects",
      })
    ) {
      void clearLocalHistory()
    }
    return
  }

  if (target.closest("[data-viewer-recenter]")) {
    plateViewer?.recenter()
    return
  }

  const viewButton = target.closest<HTMLButtonElement>("[data-viewer-view]")
  if (viewButton) {
    plateViewer?.setView(viewButton.dataset.viewerView as ViewPreset)
    return
  }

  const exportButton = target.closest<HTMLButtonElement>("[data-export]")
  if (exportButton) {
    void exportProject()
    return
  }

  const alternative = target.closest<HTMLButtonElement>("[data-select-spool]")
  if (alternative) {
    const index = Number(alternative.dataset.filament)
    const selectedFromMenu = Boolean(alternative.closest(".spool-menu"))
    const choice = state.choices.find(({ filament }) => filament.index === index)
    if (choice) {
      choice.selectedSpoolId = alternative.dataset.selectSpool || null
      state.openSpoolMenu = null
      scheduleSessionUpdate()
      renderSpoolSelection(index)
      if (selectedFromMenu) {
        document
          .querySelector<HTMLButtonElement>(`[data-spool-menu="${index}"]`)
          ?.focus({ preventScroll: true })
      }
    }
    return
  }

  const scope = target.closest<HTMLButtonElement>("[data-plate]")
  if (scope) {
    const next = scope.dataset.plate || null
    if (next !== state.selectedPlateId) {
      state.selectedPlateId = next
      scheduleSessionUpdate()
      render()
    }
    return
  }

  const restore = target.closest<HTMLButtonElement>("[data-restore]")
  if (restore?.dataset.restore) {
    void restoreSession(restore.dataset.restore)
    return
  }

  const forget = target.closest<HTMLButtonElement>("[data-forget]")
  if (forget?.dataset.forget) {
    const entry = state.history.find(({ id }) => id === forget.dataset.forget)
    if (
      await confirmAction({
        title: "Remove saved project?",
        body: `“${entry?.projectTitle ?? "This project"}” will be removed from this device.`,
        confirmLabel: "Remove project",
      })
    ) {
      void forgetSession(forget.dataset.forget)
    }
    return
  }

  if (target.closest("[data-dismiss]")) {
    setNotice(null)
    render()
  }
})

app.addEventListener("input", (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>("[data-spool-filter]")
  if (input) filterSpoolMenu(input)
})

document.addEventListener("keydown", (event) => {
  const openSpoolTrigger = document.querySelector<HTMLButtonElement>(
    "[data-spool-menu][aria-expanded='true']",
  )
  if (openSpoolTrigger && event.key === "Escape") {
    event.preventDefault()
    closeSpoolMenus()
    openSpoolTrigger.focus({ preventScroll: true })
    return
  }

  if (
    openSpoolTrigger &&
    document.activeElement instanceof HTMLInputElement &&
    document.activeElement.matches("[data-spool-filter]") &&
    ["ArrowDown", "ArrowUp"].includes(event.key)
  ) {
    event.preventDefault()
    const options = Array.from(
      document.activeElement
        .closest(".spool-menu")
        ?.querySelectorAll<HTMLButtonElement>(".spool-menu-option[role='option']") ?? [],
    ).filter((option) => !option.hidden)

    options[event.key === "ArrowDown" ? 0 : options.length - 1]?.focus()
    return
  }

  if (
    openSpoolTrigger &&
    document.activeElement instanceof HTMLElement &&
    document.activeElement.matches(".spool-menu [role='option']") &&
    ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
  ) {
    event.preventDefault()
    const menu = document.getElementById(openSpoolTrigger.dataset.spoolPopup ?? "")
    const options = Array.from(
      menu?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? [],
    ).filter((option) => !option.hidden)
    const current = options.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? options.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
    options[next]?.focus()
    return
  }

  if (
    event.key === "ArrowDown" &&
    document.activeElement instanceof HTMLElement &&
    document.activeElement.matches("[data-spool-menu]")
  ) {
    event.preventDefault()
    const trigger = document.activeElement as HTMLButtonElement
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click()
    const listbox = document.getElementById(trigger.getAttribute("aria-controls") ?? "")
    listbox?.querySelector<HTMLButtonElement>("[role='option']")?.focus()
    return
  }
})

// File name budgets are width-dependent, so they are re-cut, not re-rendered.
let refit = 0
window.addEventListener("resize", () => {
  cancelAnimationFrame(refit)
  refit = requestAnimationFrame(fitFileNames)
})

render()
void refreshHistory().then(render)
