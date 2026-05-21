import { findMove } from '~~/data/ptuReference'
import { findMoveDamageBase } from '~/utils/moveDamageBase'
import {
  resolveSheetMoveAttackStat,
  type SheetMoveAttackStatOptions,
} from '~/utils/sheetMoveAttackStats'
import {
  isStruggleAttackMoveName,
  struggleAccuracyForCombatRank,
  struggleDamageBaseForCombatRank,
} from '~/utils/struggleMoves'
import { pokemonLoyaltyDamageBase } from '~/utils/sheets/pokemonLoyalty'
import type { CharacterSheetMove } from '~/types/characterSheet'
import type { PtuMove } from '~/types/ptuReference'
import type { TrainerMove } from '~/types/trainerSheet'

export type SheetMoveLike = CharacterSheetMove | TrainerMove

export interface MoveLookupOptions extends SheetMoveAttackStatOptions {
  /** Types that grant Pokémon STAB. Trainers normally leave this empty. */
  stabTypes?: readonly string[]
  /** Rank value for Combat Skill (Pathetic=1 … Master=6), used by Struggle Attacks. */
  combatSkillRankValue?: number | null
  /** Pokémon Loyalty rank (0–6), used by Return and Frustration. */
  loyalty?: number | null
}

export interface MoveLookupRow<T extends SheetMoveLike> {
  move: T
  reference: PtuMove | null
  /** Accuracy Check after sheet-derived Struggle Attack overrides. */
  ac: number | string | null
  /** Damage Base after sheet-derived bonuses such as Pokémon STAB. */
  damageBase: number | null
  /** True when this row's DB includes the +2 same-type attack bonus. */
  hasStab: boolean
  /** Total offensive bonus after current Combat Stages and ability additions, when relevant. */
  attackStat: number | null
  /** Normal damage-class offensive stat before current Combat Stages, when relevant. */
  baseAttackStat: number | null
  /** Current Combat Stage for the normal damage-class stat, when relevant. */
  attackStage: number | null
  /** Which offensive stat supplies the normal damage-class bonus, when relevant. */
  attackStatKey: 'atk' | 'satk' | null
  /** Human-readable label for the normal damage-class stat, when relevant. */
  attackStatLabel: string | null
  /** Ability responsible for adding an extra offensive stat, when relevant. */
  attackStatAbility: string | null
  /** Extra offensive stat added by an ability after Combat Stages, when relevant. */
  additionalAttackStat: number | null
  /** Extra offensive stat before current Combat Stages, when relevant. */
  additionalBaseAttackStat: number | null
  /** Current Combat Stage for the extra offensive stat, when relevant. */
  additionalAttackStage: number | null
  /** Which offensive stat supplies the extra ability bonus, when relevant. */
  additionalAttackStatKey: 'atk' | 'satk' | null
  /** Human-readable label for the extra offensive stat, when relevant. */
  additionalAttackStatLabel: string | null
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
  'special',
  'contestStats',
] as const

export const lookupMoveReference = (move: Pick<SheetMoveLike, 'name'>): PtuMove | null => {
  const name = typeof move.name === 'string' ? move.name.trim() : ''
  return name ? findMove(name) : null
}

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
  isStruggleAttackMoveName(move.name)

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
  const moveName = reference?.name ?? move.name
  const loyaltyDamageBase = pokemonLoyaltyDamageBase(moveName, options.loyalty)
  const base = struggleDamageBaseForCombatRank(
    moveName,
    loyaltyDamageBase ?? reference?.damage_base ?? move.db ?? null,
    options.combatSkillRankValue,
  )
  const damageLike: MoveDamageLike = {
    name: moveName,
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

const effectiveMoveAccuracy = (
  move: SheetMoveLike,
  reference: PtuMove | null,
  options: MoveLookupOptions,
): number | string | null => struggleAccuracyForCombatRank(
  reference?.name ?? move.name,
  reference?.ac ?? move.ac ?? null,
  options.combatSkillRankValue,
)

const attackBonusFor = (
  move: SheetMoveLike,
  reference: PtuMove | null,
  options: MoveLookupOptions,
) => resolveSheetMoveAttackStat(reference?.damage_class ?? move.category, options)

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
      ac: effectiveMoveAccuracy(move, reference, options),
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
  // from data/reference/moves.json via data/ptuReference.ts.
  clearLookupBackedMoveFields(move)
}
