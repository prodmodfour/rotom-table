import {
  applyAbilityCombatDamageProviders,
  parseAbilityCombatProviders,
  resolveAbilityCombatProviders,
  type AbilityCombatProviderFact,
  type AbilityCombatProviderResolution,
  type AppliedAbilityCombatDamage,
} from '#shared/abilityAutomation/combatProviders'
import { computeMultiplier, POKEMON_TYPES } from '~/utils/typeChart'
import type { AuthoritativeAbilityContext } from './context'

export class AuthoritativeAbilityCombatProviderError extends Error {
  constructor(readonly code:
    | 'actor-missing' | 'target-missing' | 'source-placement-missing'
    | 'source-ability-inactive' | 'fact-identity-mismatch' | 'type-resolution-invalid', detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityCombatProviderError'
  }
}
const fail = (code: AuthoritativeAbilityCombatProviderError['code'], detail: string): never => {
  throw new AuthoritativeAbilityCombatProviderError(code, detail)
}

/** Authorize every provider against current effective instances before pure resolution. */
export const resolveAuthoritativeAbilityCombatProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly providers: unknown
  readonly fact: AbilityCombatProviderFact
}): AbilityCombatProviderResolution => {
  const providers = parseAbilityCombatProviders(input.providers)
  const actor = input.context.queries.placements.get(input.fact.actorPlacementId)
    ?? fail('actor-missing', 'Combat provider actor placement is missing.')
  const target = input.context.queries.placements.get(input.fact.targetPlacementId)
    ?? fail('target-missing', 'Combat provider target placement is missing.')
  if (actor.id !== input.context.actor.placement.id
    || ![input.context.actor.placement.id, ...input.context.targets.map(entry => entry.placement.id)].includes(target.id)) {
    fail('fact-identity-mismatch', 'Combat provider facts are outside the selected ability participants.')
  }
  for (const provider of providers) {
    if (!input.context.queries.placements.get(provider.sourcePlacementId)) {
      fail('source-placement-missing', `Provider ${provider.providerId} source placement is missing.`)
    }
    const active = input.context.queries.effectiveAbilities.activeForPlacement(provider.sourcePlacementId)
      .some(ability => ability.instanceId === provider.abilityInstanceId
        && ability.canonicalId === provider.canonicalId)
    if (!active) {
      fail('source-ability-inactive', `Provider ${provider.providerId} is not backed by an active effective ability.`)
    }
  }
  return resolveAbilityCombatProviders({
    providers,
    fact: input.fact,
    relation: (sourcePlacementId, subjectPlacementId) => (
      input.context.queries.relationships.relation(sourcePlacementId, subjectPlacementId)
    ),
  })
}

/** Recompute type effectiveness after all type providers, never from a client multiplier. */
export const authoritativeAbilityCombatTypeMultiplier = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly targetPlacementId: string
  readonly resolution: AbilityCombatProviderResolution
}): number => {
  const target = input.context.queries.tokens.get(input.targetPlacementId)
    ?? fail('target-missing', 'Combat provider target token is missing.')
  const attackingType = POKEMON_TYPES.find(type => type.toLowerCase() === input.resolution.moveType)
    ?? fail('type-resolution-invalid', 'Resolved provider type is not canonical.')
  const multiplier = computeMultiplier(attackingType, target.defenderTypes)
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    fail('type-resolution-invalid', 'Authoritative type chart produced an invalid multiplier.')
  }
  return multiplier
}

/** Apply provider damage after authoritative target types have been read. */
export const applyAuthoritativeAbilityCombatDamage = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly targetPlacementId: string
  readonly baseDamage: number
  readonly resolution: AbilityCombatProviderResolution
}): AppliedAbilityCombatDamage => applyAbilityCombatDamageProviders({
  baseDamage: input.baseDamage,
  typeMultiplier: authoritativeAbilityCombatTypeMultiplier(input),
  resolution: input.resolution,
})
