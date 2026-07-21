import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import {
  ABILITY_AUTOMATION_ENGINE_BUDGETS,
  assertAbilityAutomationEngineBudgets,
} from '#shared/abilityAutomation/performanceBudgets'
import {
  AbilityExecutionBudgetError,
  createAbilityExecutionBudget,
  executeNestedAbility,
} from '../../server/domain/abilityAutomation/executionBudget'

const smallBudget = () => createAbilityExecutionBudget({
  limits: {
    eventFanOutPerEvent: 2,
    eventsPerCausalChain: 3,
    triggersPerEvent: 2,
    triggersPerCausalChain: 3,
    nestedDepth: 2,
    nestedExecutions: 2,
    operationsPerCausalChain: 2,
    recipientsPerOperation: 2,
    recipientsPerCausalChain: 3,
    rollsPerCausalChain: 2,
    choicesPerCausalChain: 2,
    traceEventsPerCausalChain: 2,
  },
})

describe('ability execution performance budgets', () => {
  it('keeps every reviewed hard ceiling within audited maxima', () => {
    expect(() => assertAbilityAutomationEngineBudgets()).not.toThrow()
    expect(ABILITY_AUTOMATION_ENGINE_BUDGETS).toMatchObject({
      eventFanOutPerEvent: 64,
      triggersPerEvent: 64,
      nestedDepth: 16,
      operationsPerCausalChain: 512,
      recipientsPerOperation: 128,
      rollsPerCausalChain: 512,
      choicesPerCausalChain: 512,
      traceEventsPerCausalChain: 2_048,
    })
  })

  it('tracks exact event, trigger, operation, recipient, roll, choice, and trace totals', () => {
    const budget = smallBudget()
    budget.consumeEvent(2, 1)
    budget.consumeEvent(1, 2)
    budget.consumeOperation(2)
    budget.consumeOperation(1)
    budget.consumeRolls(2)
    budget.consumeChoices(2)
    budget.consumeTraceEvents(2)

    expect(budget.snapshot()).toEqual({
      events: 3,
      triggers: 3,
      nestedExecutions: 0,
      operations: 2,
      recipients: 3,
      rolls: 2,
      choices: 2,
      traceEvents: 2,
    })
    expect(Object.isFrozen(budget.snapshot())).toBe(true)
  })

  it.each([
    ['eventFanOutPerEvent', (budget: ReturnType<typeof smallBudget>) => budget.consumeEvent(3, 0)],
    ['triggersPerEvent', (budget: ReturnType<typeof smallBudget>) => budget.consumeEvent(0, 3)],
    ['eventsPerCausalChain', (budget: ReturnType<typeof smallBudget>) => {
      budget.consumeEvent(2, 0)
      budget.consumeEvent(2, 0)
    }],
    ['triggersPerCausalChain', (budget: ReturnType<typeof smallBudget>) => {
      budget.consumeEvent(0, 2)
      budget.consumeEvent(0, 2)
    }],
    ['operationsPerCausalChain', (budget: ReturnType<typeof smallBudget>) => {
      budget.consumeOperation(0)
      budget.consumeOperation(0)
      budget.consumeOperation(0)
    }],
    ['recipientsPerOperation', (budget: ReturnType<typeof smallBudget>) => budget.consumeOperation(3)],
    ['recipientsPerCausalChain', (budget: ReturnType<typeof smallBudget>) => {
      budget.consumeOperation(2)
      budget.consumeOperation(2)
    }],
    ['rollsPerCausalChain', (budget: ReturnType<typeof smallBudget>) => budget.consumeRolls(3)],
    ['choicesPerCausalChain', (budget: ReturnType<typeof smallBudget>) => budget.consumeChoices(3)],
    ['traceEventsPerCausalChain', (budget: ReturnType<typeof smallBudget>) => budget.consumeTraceEvents(3)],
  ] as const)('fails closed when %s is exceeded', (name, consume) => {
    try {
      consume(smallBudget())
      expect.unreachable(`Expected ${name}`)
    }
    catch (error) {
      expect(error).toBeInstanceOf(AbilityExecutionBudgetError)
      expect((error as AbilityExecutionBudgetError).code).toBe('budget-exceeded')
      expect((error as AbilityExecutionBudgetError).budget).toBe(name)
    }
  })

  it('shares counters across nested executions and bounds depth and child count', () => {
    const root = smallBudget()
    const child = root.child()
    const grandchild = executeNestedAbility(child, nested => nested)
    child.consumeOperation(1)
    grandchild.consumeRolls(1)

    expect(root.depth).toBe(0)
    expect(child.depth).toBe(1)
    expect(grandchild.depth).toBe(2)
    expect(root.snapshot()).toMatchObject({
      nestedExecutions: 2,
      operations: 1,
      rolls: 1,
    })
    expect(() => grandchild.child()).toThrowError(expect.objectContaining({
      code: 'budget-exceeded',
      budget: 'nestedDepth',
    }))

    const countBound = smallBudget()
    countBound.child()
    countBound.child()
    expect(() => countBound.child()).toThrowError(expect.objectContaining({
      code: 'budget-exceeded',
      budget: 'nestedExecutions',
    }))
  })

  it('rejects negative, fractional, oversized, and over-canonical limit configuration', () => {
    expect(() => smallBudget().consumeRolls(-1)).toThrowError(expect.objectContaining({
      code: 'invalid-budget',
    }))
    expect(() => smallBudget().consumeChoices(0.5)).toThrowError(AbilityExecutionBudgetError)
    expect(() => createAbilityExecutionBudget({ initialDepth: 17 })).toThrowError(expect.objectContaining({
      budget: 'nestedDepth',
    }))
    expect(() => createAbilityExecutionBudget({
      limits: { operationsPerCausalChain: 513 },
    })).toThrowError(expect.objectContaining({
      code: 'invalid-budget',
      budget: 'operationsPerCausalChain',
    }))
  })

  it('executes maximum synthetic counter checks within the CI guard', () => {
    const started = performance.now()
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const budget = createAbilityExecutionBudget()
      for (let index = 0; index < 64; index += 1) budget.consumeEvent(1, 1)
      for (let index = 0; index < 128; index += 1) budget.consumeOperation(1)
      budget.consumeRolls(128)
      budget.consumeChoices(128)
      budget.consumeTraceEvents(128)
    }
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(ABILITY_AUTOMATION_ENGINE_BUDGETS.syntheticGuardMilliseconds)
  })
})
