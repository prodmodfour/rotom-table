import { findMove } from '~~/data/ptuReference'
import {
  buildManualMoveResolution,
  explicitScriptForMove,
  sheetMoveToMoveLike,
  type MoveAutomationMoveLike,
} from '~/utils/moveAutomation'
import { hasSameTypeAttackBonus } from '~/utils/sheetMoveLookup'
import {
  isStruggleAttackMoveName,
  struggleAccuracyForCombatRank,
  struggleDamageBaseForCombatRank,
  struggleDamageRollForCombatRank,
} from '~/utils/struggleMoves'
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
  hasStab: boolean
}

export interface MoveAutomationMoveEntryOptions {
  /** Types that grant STAB for this move user. Trainers normally leave this empty. */
  stabTypes?: readonly string[]
  /** Rank value for Combat Skill (Pathetic=1 … Master=6), used by Struggle Attacks. */
  combatSkillRankValue?: number | null
}

const moveWithStruggleCombatSkill = (
  move: MoveAutomationMoveLike,
  combatSkillRankValue: number | null | undefined,
): MoveAutomationMoveLike => {
  if (!isStruggleAttackMoveName(move.name)) return move
  return {
    ...move,
    ac: struggleAccuracyForCombatRank(move.name, move.ac ?? null, combatSkillRankValue),
    damage_base: struggleDamageBaseForCombatRank(move.name, move.damage_base ?? null, combatSkillRankValue),
    damage_roll: struggleDamageRollForCombatRank(move.name, move.damage_roll ?? null, combatSkillRankValue),
  }
}

const scriptWithStruggleCombatSkill = (
  script: MoveAutomationScript,
  combatSkillRankValue: number | null | undefined,
): MoveAutomationScript => {
  if (!isStruggleAttackMoveName(script.moveName)) return script
  return {
    ...script,
    ac: struggleAccuracyForCombatRank(script.moveName, script.ac, combatSkillRankValue),
    damageBase: struggleDamageBaseForCombatRank(script.moveName, script.damageBase, combatSkillRankValue),
  }
}

export const moveLikeForSheetMove = (
  sheetMove: MoveAutomationSheetMove,
  options: MoveAutomationMoveEntryOptions = {},
): MoveAutomationMoveLike => {
  const canonical = findMove(sheetMove.name)
  const move = moveWithStruggleCombatSkill(canonical ?? sheetMoveToMoveLike(sheetMove), options.combatSkillRankValue)
  const hasStab = hasSameTypeAttackBonus(move, options.stabTypes)
  if (!hasStab || move.damage_base == null) return move
  return {
    ...move,
    damage_base: move.damage_base + 2,
    damage_roll: null,
  }
}

export const buildMoveAutomationMoveEntries = (
  moves: readonly MoveAutomationSheetMove[],
  options: MoveAutomationMoveEntryOptions = {},
): MoveAutomationMoveEntry[] => moves
  .filter((move) => move.name?.trim())
  .map((sheetMove) => {
    const move = moveLikeForSheetMove(sheetMove, options)
    const hasStab = hasSameTypeAttackBonus(move, options.stabTypes)
    const explicitScript = explicitScriptForMove(move.name)
    const baseScript = explicitScript && hasStab && explicitScript.damageBase != null
      ? { ...explicitScript, damageBase: explicitScript.damageBase + 2 }
      : explicitScript ?? buildManualMoveResolution(move)
    const script = scriptWithStruggleCombatSkill(baseScript, options.combatSkillRankValue)
    return {
      label: move.name,
      sheetMove,
      move,
      script,
      hasExplicitScript: Boolean(explicitScript),
      hasStab,
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
      script.special ?? '',
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
