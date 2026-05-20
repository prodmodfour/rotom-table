import { SWEET_VEIL_ABILITY_NAME } from '~/utils/abilityAutomation'
import { tokenGridDistance } from '~/utils/moveAutomationRange'
import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import { FLASH_FIRE_ABILITY_NAME } from '~/utils/sheetPassiveAbilityEffects'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { SpawnedPokemon } from '~/types/pokemon'

const IMMUNITY_ABILITY_NAME = 'Immunity'
const PASTEL_VEIL_ABILITY_NAME = 'Pastel Veil'
const WATER_VEIL_ABILITY_NAME = 'Water Veil'
const SWEET_VEIL_RANGE_METERS = 3

export interface MoveAutomationConditionImmunityContext {
  /**
   * Tokens considered allied Sweet Veil providers by the caller. Team ownership
   * is not stored on map tokens yet, so callers should pass only legal allies
   * when that distinction is known.
   */
  sweetVeilProviders?: readonly SpawnedPokemon[]
}

const hasType = (target: SpawnedPokemon, type: string): boolean =>
  target.defenderTypes.some((entry) => entry.toLowerCase() === type.toLowerCase())

const hasAbility = (target: Pick<SpawnedPokemon, 'abilityNames'>, ability: string): boolean =>
  sheetHasCanonicalAbility(target.abilityNames, ability)

export const tokenHasSweetVeil = (token: Pick<SpawnedPokemon, 'abilityNames'>): boolean =>
  hasAbility(token, SWEET_VEIL_ABILITY_NAME)

const sweetVeilProviderForTarget = (
  target: SpawnedPokemon,
  providers: readonly SpawnedPokemon[] | null | undefined,
): SpawnedPokemon | null => {
  if (tokenHasSweetVeil(target)) return target
  return (providers ?? []).find((provider) =>
    provider.id !== target.id
    && tokenHasSweetVeil(provider)
    && tokenGridDistance(provider, target) <= SWEET_VEIL_RANGE_METERS,
  ) ?? null
}

const sweetVeilSource = (
  target: SpawnedPokemon,
  context: MoveAutomationConditionImmunityContext,
): string | null => {
  const provider = sweetVeilProviderForTarget(target, context.sweetVeilProviders)
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

  if (canonical === 'Sleep') return sweetVeilSource(target, context)

  if (canonical === 'Paralysis' && hasType(target, 'Electric')) return 'Electric type'
  if (canonical === 'Frozen' && hasType(target, 'Ice')) return 'Ice type'
  if (canonical === 'Poisoned' || canonical === 'Badly Poisoned') {
    if (hasType(target, 'Poison') || hasType(target, 'Steel')) return hasType(target, 'Poison') ? 'Poison type' : 'Steel type'
    if (hasAbility(target, IMMUNITY_ABILITY_NAME)) return IMMUNITY_ABILITY_NAME
    if (hasAbility(target, PASTEL_VEIL_ABILITY_NAME)) return PASTEL_VEIL_ABILITY_NAME
  }
  if ((canonical === 'Stuck' || canonical === 'Trapped') && hasType(target, 'Ghost')) return 'Ghost type'

  return null
}

export const canApplyMoveAutomationCondition = (
  condition: string,
  target: SpawnedPokemon,
  sourceType?: string | null,
  context: MoveAutomationConditionImmunityContext = {},
): boolean => moveAutomationConditionImmunitySource(condition, target, sourceType, context) == null
