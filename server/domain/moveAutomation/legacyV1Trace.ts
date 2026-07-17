import {
  MOVE_SPEC_PHASES,
  type MoveSpecPhase,
} from '#shared/moveAutomation/spec'
import type { MoveAutomationRollLedgerEntry } from '#shared/moveAutomation/random'
import type { EncounterConditionEffect } from '#shared/moveAutomation/encounterEffects'
import type {
  MoveResolutionAuditTrace,
  MoveResolutionAuditTraceEventInput,
  MoveResolutionTraceAncestryEntry,
  MoveResolutionTraceJsonValue,
  MoveResolutionTraceProgramIdentity,
  MoveResolutionTraceRulesetIdentity,
} from '#shared/moveAutomation/trace'
import type {
  MoveAutomationFeedbackState,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { GridAnchor } from '~/types/map'
import {
  createMoveResolutionTrace,
  reduceMoveResolutionTrace,
} from './trace'

type NonPhaseTraceEventInput = Exclude<
  MoveResolutionAuditTraceEventInput,
  { readonly kind: 'phase-transition' }
>

export interface BuildLegacyV1MoveResolutionTraceInput {
  readonly program: MoveResolutionTraceProgramIdentity
  readonly ruleset: MoveResolutionTraceRulesetIdentity
  readonly ancestry?: readonly MoveResolutionTraceAncestryEntry[]
  readonly actorPlacementId: string
  readonly selectionKind: 'self' | 'single-target' | 'target-count' | 'area'
  readonly selectedTargetIds: readonly string[]
  readonly script: MoveAutomationScript
  readonly transaction: MoveAutomationTransaction
  readonly rollLedger: readonly MoveAutomationRollLedgerEntry[]
  readonly terrainConditionProtectionEffects?: readonly EncounterConditionEffect[]
  readonly feedback?: MoveAutomationFeedbackState
  readonly area?: {
    readonly targetEvaluations: readonly {
      readonly targetPlacementId: string
      readonly outcome: 'included' | 'excluded'
      readonly reasonCode: string
    }[]
  }
  readonly movement?: {
    readonly kind: 'pass'
    readonly from: GridAnchor
    readonly destination: GridAnchor
    readonly direction: string
    readonly pathCells: readonly GridAnchor[]
  }
}

const detachedJson = (value: unknown): MoveResolutionTraceJsonValue => (
  JSON.parse(JSON.stringify(value)) as MoveResolutionTraceJsonValue
)

const rollPhase = (
  roll: MoveAutomationRollLedgerEntry,
  effectPhase: MoveSpecPhase,
): MoveSpecPhase => {
  if (roll.parentEffectId === 'legacy-v1.accuracy') return 'accuracy'
  if (roll.parentEffectId === 'legacy-v1.random-stage') return effectPhase
  return 'damage'
}

/**
 * Give the compatibility runtime explicit structured evidence without parsing
 * its prose. Native v2 execution will emit the same event contract directly.
 */
export const buildLegacyV1MoveResolutionTrace = (
  input: BuildLegacyV1MoveResolutionTraceInput,
): MoveResolutionAuditTrace => {
  const eventsByPhase = new Map<MoveSpecPhase, NonPhaseTraceEventInput[]>()
  const requiredPhases = new Set<MoveSpecPhase>(['declare', 'precondition', 'target', 'cleanup'])
  const queue = (phase: MoveSpecPhase, event: NonPhaseTraceEventInput): void => {
    requiredPhases.add(phase)
    const events = eventsByPhase.get(phase) ?? []
    events.push(event)
    eventsByPhase.set(phase, events)
  }

  queue('precondition', {
    kind: 'predicate',
    phase: 'precondition',
    predicateId: 'legacy-v1.move-available',
    outcome: true,
    reasonCode: 'move-available',
    input: {
      canonicalId: input.program.canonicalId,
      runtimeVersion: input.program.runtimeVersion,
    },
  })

  const areaEvaluations = input.area?.targetEvaluations ?? []
  const recordedTargets = new Set<string>()
  for (const evaluation of areaEvaluations) {
    recordedTargets.add(evaluation.targetPlacementId)
    queue('target', {
      kind: 'target',
      phase: 'target',
      targetId: evaluation.targetPlacementId,
      outcome: evaluation.outcome,
      reasonCode: evaluation.reasonCode,
    })
  }
  for (const targetId of input.selectedTargetIds) {
    if (recordedTargets.has(targetId)) continue
    recordedTargets.add(targetId)
    queue('target', {
      kind: 'target',
      phase: 'target',
      targetId,
      outcome: 'included',
      reasonCode: 'authoritative-selection',
    })
  }
  if (input.selectionKind === 'self') {
    queue('target', {
      kind: 'target',
      phase: 'target',
      targetId: input.actorPlacementId,
      outcome: 'included',
      reasonCode: 'self-target',
    })
  }

  const hitTargetIds = new Set(input.transaction.hitTargetIds)
  input.transaction.attackedTargetIds.forEach((targetId, index) => {
    const hit = hitTargetIds.has(targetId)
    queue('accuracy', {
      kind: 'predicate',
      phase: 'accuracy',
      predicateId: `legacy-v1.accuracy.${index + 1}`,
      outcome: hit,
      reasonCode: hit ? 'accuracy-hit' : 'accuracy-miss',
      input: { targetId },
    })
    requiredPhases.add(hit ? 'hit' : 'miss')
  })

  const effectPhase: MoveSpecPhase = input.script.damaging ? 'after-damage' : 'hit'
  for (const roll of input.rollLedger) {
    const phase = rollPhase(roll, effectPhase)
    queue(phase, {
      kind: 'roll',
      phase,
      reasonCode: 'server-roll-resolved',
      roll,
    })
  }

  input.transaction.hpUpdates.forEach((update, index) => {
    const phase: MoveSpecPhase = input.script.damaging ? 'damage' : 'hit'
    queue(phase, {
      kind: 'operation',
      phase,
      operationId: `legacy-v1.hp.${index + 1}`,
      operationKind: 'direct-hp',
      recipientIds: [update.id],
      outcome: 'applied',
      reasonCode: 'legacy-hp-update',
      input: { updateMode: 'absolute-hp-state' },
      result: detachedJson(update),
    })
  })

  input.transaction.conditionUpdates.forEach((update, index) => {
    queue(effectPhase, {
      kind: 'operation',
      phase: effectPhase,
      operationId: `legacy-v1.condition.${index + 1}`,
      operationKind: 'condition',
      recipientIds: [update.id],
      outcome: 'applied',
      reasonCode: 'legacy-condition-update',
      input: { updateMode: 'absolute-condition-state' },
      result: detachedJson(update),
    })
  })

  input.terrainConditionProtectionEffects?.forEach((effect, index) => {
    queue(effectPhase, {
      kind: 'operation',
      phase: effectPhase,
      operationId: `legacy-v1.terrain-condition-protection.${index + 1}`,
      operationKind: 'temporary-effect',
      recipientIds: [...effect.affected.placementIds],
      outcome: 'applied',
      reasonCode: 'terrain.misty.first-turn-status-protection',
      input: {
        sourceConditionOperationId: effect.source.operationId,
        terrainKind: 'misty',
      },
      result: detachedJson(effect),
    })
  })

  input.transaction.combatStageUpdates.forEach((update, index) => {
    queue(effectPhase, {
      kind: 'operation',
      phase: effectPhase,
      operationId: `legacy-v1.combat-stage.${index + 1}`,
      operationKind: 'combat-stage',
      recipientIds: [update.id],
      outcome: 'applied',
      reasonCode: 'legacy-combat-stage-update',
      input: { updateMode: 'absolute-combat-stage-state' },
      result: detachedJson(update),
    })
  })

  input.transaction.hazardsToAdd.forEach((hazard, index) => {
    queue('hit', {
      kind: 'operation',
      phase: 'hit',
      operationId: `legacy-v1.hazard.${index + 1}`,
      operationKind: 'hazard',
      recipientIds: [],
      outcome: 'applied',
      reasonCode: 'legacy-hazard-add',
      input: { updateMode: 'hazard-add' },
      result: detachedJson(hazard),
    })
  })

  input.transaction.fieldEffectsToApply.forEach((fieldEffect, index) => {
    queue('hit', {
      kind: 'operation',
      phase: 'hit',
      operationId: `legacy-v1.field.${index + 1}`,
      operationKind: 'field',
      recipientIds: [],
      outcome: 'applied',
      reasonCode: 'legacy-field-apply',
      input: { updateMode: 'field-apply' },
      result: detachedJson(fieldEffect),
    })
  })

  input.feedback?.conditions.forEach((condition, index) => {
    if (condition.applied) return
    queue(effectPhase, {
      kind: 'operation',
      phase: effectPhase,
      operationId: `legacy-v1.prevented-condition.${index + 1}`,
      operationKind: 'condition',
      recipientIds: [input.feedback!.targetId],
      outcome: 'prevented',
      reasonCode: 'condition-prevented',
      input: { condition: condition.condition },
      result: {
        applied: false,
        ...(condition.blockedBy ? { blockedBy: condition.blockedBy } : {}),
      },
    })
  })

  if (input.movement) {
    queue('movement', {
      kind: 'operation',
      phase: 'movement',
      operationId: 'legacy-v1.movement.1',
      operationKind: 'movement-request',
      recipientIds: [input.actorPlacementId],
      outcome: 'applied',
      reasonCode: 'legacy-pass-movement',
      input: detachedJson({
        kind: input.movement.kind,
        from: input.movement.from,
        direction: input.movement.direction,
      }),
      result: detachedJson({
        destination: input.movement.destination,
        pathCells: input.movement.pathCells,
      }),
    })
  }

  queue('cleanup', {
    kind: 'operation',
    phase: 'cleanup',
    operationId: 'legacy-v1.log.1',
    operationKind: 'log',
    recipientIds: [],
    outcome: input.transaction.logLines.length ? 'applied' : 'no-op',
    reasonCode: 'legacy-log-projection',
    input: { lineCount: input.transaction.logLines.length },
    result: { lines: [...input.transaction.logLines] },
  })

  let trace = createMoveResolutionTrace({
    program: input.program,
    ruleset: input.ruleset,
    ancestry: input.ancestry,
  })
  let activePhase: MoveSpecPhase | null = null
  for (const phase of MOVE_SPEC_PHASES) {
    if (!requiredPhases.has(phase)) continue
    trace = reduceMoveResolutionTrace(trace, {
      kind: 'phase-transition',
      from: activePhase,
      to: phase,
      reasonCode: `${phase}-phase`,
    })
    activePhase = phase
    for (const event of eventsByPhase.get(phase) ?? []) {
      trace = reduceMoveResolutionTrace(trace, event)
    }
  }
  return trace
}
