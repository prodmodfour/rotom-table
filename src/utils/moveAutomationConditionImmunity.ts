import { SWEET_VEIL_ABILITY_NAME } from '#shared/abilityAutomation/legacyNames'
import { tokenGridDistance } from '~/utils/moveAutomationRange'
import { KEEN_EYE_ABILITY_NAME } from '~/utils/sheetAbilityCombatModifiers'
import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import { FLASH_FIRE_ABILITY_NAME } from '~/utils/sheetPassiveAbilityEffects'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { SpawnedPokemon } from '~/types/pokemon'

const IMMUNITY_ABILITY_NAME = 'Immunity'
const INNER_FOCUS_ABILITY_NAME = 'Inner Focus'
const OWN_TEMPO_ABILITY_NAME = 'Own Tempo'
const OBLIVIOUS_ABILITY_NAME = 'Oblivious'
export const PASTEL_VEIL_ABILITY_NAME = 'Pastel Veil'
const WATER_VEIL_ABILITY_NAME = 'Water Veil'
const WATER_BUBBLE_ABILITY_NAME = 'Water Bubble'
const VITAL_SPIRIT_ABILITY_NAME = 'Vital Spirit'
const TANGLED_FEET_ABILITY_NAME = 'Tangled Feet'
export const SWEET_VEIL_RANGE_METERS = 3
export const PASTEL_VEIL_RANGE_METERS = 3

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
  /** Sweet/Pastel Veil candidates; `isAlly` authorizes each cross-token provider. */
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

export const tokenHasPastelVeil = (token: Pick<SpawnedPokemon, 'abilityNames'>): boolean =>
  hasAbility(token, PASTEL_VEIL_ABILITY_NAME)

export const isEligibleSweetVeilProvider = (
  provider: SpawnedPokemon,
  target: SpawnedPokemon,
  isAlly: MoveAutomationAllyQuery,
): boolean => provider.id !== target.id
  && tokenHasSweetVeil(provider)
  && tokenGridDistance(provider, target) <= SWEET_VEIL_RANGE_METERS
  && isAlly(provider, target)

export const isEligiblePastelVeilProvider = (
  provider: SpawnedPokemon,
  target: SpawnedPokemon,
  isAlly: MoveAutomationAllyQuery,
): boolean => provider.id !== target.id
  && tokenHasPastelVeil(provider)
  && tokenGridDistance(provider, target) <= PASTEL_VEIL_RANGE_METERS
  && isAlly(provider, target)

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

const pastelVeilProviderForTarget = (
  target: SpawnedPokemon,
  context: MoveAutomationConditionImmunityContext,
): SpawnedPokemon | null => {
  if (tokenHasPastelVeil(target)) return target
  const providers = context.sweetVeilProviderCandidates
  const isAlly = context.isAlly
  if (!providers || !isAlly) return null
  return providers.find(provider => isEligiblePastelVeilProvider(provider, target, isAlly)) ?? null
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

const pastelVeilSource = (
  target: SpawnedPokemon,
  context: MoveAutomationConditionImmunityContext,
): string | null => {
  const provider = pastelVeilProviderForTarget(target, context)
  if (!provider) return null
  return provider.id === target.id
    ? PASTEL_VEIL_ABILITY_NAME
    : `${PASTEL_VEIL_ABILITY_NAME} (${provider.species})`
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
    if (hasAbility(target, WATER_BUBBLE_ABILITY_NAME)) return WATER_BUBBLE_ABILITY_NAME
    if (hasAbility(target, WATER_VEIL_ABILITY_NAME)) return WATER_VEIL_ABILITY_NAME
    if (sourceType === 'Fire' && hasAbility(target, FLASH_FIRE_ABILITY_NAME)) return FLASH_FIRE_ABILITY_NAME
  }

  if (canonical === 'Sleep') {
    if (hasAbility(target, VITAL_SPIRIT_ABILITY_NAME)) return VITAL_SPIRIT_ABILITY_NAME
    const sweetVeil = sweetVeilSource(target, context)
    if (sweetVeil) return sweetVeil
  }
  if (canonical === 'Vulnerable' && hasAbility(target, TANGLED_FEET_ABILITY_NAME)) {
    return TANGLED_FEET_ABILITY_NAME
  }
  if (canonical === 'Blindness' && hasAbility(target, KEEN_EYE_ABILITY_NAME)) return KEEN_EYE_ABILITY_NAME

  if ((canonical === 'Rage' || canonical === 'Infatuation')
    && hasAbility(target, OBLIVIOUS_ABILITY_NAME)) return OBLIVIOUS_ABILITY_NAME
  if (canonical === 'Confused' && hasAbility(target, OWN_TEMPO_ABILITY_NAME)) {
    return OWN_TEMPO_ABILITY_NAME
  }
  if (canonical === 'Flinch' && hasAbility(target, INNER_FOCUS_ABILITY_NAME)) {
    return INNER_FOCUS_ABILITY_NAME
  }
  if (canonical === 'Paralysis' && hasType(target, 'Electric')) return 'Electric type'
  if (canonical === 'Frozen' && hasType(target, 'Ice')) return 'Ice type'
  if (canonical === 'Poisoned' || canonical === 'Badly Poisoned') {
    if (hasType(target, 'Poison') || hasType(target, 'Steel')) return hasType(target, 'Poison') ? 'Poison type' : 'Steel type'
    if (hasAbility(target, IMMUNITY_ABILITY_NAME)) return IMMUNITY_ABILITY_NAME
    const pastelVeil = pastelVeilSource(target, context)
    if (pastelVeil) return pastelVeil
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
