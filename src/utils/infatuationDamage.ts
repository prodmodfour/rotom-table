import type { SpawnedPokemon } from '~/types/pokemon'
import {
  conditionBaseName,
  conditionLookupKey,
  infatuationCrushName,
  normalizeConditionNames,
} from '~/utils/statusConditions'

export interface InfatuationDamageEffect {
  active: boolean
  crushName: string | null
  crushIncluded: boolean
  damageRollModifier: number
  offenseDivisor: number
}

const NO_INFATUATION_DAMAGE_EFFECT: InfatuationDamageEffect = {
  active: false,
  crushName: null,
  crushIncluded: false,
  damageRollModifier: 0,
  offenseDivisor: 1,
}

const targetMatchKeys = (target: SpawnedPokemon): Set<string> => new Set([
  target.id,
  target.species,
  target.slug,
  target.sheetSlug,
].map(conditionLookupKey).filter(Boolean))

const targetMatchesCrush = (target: SpawnedPokemon, crushName: string): boolean =>
  targetMatchKeys(target).has(conditionLookupKey(crushName))

const infatuationEntry = (conditions: readonly string[] | null | undefined): string | null =>
  normalizeConditionNames(conditions).find((condition) => conditionBaseName(condition) === 'Infatuation') ?? null

export const resolveInfatuationDamageEffect = (
  userConditions: readonly string[] | null | undefined,
  selectedTargets: readonly SpawnedPokemon[],
): InfatuationDamageEffect => {
  const entry = infatuationEntry(userConditions)
  if (!entry) return NO_INFATUATION_DAMAGE_EFFECT

  const crushName = infatuationCrushName(entry)
  if (!crushName) {
    return {
      ...NO_INFATUATION_DAMAGE_EFFECT,
      active: true,
    }
  }

  const crushIncluded = selectedTargets.some((target) => targetMatchesCrush(target, crushName))
  return {
    active: true,
    crushName,
    crushIncluded,
    damageRollModifier: crushIncluded ? 0 : -5,
    offenseDivisor: crushIncluded ? 2 : 1,
  }
}

export const applyInfatuationOffenseModifier = (
  offense: number,
  effect: InfatuationDamageEffect,
): number => Math.floor(offense / effect.offenseDivisor)
