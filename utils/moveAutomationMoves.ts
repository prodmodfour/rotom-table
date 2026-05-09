import { findMove } from '~/data/ptuReference'
import {
  buildManualMoveResolution,
  explicitScriptForMove,
  sheetMoveToMoveLike,
  type MoveAutomationMoveLike,
} from '~/utils/moveAutomation'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'
import type { TrainerMove } from '~/types/trainerSheet'

export type MoveAutomationSheetMove = CharacterSheetMove | TrainerMove

export interface MoveAutomationMoveEntry {
  label: string
  sheetMove: MoveAutomationSheetMove
  move: MoveAutomationMoveLike
  script: MoveAutomationScript
  hasExplicitScript: boolean
}

export const moveLikeForSheetMove = (sheetMove: MoveAutomationSheetMove): MoveAutomationMoveLike => {
  const canonical = findMove(sheetMove.name)
  if (canonical) return canonical
  return sheetMoveToMoveLike(sheetMove)
}

export const buildMoveAutomationMoveEntries = (
  moves: readonly MoveAutomationSheetMove[],
): MoveAutomationMoveEntry[] => moves
  .filter((move) => move.name?.trim())
  .map((sheetMove) => {
    const move = moveLikeForSheetMove(sheetMove)
    const explicitScript = explicitScriptForMove(move.name)
    return {
      label: move.name,
      sheetMove,
      move,
      script: explicitScript ?? buildManualMoveResolution(move),
      hasExplicitScript: Boolean(explicitScript),
    }
  })

export const filterMoveAutomationMoveEntries = (
  entries: readonly MoveAutomationMoveEntry[],
  search: string,
): MoveAutomationMoveEntry[] => {
  const q = search.trim().toLowerCase()
  if (!q) return [...entries]
  return entries.filter((entry) => {
    const script = entry.script
    return [
      script.moveName,
      script.type,
      script.damageClass ?? '',
      entry.move.frequency ?? '',
      script.range,
      script.effect,
    ]
      .join(' ')
      .toLowerCase()
      .includes(q)
  })
}

export const selectMoveAutomationEntry = (
  entries: readonly MoveAutomationMoveEntry[],
  selectedMoveName: string | null | undefined,
): MoveAutomationMoveEntry | null => entries.find((entry) => entry.move.name === selectedMoveName) ?? entries[0] ?? null

export const sortMoveAutomationTargets = (tokens: readonly SpawnedPokemon[]): SpawnedPokemon[] =>
  [...tokens].sort((a, b) => a.species.localeCompare(b.species))

export const selectedMoveAutomationTargets = (
  targetIds: readonly string[],
  allTokens: readonly SpawnedPokemon[],
): SpawnedPokemon[] => targetIds
  .map((id) => allTokens.find((token) => token.id === id))
  .filter((token): token is SpawnedPokemon => Boolean(token))

export const moveAutomationRequiresTargets = (script: MoveAutomationScript | null | undefined): boolean => {
  const mode = script?.targetMode
  return mode === 'one-target' || mode === 'multi-target'
}

export const toggleMoveAutomationTargetIds = (
  currentTargetIds: readonly string[],
  id: string,
  script: MoveAutomationScript | null | undefined,
): string[] => {
  if (!script) return [...currentTargetIds]
  if (script.targetCount === 1 || script.targetMode === 'one-target') {
    return currentTargetIds[0] === id ? [] : [id]
  }

  const next = new Set(currentTargetIds)
  if (next.has(id)) next.delete(id)
  else {
    if (script.targetCount != null && next.size >= script.targetCount) return [...currentTargetIds]
    next.add(id)
  }
  return Array.from(next)
}
