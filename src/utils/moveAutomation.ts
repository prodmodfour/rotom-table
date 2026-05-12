import { moves } from '~~/data/ptuReference'
import {
  MOVE_DAMAGE_BASE_TABLE,
  formatMoveDamageBase,
  rollMoveDamageFormula,
} from '~/utils/moveDamageBase'
import {
  createManualMoveAutomationScript,
  damageFormulaForManualMove,
} from '~/utils/moveAutomationManual'
import type { MoveDamageRollResult } from '~/utils/moveDamageBase'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { TrainerMove } from '~/types/trainerSheet'

export interface MoveAutomationMoveLike {
  name: string
  type?: string
  frequency?: string
  ac?: number | string | null
  damage_base?: number | null
  damage_roll?: string | null
  damage_class?: string | null
  range?: string
  effect?: string
}

export type DamageRollResult = MoveDamageRollResult

export const DAMAGE_BASE_TABLE = MOVE_DAMAGE_BASE_TABLE
export const formatDamageBase = formatMoveDamageBase
export const rollDamageFormula = rollMoveDamageFormula

export const sheetMoveToMoveLike = (move: CharacterSheetMove | TrainerMove): MoveAutomationMoveLike => ({
  name: move.name,
  type: move.type,
  frequency: move.frequency,
  ac: move.ac,
  damage_base: move.db ?? null,
  damage_roll: move.damageRoll ?? null,
  damage_class: move.category ?? null,
  range: move.range,
  effect: move.effect,
})

export const damageFormulaForMove = damageFormulaForManualMove

export const buildManualMoveResolution = createManualMoveAutomationScript

const defineExplicitMoveScript = (script: Omit<MoveAutomationScript, 'kind'>): MoveAutomationScript => ({
  ...script,
  kind: 'explicit',
})

/**
 * Human-authored move automation scripts. This registry is intentionally not
 * populated from moves.json. A move only counts as automated when an explicit
 * entry is added here (or moved into per-move modules later) and reviewed.
 */
export const EXPLICIT_MOVE_AUTOMATION_SCRIPTS: ReadonlyMap<string, MoveAutomationScript> = new Map<string, MoveAutomationScript>([
  // Example shape for future scripts:
  // ['Tackle', defineExplicitMoveScript({ ...buildManualMoveResolution(findMove('Tackle')!), ...move-specific steps })],
])

// Keep the helper referenced so TypeScript warns if its signature drifts while
// the explicit registry is still empty.
void defineExplicitMoveScript

export const moveAutomationCoverage = {
  canonicalMoveCount: moves.length,
  explicitScriptCount: EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size,
  missing: moves
    .filter((move) => !EXPLICIT_MOVE_AUTOMATION_SCRIPTS.has(move.name))
    .map((move) => move.name),
}

export const explicitScriptForMove = (moveName: string): MoveAutomationScript | null =>
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(moveName) ?? null

export const fieldEffectDamageBonus = (attackType: string, fieldEffects: MapFieldEffects | null | undefined): number => {
  let bonus = 0
  const weather = fieldEffects?.weather ?? []
  if (weather.some((effect) => effect.kind === 'sunny')) {
    if (attackType === 'Fire') bonus += 5
    if (attackType === 'Water') bonus -= 5
  }
  if (weather.some((effect) => effect.kind === 'rainy')) {
    if (attackType === 'Water') bonus += 5
    if (attackType === 'Fire') bonus -= 5
  }
  const terrains = fieldEffects?.terrains ?? []
  if (terrains.some((effect) => effect.kind === 'electric') && attackType === 'Electric') bonus += 10
  if (terrains.some((effect) => effect.kind === 'grassy') && attackType === 'Grass') bonus += 10
  if (terrains.some((effect) => effect.kind === 'psychic') && attackType === 'Psychic') bonus += 10
  if (terrains.some((effect) => effect.kind === 'misty') && attackType === 'Dragon') bonus -= 10
  return bonus
}
