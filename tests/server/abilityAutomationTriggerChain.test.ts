import { describe, expect, it } from 'vitest'
import { createAbilityExecutionBudget, AbilityExecutionBudgetError } from '../../server/domain/abilityAutomation/executionBudget'
import {
  AbilityTriggerChainError,
  createAbilityTriggerChainCoordinator,
} from '../../server/domain/abilityAutomation/triggerChain'
import type { AbilitySubscriptionRoute } from '../../server/domain/abilityAutomation/subscriptionRouter'

const HASH = 'a'.repeat(64)
const route = (input: {
  eventId: string
  routeId: string
  canonicalId: string
  priority?: number
  ownerPlacementId?: string
  abilityInstanceId?: string
  subscriptionId?: string
  response?: 'mandatory' | 'optional'
  once?: boolean
}): AbilitySubscriptionRoute => ({
  routeId: input.routeId,
  eventId: input.eventId,
  checkpoint: 'after-commit',
  ownerPlacementId: input.ownerPlacementId ?? 'owner-token',
  abilityInstanceId: input.abilityInstanceId ?? `base:owner-token:${input.canonicalId.toLowerCase()}`,
  canonicalId: input.canonicalId,
  modeId: 'mode-triggered',
  subscriptionId: input.subscriptionId ?? 'subscription-main',
  priority: input.priority ?? 0,
  response: input.response ?? 'mandatory',
  oncePerCausalChain: input.once ?? false,
  runtimeVersion: 1,
  definitionHash: HASH,
  sourceModule: 'server/domain/abilityAutomation/specs/test.ts',
})

describe('nested ability trigger chain', () => {
  it('orders simultaneous triggers by priority and stable source identity', () => {
    const coordinator = createAbilityTriggerChainCoordinator({
      chainId: 'chain.one',
      rootEventId: 'event.root',
      routes: [
        route({ eventId: 'event.root', routeId: 'route.z', canonicalId: 'Zulu', priority: 5 }),
        route({ eventId: 'event.root', routeId: 'route.a2', canonicalId: 'Alpha', priority: 5, ownerPlacementId: 'owner-b' }),
        route({ eventId: 'event.root', routeId: 'route.high', canonicalId: 'Beta', priority: 10 }),
        route({ eventId: 'event.root', routeId: 'route.a1', canonicalId: 'Alpha', priority: 5, ownerPlacementId: 'owner-a' }),
      ],
    })
    expect(coordinator.snapshot().pending.map(entry => entry.triggerId)).toEqual([
      'route.high', 'route.a1', 'route.a2', 'route.z',
    ])
    expect(coordinator.current()?.triggerId).toBe('route.high')
  })

  it('requires deterministic head completion and permits pass only for optional triggers', () => {
    const coordinator = createAbilityTriggerChainCoordinator({
      chainId: 'chain.pass',
      rootEventId: 'event.root',
      routes: [
        route({ eventId: 'event.root', routeId: 'route.optional', canonicalId: 'Alpha', priority: 2, response: 'optional' }),
        route({ eventId: 'event.root', routeId: 'route.mandatory', canonicalId: 'Beta', priority: 1 }),
      ],
    })
    expect(() => coordinator.completeCurrent({
      triggerId: 'route.mandatory', disposition: 'executed',
    })).toThrowError(AbilityTriggerChainError)
    const passed = coordinator.completeCurrent({ triggerId: 'route.optional', disposition: 'passed' })
    expect(passed.terminal).toEqual([expect.objectContaining({
      triggerId: 'route.optional', disposition: 'passed', reasonCode: 'ability.trigger.passed',
    })])
    expect(() => coordinator.completeCurrent({
      triggerId: 'route.mandatory', disposition: 'passed',
    })).toThrowError(/mandatory trigger cannot pass/)
    expect(coordinator.current()?.triggerId).toBe('route.mandatory')
  })

  it('runs child events depth-first and suppresses direct causal cycles', () => {
    const root = route({
      eventId: 'event.root', routeId: 'route.root-a', canonicalId: 'Alpha',
      subscriptionId: 'subscription-loop',
    })
    const coordinator = createAbilityTriggerChainCoordinator({
      chainId: 'chain.nested', rootEventId: 'event.root', routes: [root],
    })
    const childCycle = route({
      eventId: 'event.child', routeId: 'route.child-cycle', canonicalId: 'Alpha',
      subscriptionId: 'subscription-loop', priority: 20,
    })
    const childSafe = route({
      eventId: 'event.child', routeId: 'route.child-safe', canonicalId: 'Beta',
      subscriptionId: 'subscription-safe', priority: 10,
    })
    const afterRoot = coordinator.completeCurrent({
      triggerId: root.routeId,
      disposition: 'executed',
      childEvents: [{
        eventId: 'event.child', parentEventId: 'event.root', routes: [childSafe, childCycle],
      }],
    })
    expect(afterRoot.terminal).toEqual([
      expect.objectContaining({ triggerId: 'route.root-a', disposition: 'executed' }),
      expect.objectContaining({ triggerId: 'route.child-cycle', disposition: 'suppressed-cycle' }),
    ])
    expect(coordinator.current()).toMatchObject({ triggerId: 'route.child-safe', depth: 1 })
    expect(coordinator.completeCurrent({
      triggerId: 'route.child-safe', disposition: 'executed',
    }).status).toBe('completed')
  })

  it('reserves once-per-chain guards in deterministic route order', () => {
    const first = route({
      eventId: 'event.root', routeId: 'route.once.first', canonicalId: 'Alpha',
      subscriptionId: 'subscription-once', priority: 10, once: true,
    })
    const duplicate = route({
      eventId: 'event.root', routeId: 'route.once.second', canonicalId: 'Alpha',
      subscriptionId: 'subscription-once', priority: 5, once: true,
    })
    const coordinator = createAbilityTriggerChainCoordinator({
      chainId: 'chain.once', rootEventId: 'event.root', routes: [duplicate, first],
    })
    expect(coordinator.current()?.triggerId).toBe(first.routeId)
    const completed = coordinator.completeCurrent({ triggerId: first.routeId, disposition: 'executed' })
    expect(completed.status).toBe('completed')
    expect(completed.terminal).toEqual([
      expect.objectContaining({ triggerId: first.routeId, disposition: 'executed' }),
      expect.objectContaining({ triggerId: duplicate.routeId, disposition: 'suppressed-once' }),
    ])
  })

  it('rejects duplicate child events without mutating the active head', () => {
    const root = route({ eventId: 'event.root', routeId: 'route.root', canonicalId: 'Alpha' })
    const coordinator = createAbilityTriggerChainCoordinator({
      chainId: 'chain.invalid-child', rootEventId: 'event.root', routes: [root],
    })
    expect(() => coordinator.completeCurrent({
      triggerId: root.routeId,
      disposition: 'executed',
      childEvents: [{ eventId: 'event.root', parentEventId: 'event.root', routes: [] }],
    })).toThrowError(/repeated an event ID/)
    expect(coordinator.current()?.triggerId).toBe(root.routeId)
    expect(coordinator.snapshot().terminal).toEqual([])
  })

  it('shares causal budgets across descendants and fails closed at depth bounds', () => {
    const budget = createAbilityExecutionBudget({ limits: {
      nestedDepth: 1,
      nestedExecutions: 2,
      eventsPerCausalChain: 3,
      triggersPerCausalChain: 3,
    } })
    const root = route({ eventId: 'event.root', routeId: 'route.root', canonicalId: 'Alpha' })
    const child = route({ eventId: 'event.child', routeId: 'route.child', canonicalId: 'Beta' })
    const grandchild = route({ eventId: 'event.grandchild', routeId: 'route.grandchild', canonicalId: 'Gamma' })
    const coordinator = createAbilityTriggerChainCoordinator({
      chainId: 'chain.budget', rootEventId: 'event.root', routes: [root], budget,
    })
    coordinator.completeCurrent({
      triggerId: root.routeId,
      disposition: 'executed',
      childEvents: [{ eventId: 'event.child', parentEventId: 'event.root', routes: [child] }],
    })
    expect(() => coordinator.completeCurrent({
      triggerId: child.routeId,
      disposition: 'executed',
      childEvents: [{
        eventId: 'event.grandchild', parentEventId: 'event.child', routes: [grandchild],
      }],
    })).toThrowError(AbilityExecutionBudgetError)
  })

  it('returns detached deeply frozen JSON snapshots with shared counters', () => {
    const coordinator = createAbilityTriggerChainCoordinator({
      chainId: 'chain.snapshot',
      rootEventId: 'event.root',
      routes: [route({ eventId: 'event.root', routeId: 'route.root', canonicalId: 'Alpha' })],
    })
    const snapshot = coordinator.snapshot()
    expect(snapshot.budgets).toMatchObject({ events: 1, triggers: 1 })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.pending)).toBe(true)
    expect(Object.isFrozen(snapshot.pending[0]?.ancestryCycleKeys)).toBe(true)
  })
})
