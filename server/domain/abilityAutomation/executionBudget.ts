import {
  ABILITY_AUTOMATION_ENGINE_BUDGETS,
  assertAbilityAutomationEngineBudgets,
  type AbilityAutomationEngineBudgetName,
} from '#shared/abilityAutomation/performanceBudgets'

export type AbilityExecutionBudgetLimits = Readonly<Record<
  Exclude<keyof typeof ABILITY_AUTOMATION_ENGINE_BUDGETS, 'syntheticGuardMilliseconds'>,
  number
>>

export interface AbilityExecutionBudgetCounters {
  readonly events: number
  readonly triggers: number
  readonly nestedExecutions: number
  readonly operations: number
  readonly recipients: number
  readonly rolls: number
  readonly choices: number
  readonly traceEvents: number
}

export interface AbilityExecutionBudget {
  readonly depth: number
  readonly limits: Readonly<AbilityExecutionBudgetLimits>
  readonly consumeEvent: (fanOut: number, triggerCount: number) => void
  readonly consumeOperation: (recipientCount: number) => void
  readonly consumeRolls: (count?: number) => void
  readonly consumeChoices: (count?: number) => void
  readonly consumeTraceEvents: (count?: number) => void
  readonly child: () => AbilityExecutionBudget
  readonly snapshot: () => AbilityExecutionBudgetCounters
}

export type AbilityExecutionBudgetErrorCode =
  | 'invalid-budget'
  | 'budget-exceeded'

export class AbilityExecutionBudgetError extends Error {
  readonly code: AbilityExecutionBudgetErrorCode
  readonly budget: AbilityAutomationEngineBudgetName
  readonly value: number
  readonly maximum: number

  constructor(
    code: AbilityExecutionBudgetErrorCode,
    budget: AbilityAutomationEngineBudgetName,
    value: number,
    maximum: number,
  ) {
    super(`Ability execution budget ${budget} received ${value}; maximum ${maximum}.`)
    this.name = 'AbilityExecutionBudgetError'
    this.code = code
    this.budget = budget
    this.value = value
    this.maximum = maximum
  }
}

type RuntimeLimits = AbilityExecutionBudgetLimits
type MutableCounters = { -readonly [Key in keyof AbilityExecutionBudgetCounters]: number }

const boundedCount = (
  value: number,
  budget: AbilityAutomationEngineBudgetName,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AbilityExecutionBudgetError('invalid-budget', budget, value, maximum)
  }
  return value
}

const consume = (
  counters: MutableCounters,
  key: keyof AbilityExecutionBudgetCounters,
  amount: number,
  budget: AbilityAutomationEngineBudgetName,
  maximum: number,
): void => {
  boundedCount(amount, budget, maximum)
  const next = counters[key] + amount
  if (!Number.isSafeInteger(next) || next > maximum) {
    throw new AbilityExecutionBudgetError('budget-exceeded', budget, next, maximum)
  }
  counters[key] = next
}

const createView = (
  limits: RuntimeLimits,
  counters: MutableCounters,
  depth: number,
): AbilityExecutionBudget => Object.freeze({
  depth,
  limits: Object.freeze({ ...limits }),
  consumeEvent: (fanOut: number, triggerCount: number): void => {
    boundedCount(fanOut, 'eventFanOutPerEvent', limits.eventFanOutPerEvent)
    boundedCount(triggerCount, 'triggersPerEvent', limits.triggersPerEvent)
    if (fanOut > limits.eventFanOutPerEvent) {
      throw new AbilityExecutionBudgetError(
        'budget-exceeded',
        'eventFanOutPerEvent',
        fanOut,
        limits.eventFanOutPerEvent,
      )
    }
    if (triggerCount > limits.triggersPerEvent) {
      throw new AbilityExecutionBudgetError(
        'budget-exceeded',
        'triggersPerEvent',
        triggerCount,
        limits.triggersPerEvent,
      )
    }
    consume(counters, 'events', fanOut, 'eventsPerCausalChain', limits.eventsPerCausalChain)
    consume(
      counters,
      'triggers',
      triggerCount,
      'triggersPerCausalChain',
      limits.triggersPerCausalChain,
    )
  },
  consumeOperation: (recipientCount: number): void => {
    boundedCount(recipientCount, 'recipientsPerOperation', limits.recipientsPerOperation)
    if (recipientCount > limits.recipientsPerOperation) {
      throw new AbilityExecutionBudgetError(
        'budget-exceeded',
        'recipientsPerOperation',
        recipientCount,
        limits.recipientsPerOperation,
      )
    }
    consume(
      counters,
      'operations',
      1,
      'operationsPerCausalChain',
      limits.operationsPerCausalChain,
    )
    consume(
      counters,
      'recipients',
      recipientCount,
      'recipientsPerCausalChain',
      limits.recipientsPerCausalChain,
    )
  },
  consumeRolls: (count = 1): void => consume(
    counters,
    'rolls',
    count,
    'rollsPerCausalChain',
    limits.rollsPerCausalChain,
  ),
  consumeChoices: (count = 1): void => consume(
    counters,
    'choices',
    count,
    'choicesPerCausalChain',
    limits.choicesPerCausalChain,
  ),
  consumeTraceEvents: (count = 1): void => consume(
    counters,
    'traceEvents',
    count,
    'traceEventsPerCausalChain',
    limits.traceEventsPerCausalChain,
  ),
  child: (): AbilityExecutionBudget => {
    const childDepth = depth + 1
    if (childDepth > limits.nestedDepth) {
      throw new AbilityExecutionBudgetError(
        'budget-exceeded',
        'nestedDepth',
        childDepth,
        limits.nestedDepth,
      )
    }
    consume(
      counters,
      'nestedExecutions',
      1,
      'nestedExecutions',
      limits.nestedExecutions,
    )
    return createView(limits, counters, childDepth)
  },
  snapshot: (): AbilityExecutionBudgetCounters => Object.freeze({ ...counters }),
})

export const createAbilityExecutionBudget = (options: {
  readonly initialDepth?: number
  readonly limits?: Partial<RuntimeLimits>
} = {}): AbilityExecutionBudget => {
  assertAbilityAutomationEngineBudgets()
  const canonical: RuntimeLimits = ABILITY_AUTOMATION_ENGINE_BUDGETS
  const limits = { ...canonical, ...options.limits }
  for (const [name, canonicalMaximum] of Object.entries(canonical)) {
    const value = limits[name as keyof RuntimeLimits]
    boundedCount(value, name as AbilityAutomationEngineBudgetName, canonicalMaximum)
    if (value > canonicalMaximum || value < 1) {
      throw new AbilityExecutionBudgetError(
        'invalid-budget',
        name as AbilityAutomationEngineBudgetName,
        value,
        canonicalMaximum,
      )
    }
  }
  const initialDepth = boundedCount(
    options.initialDepth ?? 0,
    'nestedDepth',
    limits.nestedDepth,
  )
  if (initialDepth > limits.nestedDepth) {
    throw new AbilityExecutionBudgetError(
      'budget-exceeded',
      'nestedDepth',
      initialDepth,
      limits.nestedDepth,
    )
  }
  const counters: MutableCounters = {
    events: 0,
    triggers: 0,
    nestedExecutions: 0,
    operations: 0,
    recipients: 0,
    rolls: 0,
    choices: 0,
    traceEvents: 0,
  }
  return createView(limits, counters, initialDepth)
}

/** Execute one direct child with shared chain counters and a checked depth. */
export const executeNestedAbility = <Result>(
  parent: AbilityExecutionBudget,
  execute: (child: AbilityExecutionBudget) => Result,
): Result => execute(parent.child())
