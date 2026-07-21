import {
  parseAbilityConditionProviders,
  requiredAbilityConditionSaves,
  resolveAbilityConditionProviders,
  type AbilityConditionFact,
  type AbilityConditionResolution,
} from '#shared/abilityAutomation/conditionProviders'
import type { AbilityCheckResolution } from '#shared/abilityAutomation/checks'
import type { AuthoritativeAbilityContext } from './context'
import { resolveAuthoritativeAbilityCheck } from './checks'

export class AuthoritativeAbilityConditionProviderError extends Error {
  constructor(readonly code:
    | 'actor-missing' | 'target-missing' | 'fact-identity-mismatch'
    | 'source-placement-missing' | 'source-ability-inactive' | 'condition-id-invalid', detail: string) {
    super(detail)
    this.name = 'AuthoritativeAbilityConditionProviderError'
  }
}
const fail = (code: AuthoritativeAbilityConditionProviderError['code'], detail: string): never => {
  throw new AuthoritativeAbilityConditionProviderError(code, detail)
}
const ID = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const conditionId = (value: string): string => {
  if (ID.test(value)) return value
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!normalized || !ID.test(normalized)) fail('condition-id-invalid', `Condition ${JSON.stringify(value)} has no stable identity.`)
  return normalized
}
const conditionsFor = (context: AuthoritativeAbilityContext, placementId: string): readonly string[] => {
  const token = context.queries.tokens.get(placementId)
    ?? fail('target-missing', `Condition token ${placementId} is missing.`)
  return Object.freeze([...new Set((token.conditions ?? []).map(conditionId))].sort())
}
const authorize = (context: AuthoritativeAbilityContext, value: unknown) => {
  const providers = parseAbilityConditionProviders(value)
  for (const provider of providers) {
    if (!context.queries.placements.get(provider.sourcePlacementId)) {
      fail('source-placement-missing', `Condition provider ${provider.providerId} source is missing.`)
    }
    if (!context.queries.effectiveAbilities.activeForPlacement(provider.sourcePlacementId)
      .some(ability => ability.instanceId === provider.abilityInstanceId
        && ability.canonicalId === provider.canonicalId)) {
      fail('source-ability-inactive', `Condition provider ${provider.providerId} source ability is inactive.`)
    }
  }
  return providers
}

export interface AuthoritativeAbilityConditionResolution {
  readonly resolution: AbilityConditionResolution
  readonly saves: readonly {
    readonly providerId: string
    readonly resolution: AbilityCheckResolution
  }[]
}
/** Roll only the exact eligible saves, then reduce authoritative condition sets. */
export const resolveAuthoritativeAbilityConditionProviders = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly providers: unknown
  readonly fact: Omit<AbilityConditionFact, 'actorConditions' | 'targetConditions' | 'saveResolutions'>
  readonly selectedRerollSourceIdsByProvider?: ReadonlyMap<string, readonly string[]>
}): AuthoritativeAbilityConditionResolution => {
  const providers = authorize(input.context, input.providers)
  if (!input.context.queries.placements.get(input.fact.actorPlacementId)) fail('actor-missing', 'Condition actor is missing.')
  if (!input.context.queries.placements.get(input.fact.targetPlacementId)) fail('target-missing', 'Condition target is missing.')
  if (input.fact.actorPlacementId !== input.context.actor.placement.id
    || !input.context.targets.some(target => target.placement.id === input.fact.targetPlacementId)) {
    fail('fact-identity-mismatch', 'Condition facts are outside selected participants.')
  }
  const relation = (sourcePlacementId: string, subjectPlacementId: string) => (
    input.context.queries.relationships.relation(sourcePlacementId, subjectPlacementId)
  )
  const factWithoutSaves: AbilityConditionFact = {
    ...input.fact,
    conditionId: conditionId(input.fact.conditionId),
    sourceTags: Object.freeze([...input.fact.sourceTags]),
    actorConditions: conditionsFor(input.context, input.fact.actorPlacementId),
    targetConditions: conditionsFor(input.context, input.fact.targetPlacementId),
    saveResolutions: [],
  }
  const requests = requiredAbilityConditionSaves({ providers, fact: factWithoutSaves, relation })
  const requestIds = new Set(requests.map(request => request.providerId))
  if ([...(input.selectedRerollSourceIdsByProvider?.keys() ?? [])].some(id => !requestIds.has(id))) {
    fail('fact-identity-mismatch', 'Reroll choices name an ineligible condition save.')
  }
  const saves = requests.map(request => ({
    providerId: request.providerId,
    resolution: resolveAuthoritativeAbilityCheck({
      resolutionId: `${input.context.resolutionId}.${input.fact.operationId}.${request.providerId}`,
      definition: request.definition,
      selectedRerollSourceIds: input.selectedRerollSourceIdsByProvider?.get(request.providerId) ?? [],
      random: input.context.random,
      budget: input.context.budget,
    }),
  }))
  return Object.freeze({
    resolution: resolveAbilityConditionProviders({
      providers,
      fact: { ...factWithoutSaves, saveResolutions: saves },
      relation,
    }),
    saves: Object.freeze(saves),
  })
}
