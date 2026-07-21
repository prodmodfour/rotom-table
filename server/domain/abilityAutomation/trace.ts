import {
  appendAbilityResolutionTraceEvent,
  createAbilityResolutionTrace,
  type AbilityResolutionAuditTrace,
  type AbilityResolutionAuditTraceEventInput,
  type AbilityResolutionTraceAncestryEntry,
} from '#shared/abilityAutomation/trace'
import type { AbilitySpecPhase } from '#shared/abilityAutomation/spec'
import type { AbilityCombatStageReduction } from './effectKernel'
import type { AuthoritativeAbilityContext } from './context'
import type { AbilityExecutionBudget } from './executionBudget'

/** Bind every trace to the exact manifest-selected runtime and frozen rules source. */
export const createAbilityResolutionTraceForContext = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly resolutionId?: string
  readonly ancestry?: readonly AbilityResolutionTraceAncestryEntry[]
}): AbilityResolutionAuditTrace => createAbilityResolutionTrace({
  resolutionId: input.resolutionId ?? input.context.resolutionId,
  program: {
    canonicalId: input.context.runtime.canonicalId,
    modeId: input.context.request.modeId,
    runtimeKind: 'abilityspec-v1',
    runtimeVersion: input.context.runtime.version,
    definitionHash: input.context.runtime.definitionHash,
    sourceModule: input.context.runtime.sourceModule,
  },
  ruleset: {
    rulesetId: input.context.ruleset.rulesetId,
    sourceDataSha256: input.context.ruleset.sourceData.sha256,
  },
  ancestry: input.ancestry ?? input.context.ancestry,
})

export const appendAbilityTraceEvents = (
  trace: AbilityResolutionAuditTrace,
  events: readonly AbilityResolutionAuditTraceEventInput[],
  budget?: AbilityExecutionBudget,
): AbilityResolutionAuditTrace => events.reduce((current, event) => {
  budget?.consumeTraceEvents(1)
  return appendAbilityResolutionTraceEvent(current, event)
}, trace)

/** Translate shared reducer outcomes without exposing a synthetic Move phase/source. */
export const traceAbilityCombatStageReduction = (
  trace: AbilityResolutionAuditTrace,
  reduction: AbilityCombatStageReduction,
  budget?: AbilityExecutionBudget,
): AbilityResolutionAuditTrace => {
  let current = trace
  let activePhase: AbilitySpecPhase | null = null
  for (const event of current.events) {
    if (event.kind === 'phase-transition') activePhase = event.to
  }
  for (const result of reduction.operationResults) {
    if (activePhase !== result.phase) {
      budget?.consumeTraceEvents(1)
      current = appendAbilityResolutionTraceEvent(current, {
        kind: 'phase-transition',
        reasonCode: `phase.${result.phase}`,
        from: activePhase,
        to: result.phase,
      })
      activePhase = result.phase
    }
    budget?.consumeTraceEvents(1)
    current = appendAbilityResolutionTraceEvent(current, {
      kind: 'operation',
      phase: result.phase,
      reasonCode: result.reasonCode,
      operationId: result.operationId,
      operationKind: result.operationKind,
      recipientIds: result.recipientIds,
      outcome: result.outcome,
      input: null,
      result: {
        recipients: result.recipients.map(recipient => ({
          recipientId: recipient.recipientId,
          outcome: recipient.outcome,
          reasonCode: recipient.reasonCode,
          changedFields: recipient.changedFields,
        })),
      },
    })
  }
  return current
}
