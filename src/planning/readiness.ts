import type { FilamentChoice, ProjectPlate } from "../types"

export type ExportReadiness = {
  selectedCount: number
  totalCount: number
  unresolvedIndexes: number[]
  incompatibleIndexes: number[]
  incompatibleSelections: Array<{
    filamentIndex: number
    requestedProfile: string
    selectedProfile: string
  }>
  hiddenCount: number
  reusedSpools: Array<{ spoolId: string; filamentIndexes: number[] }>
  canExport: boolean
}

export function exportReadiness(
  choices: FilamentChoice[],
  plates: ProjectPlate[],
  activePlateId: string | null,
): ExportReadiness {
  const unresolvedIndexes: number[] = []
  const incompatibleIndexes: number[] = []
  const incompatibleSelections: ExportReadiness["incompatibleSelections"] = []
  const selectedByFilament = new Map<number, string>()

  for (const choice of choices) {
    const selected = choice.matches.find(({ spool }) => spool.id === choice.selectedSpoolId)
    if (!selected) {
      unresolvedIndexes.push(choice.filament.index)
      continue
    }
    selectedByFilament.set(choice.filament.index, selected.spool.id)
    if (!selected.materialOk) {
      incompatibleIndexes.push(choice.filament.index)
      incompatibleSelections.push({
        filamentIndex: choice.filament.index,
        requestedProfile: choice.filament.label.trim() || choice.filament.material.trim(),
        selectedProfile:
          [selected.spool.material, selected.spool.materialType].filter(Boolean).join(" ") ||
          "Unknown profile",
      })
    }
  }

  const activePlate = plates.find(({ id }) => id === activePlateId)
  const visible = activePlate
    ? new Set(activePlate.filamentIndexes)
    : new Set(choices.map(({ filament }) => filament.index))

  const reused = new Map<string, Set<number>>()
  for (const plate of plates) {
    const perSpool = new Map<string, number[]>()
    for (const filamentIndex of plate.filamentIndexes) {
      const spoolId = selectedByFilament.get(filamentIndex)
      if (!spoolId) continue
      const indexes = perSpool.get(spoolId) ?? []
      indexes.push(filamentIndex)
      perSpool.set(spoolId, indexes)
    }
    for (const [spoolId, indexes] of perSpool) {
      if (new Set(indexes).size < 2) continue
      const all = reused.get(spoolId) ?? new Set<number>()
      indexes.forEach((index) => all.add(index))
      reused.set(spoolId, all)
    }
  }

  return {
    selectedCount: selectedByFilament.size,
    totalCount: choices.length,
    unresolvedIndexes,
    incompatibleIndexes,
    incompatibleSelections,
    hiddenCount: choices.filter(({ filament }) => !visible.has(filament.index)).length,
    reusedSpools: [...reused].map(([spoolId, indexes]) => ({
      spoolId,
      filamentIndexes: [...indexes].sort((a, b) => a - b),
    })),
    canExport: choices.length > 0 && unresolvedIndexes.length === 0,
  }
}
