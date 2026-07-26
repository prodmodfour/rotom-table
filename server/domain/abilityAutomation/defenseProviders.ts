import {
  parseAbilityDefenseProviders,
  resolveAbilityDefenseProviders,
  type AbilityDefenseFact,
  type AbilityDefenseResolution,
} from '#shared/abilityAutomation/defenseProviders'
import { POKEMON_TYPES, computeMultiplier } from '~/utils/typeChart'
import type { AuthoritativeAbilityContext } from './context'
import { aa080MoldBreakerSuppressesAbility } from './mechanics/aa080StaticIntegration'

export class AuthoritativeAbilityDefenseProviderError extends Error {
  constructor(readonly code:
    | 'actor-missing' | 'target-missing' | 'fact-identity-mismatch'
    | 'source-placement-missing' | 'source-ability-inactive' | 'type-invalid', detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityDefenseProviderError'
  }
}
const fail = (code: AuthoritativeAbilityDefenseProviderError['code'], detail: string): never => {
  throw new AuthoritativeAbilityDefenseProviderError(code, detail)
}

/** Authorize defense/bypass sources and replace supplied effectiveness with server type-chart facts. */
export const resolveAuthoritativeAbilityDefenseProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly providers: unknown
  readonly fact: AbilityDefenseFact
}): AbilityDefenseResolution => {
  const parsedProviders = parseAbilityDefenseProviders(input.providers)
  const actorHasMoldBreaker = input.context.queries.effectiveAbilities
    .activeForPlacement(input.fact.actorPlacementId)
    .some(ability => ability.effective && ability.canonicalId === 'Mold Breaker')
  const providers = parsedProviders.filter(provider => !aa080MoldBreakerSuppressesAbility({
    actorPlacementId: input.fact.actorPlacementId,
    targetPlacementId: provider.sourcePlacementId,
    canonicalId: provider.canonicalId,
    actorHasMoldBreaker,
    relationship: input.context.queries.relationships.relation(
      input.fact.actorPlacementId,
      provider.sourcePlacementId,
    ),
  }))
  const actor = input.context.queries.placements.get(input.fact.actorPlacementId)
    ?? fail('actor-missing', 'Defense provider actor placement is missing.')
  const target = input.context.queries.placements.get(input.fact.targetPlacementId)
    ?? fail('target-missing', 'Defense provider target placement is missing.')
  if (actor.id !== input.context.actor.placement.id
    || ![input.context.actor.placement.id, ...input.context.targets.map(entry => entry.placement.id)].includes(target.id)) {
    fail('fact-identity-mismatch', 'Defense provider facts are outside selected participants.')
  }
  for (const provider of providers) {
    if (!input.context.queries.placements.get(provider.sourcePlacementId)) {
      fail('source-placement-missing', `Provider ${provider.providerId} source is missing.`)
    }
    if (!input.context.queries.effectiveAbilities.activeForPlacement(provider.sourcePlacementId)
      .some(ability => ability.instanceId === provider.abilityInstanceId
        && ability.canonicalId === provider.canonicalId)) {
      fail('source-ability-inactive', `Provider ${provider.providerId} source ability is inactive.`)
    }
  }
  const targetToken = input.context.queries.tokens.get(target.id)
    ?? fail('target-missing', 'Defense provider target token is missing.')
  const moveType = POKEMON_TYPES.find(type => type.toLowerCase() === input.fact.moveType)
    ?? fail('type-invalid', 'Defense provider move type is not canonical.')
  const baseTypeMultiplier = computeMultiplier(moveType, targetToken.defenderTypes)
  return resolveAbilityDefenseProviders({
    providers,
    fact: { ...input.fact, baseTypeMultiplier },
    relation: (sourcePlacementId, subjectPlacementId) => (
      input.context.queries.relationships.relation(sourcePlacementId, subjectPlacementId)
    ),
  })
}
