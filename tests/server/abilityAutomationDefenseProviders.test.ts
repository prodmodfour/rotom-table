import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AuthoritativeAbilityDefenseProviderError,
  resolveAuthoritativeAbilityDefenseProviders,
} from '../../server/domain/abilityAutomation/defenseProviders'
import {
  AbilityDefenseProviderValidationError,
  parseAbilityDefenseProviders,
  resolveAbilityDefenseProviders,
  type AbilityDefenseFact,
  type AbilityDefenseProviderEffect,
} from '#shared/abilityAutomation/defenseProviders'

const predicate = (overrides: Record<string, unknown> = {}) => ({
  moveIds: [], moveTypes: [], damageClasses: [], requiredKeywords: [], excludedKeywords: [],
  ...overrides,
})
const provider = (
  providerId: string,
  effect: AbilityDefenseProviderEffect,
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  providerId,
  abilityInstanceId: 'base:target:0',
  canonicalId: 'Flash Fire',
  sourcePlacementId: 'target',
  subject: 'target',
  relation: 'self',
  predicate: predicate(),
  effect,
  stackingGroup: `group.${providerId}`,
  stackingPolicy: effect.kind === 'resistance' || effect.kind === 'vulnerability' ? 'stack' : 'union',
  priority: 0,
  reasonCode: `ability.${providerId}`,
  ...overrides,
})
const bypass = (
  providerId: string,
  kinds: readonly ('immunity' | 'resistance' | 'protection')[],
  tags: readonly string[],
) => provider(providerId, {
  kind: 'bypass', bypassKinds: kinds, protectionTags: tags,
}, {
  abilityInstanceId: 'base:actor:0', canonicalId: 'Mold Breaker', sourcePlacementId: 'actor',
  subject: 'actor', relation: 'self', stackingPolicy: 'union',
})
const fact: AbilityDefenseFact = {
  actorPlacementId: 'actor', targetPlacementId: 'target', moveId: 'Ember',
  moveType: 'fire', damageClass: 'special', keywords: ['ranged'],
  effectCategory: 'damage', baseTypeMultiplier: 1.5,
}
const relation = (left: string, right: string): 'self' | 'ally' | 'enemy' | 'unknown' => (
  left === right ? 'self' : 'enemy'
)
const fireImmunity = () => provider('fire-immunity', {
  kind: 'immunity', category: 'move-type', value: 'fire', protectionTag: 'typed-fire-immunity',
})
const context = (
  active = true,
  defenderTypes = ['Grass'],
  actorHasMoldBreaker = false,
): AuthoritativeAbilityContext => {
  const actor = { id: 'actor', sideId: 'red' }
  const target = { id: 'target', sideId: 'blue' }
  return {
    actor: { placement: actor }, targets: [{ placement: target }],
    queries: {
      placements: { get: (id: string) => id === 'actor' ? actor : id === 'target' ? target : null },
      tokens: { get: (id: string) => id === 'target' ? { id, defenderTypes } : { id, defenderTypes: ['Fire'] } },
      effectiveAbilities: {
        activeForPlacement: (id: string) => !active ? [] : id === 'actor'
          ? actorHasMoldBreaker
            ? [{ instanceId: 'base:actor:0', canonicalId: 'Mold Breaker', effective: true }]
            : []
          : id === 'target'
            ? [{ instanceId: 'base:target:0', canonicalId: 'Flash Fire', effective: true }]
            : [],
      },
      relationships: { relation },
    },
  } as unknown as AuthoritativeAbilityContext
}

describe('ability immunity, resistance, vulnerability, protection, and bypass providers', () => {
  it('strictly parses explicit match categories, protection tags, and bypass tags', () => {
    const parsed = parseAbilityDefenseProviders([
      fireImmunity(),
      bypass('mold-breaker', ['immunity'], ['typed-fire-immunity']),
    ])
    expect(parsed).toHaveLength(2)
    expect(Object.isFrozen(parsed[0]?.effect)).toBe(true)
    expect(() => parseAbilityDefenseProviders([{
      ...fireImmunity(), proseException: 'unless ignored',
    }])).toThrowError(AbilityDefenseProviderValidationError)
    expect(() => parseAbilityDefenseProviders([
      bypass('implicit-bypass', ['immunity'], []),
    ])).toThrowError(/explicitly name/)
  })

  it('grants typed immunity and retains exact provider evidence', () => {
    const result = resolveAbilityDefenseProviders({ providers: [fireImmunity()], fact, relation })
    expect(result).toMatchObject({
      immune: true, immunityProviderIds: ['fire-immunity'],
      finalTypeMultiplier: 0, damagePrevented: true,
    })
    expect(result.trace).toContainEqual(expect.objectContaining({
      providerId: 'fire-immunity', status: 'applied', protectionTag: 'typed-fire-immunity',
    }))
  })

  it('allows only an explicit matching bypass kind and protection tag', () => {
    const applied = resolveAbilityDefenseProviders({
      providers: [fireImmunity(), bypass('mold-breaker', ['immunity'], ['typed-fire-immunity'])],
      fact, relation,
    })
    expect(applied).toMatchObject({
      immune: false, bypassedProviderIds: ['fire-immunity'], finalTypeMultiplier: 1.5,
    })
    const wrongTag = resolveAbilityDefenseProviders({
      providers: [fireImmunity(), bypass('wrong-bypass', ['immunity'], ['other-immunity'])],
      fact, relation,
    })
    expect(wrongTag.immune).toBe(true)
    const wrongKind = resolveAbilityDefenseProviders({
      providers: [fireImmunity(), bypass('wrong-kind', ['resistance'], ['typed-fire-immunity'])],
      fact, relation,
    })
    expect(wrongKind.immune).toBe(true)
  })

  it('composes resistance and vulnerability as ordered PTU effectiveness steps', () => {
    const providers = [
      provider('fire-resistance', {
        kind: 'resistance', category: 'move-type', value: 'fire', steps: 2,
        protectionTag: 'typed-fire-resistance',
      }),
      provider('ranged-vulnerability', {
        kind: 'vulnerability', category: 'keyword', value: 'ranged', steps: 1,
        protectionTag: 'ranged-vulnerability',
      }, {
        abilityInstanceId: 'base:actor:0', canonicalId: 'Mold Breaker', sourcePlacementId: 'actor',
        subject: 'actor', relation: 'self',
      }),
    ]
    const result = resolveAbilityDefenseProviders({ providers, fact, relation })
    expect(result).toMatchObject({
      baseTypeMultiplier: 1.5, resistanceSteps: 2, vulnerabilitySteps: 1,
      finalTypeMultiplier: 1,
    })
    const bypassed = resolveAbilityDefenseProviders({
      providers: [...providers, bypass('resistance-bypass', ['resistance'], ['typed-fire-resistance'])],
      fact, relation,
    })
    expect(bypassed).toMatchObject({ resistanceSteps: 0, vulnerabilitySteps: 1, finalTypeMultiplier: 2 })
    expect(bypassed.bypassedProviderIds).toEqual(['fire-resistance'])
  })

  it('protects typed effect categories without pretending non-damage protection is damage immunity', () => {
    const protection = provider('condition-ward', {
      kind: 'protection', categories: ['condition'], protectionTag: 'condition-ward',
    })
    const condition = resolveAbilityDefenseProviders({
      providers: [protection], fact: { ...fact, effectCategory: 'condition' }, relation,
    })
    expect(condition).toMatchObject({ protected: true, damagePrevented: false })
    const damage = resolveAbilityDefenseProviders({ providers: [protection], fact, relation })
    expect(damage.protected).toBe(false)
    const bypassed = resolveAbilityDefenseProviders({
      providers: [protection, bypass('ward-bypass', ['protection'], ['condition-ward'])],
      fact: { ...fact, effectCategory: 'condition' }, relation,
    })
    expect(bypassed.protected).toBe(false)
    expect(bypassed.bypassedProviderIds).toEqual(['condition-ward'])
  })

  it('uses deterministic highest stacking and exposes shadowed sources', () => {
    const low = provider('resistance-low', {
      kind: 'resistance', category: 'all-damage', value: null, steps: 1, protectionTag: 'all-resistance',
    }, { stackingGroup: 'resistance.shared', stackingPolicy: 'highest' })
    const high = provider('resistance-high', {
      kind: 'resistance', category: 'all-damage', value: null, steps: 3, protectionTag: 'all-resistance',
    }, { stackingGroup: 'resistance.shared', stackingPolicy: 'highest' })
    const result = resolveAbilityDefenseProviders({ providers: [low, high], fact, relation })
    expect(result.resistanceSteps).toBe(3)
    expect(result.trace).toContainEqual(expect.objectContaining({
      providerId: 'resistance-low', status: 'shadowed',
    }))
    expect(() => resolveAbilityDefenseProviders({
      providers: [low, { ...high, stackingPolicy: 'stack' }], fact, relation,
    })).toThrowError(/disagree on stacking policy/)
  })

  it('authorizes every source and replaces untrusted multiplier with target type facts', () => {
    const result = resolveAuthoritativeAbilityDefenseProviders({
      context: context(), providers: [fireImmunity()], fact: { ...fact, baseTypeMultiplier: 99 },
    })
    expect(result.baseTypeMultiplier).toBe(1.5)
    expect(result.immune).toBe(true)
    expect(() => resolveAuthoritativeAbilityDefenseProviders({
      context: context(false), providers: [fireImmunity()], fact,
    })).toThrowError(AuthoritativeAbilityDefenseProviderError)
  })

  it('lets exact Mold Breaker authority omit an enemy Defensive provider', () => {
    const result = resolveAuthoritativeAbilityDefenseProviders({
      context: context(true, ['Grass'], true), providers: [fireImmunity()], fact,
    })
    expect(result.immune).toBe(false)
    expect(result.immunityProviderIds).toEqual([])
  })

  it('does not let ability bypass erase an unrelated type-chart immunity', () => {
    const electricFact: AbilityDefenseFact = {
      ...fact, moveType: 'electric', baseTypeMultiplier: 0,
    }
    const result = resolveAuthoritativeAbilityDefenseProviders({
      context: context(true, ['Ground'], true),
      providers: [bypass('immunity-bypass', ['immunity'], ['typed-fire-immunity'])],
      fact: electricFact,
    })
    expect(result).toMatchObject({
      immune: false, baseTypeMultiplier: 0, finalTypeMultiplier: 0, damagePrevented: true,
    })
  })
})
