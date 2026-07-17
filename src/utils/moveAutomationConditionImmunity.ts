import { SWEET_VEIL_ABILITY_NAME } from '~/utils/abilityAutomation'
import { tokenGridDistance } from '~/utils/moveAutomationRange'
import { KEEN_EYE_ABILITY_NAME } from '~/utils/sheetAbilityCombatModifiers'
import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import { FLASH_FIRE_ABILITY_NAME } from '~/utils/sheetPassiveAbilityEffects'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { SpawnedPokemon } from '~/types/pokemon'

const IMMUNITY_ABILITY_NAME = 'Immunity'
const PASTEL_VEIL_ABILITY_NAME = 'Pastel Veil'
const WATER_VEIL_ABILITY_NAME = 'Water Veil'
export const SWEET_VEIL_RANGE_METERS = 3

export type MoveAutomationAllyQuery = (
  provider: Pick<SpawnedPokemon, 'id'>,
  target: Pick<SpawnedPokemon, 'id'>,
) => boolean

export type MoveAutomationAdditionalConditionImmunityQuery = (
  condition: string,
  target: SpawnedPokemon,
) => string | null

interface MoveAutomationConditionImmunityBase {
  /** Server-owned contextual prevention such as grounded terrain membership. */
  readonly additionalImmunitySource?: MoveAutomationAdditionalConditionImmunityQuery
}

interface MoveAutomationConditionImmunityWithoutSweetVeilProviders {
  readonly sweetVeilProviderCandidates?: undefined
  readonly isAlly?: undefined
}

interface MoveAutomationConditionImmunityWithSweetVeilProviders {
  /** Candidate tokens only; `isAlly` must authorize each cross-token provider. */
  readonly sweetVeilProviderCandidates: readonly SpawnedPokemon[]
  readonly isAlly: MoveAutomationAllyQuery
}

export type MoveAutomationConditionImmunityContext = MoveAutomationConditionImmunityBase & (
  | MoveAutomationConditionImmunityWithoutSweetVeilProviders
  | MoveAutomationConditionImmunityWithSweetVeilProviders
)

const hasType = (target: SpawnedPokemon, type: string): boolean =>
  target.defenderTypes.some((entry) => entry.toLowerCase() === type.toLowerCase())

const hasAbility = (target: Pick<SpawnedPokemon, 'abilityNames'>, ability: string): boolean =>
  sheetHasCanonicalAbility(target.abilityNames, ability)

export const tokenHasSweetVeil = (token: Pick<SpawnedPokemon, 'abilityNames'>): boolean =>
  hasAbility(token, SWEET_VEIL_ABILITY_NAME)

export const isEligibleSweetVeilProvider = (
  provider: SpawnedPokemon,
  target: SpawnedPokemon,
  isAlly: MoveAutomationAllyQuery,
): boolean => provider.id !== target.id
  && tokenGridDistance(provider, target) <= SWEET_VEIL_RANGE_METERS
  && isAlly(provider, target)
  && tokenHasSweetVeil(provider)

const sweetVeilProviderForTarget = (
  target: SpawnedPokemon,
  context: MoveAutomationConditionImmunityContext,
): SpawnedPokemon | null => {
  if (tokenHasSweetVeil(target)) return target
  const providers = context.sweetVeilProviderCandidates
  const isAlly = context.isAlly
  if (!providers || !isAlly) return null
  return providers.find(provider => isEligibleSweetVeilProvider(provider, target, isAlly)) ?? null
}

const sweetVeilSource = (
  target: SpawnedPokemon,
  context: MoveAutomationConditionImmunityContext,
): string | null => {
  const provider = sweetVeilProviderForTarget(target, context)
  if (!provider) return null
  return provider.id === target.id
    ? SWEET_VEIL_ABILITY_NAME
    : `${SWEET_VEIL_ABILITY_NAME} (${provider.species})`
}

export const moveAutomationConditionImmunitySource = (
  condition: string,
  target: SpawnedPokemon,
  sourceType?: string | null,
  context: MoveAutomationConditionImmunityContext = {},
): string | null => {
  const canonical = normalizeConditionName(condition) ?? condition

  if (canonical === 'Burned') {
    if (hasType(target, 'Fire')) return 'Fire type'
    if (hasAbility(target, WATER_VEIL_ABILITY_NAME)) return WATER_VEIL_ABILITY_NAME
    if (sourceType === 'Fire' && hasAbility(target, FLASH_FIRE_ABILITY_NAME)) return FLASH_FIRE_ABILITY_NAME
  }

  if (canonical === 'Sleep') {
    const sweetVeil = sweetVeilSource(target, context)
    if (sweetVeil) return sweetVeil
  }
  if (canonical === 'Blindness' && hasAbility(target, KEEN_EYE_ABILITY_NAME)) return KEEN_EYE_ABILITY_NAME

  if (canonical === 'Paralysis' && hasType(target, 'Electric')) return 'Electric type'
  if (canonical === 'Frozen' && hasType(target, 'Ice')) return 'Ice type'
  if (canonical === 'Poisoned' || canonical === 'Badly Poisoned') {
    if (hasType(target, 'Poison') || hasType(target, 'Steel')) return hasType(target, 'Poison') ? 'Poison type' : 'Steel type'
    if (hasAbility(target, IMMUNITY_ABILITY_NAME)) return IMMUNITY_ABILITY_NAME
    if (hasAbility(target, PASTEL_VEIL_ABILITY_NAME)) return PASTEL_VEIL_ABILITY_NAME
  }
  if ((canonical === 'Stuck' || canonical === 'Trapped') && hasType(target, 'Ghost')) return 'Ghost type'

  return context.additionalImmunitySource?.(canonical, target) ?? null
}

export const canApplyMoveAutomationCondition = (
  condition: string,
  target: SpawnedPokemon,
  sourceType?: string | null,
  context: MoveAutomationConditionImmunityContext = {},
): boolean => moveAutomationConditionImmunitySource(condition, target, sourceType, context) == null
