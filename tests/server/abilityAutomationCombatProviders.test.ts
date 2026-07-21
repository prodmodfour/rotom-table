import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import {
  applyAuthoritativeAbilityCombatDamage,
  AuthoritativeAbilityCombatProviderError,
  resolveAuthoritativeAbilityCombatProviders,
} from '../../server/domain/abilityAutomation/combatProviders'
import {
  AbilityCombatProviderValidationError,
  applyAbilityCombatDamageProviders,
  parseAbilityCombatProviders,
  resolveAbilityCombatProviders,
  type AbilityCombatProviderEffect,
  type AbilityCombatProviderFact,
} from '#shared/abilityAutomation/combatProviders'

const predicate = (overrides: Record<string, unknown> = {}) => ({
  moveIds: [], moveTypes: [], damageClasses: [], requiredKeywords: [], excludedKeywords: [],
  requiresStab: null,
  ...overrides,
})
const provider = (
  providerId: string,
  effect: AbilityCombatProviderEffect,
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  providerId,
  abilityInstanceId: 'base:actor:0',
  canonicalId: 'Blaze',
  sourcePlacementId: 'actor',
  subject: 'actor',
  relation: 'self',
  predicate: predicate(),
  effect,
  stackingGroup: `group.${providerId}`,
  stackingPolicy: effect.kind === 'damage' || effect.kind === 'damage-base' ? 'stack' : 'priority',
  priority: 0,
  reasonCode: `ability.${providerId}`,
  ...overrides,
})
const fact: AbilityCombatProviderFact = {
  actorPlacementId: 'actor', targetPlacementId: 'target', moveId: 'Tackle',
  moveType: 'normal', actorTypeIds: ['fire'], damageClass: 'physical', keywords: ['contact'],
  baseDamageBase: 5, baseHasStab: false, standardStabDamageBaseBonus: 2,
  baseAccuracyModifier: 0, baseCriticalMinimum: 20,
  naturalAccuracyRoll: 12, naturalCriticalRoll: 18,
}
const relation = (left: string, right: string): 'self' | 'ally' | 'enemy' | 'unknown' => (
  left === right ? 'self' : 'enemy'
)
const fullProviders = () => [
  provider('type-fire', { kind: 'move-type', typeId: 'fire' }),
  provider('db-plus-two', { kind: 'damage-base', operation: 'add', value: 2 }, {
    predicate: predicate({ moveTypes: ['fire'] }),
  }),
  provider('damage-pre', { kind: 'damage', stage: 'pre-type', operation: 'add', value: 2 }),
  provider('damage-post', { kind: 'damage', stage: 'post-type', operation: 'multiply', value: 2 }),
  provider('damage-final', { kind: 'damage', stage: 'final', operation: 'add', value: 1 }),
  provider('accuracy-three', { kind: 'accuracy', operation: 'add', value: 3 }),
  provider('accuracy-auto', { kind: 'accuracy', operation: 'automatic-hit', value: null }),
  provider('critical-wide', { kind: 'critical', operation: 'widen', value: 2 }),
]
const context = (active = true): AuthoritativeAbilityContext => {
  const actor = { id: 'actor', sideId: 'red' }
  const target = { id: 'target', sideId: 'blue' }
  return {
    actor: { placement: actor }, targets: [{ placement: target }],
    queries: {
      placements: { get: (id: string) => id === 'actor' ? actor : id === 'target' ? target : null },
      tokens: {
        get: (id: string) => id === 'target'
          ? { id, defenderTypes: ['Grass'] }
          : id === 'actor' ? { id, defenderTypes: ['Fire'] } : null,
      },
      effectiveAbilities: {
        activeForPlacement: (id: string) => active && id === 'actor'
          ? [{ instanceId: 'base:actor:0', canonicalId: 'Blaze', effective: true }]
          : [],
      },
      relationships: { relation },
    },
  } as unknown as AuthoritativeAbilityContext
}

describe('ability damage, DB, type, STAB, Accuracy, and critical providers', () => {
  it('strictly parses closed bounded providers and rejects unknown mechanics', () => {
    const parsed = parseAbilityCombatProviders(fullProviders())
    expect(parsed).toHaveLength(8)
    expect(Object.isFrozen(parsed[0]?.predicate)).toBe(true)
    expect(() => parseAbilityCombatProviders([
      { ...fullProviders()[0], inferredFromProse: true },
    ])).toThrowError(AbilityCombatProviderValidationError)
    expect(() => parseAbilityCombatProviders([
      provider('bad-type-stack', { kind: 'move-type', typeId: 'fire' }, { stackingPolicy: 'stack' }),
    ])).toThrowError(/cannot use stack policy/)
  })

  it('resolves type before STAB and DB, then accuracy and critical in fixed order', () => {
    const resolution = resolveAbilityCombatProviders({ providers: fullProviders(), fact, relation })
    expect(resolution).toMatchObject({
      moveType: 'fire',
      stab: { base: false, effective: true, damageBaseBonus: 2 },
      damageBase: 9,
      accuracy: { modifier: 3, automaticHit: true, naturalRoll: 12 },
      critical: { minimum: 18, automatic: null, naturalRoll: 18, candidate: true },
    })
    expect(resolution.trace.filter(entry => entry.status === 'applied').map(entry => entry.effectKind))
      .toEqual(['move-type', 'damage-base', 'damage', 'damage', 'damage', 'accuracy', 'accuracy', 'critical'])
    expect(resolution.trace.find(entry => entry.providerId === 'db-plus-two')).toMatchObject({
      before: 7, after: 9,
    })
  })

  it('applies pre-type, effectiveness, post-type, and final damage without reordering', () => {
    const resolution = resolveAbilityCombatProviders({ providers: fullProviders(), fact, relation })
    const damage = applyAbilityCombatDamageProviders({
      baseDamage: 10, typeMultiplier: 1.5, resolution,
    })
    expect(damage).toMatchObject({
      baseDamage: 10, preTypeDamage: 12, typedDamage: 18,
      postTypeDamage: 36, finalDamage: 37,
    })
    expect(damage.modifiers.map(entry => entry.stage)).toEqual(['pre-type', 'post-type', 'final'])
  })

  it('evaluates predicates against phase-current type and reports scope/predicate failures', () => {
    const providers = [
      provider('type-fire', { kind: 'move-type', typeId: 'fire' }),
      provider('fire-db', { kind: 'damage-base', operation: 'add', value: 1 }, {
        predicate: predicate({ moveTypes: ['fire'], requiredKeywords: ['contact'] }),
      }),
      provider('water-only', { kind: 'accuracy', operation: 'add', value: 99 }, {
        predicate: predicate({ moveTypes: ['water'] }),
      }),
      provider('target-self', { kind: 'accuracy', operation: 'add', value: 99 }, {
        subject: 'target', relation: 'self',
      }),
    ]
    const resolution = resolveAbilityCombatProviders({ providers, fact, relation })
    expect(resolution.damageBase).toBe(8)
    expect(resolution.accuracy.modifier).toBe(0)
    expect(resolution.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'water-only', status: 'predicate-false' }),
      expect.objectContaining({ providerId: 'target-self', status: 'scope-false' }),
    ]))
  })

  it('resolves highest/priority stacking deterministically and rejects conflicting policy', () => {
    const low = provider('accuracy-low', { kind: 'accuracy', operation: 'add', value: 2 }, {
      stackingGroup: 'accuracy.shared', stackingPolicy: 'highest', priority: 0,
    })
    const high = provider('accuracy-high', { kind: 'accuracy', operation: 'add', value: 4 }, {
      stackingGroup: 'accuracy.shared', stackingPolicy: 'highest', priority: 0,
    })
    const resolution = resolveAbilityCombatProviders({ providers: [low, high], fact, relation })
    expect(resolution.accuracy.modifier).toBe(4)
    expect(resolution.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: 'accuracy-low', status: 'shadowed' }),
      expect.objectContaining({ providerId: 'accuracy-high', status: 'applied' }),
    ]))
    expect(() => resolveAbilityCombatProviders({
      providers: [low, { ...high, stackingPolicy: 'priority' }], fact, relation,
    })).toThrowError(/disagree on stacking policy/)
  })

  it('authorizes source instances and recomputes effectiveness from target types', () => {
    const resolution = resolveAuthoritativeAbilityCombatProviders({
      context: context(), providers: fullProviders(), fact,
    })
    const damage = applyAuthoritativeAbilityCombatDamage({
      context: context(), targetPlacementId: 'target', baseDamage: 10, resolution,
    })
    expect(damage.typeMultiplier).toBe(1.5)
    expect(damage.finalDamage).toBe(37)
    expect(() => resolveAuthoritativeAbilityCombatProviders({
      context: context(false), providers: fullProviders(), fact,
    })).toThrowError(AuthoritativeAbilityCombatProviderError)
  })

  it('supports explicit STAB suppression, bonus, critical always/never, and DB bounds', () => {
    const resolution = resolveAbilityCombatProviders({
      providers: [
        provider('stab-suppress', { kind: 'stab', operation: 'suppress', value: null }),
        provider('stab-bonus', { kind: 'stab', operation: 'bonus', value: 3 }),
        provider('db-max', { kind: 'damage-base', operation: 'maximum', value: 6 }),
        provider('critical-always', { kind: 'critical', operation: 'always', value: null }),
      ],
      fact: { ...fact, baseHasStab: true, naturalCriticalRoll: 1 }, relation,
    })
    expect(resolution.stab).toEqual({ base: true, effective: false, damageBaseBonus: 0 })
    expect(resolution.damageBase).toBe(5)
    expect(resolution.critical).toMatchObject({ automatic: 'always', candidate: true })
  })
})
