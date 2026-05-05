import { findMove } from '~/data/ptuReference'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { PtuMove } from '~/types/ptuReference'
import type { TrainerMove } from '~/types/trainerSheet'

export type SheetMoveLike = CharacterSheetMove | TrainerMove

export interface MoveLookupOptions {
  /** Types that grant Pokémon STAB. Trainers normally leave this empty. */
  stabTypes?: readonly string[]
  /** Resolved Attack total added to Physical damage. */
  physicalAttack?: number | null
  /** Resolved Special Attack total added to Special damage. */
  specialAttack?: number | null
}

export interface MoveLookupRow<T extends SheetMoveLike> {
  move: T
  reference: PtuMove | null
  /** Damage Base after sheet-derived bonuses such as Pokémon STAB. */
  damageBase: number | null
  /** True when this row's DB includes the +2 same-type attack bonus. */
  hasStab: boolean
  /** Dice formula after adjusted DB and Attack/Special Attack additions. */
  damageFormula: string | null
}

const LOOKUP_BACKED_MOVE_KEYS = [
  'type',
  'category',
  'db',
  'damageRoll',
  'damageRollMod',
  'frequency',
  'ac',
  'range',
  'effect',
  'contestStats',
] as const

export const lookupMoveReference = (move: Pick<SheetMoveLike, 'name'>): PtuMove | null => {
  const name = typeof move.name === 'string' ? move.name.trim() : ''
  return name ? findMove(name) : null
}

const DAMAGE_BASE_TABLE: Record<number, { count: number; sides: number; mod: number }> = {
  1: { count: 1, sides: 6, mod: 1 },
  2: { count: 1, sides: 6, mod: 3 },
  3: { count: 1, sides: 6, mod: 5 },
  4: { count: 1, sides: 8, mod: 6 },
  5: { count: 1, sides: 8, mod: 8 },
  6: { count: 2, sides: 6, mod: 8 },
  7: { count: 2, sides: 6, mod: 10 },
  8: { count: 2, sides: 8, mod: 10 },
  9: { count: 2, sides: 10, mod: 10 },
  10: { count: 3, sides: 8, mod: 10 },
  11: { count: 3, sides: 10, mod: 10 },
  12: { count: 3, sides: 12, mod: 10 },
  13: { count: 4, sides: 10, mod: 10 },
  14: { count: 4, sides: 10, mod: 15 },
  15: { count: 4, sides: 10, mod: 20 },
  16: { count: 5, sides: 10, mod: 20 },
  17: { count: 5, sides: 12, mod: 25 },
  18: { count: 6, sides: 12, mod: 25 },
  19: { count: 6, sides: 12, mod: 30 },
  20: { count: 6, sides: 12, mod: 35 },
  21: { count: 6, sides: 12, mod: 40 },
  22: { count: 6, sides: 12, mod: 45 },
  23: { count: 6, sides: 12, mod: 50 },
  24: { count: 7, sides: 12, mod: 50 },
  25: { count: 8, sides: 12, mod: 50 },
  26: { count: 8, sides: 12, mod: 55 },
  27: { count: 8, sides: 12, mod: 60 },
  28: { count: 8, sides: 12, mod: 65 },
}

const toNumber = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const normalizeKey = (value: string | null | undefined): string =>
  String(value ?? '').trim().toLowerCase()

const formatSignedMod = (value: number): string =>
  value >= 0 ? `+${value}` : String(value)

const hasSameTypeAttackBonus = (move: PtuMove, stabTypes: readonly string[] | undefined): boolean => {
  if (move.damage_base == null || !stabTypes?.length) return false
  const type = normalizeKey(move.type)
  return Boolean(type && stabTypes.some((stabType) => normalizeKey(stabType) === type))
}

const attackBonusFor = (move: PtuMove, options: MoveLookupOptions): number => {
  const damageClass = normalizeKey(move.damage_class)
  if (damageClass === 'physical') return toNumber(options.physicalAttack)
  if (damageClass === 'special') return toNumber(options.specialAttack)
  return 0
}

const damageFormulaFor = (damageBase: number | null, attackBonus: number): string | null => {
  if (damageBase == null) return null
  const attackSuffix = attackBonus ? formatSignedMod(attackBonus) : ''
  const dice = DAMAGE_BASE_TABLE[damageBase]
  if (!dice) return `DB ${damageBase}${attackSuffix}`
  return `${dice.count}d${dice.sides}${formatSignedMod(dice.mod)}${attackSuffix}`
}

export const makeMoveLookupRows = <T extends SheetMoveLike>(
  moves: readonly T[] | undefined,
  options: MoveLookupOptions = {},
): MoveLookupRow<T>[] =>
  (moves ?? []).map((move) => {
    const reference = lookupMoveReference(move)
    const hasStab = reference ? hasSameTypeAttackBonus(reference, options.stabTypes) : false
    const damageBase = reference?.damage_base == null
      ? null
      : reference.damage_base + (hasStab ? 2 : 0)
    return {
      move,
      reference,
      damageBase,
      hasStab,
      damageFormula: reference ? damageFormulaFor(damageBase, attackBonusFor(reference, options)) : null,
    }
  })

export const formatLookupValue = (value: unknown): string =>
  value === null || value === undefined || value === '' ? '—' : String(value)

export const clearLookupBackedMoveFields = (move: SheetMoveLike): void => {
  const target = move as Record<string, unknown>
  for (const key of LOOKUP_BACKED_MOVE_KEYS) delete target[key]
}

export const setLookupMoveName = (move: SheetMoveLike, value: unknown): void => {
  move.name = typeof value === 'string' ? value : value == null ? '' : String(value)
  // The sheet stores only the selected move name; display/runtime details come
  // from ptu-data/data/moves.json via data/ptuReference.ts.
  clearLookupBackedMoveFields(move)
}
