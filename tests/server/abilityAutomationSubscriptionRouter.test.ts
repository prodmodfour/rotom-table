import { describe, expect, it } from 'vitest'
import type { AuthoritativeEffectiveAbility } from '../../server/domain/abilityAutomation/context'
import type {
  AbilityAutomationRuntimeRegistry,
  AbilitySpecV1Runtime,
} from '../../server/domain/abilityAutomation/registry'
import {
  AbilitySubscriptionRouterError,
  createAbilitySubscriptionPredicateRegistry,
  routeAbilityEventSubscriptions,
} from '../../server/domain/abilityAutomation/subscriptionRouter'

const HASH = 'a'.repeat(64)

const effective = (
  instanceId: string,
  active = true,
  definitionHash: string | null = null,
): AuthoritativeEffectiveAbility => ({
  instanceId,
  canonicalId: 'Moxie',
  sourceKind: 'base',
  sourcePlacementId: instanceId.includes('a') ? 'actor-a' : 'actor-b',
  definitionHash,
  effective: active,
  suppressionReasonCode: active ? null : 'ability.suppressed.all',
  parameterStatus: 'not-parameterized',
  parameterData: null,
})

const runtime = (): AbilitySpecV1Runtime => ({
  canonicalId: 'Moxie',
  kind: 'abilityspec-v1',
  version: 1,
  definitionHash: HASH,
  sourceModule: 'server/domain/abilityAutomation/specs/moxie.ts',
  definition: {
    spec: {
      canonicalId: 'Moxie',
      subscriptions: [
        {
          id: 'subscription-owner',
          modeId: 'mode-triggered',
          eventKind: 'action',
          checkpoint: 'after-commit',
          response: 'optional',
          priority: 20,
          oncePerCausalChain: true,
          predicate: { kind: 'owner-match' },
        },
        {
          id: 'subscription-all',
          modeId: 'mode-triggered',
          eventKind: 'action',
          checkpoint: 'after-commit',
          response: 'mandatory',
          priority: 10,
          oncePerCausalChain: false,
          predicate: null,
        },
        {
          id: 'subscription-unavailable',
          modeId: 'mode-triggered',
          eventKind: 'action',
          checkpoint: 'after-commit',
          response: 'optional',
          priority: 30,
          oncePerCausalChain: false,
          predicate: { kind: 'missing-evaluator' },
        },
        {
          id: 'subscription-hp',
          modeId: 'mode-triggered',
          eventKind: 'hp',
          checkpoint: 'after-commit',
          response: 'optional',
          priority: 5,
          oncePerCausalChain: false,
          predicate: null,
        },
        {
          id: 'subscription-pre-effect',
          modeId: 'mode-triggered',
          eventKind: 'action',
          checkpoint: 'pre-effect',
          response: 'optional',
          priority: 5,
          oncePerCausalChain: false,
          predicate: null,
        },
      ],
    },
    extensionReferences: [
      { family: 'predicate', kind: 'owner-match', version: 1 },
      { family: 'predicate', kind: 'missing-evaluator', version: 1 },
    ],
  },
} as unknown as AbilitySpecV1Runtime)

const registry = (value: AbilitySpecV1Runtime | null = runtime()): AbilityAutomationRuntimeRegistry => ({
  size: value ? 1 : 0,
  extensionRegistry: {} as never,
  handlerRegistry: {} as never,
  resolve: canonicalId => canonicalId === 'Moxie' ? value : null,
  entries: () => value ? [value] : [],
})

const actionEvent = () => ({
  schemaVersion: 1,
  eventId: 'event.action.1',
  kind: 'action',
  sequence: 1,
  mapSlug: 'route-arena',
  mapRevision: 9,
  sceneId: 'scene.one',
  occurredAt: 1_000,
  actorPlacementId: 'actor-b',
  sourceResolutionId: 'resolution.move',
  parentEventId: null,
  payload: {
    actionKind: 'move',
    actionId: 'move.tackle',
    timing: 'completed',
    outcome: 'applied',
    targetPlacementIds: ['target-token'],
    tags: ['damaging'],
  },
})

const predicateRegistry = () => createAbilitySubscriptionPredicateRegistry([{
  kind: 'owner-match',
  version: 1,
  evaluate: context => context.ownerPlacementId === context.event.actorPlacementId,
}])

const route = (overrides: Partial<Parameters<typeof routeAbilityEventSubscriptions>[0]> = {}) => (
  routeAbilityEventSubscriptions({
    event: actionEvent(),
    checkpoint: 'after-commit',
    mapSlug: 'route-arena',
    mapRevision: 9,
    placements: [
      { placementId: 'actor-b', effectiveAbilities: [effective('base:actor-b:0')] },
      { placementId: 'actor-a', effectiveAbilities: [effective('base:actor-a:0')] },
    ],
    runtimeRegistry: registry(),
    predicateRegistry: predicateRegistry(),
    ...overrides,
  })
)

describe('deterministic ability subscription routing', () => {
  it('matches event/checkpoint and current effective abilities in stable priority order', () => {
    const result = route()

    expect(result.routes.map(candidate => [
      candidate.subscriptionId,
      candidate.ownerPlacementId,
      candidate.priority,
    ])).toEqual([
      ['subscription-owner', 'actor-b', 20],
      ['subscription-all', 'actor-a', 10],
      ['subscription-all', 'actor-b', 10],
    ])
    expect(result.stats).toEqual({
      effectiveInstances: 2,
      nativeRuntimes: 2,
      subscriptionsConsidered: 10,
      eventKindRejected: 2,
      checkpointRejected: 2,
      predicateRejected: 1,
      predicateUnavailable: 2,
      routes: 3,
    })
    expect(Object.isFrozen(result.routes)).toBe(true)
  })

  it('is independent of placement and ability input ordering', () => {
    const forward = route()
    const reverse = route({ placements: [
      {
        placementId: 'actor-a',
        effectiveAbilities: [effective('base:actor-a:1', false), effective('base:actor-a:0')],
      },
      { placementId: 'actor-b', effectiveAbilities: [effective('base:actor-b:0')] },
    ] })

    expect(reverse.routes).toEqual(forward.routes)
  })

  it('routes only exact manifest-selected runtime and definition identity', () => {
    expect(route({ runtimeRegistry: registry(null) }).routes).toEqual([])
    expect(route({ placements: [{
      placementId: 'actor-a',
      effectiveAbilities: [effective('base:actor-a:0', true, 'b'.repeat(64))],
    }] }).routes).toEqual([])
    expect(route({ placements: [{
      placementId: 'actor-a',
      effectiveAbilities: [effective('base:actor-a:0', false)],
    }] }).routes).toEqual([])
  })

  it('fails unavailable or throwing predicate evaluators closed', () => {
    const throwing = createAbilitySubscriptionPredicateRegistry([{
      kind: 'owner-match',
      version: 1,
      evaluate: () => { throw new Error('no') },
    }])
    const result = route({ predicateRegistry: throwing })

    expect(result.routes.every(candidate => candidate.subscriptionId !== 'subscription-owner')).toBe(true)
    expect(result.stats.predicateRejected).toBe(2)
  })

  it('rejects stale map facts, duplicate placements/instances, and invalid checkpoints', () => {
    expect(() => route({ mapRevision: 10 })).toThrowError(
      expect.objectContaining({ code: 'map-identity-mismatch' }),
    )
    expect(() => route({ placements: [
      { placementId: 'actor-a', effectiveAbilities: [] },
      { placementId: 'actor-a', effectiveAbilities: [] },
    ] })).toThrowError(expect.objectContaining({ code: 'duplicate-placement-id' }))
    expect(() => route({ placements: [{
      placementId: 'actor-a',
      effectiveAbilities: [effective('same'), effective('same')],
    }] })).toThrowError(expect.objectContaining({ code: 'duplicate-ability-instance' }))
    expect(() => route({ checkpoint: 'unknown' as never })).toThrow(AbilitySubscriptionRouterError)
  })

  it('builds a bounded duplicate-safe predicate evaluator registry', () => {
    expect(predicateRegistry().entries().map(entry => entry.kind)).toEqual(['owner-match'])
    expect(() => createAbilitySubscriptionPredicateRegistry([
      { kind: 'same', version: 1, evaluate: () => true },
      { kind: 'same', version: 1, evaluate: () => true },
    ])).toThrowError(expect.objectContaining({ code: 'duplicate-predicate-kind' }))
  })
})
