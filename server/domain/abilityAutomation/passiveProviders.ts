import {
  aggregateAbilityPassiveProviders,
  parseAbilityPassiveProviders,
  type ResolvedAbilityPassiveProviderGroup,
} from '#shared/abilityAutomation/passiveProviders'
import type { AuthoritativeAbilityContext } from './context'

export type AuthoritativePassiveProviderErrorCode =
  | 'source-placement-missing'
  | 'source-ability-inactive'

export class AuthoritativePassiveProviderError extends Error {
  readonly code: AuthoritativePassiveProviderErrorCode

  constructor(code: AuthoritativePassiveProviderErrorCode, detail: string) {
    super(detail)
    this.name = 'AuthoritativePassiveProviderError'
    this.code = code
  }
}

const fail = (code: AuthoritativePassiveProviderErrorCode, detail: string): never => {
  throw new AuthoritativePassiveProviderError(code, detail)
}

/**
 * Authorize passive providers against the immutable effective-ability
 * projection before deterministic stacking. Suppressed and spoofed sources
 * never enter aggregation.
 */
export const aggregateAuthoritativeAbilityPassiveProviders = (
  context: AuthoritativeAbilityContext,
  value: unknown,
): readonly ResolvedAbilityPassiveProviderGroup[] => {
  const providers = parseAbilityPassiveProviders(value)
  for (const provider of providers) {
    if (!context.queries.placements.get(provider.sourcePlacementId)) {
      fail(
        'source-placement-missing',
        `Passive provider ${provider.providerId} references an absent placement.`,
      )
    }
    const source = context.queries.effectiveAbilities
      .activeForPlacement(provider.sourcePlacementId)
      .find(ability => (
        ability.instanceId === provider.abilityInstanceId
        && ability.canonicalId === provider.canonicalId
      ))
    if (!source) {
      fail(
        'source-ability-inactive',
        `Passive provider ${provider.providerId} is not backed by an active effective ability.`,
      )
    }
  }
  return aggregateAbilityPassiveProviders(providers)
}
