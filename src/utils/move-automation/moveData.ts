import {
  MOVE_DAMAGE_BASE_TABLE,
  formatMoveDamageBase,
  rollMoveDamageFormula,
} from '~/utils/moveDamageBase'
import {
  createMoveAutomationScriptFromMoveData,
  damageFormulaForMoveData,
} from '~/utils/moveAutomationDerived'
import type { MoveDamageRollResult } from '~/utils/moveDamageBase'
import type { CharacterSheetMove } from '~/types/characterSheet'
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
  special?: string
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
  special: move.special,
})

export const damageFormulaForMove = damageFormulaForMoveData

export const buildMoveAutomationScriptFromMoveData = createMoveAutomationScriptFromMoveData
