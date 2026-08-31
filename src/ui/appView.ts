import { displayFileName, escapeHtml, exactTime, relativeTime, truncateMiddle } from "../format"
import type { ThreeMfProject } from "../parse/threeMf"
import type { SessionSummary } from "../storage/history"
import type { PhysicalSpool } from "../types"

type AppViewState = {
  inventory: PhysicalSpool[]
  inventoryName: string | null
  inventoryImportedAt: number | null
  project: ThreeMfProject | null
  history: SessionSummary[]
  sessionId: string | null
  loading: Set<"inventory" | "model" | "restore">
  dragging: "inventory" | "model" | null
}

type AppViewDependencies = {
  state: AppViewState
  staleAfter: number
}

export function createAppView(dependencies: AppViewDependencies): {
  metaGroup: (parts: Array<string | null | undefined>) => string
  fileMark: (name: string, className: string) => string
  fitFileNames: () => void
  renderDropzone: (kind: "inventory" | "model") => string
  renderHistory: () => string
} {
  const { state, staleAfter } = dependencies
  const colorCount = (count: number): string => `${count} color${count === 1 ? "" : "s"}`

  /**
   * Metadata reads as a wall when unrelated facts are strung together with the
   * same dot in the same colour. Two rules keep it scannable everywhere it
   * appears: an interpunct only ever joins facts of the same kind, and a
   * different kind of fact is set apart by whitespace and colour instead.
   */
  const META_SEP = '<span class="meta-sep" aria-hidden="true">·</span>'

  /** Joins same-kind facts. Parts are HTML, so callers escape their own text. */
  function metaGroup(parts: Array<string | null | undefined>): string {
    return parts.filter((part): part is string => Boolean(part)).join(` ${META_SEP} `)
  }

  /**
   * Relative ages are the readable form, but the exact moment has to stay
   * reachable, so every one of them is a `<time>` carrying the full timestamp.
   */
  function timeMark(timestamp: number, event: string): string {
    return `<time datetime="${new Date(timestamp).toISOString()}" title="${escapeHtml(
      `${event} ${exactTime(timestamp)}`,
    )}">${escapeHtml(relativeTime(timestamp))}</time>`
  }

  /** A file name. Rendered whole; `fitFileNames` cuts it to its box after layout. */
  function fileMark(name: string, className: string): string {
    const full = displayFileName(name)
    const safe = escapeHtml(full)
    return `<span class="${className}" data-file-name="${safe}" title="${safe}" aria-label="${safe}">${safe}</span>`
  }

  /**
   * Middle truncation needs a character budget, and the budget is however wide
   * the box turned out to be. Meta text is monospaced, so measuring the whole
   * name once converts pixels to characters exactly, with no search.
   */
  function fitFileNames(): void {
    document.querySelectorAll<HTMLElement>("[data-file-name]").forEach((element) => {
      const full = element.dataset.fileName ?? ""
      element.textContent = full
      if (full.length === 0 || element.scrollWidth <= element.clientWidth) return
      const unit = element.scrollWidth / full.length
      const budget = Math.floor(element.clientWidth / unit)
      element.textContent = truncateMiddle(full, budget)
      if (element.scrollWidth > element.clientWidth) {
        element.textContent = truncateMiddle(full, budget - 1)
      }
    })
  }

  /**
   * Only spools present in the last import can ever be matched, so a restored
   * inventory has to state its size and its age instead of quietly looking
   * current. The heading above it already says these are imported spools, so
   * the age needs no verb of its own.
   */
  function inventoryState(): string {
    if (state.inventory.length === 0) return "JSON or CSV with hex colors"
    const count = `${state.inventory.length} spool${state.inventory.length === 1 ? "" : "s"}`
    return metaGroup([
      count,
      state.inventoryImportedAt
        ? timeMark(state.inventoryImportedAt, "Imported")
        : "imported earlier",
    ])
  }

  function inventoryPrompt(): string | null {
    if (state.inventory.length === 0) return null
    const importedAt = state.inventoryImportedAt
    if (importedAt !== null && Date.now() - importedAt < staleAfter) return null
    return "Added spools since then? Re-import your export — anything missing here cannot be matched."
  }

  function renderDropzone(kind: "inventory" | "model"): string {
    const inventory = kind === "inventory"
    const loaded = inventory ? state.inventory.length > 0 : Boolean(state.project)
    const label = inventory ? "Spool inventory" : "3MF project"
    const detail = inventory
      ? loaded
        ? inventoryState()
        : 'JSON or CSV with hex colors · <a class="source-link" href="https://3dfilamentprofiles.com/my/spools" target="_blank" rel="noreferrer">3DFilamentProfiles <span aria-hidden="true">↗</span></a> or <button class="format-hint" type="button" data-inventory-format aria-expanded="false" aria-controls="inventory-format-popover">paste a list with <code>rgb</code> or <code>hex</code></button>'
      : state.project
        ? metaGroup([
            colorCount(state.project.filaments.length),
            `${state.project.plates.length || 1} plate${state.project.plates.length === 1 ? "" : "s"}`,
          ])
        : "Bambu Studio or OrcaSlicer .3mf"
    const prompt = inventory ? inventoryPrompt() : null
    const fileName = inventory ? state.inventoryName : state.project?.fileName
    const accept = inventory ? ".json,.csv,application/json,text/csv" : ".3mf"
    const isLoading = state.loading.has(kind)
    const locked = state.loading.has("restore")
    const action = isLoading
      ? "Reading…"
      : loaded
        ? inventory
          ? "Re-import"
          : "Replace"
        : inventory
          ? "Choose JSON or CSV"
          : "Choose 3MF"
    /**
     * A status word is only earned when it carries news. "Required" repeats what
     * an empty row already says, so the quiet states say nothing at all.
     */
    const status = prompt ? "Check age" : loaded ? "Ready" : ""
    return `
      <section class="file-station ${loaded ? "is-loaded" : ""} ${prompt ? "is-stale" : ""} ${state.dragging === kind ? "is-dragging" : ""}"
        data-drop="${kind}" aria-labelledby="${kind}-label">
        <div class="station-copy">
          <h2 id="${kind}-label">${label}</h2>
          ${status ? `<span class="status-mark">${status}</span>` : ""}
          <p class="station-state">${detail}</p>
          ${fileName ? fileMark(fileName, "station-file") : ""}
        </div>
        <span class="drop-hint" aria-hidden="true">Drop a file anywhere in this panel</span>
        <div class="station-actions">
          <label class="file-action">
            <input type="file" data-file="${kind}" accept="${accept}" ${isLoading || locked ? "disabled" : ""}
              aria-label="${action} — ${label}. Or drop a file onto this panel.">
            <span>${isLoading ? '<i class="spinner"></i> ' : ""}${action}</span>
          </label>
          ${
            inventory && !loaded
              ? `<button class="text-button" type="button" data-paste-inventory ${isLoading || locked ? "disabled" : ""}>Paste JSON</button>`
              : ""
          }
        </div>
        ${loaded ? `<button class="text-button station-clear" type="button" data-clear-${kind}>${inventory ? "Clear inventory" : "Clear project"}</button>` : ""}
        ${prompt ? `<p class="station-prompt">${escapeHtml(prompt)}</p>` : ""}
      </section>`
  }

  function renderSessionCard(entry: SessionSummary): string {
    const active = entry.id === state.sessionId
    return `
      <li class="session-card ${active ? "is-active" : ""}">
        <span class="session-swatches" aria-hidden="true">
          ${entry.swatches.map((hex) => `<i style="--swatch:${hex}"></i>`).join("")}
        </span>
        <div class="session-copy">
          <strong>${escapeHtml(entry.projectTitle)}</strong>
          <p class="session-state">${metaGroup([
            colorCount(entry.filamentCount),
            `${entry.inventoryCount} spools`,
            `${entry.plateCount || 1} plate${entry.plateCount === 1 ? "" : "s"}`,
          ])}</p>
          <p class="session-meta">
            ${metaGroup([
              fileMark(entry.modelName, "session-file"),
              timeMark(entry.savedAt, "Saved"),
            ])}
            ${entry.hasPayload ? "" : '<span class="session-note">files no longer stored</span>'}
          </p>
        </div>
        <div class="session-actions">
          ${active ? '<span class="tag tag-ok">Open now</span>' : `<button class="text-button" type="button" data-restore="${escapeHtml(entry.id)}" aria-label="Restore ${escapeHtml(entry.projectTitle)}" ${state.loading.size ? "disabled" : ""}>Restore</button>`}
          <button class="ghost-button" type="button" data-forget="${escapeHtml(entry.id)}" aria-label="Remove ${escapeHtml(entry.projectTitle)} from saved history" ${state.loading.size ? "disabled" : ""}>Remove</button>
        </div>
      </li>`
  }

  function renderHistory(): string {
    if (state.history.length === 0) return ""
    if (state.project) {
      return `
        <details class="recent-drawer">
          <summary>
            <span>Recent projects</span>
            <small>${state.history.length} saved in this browser</small>
          </summary>
          <ul class="session-list">${state.history.map(renderSessionCard).join("")}</ul>
          <button class="text-button history-clear" type="button" data-clear-history ${state.loading.size ? "disabled" : ""}>Clear saved history</button>
        </details>`
    }
    return `
      <section class="work-section recents" id="recents">
        <div class="section-head">
          <div><h2>Recents</h2></div>
        </div>
        <ul class="session-list">${state.history.map(renderSessionCard).join("")}</ul>
        <button class="text-button history-clear" type="button" data-clear-history ${state.loading.size ? "disabled" : ""}>Clear saved history</button>
      </section>`
  }

  return {
    metaGroup,
    fileMark,
    fitFileNames,
    renderDropzone,
    renderHistory,
  }
}
