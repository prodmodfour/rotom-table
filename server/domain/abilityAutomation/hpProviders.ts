import {
  parseAbilityHpProviders,
  resolveAbilityHpDamageProviders,
  resolveAbilityHpRecoveryProviders,
  type AbilityHpDamageFact,
  type AbilityHpDamageResolution,
  type AbilityHpPool,
  type AbilityHpRecoveryResolution,
} from '#shared/abilityAutomation/hpProviders'
import type { AuthoritativeAbilityContext } from './context'

export class AuthoritativeAbilityHpProviderError extends Error {
  constructor(readonly code:
    | 'actor-missing' | 'target-missing' | 'recipient-missing' | 'fact-identity-mismatch'
    | 'source-placement-missing' | 'source-ability-inactive', detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityHpProviderError'
  }
}
const fail = (code: AuthoritativeAbilityHpProviderError['code'], detail: string): never => {
  throw new AuthoritativeAbilityHpProviderError(code, detail)
}
const poolFor = (context: AuthoritativeAbilityContext, placementId: string): AbilityHpPool => {
  const token = context.queries.tokens.get(placementId)
    ?? fail('recipient-missing', `HP provider placement ${placementId} has no authoritative token.`)
  return Object.freeze({
    placementId,
    currentHp: token.currentHp,
    maximumHp: token.maxHp,
    temporaryHp: token.temporaryHp ?? 0,
    injuries: token.injuries ?? 0,
  })
}
const authorizeProviders = (
  context: AuthoritativeAbilityContext,
  value: unknown,
) => {
  const providers = parseAbilityHpProviders(value)
  for (const provider of providers) {
    if (!context.queries.placements.get(provider.sourcePlacementId)) {
      fail('source-placement-missing', `HP provider ${provider.providerId} source is missing.`)
    }
    if (!context.queries.effectiveAbilities.activeForPlacement(provider.sourcePlacementId)
      .some(ability => ability.instanceId === provider.abilityInstanceId
        && ability.canonicalId === provider.canonicalId)) {
      fail('source-ability-inactive', `HP provider ${provider.providerId} source ability is inactive.`)
    }
  }
  return providers
}
const relationFor = (context: AuthoritativeAbilityContext) => (
  sourcePlacementId: string,
  subjectPlacementId: string,
) => context.queries.relationships.relation(sourcePlacementId, subjectPlacementId)

/** Replace all pool values with authoritative token/sheet/map projections before damage resolution. */
export const resolveAuthoritativeAbilityHpDamageProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly providers: unknown
  readonly fact: Omit<AbilityHpDamageFact, 'actor' | 'target'> & {
    readonly actorPlacementId: string
    readonly targetPlacementId: string
  }
}): AbilityHpDamageResolution => {
  const providers = authorizeProviders(input.context, input.providers)
  if (input.fact.actorPlacementId !== input.context.actor.placement.id) {
    fail('fact-identity-mismatch', 'HP damage actor differs from the selected actor.')
  }
  if (![...input.context.targets.map(entry => entry.placement.id)].includes(input.fact.targetPlacementId)) {
    fail('fact-identity-mismatch', 'HP damage target was not selected.')
  }
  return resolveAbilityHpDamageProviders({
    providers,
    fact: {
      ...input.fact,
      actor: poolFor(input.context, input.fact.actorPlacementId),
      target: poolFor(input.context, input.fact.targetPlacementId),
    },
    relation: relationFor(input.context),
  })
}

/** Resolve direct healing/temp-HP against one selected authoritative recipient pool. */
export const resolveAuthoritativeAbilityHpRecoveryProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly providers: unknown
  readonly placementId: string
  readonly baseHealing: number
  readonly baseTemporaryHpGrant: number
  readonly fact: Parameters<typeof resolveAbilityHpRecoveryProviders>[0]['fact']
}): AbilityHpRecoveryResolution => {
  const providers = authorizeProviders(input.context, input.providers)
  if (![input.context.actor.placement.id, ...input.context.targets.map(entry => entry.placement.id)].includes(input.placementId)) {
    fail('fact-identity-mismatch', 'HP recovery recipient was not selected.')
  }
  return resolveAbilityHpRecoveryProviders({
    providers,
    pool: poolFor(input.context, input.placementId),
    baseHealing: input.baseHealing,
    baseTemporaryHpGrant: input.baseTemporaryHpGrant,
    fact: input.fact,
    relation: relationFor(input.context),
  })
}
