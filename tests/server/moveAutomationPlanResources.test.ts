import { describe, expect, it } from 'vitest'
import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import {
  EncounterResourceReductionError,
} from '~~/server/domain/moveAutomation/reduceEncounterResources'
import {
  moveResourceCostsInPhaseWindow,
  planMoveResourceCostWindow,
  type PlanMoveResourceCostWindowInput,
} from '~~/server/domain/moveAutomation/planMoveResources'
import { createMoveAutomationResourceResolver } from '~~/server/domain/moveAutomation/resources'

const cost = (
  id: string,
  phase: MoveSpecCostDeclaration['phase'],
  resourceCost: MoveSpecCostDeclaration['cost'],
): MoveSpecCostDeclaration => ({ id, phase, cost: resourceCost })

const declarations = (): MoveSpecCostDeclaration[] => [
  cost('cost.exhaust', 'cleanup', {
    kind: 'exhaust', timing: 'next-turn', forfeitCommand: true,
  }),
  cost('cost.once', 'usage', {
    kind: 'once-per-turn', flagId: 'move.test-once',
  }),
  cost('cost.standard', 'pay', {
    kind: 'action-resource', resource: 'standard', amount: 1,
  }),
  cost('cost.distance', 'movement', {
    kind: 'movement-distance', amount: 'resolved-distance',
  }),
  cost('cost.priority', 'declare', {
    kind: 'priority', mode: 'standard',
  }),
]

const planningInput = (
  overrides: Partial<PlanMoveResourceCostWindowInput> = {},
): PlanMoveResourceCostWindowInput => ({
  resources: {},
  placementId: 'actor-token',
  canonicalMoveId: 'Test Move',
  resolutionId: 'resolution.test.1',
  sourceOperationId: 'operation.test.1',
  declarations: declarations(),
  movementDistance: 3,
  movementBudget: 6,
  round: 2,
  turn: 4,
  actedThisRound: false,
  ...overrides,
})

const expectDeeplyFrozen = (value: unknown, seen = new WeakSet<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeeplyFrozen(child, seen)
}

describe('authoritative move resource cost planning', () => {
  it('returns deterministic canonical phase order from an immutable snapshot', () => {
    const input = planningInput()
    const snapshot = structuredClone(input)

    const first = planMoveResourceCostWindow(input)
    const replay = planMoveResourceCostWindow(input)

    expect(first).toEqual(replay)
    expect(input).toEqual(snapshot)
    expect(first.costs.map(entry => entry.id)).toEqual([
      'cost.priority',
      'cost.standard',
      'cost.distance',
      'cost.once',
      'cost.exhaust',
    ])
    expect(first.spends.map(entry => entry.costId)).toEqual(
      first.costs.map(entry => entry.id),
    )
    expect(first.spends).toEqual([
      expect.objectContaining({ phase: 'declare', kind: 'priority', amount: 1 }),
      expect.objectContaining({ phase: 'pay', resourceId: 'action.standard', amount: 1 }),
      expect.objectContaining({ phase: 'movement', resourceId: 'movement', amount: 3 }),
      expect.objectContaining({ phase: 'usage', resourceId: 'once-per-turn.move.test-once', amount: 1 }),
      expect.objectContaining({ phase: 'cleanup', kind: 'exhaust', amount: 1 }),
    ])

    const resources = createMoveAutomationResourceResolver(first.currentResources)
    expect(resources.actionSpent('actor-token', 'standard')).toBe(1)
    expect(resources.movementSpent('actor-token')).toBe(3)
    expect(resources.hasOncePerTurnFlag('actor-token', 'move.test-once')).toBe(true)
    expect(first.changed).toBe(true)
    expectDeeplyFrozen(first)
  })

  it('selects exclusive/inclusive phase windows without repaying earlier phases', () => {
    const costs = declarations().filter(entry => entry.cost.kind !== 'exhaust')
    const firstWindow = planMoveResourceCostWindow(planningInput({
      declarations: costs,
      maximumPhaseInclusive: 'pay',
    }))

    expect(firstWindow.costs.map(entry => entry.id)).toEqual([
      'cost.priority',
      'cost.standard',
    ])
    expect(createMoveAutomationResourceResolver(firstWindow.currentResources)
      .actionSpent('actor-token', 'standard')).toBe(1)
    expect(createMoveAutomationResourceResolver(firstWindow.currentResources)
      .movementSpent('actor-token')).toBe(0)

    const secondWindow = planMoveResourceCostWindow(planningInput({
      resources: firstWindow.currentResources,
      declarations: costs,
      minimumPhaseExclusive: 'pay',
      maximumPhaseInclusive: 'usage',
    }))
    expect(secondWindow.costs.map(entry => entry.id)).toEqual([
      'cost.distance',
      'cost.once',
    ])
    const resources = createMoveAutomationResourceResolver(secondWindow.currentResources)
    expect(resources.actionSpent('actor-token', 'standard')).toBe(1)
    expect(resources.movementSpent('actor-token')).toBe(3)
    expect(resources.hasOncePerTurnFlag('actor-token', 'move.test-once')).toBe(true)
  })

  it('records an explicit no-cost outcome without creating a ledger mutation', () => {
    const plan = planMoveResourceCostWindow(planningInput({
      declarations: [cost('cost.waived', 'declare', {
        kind: 'no-cost', reasonCode: 'move.triggered-child',
      })],
      movementDistance: 0,
      movementBudget: null,
    }))

    expect(plan.changed).toBe(false)
    expect(plan.previousResources).toEqual({})
    expect(plan.currentResources).toEqual({})
    expect(plan.spends).toEqual([{
      costId: 'cost.waived',
      phase: 'declare',
      kind: 'no-cost',
      resourceId: null,
      amount: 0,
    }])
  })

  it('fails closed when the oracle supplies no current movement budget', () => {
    const seeded = planMoveResourceCostWindow(planningInput({
      declarations: [cost('cost.distance', 'movement', {
        kind: 'movement-distance', amount: 2,
      })],
      movementDistance: 0,
    }))
    const snapshot = structuredClone(seeded.currentResources)

    expect(() => planMoveResourceCostWindow(planningInput({
      resources: seeded.currentResources,
      declarations: [cost('cost.distance', 'movement', {
        kind: 'movement-distance', amount: 'resolved-distance',
      })],
      movementDistance: 1,
      movementBudget: null,
    }))).toThrowError(expect.objectContaining({
      name: EncounterResourceReductionError.name,
      code: 'movement-unavailable',
    }))
    expect(seeded.currentResources).toEqual(snapshot)
  })

  it('leaves every input unchanged when a later cost fails', () => {
    const seeded = planMoveResourceCostWindow(planningInput({
      declarations: [cost('cost.once', 'usage', {
        kind: 'once-per-turn', flagId: 'move.test-once',
      })],
      movementDistance: 0,
    }))
    const input = planningInput({
      resources: seeded.currentResources,
      declarations: [
        cost('cost.distance', 'movement', {
          kind: 'movement-distance', amount: 'resolved-distance',
        }),
        cost('cost.once-again', 'usage', {
          kind: 'once-per-turn', flagId: 'move.test-once',
        }),
      ],
      movementDistance: 2,
    })
    const snapshot = structuredClone(input)

    expect(() => planMoveResourceCostWindow(input)).toThrowError(expect.objectContaining({
      name: EncounterResourceReductionError.name,
      code: 'once-per-turn-unavailable',
    }))
    expect(input).toEqual(snapshot)
  })

  it('rejects malformed declarations and impossible windows before selection', () => {
    const malformed = [
      cost('cost.standard', 'pay', {
        kind: 'action-resource', resource: 'standard', amount: 1,
      }),
      {
        id: 'cost.client',
        phase: 'cleanup',
        cost: { kind: 'client-patch', state: { standard: 0 } },
      },
    ] as never

    expect(() => moveResourceCostsInPhaseWindow(malformed, {
      maximumPhaseInclusive: 'pay',
    })).toThrowError(expect.objectContaining({
      name: EncounterResourceReductionError.name,
      code: 'invalid-resource-cost',
    }))
    expect(() => moveResourceCostsInPhaseWindow(declarations(), {
      minimumPhaseExclusive: 'cleanup',
      maximumPhaseInclusive: 'pay',
    })).toThrowError(expect.objectContaining({
      name: EncounterResourceReductionError.name,
      code: 'invalid-resource-cost',
    }))
  })
})
