import { describe, expect, it } from 'vitest'
import {
  NESTED_MOVE_EXECUTION_LIMITS,
  NestedMoveExecutionBudgetError,
  createNestedMoveExecutionBudget,
} from '~~/server/domain/moveAutomation/nestedExecution'

const expectBudgetError = (
  operation: () => unknown,
  code: NestedMoveExecutionBudgetError['code'],
): void => {
  expect(operation).toThrowError(expect.objectContaining<Partial<NestedMoveExecutionBudgetError>>({
    code,
  }))
}

describe('nested move execution budget', () => {
  it('enforces aggregate operation, target, event, and random-retry ceilings atomically', () => {
    const budget = createNestedMoveExecutionBudget()
    budget.reserveOperations(NESTED_MOVE_EXECUTION_LIMITS.operations, 'operation boundary')
    budget.reserveTargets(NESTED_MOVE_EXECUTION_LIMITS.targets, 'target boundary')
    budget.reserveEmittedEvents(NESTED_MOVE_EXECUTION_LIMITS.emittedEvents, 'event boundary')
    budget.reserveRandomRetries(NESTED_MOVE_EXECUTION_LIMITS.randomRetries, 'retry boundary')

    const atBoundary = budget.snapshot()
    expect(atBoundary).toMatchObject({
      operations: NESTED_MOVE_EXECUTION_LIMITS.operations,
      targets: NESTED_MOVE_EXECUTION_LIMITS.targets,
      emittedEvents: NESTED_MOVE_EXECUTION_LIMITS.emittedEvents,
      randomRetries: NESTED_MOVE_EXECUTION_LIMITS.randomRetries,
    })

    expectBudgetError(
      () => budget.reserveOperations(1, 'oversized child'),
      'operation-limit-exceeded',
    )
    expectBudgetError(
      () => budget.reserveTargets(1, 'oversized target set'),
      'target-limit-exceeded',
    )
    expectBudgetError(
      () => budget.reserveEmittedEvents(1, 'oversized event stream'),
      'event-limit-exceeded',
    )
    expectBudgetError(
      () => budget.reserveRandomRetries(1, 'reroll-invalid loop'),
      'random-retry-limit-exceeded',
    )
    expect(budget.snapshot()).toEqual(atBoundary)
  })

  it('rejects depth, repeated specs, and server-reviewed banned specs before entry', () => {
    const budget = createNestedMoveExecutionBudget({
      visitedCanonicalIds: ['Copycat'],
      policy: { bannedCanonicalIds: ['Metronome', 'Assist'] },
    })

    budget.enterSpec('Tackle', 0, true)
    budget.enterSpec('Scratch', NESTED_MOVE_EXECUTION_LIMITS.depth)
    const beforeFailures = budget.snapshot()

    expectBudgetError(
      () => budget.enterSpec('Copycat', 1),
      'spec-already-visited',
    )
    expectBudgetError(
      () => budget.enterSpec('Metronome', 1),
      'spec-banned',
    )
    expectBudgetError(
      () => budget.enterSpec('Ember', NESTED_MOVE_EXECUTION_LIMITS.depth + 1),
      'depth-limit-exceeded',
    )
    expect(budget.snapshot()).toEqual(beforeFailures)
  })

  it('bounds policy sets and rejects malformed reservations', () => {
    expectBudgetError(
      () => createNestedMoveExecutionBudget({
        policy: {
          bannedCanonicalIds: Array.from(
            { length: NESTED_MOVE_EXECUTION_LIMITS.bannedSpecs + 1 },
            (_, index) => `Move ${index}`,
          ),
        },
      }),
      'banned-spec-limit-exceeded',
    )

    const budget = createNestedMoveExecutionBudget()
    expectBudgetError(
      () => budget.reserveOperations(-1, 'negative work'),
      'invalid-budget-request',
    )
    expect(budget.snapshot().operations).toBe(0)
  })
})
