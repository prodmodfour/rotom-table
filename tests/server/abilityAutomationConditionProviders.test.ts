import { describe, expect, it } from 'vitest'
import type { AuthoritativeAbilityContext } from '../../server/domain/abilityAutomation/context'
import { resolveAuthoritativeAbilityConditionProviders } from '../../server/domain/abilityAutomation/conditionProviders'
import {
  AbilityConditionProviderValidationError,
  parseAbilityConditionProviders,
  requiredAbilityConditionSaves,
  resolveAbilityConditionProviders,
  type AbilityConditionFact,
  type AbilityConditionProviderEffect,
} from '#shared/abilityAutomation/conditionProviders'
import { createAuthoritativeAbilityRandom, createFiniteAuthoritativeAbilityRandomStream } from '../../server/domain/abilityAutomation/random'
import { createAbilityExecutionBudget } from '../../server/domain/abilityAutomation/executionBudget'

const saveDefinition = () => ({
  kind: 'ability-check',
  checkId: 'save.poison',
  checkKind: 'save',
  parentEffectId: 'operation.poison-save',
  formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  modifiers: [],
  threshold: { comparison: 'at-least', value: 11 },
  reroll: { trigger: 'on-failure', selection: 'highest', maximumRerolls: 0, sources: [] },
})
const predicate = (overrides: Record<string, unknown> = {}) => ({
  operations: [], conditionIds: [], requiredSourceTags: [], excludedSourceTags: [],
  ...overrides,
})
const provider = (
  providerId: string,
  effect: AbilityConditionProviderEffect | Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  providerId,
  abilityInstanceId: 'base:target:0',
  canonicalId: 'Shed Skin',
  sourcePlacementId: 'target',
  subject: 'target',
  relation: 'self',
  predicate: predicate(),
  effect,
  stackingGroup: `group.${providerId}`,
  stackingPolicy: 'union',
  priority: 0,
  reasonCode: `ability.${providerId}`,
  ...overrides,
})
const fact = (overrides: Partial<AbilityConditionFact> = {}): AbilityConditionFact => ({
  operationId: 'operation.condition',
  actorPlacementId: 'actor',
  targetPlacementId: 'target',
  operation: 'apply',
  conditionId: 'poisoned',
  sourceTags: ['move'],
  actorConditions: [],
  targetConditions: ['burned', 'cursed'],
  saveResolutions: [],
  ...overrides,
})
const relation = (left: string, right: string): 'self' | 'ally' | 'enemy' | 'unknown' => (
  left === right ? 'self' : 'enemy'
)
const context = (rolls: readonly number[] = [0.9]): AuthoritativeAbilityContext => {
  const actor = { id: 'actor' }
  const target = { id: 'target' }
  return {
    resolutionId: 'resolution.condition-one',
    actor: { placement: actor }, targets: [{ placement: target }],
    random: createAuthoritativeAbilityRandom(createFiniteAuthoritativeAbilityRandomStream(rolls)),
    budget: createAbilityExecutionBudget(),
    queries: {
      placements: { get: (id: string) => id === 'actor' ? actor : id === 'target' ? target : null },
      tokens: {
        get: (id: string) => id === 'actor'
          ? { id, conditions: [] }
          : id === 'target' ? { id, conditions: ['Burned', 'Cursed'] } : null,
      },
      effectiveAbilities: {
        activeForPlacement: (id: string) => id === 'target'
          ? [{ instanceId: 'base:target:0', canonicalId: 'Shed Skin', effective: true }]
          : [],
      },
      relationships: { relation },
    },
  } as unknown as AuthoritativeAbilityContext
}

describe('ability condition, save, cure, prevention, reflection, and transfer providers', () => {
  it('strictly parses condition effects and threshold-bearing saves', () => {
    const parsed = parseAbilityConditionProviders([
      provider('poison-save', { kind: 'save', definition: saveDefinition() }),
      provider('poison-prevention', { kind: 'prevention', conditionIds: ['poisoned'] }),
    ])
    expect(parsed).toHaveLength(2)
    expect(Object.isFrozen(parsed[0]?.effect)).toBe(true)
    expect(() => parseAbilityConditionProviders([{
      ...provider('bad', { kind: 'prevention', conditionIds: ['poisoned'] }),
      inferredException: true,
    }])).toThrowError(AbilityConditionProviderValidationError)
    expect(() => parseAbilityConditionProviders([
      provider('contest-not-save', {
        kind: 'save',
        definition: {
          ...saveDefinition(), checkKind: 'contest', threshold: null,
          reroll: { trigger: 'always', selection: 'replace', maximumRerolls: 0, sources: [] },
        },
      }),
    ])).toThrowError(/threshold-bearing save/)
  })

  it('prevents a matching condition before any base mutation', () => {
    const result = resolveAbilityConditionProviders({
      providers: [provider('poison-prevention', {
        kind: 'prevention', conditionIds: ['poisoned'],
      })],
      fact: fact(), relation,
    })
    expect(result).toMatchObject({
      outcome: 'prevented', preventionProviderIds: ['poison-prevention'],
      actorConditions: [], targetConditions: ['burned', 'cursed'],
    })
  })

  it('reflects application with explicit prevent or retain target policy', () => {
    const reflected = resolveAbilityConditionProviders({
      providers: [provider('poison-reflect', {
        kind: 'reflection', conditionIds: ['poisoned'], destination: 'actor', targetPolicy: 'prevent',
      })],
      fact: fact(), relation,
    })
    expect(reflected).toMatchObject({
      outcome: 'reflected', actorConditions: ['poisoned'], targetConditions: ['burned', 'cursed'],
      emissions: [{
        providerId: 'poison-reflect', kind: 'reflected', conditionId: 'poisoned',
        fromPlacementId: 'target', toPlacementId: 'actor',
      }],
    })
    const retained = resolveAbilityConditionProviders({
      providers: [provider('poison-reflect-retain', {
        kind: 'reflection', conditionIds: ['poisoned'], destination: 'actor', targetPolicy: 'retain',
      })],
      fact: fact(), relation,
    })
    expect(retained.actorConditions).toContain('poisoned')
    expect(retained.targetConditions).toContain('poisoned')
  })

  it('handles base cure/transfer and provider cures/transfers without duplication', () => {
    const cured = resolveAbilityConditionProviders({
      providers: [provider('cure-cursed', { kind: 'cure', conditionIds: ['cursed'] })],
      fact: fact({ operation: 'cure', conditionId: 'burned' }), relation,
    })
    expect(cured).toMatchObject({ outcome: 'cured', targetConditions: [] })
    expect(cured.emissions).toContainEqual(expect.objectContaining({
      providerId: 'cure-cursed', kind: 'removed', conditionId: 'cursed',
    }))

    const transferred = resolveAbilityConditionProviders({
      providers: [provider('transfer-burn', {
        kind: 'transfer', conditionIds: ['burned'], direction: 'target-to-actor',
      })],
      fact: fact({ operation: 'transfer', conditionId: 'cursed' }), relation,
    })
    expect(transferred).toMatchObject({
      outcome: 'transferred', actorConditions: ['burned', 'cursed'], targetConditions: [],
    })
  })

  it('applies linked condition mutations after the authoritative base operation', () => {
    const result = resolveAbilityConditionProviders({
      providers: [provider('add-slow', {
        kind: 'condition', action: 'add', conditionIds: ['slowed'],
      })],
      fact: fact(), relation,
    })
    expect(result).toMatchObject({
      outcome: 'applied', targetConditions: ['burned', 'cursed', 'poisoned', 'slowed'],
    })
    expect(result.emissions).toContainEqual(expect.objectContaining({
      providerId: 'add-slow', kind: 'added', conditionId: 'slowed',
    }))
  })

  it('enumerates only eligible stacked/priority save definitions before entropy is consumed', () => {
    const applicable = provider('poison-save', { kind: 'save', definition: saveDefinition() }, {
      predicate: predicate({ operations: ['apply'], conditionIds: ['poisoned'] }),
    })
    const irrelevant = provider('burn-save', {
      kind: 'save', definition: { ...saveDefinition(), checkId: 'save.burn' },
    }, {
      predicate: predicate({ conditionIds: ['burned'] }),
    })
    expect(requiredAbilityConditionSaves({
      providers: [applicable, irrelevant], fact: fact(), relation,
    }).map(entry => entry.providerId)).toEqual(['poison-save'])
  })

  it('rolls saves from server entropy and prevents application only on success', () => {
    const save = provider('poison-save', { kind: 'save', definition: saveDefinition() }, {
      predicate: predicate({ conditionIds: ['poisoned'] }),
    })
    const serverContext = context([0.9])
    const result = resolveAuthoritativeAbilityConditionProviders({
      context: serverContext,
      providers: [save],
      fact: {
        operationId: 'operation.poison', actorPlacementId: 'actor', targetPlacementId: 'target',
        operation: 'apply', conditionId: 'poisoned', sourceTags: ['move'],
      },
    })
    expect(result.resolution).toMatchObject({
      outcome: 'saved', saveProviderIds: ['poison-save'], targetConditions: ['burned', 'cursed'],
    })
    expect(result.saves[0]).toMatchObject({
      providerId: 'poison-save', resolution: { checkId: 'save.poison', success: true },
    })
    expect(serverContext.random.complete()).toHaveLength(1)
  })

  it('does not roll an ineligible save and normalizes authoritative condition identities', () => {
    const save = provider('poison-save', { kind: 'save', definition: saveDefinition() }, {
      predicate: predicate({ conditionIds: ['poisoned'] }),
    })
    const serverContext = context([])
    const result = resolveAuthoritativeAbilityConditionProviders({
      context: serverContext,
      providers: [save],
      fact: {
        operationId: 'operation.burn', actorPlacementId: 'actor', targetPlacementId: 'target',
        operation: 'apply', conditionId: 'frozen', sourceTags: ['move'],
      },
    })
    expect(result.saves).toEqual([])
    expect(result.resolution).toMatchObject({
      outcome: 'applied', targetConditions: ['burned', 'cursed', 'frozen'],
    })
    expect(serverContext.random.complete()).toEqual([])
  })
})
