import { describeColor } from "../color/describe"
import {
  demotionReason,
  escapeHtml,
  isMultiColor,
  materialIdentity,
  spoolColors,
  swatchBackground,
} from "../format"
import { topAlternatives } from "../matching"
import { exportReadiness } from "../planning/readiness"
import type { ThreeMfProject } from "../parse/threeMf"
import type { FilamentChoice, PhysicalSpool, ProjectPlate, SpoolMatch } from "../types"
import type { ViewPreset } from "../viewer/plateViewer"

type MatchViewState = {
  project: ThreeMfProject | null
  inventory: PhysicalSpool[]
  choices: FilamentChoice[]
  selectedPlateId: string | null
  openSpoolMenu: number | null
  exportAction: "download" | null
}

/**
 * The one fold both sides of the search share: accents, case, and punctuation
 * all collapse so a typed query can reach a spool named "Señal Red · PLA-CF".
 * The rendered index is folded once at render time and a query is folded once
 * per keystroke, so a match is a plain substring test over an inventory of any
 * size. Both callers must use this function; two spellings of the fold would
 * silently stop matching each other.
 */
export function normalizedSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
}

/** The terms a spool has to carry all of to survive a typed query. */
export function searchTerms(query: string): string[] {
  return normalizedSearch(query).split(" ").filter(Boolean)
}

/** `searchable` must already have been through `normalizedSearch`. */
export function matchesSearchTerms(searchable: string, terms: string[]): boolean {
  return terms.every((term) => searchable.includes(term))
}

/**
 * Apply the picker search without re-rendering the application. Keeping the
 * query in the live popup preserves focus and the listbox's current keyboard
 * position while the operator narrows the inventory.
 */
export function filterSpoolMenu(input: HTMLInputElement): void {
  const picker = input.closest<HTMLElement>("[data-spool-picker]")
  if (!picker) return

  const options = Array.from(
    picker.querySelectorAll<HTMLButtonElement>("[data-spool-filter-value]"),
  )
  const terms = searchTerms(input.value)
  for (const option of options) {
    option.hidden = !matchesSearchTerms(option.dataset.spoolFilterValue ?? "", terms)
  }

  for (const group of picker.querySelectorAll<HTMLElement>("[data-spool-group-section]")) {
    const name = group.dataset.spoolGroupSection
    group.hidden = !options.some((option) => option.dataset.spoolGroup === name && !option.hidden)
  }

  const empty = picker.querySelector<HTMLElement>("[data-spool-filter-empty]")
  if (empty) empty.hidden = options.some((option) => !option.hidden)
}

type MatchViewDependencies = {
  state: MatchViewState
  activePlate: () => ProjectPlate | undefined
  visibleChoices: () => FilamentChoice[]
  scopeLabel: () => string
  metaGroup: (parts: Array<string | null | undefined>) => string
  fileMark: (name: string, className: string) => string
}

const META_SEP = '<span class="meta-sep" aria-hidden="true">·</span>'

export function createMatchView(dependencies: MatchViewDependencies): {
  renderMatches: () => string
  renderMatchRow: (filamentIndex: number) => string
  renderReadiness: () => string
  renderExportActions: () => string
} {
  const { state, activePlate, visibleChoices, scopeLabel, metaGroup, fileMark } = dependencies

  const colorCount = (count: number): string => `${count} color${count === 1 ? "" : "s"}`

  /** Plain-text metadata for titles and controls that cannot contain markup. */
  function plainGroup(parts: Array<string | null | undefined>): string {
    return parts.filter((part): part is string => Boolean(part)).join(" · ")
  }

  /**
   * Facts of one kind as unbreakable atoms. A line may wrap between two atoms
   * but never inside one, because profile and printer names are single
   * readings, not four words that happen to sit together. Each separator travels
   * inside the atom it introduces, so a wrapped line ends on a fact rather than
   * on a dangling interpunct.
   */
  function factLine(className: string, parts: Array<string | null | undefined>): string {
    const atoms = parts
      .filter((part): part is string => Boolean(part))
      .map((part, index) => `<span>${index === 0 ? "" : `${META_SEP} `}${escapeHtml(part)}</span>`)
    return `<span class="${className} fact-line">${atoms.join(" ")}</span>`
  }

  /**
   * Slicer profiles name the printer and nozzle after an "@", which is a second
   * fact wearing the first one's clothes. Split apart, both stay on one line.
   */
  function profileParts(label: string): { profile: string; printer: string } {
    const at = label.indexOf("@")
    if (at < 0) return { profile: label.trim(), printer: "" }
    return {
      profile: label.slice(0, at).trim() || label.trim(),
      printer: label
        .slice(at + 1)
        .replace(/^BBL\s+/i, "")
        .trim(),
    }
  }

  /**
   * A brand is only news when the drawer holds more than one. Repeating the same
   * vendor down every row and every option costs the width that the color name,
   * the material and the reading actually need.
   */
  function ownsManyBrands(): boolean {
    return new Set(state.inventory.map(({ brand }) => brand)).size > 1
  }

  /** One labelled fact. The label is for listeners; the value speaks for itself. */
  function fact(label: string, value: string, lead = false): string {
    return `<dt>${label}</dt><dd>${lead ? `${META_SEP} ` : ""}${escapeHtml(value)}</dd>`
  }

  /**
   * LEFT column: what the 3MF asks for. No inventory data may appear here.
   *
   * Every value here says what it is without being told — a material, a vendor, a
   * profile — so labelling all three cost six ragged lines to carry three short
   * facts. Now the labels are read out but not drawn, and the facts group by kind:
   * what the material is, then which profile asked for it.
   */
  function renderDesignPane(choice: FilamentChoice): string {
    const { filament } = choice
    const { profile, printer } = profileParts(filament.label)

    return `
      <div class="design-pane">
        <div class="design-figure">
          <span class="filament-number">F${String(filament.index).padStart(2, "0")}</span>
          <span class="design-swatch" style="--swatch:${filament.hex}"
            role="img" aria-label="Design color ${filament.hex}"></span>
        </div>
        <div class="design-id">
          <h3 class="design-name">${escapeHtml(describeColor(filament.hex))}</h3>
          <p class="design-hex">${filament.hex}</p>
          <dl class="design-facts">
            <div class="design-material">
              ${fact("Material", filament.material)}
              ${filament.vendor ? fact("Vendor", filament.vendor, true) : ""}
            </div>
            <div class="design-profile">
              ${fact("Profile", profile)}
              ${printer ? `<dt>Printer</dt><dd class="design-printer">${escapeHtml(printer)}</dd>` : ""}
            </div>
          </dl>
        </div>
      </div>`
  }

  /**
   * A chip has room for a marker, not for a sentence. The full sentence is on
   * the verdict above whenever the spool is the selected one, and in the chip's
   * tooltip the rest of the time.
   */
  function demotionTag(filament: FilamentChoice["filament"], spool: PhysicalSpool): string {
    const reason = demotionReason(filament, spool)
    if (reason.startsWith("Support")) return "Support"
    if (reason.startsWith("Multi")) return "Multi"
    /*
     * Naming the material the spool is would only repeat the reading beside it,
     * so the marker names the material the part asked for and did not get.
     */
    const wanted = filament.material.trim()
    return wanted ? `not ${wanted}` : "Other"
  }

  function selectedMismatchNote(choice: FilamentChoice, match: SpoolMatch): string {
    if (match.materialOk) {
      return match.finishMismatch
        ? `Finish detail differs — project profile is ${choice.filament.label}; spool is ${materialIdentity(match.spool)}`
        : ""
    }
    const reason = demotionReason(choice.filament, match.spool)
    if (reason === "Multi-color spool") {
      return `Color format differs — project calls for single-color ${choice.filament.material}`
    }
    if (reason === "Multi-color spool required") {
      return `Color format differs — project calls for multi-color ${choice.filament.material}`
    }
    if (reason === "Support filament") {
      return `Filament role differs — project calls for ${choice.filament.material}`
    }
    if (reason === "Support filament required") {
      return "Filament role differs — project calls for support filament"
    }
    return `Material differs — project calls for ${choice.filament.material}`
  }

  /**
   * One ranked spool. Every chip carries the same four slots in the same order,
   * so the names, the readings and the markers all line up down the list however
   * wide the pane is. The reading leads its line: it is the number the list is
   * ranked by, and putting it first is what keeps the ΔE column aligned and what
   * survives if an unusually long material name has to give way.
   */
  function renderAlternative(match: SpoolMatch, choice: FilamentChoice, rank: number): string {
    const selected = choice.selectedSpoolId === match.spool.id
    const colors = spoolColors(match.spool)
    const reason = match.materialOk ? "" : demotionReason(choice.filament, match.spool)
    const title = plainGroup([match.spool.brand, reason])

    return `
      <button class="alternative ${selected ? "is-selected" : ""}" type="button"
        data-select-spool="${escapeHtml(match.spool.id)}"
        data-filament="${choice.filament.index}"
        title="${escapeHtml(title)}"
        aria-pressed="${selected}">
        <span class="mini-swatch" style="--swatch:${swatchBackground(colors)}"></span>
        <span class="alternative-name">${escapeHtml(match.spool.colorName)}</span>
        ${factLine("alternative-meta", [
          `ΔE ${match.deltaE.toFixed(1)}`,
          materialIdentity(match.spool),
        ])}
        <span class="alternative-flags">
          ${rank === 0 ? '<span class="alternative-rank">Best</span>' : ""}
          ${match.finishMismatch ? `<span class="tag">${escapeHtml(match.spool.materialType || "Finish differs")}</span>` : ""}
          ${reason ? `<span class="tag tag-warn">${escapeHtml(demotionTag(choice.filament, match.spool))}</span>` : ""}
          <span class="selection-check" aria-hidden="true">✓</span>
        </span>
      </button>`
  }

  function renderPicker(choice: FilamentChoice, visibleSpoolIds: Set<string>): string {
    const isOpen = state.openSpoolMenu === choice.filament.index
    const selected = choice.matches.find(({ spool }) => spool.id === choice.selectedSpoolId)
    const selectedOutsideShortlist = selected && !visibleSpoolIds.has(selected.spool.id)
    const selectedMismatch = selected ? selectedMismatchNote(choice, selected) : ""

    const options = (): string => {
      const compatible = choice.matches.filter(({ materialOk }) => materialOk)
      const incompatible = choice.matches.filter(({ materialOk }) => !materialOk)
      const manyBrands = ownsManyBrands()
      const option = ({ spool, deltaE, materialOk, finishMismatch }: SpoolMatch): string => {
        const isSelected = spool.id === choice.selectedSpoolId
        const reason = materialOk ? "" : demotionReason(choice.filament, spool)
        const group = materialOk ? "compatible" : "incompatible"
        const filterValue = normalizedSearch(
          plainGroup([spool.colorName, spool.brand, spool.material, spool.materialType]),
        )
        return `
          <button class="spool-menu-option ${isSelected ? "is-selected" : ""}" type="button"
            role="option" aria-selected="${isSelected}"
            data-select-spool="${escapeHtml(spool.id)}"
            data-filament="${choice.filament.index}"
            data-spool-filter-value="${escapeHtml(filterValue)}"
            data-spool-group="${group}">
            <span class="spool-menu-swatch" style="--swatch:${swatchBackground(spoolColors(spool))}" aria-hidden="true"></span>
            <span class="spool-menu-copy">
              <strong>${escapeHtml(spool.colorName)}</strong>
              <small>${escapeHtml(
                plainGroup([
                  manyBrands ? spool.brand : "",
                  materialIdentity(spool),
                  isMultiColor(spool) ? "multi-color" : "",
                  finishMismatch ? "finish differs" : "",
                ]),
              )}</small>
            </span>
            <span class="spool-menu-score">ΔE ${deltaE.toFixed(1)}</span>
            ${reason ? `<span class="spool-menu-warning">${escapeHtml(demotionTag(choice.filament, spool))}</span>` : ""}
            <span class="spool-menu-check" aria-hidden="true">✓</span>
          </button>`
      }

      return `
        <label class="spool-menu-filter">
          <span>Filter spools</span>
          <input type="search" autocomplete="off"
            data-spool-filter="${choice.filament.index}"
            aria-controls="spool-menu-options-${choice.filament.index}"
            placeholder="Color, brand, or material">
        </label>
        <div id="spool-menu-options-${choice.filament.index}" role="listbox"
          aria-label="All spools for design color ${choice.filament.index}">
          <button class="spool-menu-clear ${choice.selectedSpoolId ? "" : "is-selected"}" type="button"
            role="option" aria-selected="${choice.selectedSpoolId ? "false" : "true"}"
            data-select-spool="" data-filament="${choice.filament.index}">
            <span>No spool selected</span><span aria-hidden="true">${choice.selectedSpoolId ? "" : "✓"}</span>
          </button>
          ${
            compatible.length
              ? `<div role="group" aria-label="Matches ${escapeHtml(choice.filament.material)}; recommended" data-spool-group-section="compatible">
                   <div class="spool-menu-group-label" role="presentation" aria-hidden="true">Matches ${escapeHtml(choice.filament.material)} · recommended</div>
                   ${compatible.map(option).join("")}
                 </div>`
              : ""
          }
          ${
            incompatible.length
              ? `<div role="group" aria-label="Other materials; check before loading" data-spool-group-section="incompatible">
                   <div class="spool-menu-group-label is-warning" role="presentation" aria-hidden="true">Other materials · check before loading</div>
                   ${incompatible.map(option).join("")}
                 </div>`
              : ""
          }
        </div>
        <p class="spool-menu-empty" data-spool-filter-empty role="status" hidden>No spools match that filter.</p>`
    }

    return `
      <div class="spool-picker ${selectedOutsideShortlist ? "has-expanded-selection" : ""}" data-spool-picker="${choice.filament.index}">
        <button class="spool-picker-trigger ${selectedOutsideShortlist ? "is-expanded-selection" : ""}" type="button"
          data-spool-menu="${choice.filament.index}"
          data-spool-popup="spool-menu-${choice.filament.index}"
          aria-haspopup="listbox" aria-expanded="${isOpen}"
          aria-controls="spool-menu-options-${choice.filament.index}">
          ${
            selectedOutsideShortlist
              ? `<span class="spool-picker-selected-swatch" style="--swatch:${swatchBackground(spoolColors(selected.spool))}" aria-hidden="true"></span>
                 <span class="spool-picker-selected-copy">
                   <strong>${escapeHtml(selected.spool.colorName)}</strong>
                   <small class="spool-picker-selected-meta">
                     ${escapeHtml(
                       plainGroup([
                         "Selected",
                         `ΔE ${selected.deltaE.toFixed(1)}`,
                         materialIdentity(selected.spool),
                       ]),
                     )}
                   </small>
                   ${selectedMismatch ? `<span class="spool-picker-mismatch ${selected.materialOk ? "is-neutral" : ""}">${escapeHtml(selectedMismatch)}</span>` : ""}
                 </span>`
              : `<span>More spools</span><small>${choice.matches.length} available</small>`
          }
          <span class="spool-picker-chevron" aria-hidden="true">⌄</span>
        </button>
        <div class="spool-menu" id="spool-menu-${choice.filament.index}" ${isOpen ? "" : "hidden"}>
          ${isOpen ? options() : ""}
        </div>
      </div>`
  }

  /** RIGHT column: our catalogue, our recommendation, and the override picker. */
  function renderStockPane(choice: FilamentChoice): string {
    const shortlist = topAlternatives(choice.matches, 4)
    const visibleSpoolIds = new Set(shortlist.map(({ spool }) => spool.id))

    if (choice.matches.length === 0) {
      return `
        <div class="stock-pane">
          <div class="match-verdict no-match">
            <strong>No spool to load</strong>
            <small>Import a spool inventory to rank your owned filament against this color.</small>
          </div>
        </div>`
    }

    return `
      <div class="stock-pane">
        ${
          shortlist.length
            ? `<div class="alternatives" aria-label="Closest spool matches">
                ${shortlist.map((match) => renderAlternative(match, choice, match.rank)).join("")}
              </div>`
            : ""
        }
        ${renderPicker(choice, visibleSpoolIds)}
      </div>`
  }

  function renderRow(choice: FilamentChoice): string {
    return `
      <article class="match-row" data-match-row="${choice.filament.index}">
        ${renderDesignPane(choice)}
        ${renderStockPane(choice)}
      </article>`
  }

  function renderMatchRow(filamentIndex: number): string {
    const choice = state.choices.find(({ filament }) => filament.index === filamentIndex)
    return choice ? renderRow(choice) : ""
  }

  function renderScope(): string {
    const plates = state.project?.plates ?? []
    if (plates.length === 0) return ""

    const hexOf = (index: number): string =>
      state.project?.filaments.find((filament) => filament.index === index)?.hex ?? "#D7DADD"

    return `
      <section class="scope" aria-label="Plate selection">
        <div class="scope-head">
          <p class="pane-label">Match by plate</p>
          <button class="scope-all ${state.selectedPlateId === null ? "is-active" : ""}"
            type="button" data-plate="" aria-pressed="${state.selectedPlateId === null}">
            Whole model · ${colorCount(state.choices.length)}
          </button>
        </div>
        <div class="plate-grid">
          ${plates
            .map((plate) => {
              const active = plate.id === state.selectedPlateId
              const used = plate.filamentIndexes.length
                ? plate.filamentIndexes
                : state.choices.map(({ filament }) => filament.index)
              return `
                <button class="plate-card ${active ? "is-active" : ""}" type="button"
                  data-plate="${escapeHtml(plate.id)}" aria-pressed="${active}">
                  <span class="plate-figure">
                    ${
                      plate.thumbnail
                        ? `<img src="${plate.thumbnail}" alt="">`
                        : '<span class="plate-fallback">No preview</span>'
                    }
                    <span class="plate-number">${escapeHtml(plate.id)}</span>
                  </span>
                  <span class="plate-name">${escapeHtml(plate.name)}</span>
                  <span class="plate-swatches" aria-hidden="true">
                    ${used.map((index) => `<i style="--swatch:${hexOf(index)}"></i>`).join("")}
                  </span>
                  <span class="plate-count">
                    ${used.length} filament${used.length === 1 ? "" : "s"} · ${used.map((index) => `F${String(index).padStart(2, "0")}`).join(" ")}
                  </span>
                </button>`
            })
            .join("")}
        </div>
      </section>`
  }

  const VIEW_BUTTONS: ReadonlyArray<[ViewPreset, string]> = [
    ["top", "Top"],
    ["bottom", "Bottom"],
    ["front", "Front"],
    ["back", "Back"],
    ["left", "Left"],
    ["right", "Right"],
  ]

  function renderPlateViewer(): string {
    const plate = activePlate()
    if (!plate) return ""
    return `
      <section class="plate-inspector" aria-label="Interactive plate preview">
        <div class="inspector-head">
          <div>
            <h3>${escapeHtml(plate.name)}</h3>
            <p>Linked view of the original colors and your selected spools</p>
          </div>
        </div>
        <div class="viewer-frame" data-plate-viewer></div>
        <div class="viewer-help">
          <span class="viewer-gesture">Drag to orbit · Shift-drag to pan · Scroll to zoom</span>
          <div class="viewer-views" role="group" aria-label="Camera views">
            ${VIEW_BUTTONS.map(
              ([preset, label]) =>
                `<button type="button" data-viewer-view="${preset}">${label}</button>`,
            ).join("")}
          </div>
          <button type="button" data-viewer-recenter>Recenter</button>
        </div>
      </section>`
  }

  function renderExportActions(): string {
    const busy = state.exportAction
    const readiness = exportReadiness(
      state.choices,
      state.project?.plates ?? [],
      state.selectedPlateId,
    )
    return `
      <div class="export-actions">
        <button class="export-primary" type="button" data-export
          ${busy || !readiness.canExport ? "disabled" : ""}>
          <strong>${busy ? '<i class="spinner"></i>Preparing download…' : "Download for Bambu Studio"}</strong>
          <small>${readiness.canExport ? "Exports the whole project" : `${colorCount(readiness.unresolvedIndexes.length)} still ${readiness.unresolvedIndexes.length === 1 ? "needs" : "need"} a spool`}</small>
        </button>
      </div>`
  }

  function filamentCodes(indexes: number[]): string {
    return indexes.map((index) => `F${String(index).padStart(2, "0")}`).join(", ")
  }

  function renderReadiness(): string {
    const readiness = exportReadiness(
      state.choices,
      state.project?.plates ?? [],
      state.selectedPlateId,
    )
    const warnings: string[] = []
    if (readiness.unresolvedIndexes.length) {
      warnings.push(
        `${filamentCodes(readiness.unresolvedIndexes)} still ${readiness.unresolvedIndexes.length === 1 ? "needs" : "need"} a spool`,
      )
    }
    for (const mismatch of readiness.incompatibleSelections) {
      warnings.push(
        `${filamentCodes([mismatch.filamentIndex])} profile differs: ${mismatch.selectedProfile} selected for ${mismatch.requestedProfile}`,
      )
    }
    for (const reuse of readiness.reusedSpools) {
      const spoolName = state.inventory.find(({ id }) => id === reuse.spoolId)?.colorName
      warnings.push(
        `${spoolName ?? "One spool"} is assigned to simultaneous slots ${filamentCodes(reuse.filamentIndexes)}`,
      )
    }
    return `
      <aside class="readiness ${readiness.canExport ? "readiness-ok" : "readiness-warn"}" aria-labelledby="readiness-title">
        <div class="readiness-summary">
          <span class="pane-label">Whole-project readiness</span>
          <strong id="readiness-title">${readiness.canExport ? "Ready to export" : `${readiness.selectedCount} of ${colorCount(readiness.totalCount)} assigned`}</strong>
          <p>Spoolmap chooses colors, not AMS slots. Confirm the final profiles and slots in Bambu Studio.</p>
        </div>
        ${warnings.length ? `<ul class="readiness-list">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : '<p class="project-actions-note">Every project color has an owned spool assignment.</p>'}
      </aside>`
  }

  function renderMatches(): string {
    if (!state.project) return ""

    const rows = visibleChoices()
    const plate = activePlate()
    const hiddenCount = state.choices.length - rows.length
    return `
      <section class="work-section" id="matches">
        <div class="section-head">
          <div><h2>Matches</h2></div>
          <p>${rows.length} of ${colorCount(state.choices.length)} · ${escapeHtml(scopeLabel())}${hiddenCount > 0 ? ` · ${hiddenCount} elsewhere in the project` : ""}</p>
        </div>
        <div class="project-strip">
          ${
            plate?.thumbnail
              ? `<img src="${plate.thumbnail}" alt="">`
              : state.project.thumbnail
                ? `<img src="${state.project.thumbnail}" alt="">`
                : '<div class="model-placeholder">3MF</div>'
          }
          <div class="project-copy">
            <strong>${escapeHtml(state.project.title)}</strong>
            <p class="project-meta">
              <span class="project-state">${metaGroup([
                escapeHtml(scopeLabel()),
                colorCount(state.project.filaments.length),
                `${state.project.plates.length || 1} plate${state.project.plates.length === 1 ? "" : "s"}`,
              ])}</span>
              ${fileMark(state.project.fileName, "project-file")}
            </p>
          </div>
          ${renderExportActions()}
        </div>
        ${renderReadiness()}
        ${renderScope()}
        ${renderPlateViewer()}
        <div class="row-legend">
          <span>Original 3MF</span>
          <span>Your spools</span>
        </div>
        <div class="match-list">${rows.map(renderRow).join("")}</div>
      </section>`
  }

  return { renderExportActions, renderMatches, renderMatchRow, renderReadiness }
}
