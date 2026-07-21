import { ABILITY_SPEC_LIMITS } from './spec'
import { ABILITY_RESOLUTION_TRACE_LIMITS } from './trace'

/** Hard causal-chain ceilings; runtime code may use stricter test/cohort limits only. */
export const ABILITY_AUTOMATION_ENGINE_BUDGETS = Object.freeze({
  eventFanOutPerEvent: 64,
  eventsPerCausalChain: 512,
  triggersPerEvent: 64,
  triggersPerCausalChain: 512,
  nestedDepth: ABILITY_RESOLUTION_TRACE_LIMITS.ancestryDepth,
  nestedExecutions: 256,
  operationsPerCausalChain: ABILITY_SPEC_LIMITS.totalOperations,
  recipientsPerOperation: 128,
  recipientsPerCausalChain: 8_192,
  rollsPerCausalChain: 512,
  choicesPerCausalChain: 512,
  traceEventsPerCausalChain: ABILITY_RESOLUTION_TRACE_LIMITS.events,
  syntheticGuardMilliseconds: 2_000,
})

export type AbilityAutomationEngineBudgetName = Exclude<
  keyof typeof ABILITY_AUTOMATION_ENGINE_BUDGETS,
  'syntheticGuardMilliseconds'
>

export const assertAbilityAutomationEngineBudgets = (): void => {
  const maxima: Readonly<Record<AbilityAutomationEngineBudgetName, number>> = {
    eventFanOutPerEvent: 128,
    eventsPerCausalChain: 1_024,
    triggersPerEvent: 128,
    triggersPerCausalChain: 1_024,
    nestedDepth: 16,
    nestedExecutions: 512,
    operationsPerCausalChain: 512,
    recipientsPerOperation: 128,
    recipientsPerCausalChain: 16_384,
    rollsPerCausalChain: 512,
    choicesPerCausalChain: 512,
    traceEventsPerCausalChain: 2_048,
  }
  for (const [name, maximum] of Object.entries(maxima)) {
    const value = ABILITY_AUTOMATION_ENGINE_BUDGETS[name as AbilityAutomationEngineBudgetName]
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`Ability automation budget ${name} must remain from 1 through ${maximum}.`)
    }
  }
}
