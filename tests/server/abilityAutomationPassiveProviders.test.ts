import { describe, expect, it, vi } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AuthoritativePassiveProviderError,
  aggregateAuthoritativeAbilityPassiveProviders,
} from '../../server/domain/abilityAutomation/passiveProviders'

const passiveProvider = {
  schemaVersion: 1,
  providerId: 'battle-armor.defense',
  abilityInstanceId: 'base:actor-token:0',
  canonicalId: 'Battle Armor',
  sourcePlacementId: 'actor-token',
  scopeKey: 'placement:actor-token',
  domain: 'stat',
  attribute: 'stat.defense',
  operation: 'add',
  value: 2,
  priority: 10,
  stackingGroup: 'stat.base',
  stackingPolicy: 'stack',
  reasonCode: 'ability.battle-armor.defense',
} as const

const context = (effective = true): AuthoritativeAbilityContext => ({
  queries: {
    placements: {
      get: vi.fn((id: string) => id === 'actor-token' ? { id } : null),
    },
    effectiveAbilities: {
      activeForPlacement: vi.fn(() => effective ? [{
        instanceId: 'base:actor-token:0',
        canonicalId: 'Battle Armor',
        effective: true,
      }] : []),
    },
  },
} as unknown as AuthoritativeAbilityContext)

describe('authoritative passive provider aggregation', () => {
  it('aggregates only providers backed by an active projected ability', () => {
    const authoritative = context()
    const groups = aggregateAuthoritativeAbilityPassiveProviders(authoritative, [passiveProvider])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.providers[0]).toMatchObject({ providerId: 'battle-armor.defense' })
    expect(authoritative.queries.effectiveAbilities.activeForPlacement).toHaveBeenCalledWith(
      'actor-token',
    )
  })

  it('rejects suppressed, mismatched, or absent sources before stacking', () => {
    expect(() => aggregateAuthoritativeAbilityPassiveProviders(context(false), [passiveProvider]))
      .toThrow(AuthoritativePassiveProviderError)
    expect(() => aggregateAuthoritativeAbilityPassiveProviders(context(), [{
      ...passiveProvider,
      canonicalId: 'Blaze',
    }])).toThrowError(expect.objectContaining({ code: 'source-ability-inactive' }))
    expect(() => aggregateAuthoritativeAbilityPassiveProviders(context(), [{
      ...passiveProvider,
      sourcePlacementId: 'missing-token',
    }])).toThrowError(expect.objectContaining({ code: 'source-placement-missing' }))
  })
})
