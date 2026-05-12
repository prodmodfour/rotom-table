import type { MapHazardV2 } from '~/types/map'
import type {
  MoveAutomationFieldEffectApply,
  MoveAutomationScript,
} from '~/types/moveAutomation'
import type { GridAnchor } from '~/types/pokemon'

export type MoveAutomationMapEffectSuggestionKind = 'field' | 'hazard'

export type MoveAutomationMapEffectSuggestionPredicate = (
  kind: MoveAutomationMapEffectSuggestionKind,
  index: number,
) => boolean

export interface BuildMoveAutomationHazardsInput {
  script: MoveAutomationScript
  ownerName: string
  hazardCells: readonly GridAnchor[]
  suggestionEnabled: MoveAutomationMapEffectSuggestionPredicate
}

export interface BuildMoveAutomationHazardsResult {
  hazardsToAdd: MapHazardV2[]
  logLines: string[]
}

export interface BuildMoveAutomationFieldEffectsInput {
  script: MoveAutomationScript
  suggestionEnabled: MoveAutomationMapEffectSuggestionPredicate
}

export interface BuildMoveAutomationFieldEffectsResult {
  fieldEffectsToApply: MoveAutomationFieldEffectApply[]
  logLines: string[]
}

const hazardCellLimit = (requestedSquares: number, availableCells: number): number =>
  requestedSquares || availableCells

export const buildMoveAutomationHazards = ({
  script,
  ownerName,
  hazardCells,
  suggestionEnabled,
}: BuildMoveAutomationHazardsInput): BuildMoveAutomationHazardsResult => {
  const hazardsToAdd: MapHazardV2[] = []
  const logLines: string[] = []

  script.hazardSuggestions.forEach((item, index) => {
    if (!suggestionEnabled('hazard', index)) return

    const limit = hazardCellLimit(item.squares, hazardCells.length)
    for (const cell of hazardCells.slice(0, limit)) {
      hazardsToAdd.push({
        kind: item.kind,
        ...cell,
        layer: item.kind === 'toxic-spikes' ? 1 : undefined,
        owner: ownerName,
      })
    }

    if (hazardCells.length) {
      logLines.push(`${item.label}: ${Math.min(hazardCells.length, limit)} square(s).`)
    }
  })

  return { hazardsToAdd, logLines }
}

export const buildMoveAutomationFieldEffects = ({
  script,
  suggestionEnabled,
}: BuildMoveAutomationFieldEffectsInput): BuildMoveAutomationFieldEffectsResult => {
  const fieldEffectsToApply = script.fieldSuggestions
    .filter((_item, index) => suggestionEnabled('field', index))
    .map((item) => ({ kind: item.kind, value: item.value, source: script.moveName }))

  return {
    fieldEffectsToApply,
    logLines: fieldEffectsToApply.map((item) => `Field effect: ${item.source} applies ${item.value}.`),
  }
}
