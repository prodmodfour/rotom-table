import { findMove } from '~/data/ptuReference'
import { findMoveDamageBase } from '~/utils/moveDamageBase'
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

const toNumber = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const normalizeKey = (value: string | null | undefined): string =>
  String(value ?? '').trim().toLowerCase()

const formatSignedMod = (value: number): string =>
  value >= 0 ? `+${value}` : String(value)

const isStruggleAttackEntry = (move: PtuMove): boolean =>
  /^struggle(?:\s*\(|$)/i.test(move.name.trim())

const hasSameTypeAttackBonus = (move: PtuMove, stabTypes: readonly string[] | undefined): boolean => {
  // PTU explicitly says STAB is never applied to Struggle Attacks. Keep
  // Struggle Bug unaffected by only matching "Struggle" and "Struggle (...)".
  if (move.damage_base == null || !stabTypes?.length || isStruggleAttackEntry(move)) return false
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
  const dice = findMoveDamageBase(damageBase)
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
  const target = move as unknown as Record<string, unknown>
  for (const key of LOOKUP_BACKED_MOVE_KEYS) delete target[key]
}

export const setLookupMoveName = (move: SheetMoveLike, value: unknown): void => {
  move.name = typeof value === 'string' ? value : value == null ? '' : String(value)
  // The sheet stores only the selected move name; display/runtime details come
  // from ptu-data/data/moves.json via data/ptuReference.ts.
  clearLookupBackedMoveFields(move)
}
