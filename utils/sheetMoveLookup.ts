import { findMove } from '~/data/ptuReference'
import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { findMoveDamageBase } from '~/utils/moveDamageBase'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { PtuMove } from '~/types/ptuReference'
import type { TrainerMove } from '~/types/trainerSheet'

export type SheetMoveLike = CharacterSheetMove | TrainerMove

export interface MoveLookupOptions {
  /** Types that grant Pokémon STAB. Trainers normally leave this empty. */
  stabTypes?: readonly string[]
  /** Resolved Attack total added to Physical damage before Combat Stages. */
  physicalAttack?: number | null
  /** Resolved Special Attack total added to Special damage before Combat Stages. */
  specialAttack?: number | null
  /** Current Attack Combat Stage applied to Physical damage. */
  physicalAttackStage?: number | null
  /** Current Special Attack Combat Stage applied to Special damage. */
  specialAttackStage?: number | null
}

export interface MoveLookupRow<T extends SheetMoveLike> {
  move: T
  reference: PtuMove | null
  /** Damage Base after sheet-derived bonuses such as Pokémon STAB. */
  damageBase: number | null
  /** True when this row's DB includes the +2 same-type attack bonus. */
  hasStab: boolean
  /** Attack or Special Attack total after current Combat Stages, when relevant. */
  attackStat: number | null
  /** Attack or Special Attack total before current Combat Stages, when relevant. */
  baseAttackStat: number | null
  /** Current Attack/Special Attack Combat Stage used by the formula, when relevant. */
  attackStage: number | null
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

export interface MoveDamageLike {
  name: string
  type?: string | null
  damage_base?: number | null
  damage_class?: string | null
}

export const isStruggleAttackEntry = (move: Pick<MoveDamageLike, 'name'>): boolean =>
  /^struggle(?:\s*\(|$)/i.test(move.name.trim())

export const hasSameTypeAttackBonus = (
  move: MoveDamageLike,
  stabTypes: readonly string[] | undefined,
): boolean => {
  // PTU explicitly says STAB is never applied to Struggle Attacks. Keep
  // Struggle Bug unaffected by only matching "Struggle" and "Struggle (...)".
  if (move.damage_base == null || !stabTypes?.length || isStruggleAttackEntry(move)) return false
  const type = normalizeKey(move.type)
  return Boolean(type && stabTypes.some((stabType) => normalizeKey(stabType) === type))
}

const effectiveMoveDamageBase = (
  move: SheetMoveLike,
  reference: PtuMove | null,
  options: MoveLookupOptions,
): { damageBase: number | null; hasStab: boolean } => {
  const base = reference?.damage_base ?? move.db ?? null
  const damageLike: MoveDamageLike = {
    name: reference?.name ?? move.name,
    type: reference?.type ?? move.type,
    damage_base: base,
    damage_class: reference?.damage_class ?? move.category ?? null,
  }
  const hasStab = hasSameTypeAttackBonus(damageLike, options.stabTypes)
  return {
    damageBase: base == null ? null : base + (hasStab ? 2 : 0),
    hasStab,
  }
}

const attackBonusFor = (
  move: SheetMoveLike,
  reference: PtuMove | null,
  options: MoveLookupOptions,
): { attackStat: number | null; baseAttackStat: number | null; attackStage: number | null } => {
  const damageClass = normalizeKey(reference?.damage_class ?? move.category)
  if (damageClass === 'physical') {
    const base = toNumber(options.physicalAttack)
    const stage = options.physicalAttackStage ?? 0
    return {
      attackStat: applyCombatStageToStat(base, stage),
      baseAttackStat: base,
      attackStage: stage,
    }
  }
  if (damageClass === 'special') {
    const base = toNumber(options.specialAttack)
    const stage = options.specialAttackStage ?? 0
    return {
      attackStat: applyCombatStageToStat(base, stage),
      baseAttackStat: base,
      attackStage: stage,
    }
  }
  return { attackStat: null, baseAttackStat: null, attackStage: null }
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
    const { damageBase, hasStab } = effectiveMoveDamageBase(move, reference, options)
    const attack = attackBonusFor(move, reference, options)
    return {
      move,
      reference,
      damageBase,
      hasStab,
      ...attack,
      damageFormula: damageFormulaFor(damageBase, attack.attackStat ?? 0),
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
