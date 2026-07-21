import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  AuthoritativeAbilityHpProviderError,
  resolveAuthoritativeAbilityHpDamageProviders,
  resolveAuthoritativeAbilityHpRecoveryProviders,
} from '../../server/domain/abilityAutomation/hpProviders'
import {
  AbilityHpProviderValidationError,
  parseAbilityHpProviders,
  resolveAbilityHpDamageProviders,
  resolveAbilityHpRecoveryProviders,
  type AbilityHpDamageFact,
  type AbilityHpProviderEffect,
} from '#shared/abilityAutomation/hpProviders'

const predicate = (overrides: Record<string, unknown> = {}) => ({
  damageKinds: [], moveTypes: [], requiredKeywords: [], excludedKeywords: [], requiresCritical: null,
  ...overrides,
})
const provider = (
  providerId: string,
  subject: 'actor' | 'target',
  effect: AbilityHpProviderEffect,
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  providerId,
  abilityInstanceId: `base:${subject}:0`,
  canonicalId: 'Blaze',
  sourcePlacementId: subject,
  subject,
  relation: 'self',
  predicate: predicate(),
  effect,
  stackingGroup: `group.${providerId}`,
  stackingPolicy: ['damage-prevention', 'drain', 'recoil', 'injury'].includes(effect.kind) ? 'stack' : 'stack',
  priority: 0,
  reasonCode: `ability.${providerId}`,
  ...overrides,
})
const relation = (left: string, right: string): 'self' | 'ally' | 'enemy' | 'unknown' => (
  left === right ? 'self' : 'enemy'
)
const fact: AbilityHpDamageFact = {
  actor: { placementId: 'actor', currentHp: 50, maximumHp: 100, temporaryHp: 5, injuries: 0 },
  target: { placementId: 'target', currentHp: 30, maximumHp: 40, temporaryHp: 8, injuries: 2 },
  attemptedDamage: 20,
  damageKind: 'normal',
  moveType: 'fire',
  keywords: ['ranged'],
  critical: false,
  hit: true,
  externalPrevented: false,
  temporaryHpPolicy: 'absorb',
  baseTargetInjuryDelta: 1,
}
const providers = () => [
  provider('target-dr', 'target', {
    kind: 'damage-reduction', operation: 'add', value: 5, minimumDamage: 0,
  }),
  provider('actor-drain', 'actor', {
    kind: 'drain', basis: 'hp-damage', numerator: 1, denominator: 2, minimum: 0,
    trigger: 'on-damage',
  }),
  provider('actor-healing', 'actor', {
    kind: 'healing', operation: 'multiply', value: 2,
  }),
  provider('actor-recoil', 'actor', {
    kind: 'recoil', basis: 'total-damage', numerator: 1, denominator: 2,
    minimum: 0, temporaryHpPolicy: 'bypass', trigger: 'on-damage',
  }),
]
const context = (active = true): AuthoritativeAbilityContext => {
  const actor = { id: 'actor' }
  const target = { id: 'target' }
  return {
    actor: { placement: actor }, targets: [{ placement: target }],
    queries: {
      placements: { get: (id: string) => id === 'actor' ? actor : id === 'target' ? target : null },
      tokens: {
        get: (id: string) => id === 'actor'
          ? { id, currentHp: 50, maxHp: 100, temporaryHp: 5, injuries: 0 }
          : id === 'target'
            ? { id, currentHp: 30, maxHp: 40, temporaryHp: 8, injuries: 2 }
            : null,
      },
      effectiveAbilities: {
        activeForPlacement: (id: string) => active && (id === 'actor' || id === 'target')
          ? [{ instanceId: `base:${id}:0`, canonicalId: 'Blaze', effective: true }]
          : [],
      },
      relationships: { relation },
    },
  } as unknown as AuthoritativeAbilityContext
}

describe('ability HP, temporary HP, drain, recoil, Injury, and DR providers', () => {
  it('strictly validates typed ratios, damage kinds, and provider shapes', () => {
    const parsed = parseAbilityHpProviders(providers())
    expect(parsed).toHaveLength(4)
    expect(Object.isFrozen(parsed[0]?.effect)).toBe(true)
    expect(() => parseAbilityHpProviders([{
      ...providers()[0], inferFromDescription: true,
    }])).toThrowError(AbilityHpProviderValidationError)
    expect(() => parseAbilityHpProviders([
      provider('bad-ratio', 'actor', {
        kind: 'drain', basis: 'hp-damage', numerator: 1, denominator: 0, minimum: 0,
        trigger: 'on-damage',
      }),
    ])).toThrowError(/from 1 through/)
  })

  it('orders DR, temporary HP, HP damage, drain, healing modifiers, then recoil', () => {
    const result = resolveAbilityHpDamageProviders({ providers: providers(), fact, relation })
    expect(result).toMatchObject({
      attemptedDamage: 20,
      prevented: false,
      reduction: 5,
      damageAfterReduction: 15,
      temporaryHpAbsorbed: 8,
      hpDamage: 7,
      drainHealing: 6,
      recoilDamage: 7,
      target: {
        currentHp: 23, temporaryHp: 0, hpDelta: -7, temporaryHpDelta: -8,
        injuries: 3, injuryDelta: 1, fainted: false,
      },
      actor: {
        currentHp: 49, temporaryHp: 5, hpDelta: -1, temporaryHpDelta: 0,
      },
    })
    expect(result.trace.filter(entry => entry.status === 'applied').map(entry => entry.effectKind))
      .toEqual(['damage-reduction', 'drain', 'healing', 'recoil'])
  })

  it('lets direct HP loss bypass DR and explicitly controls temporary HP', () => {
    const result = resolveAbilityHpDamageProviders({
      providers: [providers()[0]!],
      fact: { ...fact, damageKind: 'direct-hp-loss', temporaryHpPolicy: 'bypass' },
      relation,
    })
    expect(result).toMatchObject({
      reduction: 0, damageAfterReduction: 20, temporaryHpAbsorbed: 0, hpDamage: 20,
      target: { currentHp: 10, temporaryHp: 8 },
    })
  })

  it('supports prevention, minimum damage, and reviewed HP floors', () => {
    const prevented = resolveAbilityHpDamageProviders({
      providers: [provider('prevent-indirect', 'target', { kind: 'damage-prevention' }, {
        predicate: predicate({ damageKinds: ['indirect'] }),
      })],
      fact: { ...fact, damageKind: 'indirect' }, relation,
    })
    expect(prevented).toMatchObject({ prevented: true, hpDamage: 0, temporaryHpAbsorbed: 0 })

    const floored = resolveAbilityHpDamageProviders({
      providers: [
        provider('large-dr', 'target', {
          kind: 'damage-reduction', operation: 'add', value: 100, minimumDamage: 1,
        }),
        provider('sturdy-floor', 'target', { kind: 'hp-floor', floor: 1 }),
      ],
      fact: { ...fact, attemptedDamage: 100, temporaryHpPolicy: 'bypass' }, relation,
    })
    expect(floored).toMatchObject({
      damageAfterReduction: 1, hpDamage: 1, target: { currentHp: 29 },
    })
    const fatalFloor = resolveAbilityHpDamageProviders({
      providers: [provider('sturdy-floor', 'target', { kind: 'hp-floor', floor: 1 })],
      fact: { ...fact, attemptedDamage: 100, temporaryHpPolicy: 'bypass' }, relation,
    })
    expect(fatalFloor.target).toMatchObject({ currentHp: 1, hpDelta: -29, fainted: false })
  })

  it('adds or prevents Injury only when its reviewed trigger is met', () => {
    const result = resolveAbilityHpDamageProviders({
      providers: [
        provider('massive-injury', 'target', {
          kind: 'injury', operation: 'add', value: 2, trigger: 'massive-damage',
        }),
        provider('injury-guard', 'target', {
          kind: 'injury', operation: 'prevent', value: 1, trigger: 'always',
        }),
      ],
      fact: { ...fact, attemptedDamage: 25, temporaryHpPolicy: 'bypass' }, relation,
    })
    expect(result.target).toMatchObject({ injuries: 4, injuryDelta: 2 })
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'massive-injury', status: 'applied' }),
      expect.objectContaining({ providerId: 'injury-guard', status: 'applied' }),
    ]))
  })

  it('distinguishes on-hit, on-damage, and always side-effect triggers', () => {
    const result = resolveAbilityHpDamageProviders({
      providers: [
        provider('hit-recoil', 'actor', {
          kind: 'recoil', basis: 'source-max-hp', numerator: 1, denominator: 10,
          minimum: 0, temporaryHpPolicy: 'bypass', trigger: 'on-hit',
        }),
        provider('damage-drain', 'actor', {
          kind: 'drain', basis: 'hp-damage', numerator: 1, denominator: 2,
          minimum: 0, trigger: 'on-damage',
        }),
      ],
      fact: { ...fact, externalPrevented: true, hit: true },
      relation,
    })
    expect(result).toMatchObject({ hpDamage: 0, drainHealing: 0, recoilDamage: 10 })
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'damage-drain', status: 'predicate-false' }),
      expect.objectContaining({ providerId: 'hit-recoil', status: 'applied' }),
    ]))
  })

  it('modifies healing and applies non-stacking temporary HP', () => {
    const pool = { placementId: 'target', currentHp: 10, maximumHp: 40, temporaryHp: 10, injuries: 1 }
    const result = resolveAbilityHpRecoveryProviders({
      providers: [
        provider('healing-half-again', 'target', { kind: 'healing', operation: 'multiply', value: 1.5 }),
        provider('temp-plus-three', 'target', { kind: 'temporary-hp', operation: 'add', value: 3 }),
      ],
      pool,
      baseHealing: 10,
      baseTemporaryHpGrant: 5,
      fact: {
        damageKind: 'normal', moveType: null, keywords: [], critical: false, hit: true,
        externalPrevented: false, temporaryHpPolicy: 'absorb',
      },
      relation,
    })
    expect(result).toMatchObject({
      effectiveHealing: 15, appliedHealing: 15,
      effectiveTemporaryHpGrant: 8, resultingTemporaryHp: 10,
      pool: { currentHp: 25, temporaryHp: 10 },
    })
  })

  it('authorizes sources and replaces forged HP pools with authoritative token facts', () => {
    const result = resolveAuthoritativeAbilityHpDamageProviders({
      context: context(), providers: providers(),
      fact: {
        actorPlacementId: 'actor', targetPlacementId: 'target', attemptedDamage: 20,
        damageKind: 'normal', moveType: 'fire', keywords: ['ranged'], critical: false, hit: true,
        externalPrevented: false, temporaryHpPolicy: 'absorb', baseTargetInjuryDelta: 1,
      },
    })
    expect(result.target.beforeCurrentHp).toBe(30)
    expect(result.actor.beforeCurrentHp).toBe(50)
    expect(() => resolveAuthoritativeAbilityHpDamageProviders({
      context: context(false), providers: providers(),
      fact: {
        actorPlacementId: 'actor', targetPlacementId: 'target', attemptedDamage: 20,
        damageKind: 'normal', moveType: 'fire', keywords: ['ranged'], critical: false, hit: true,
        externalPrevented: false, temporaryHpPolicy: 'absorb', baseTargetInjuryDelta: 1,
      },
    })).toThrowError(AuthoritativeAbilityHpProviderError)
  })

  it('authoritatively resolves direct recovery recipients', () => {
    const result = resolveAuthoritativeAbilityHpRecoveryProviders({
      context: context(),
      providers: [provider('target-heal', 'target', { kind: 'healing', operation: 'add', value: 5 })],
      placementId: 'target', baseHealing: 5, baseTemporaryHpGrant: 0,
      fact: {
        damageKind: 'normal', moveType: null, keywords: [], critical: false, hit: true,
        externalPrevented: false, temporaryHpPolicy: 'absorb',
      },
    })
    expect(result).toMatchObject({ appliedHealing: 10, pool: { currentHp: 40 } })
  })
})
