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

/** Wall-clock CI guardrails for catalog-scale, post-import synthetic acceptance. */
export const ABILITY_AUTOMATION_CATALOG_PERFORMANCE_BUDGETS = Object.freeze({
  registryBuildMilliseconds: 5_000,
  catalogRoutingMilliseconds: 2_000,
  passiveAggregationMilliseconds: 2_000,
  commonMoveIterations: 25,
  commonMoveResolutionMilliseconds: 5_000,
  worstTriggerFanOut: 64,
  pendingResumeIterations: 128,
  pendingResumeMilliseconds: 2_000,
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
  const catalogBudgets = ABILITY_AUTOMATION_CATALOG_PERFORMANCE_BUDGETS
  if (catalogBudgets.worstTriggerFanOut !== ABILITY_AUTOMATION_ENGINE_BUDGETS.triggersPerEvent) {
    throw new Error('Catalog trigger benchmark must exercise the production per-event ceiling.')
  }
  for (const [name, value] of Object.entries(catalogBudgets)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
      throw new Error(`Ability catalog performance budget ${name} is invalid.`)
    }
  }
}
