import type {
  MoveDamageEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  MoveStatSelectionExpression,
} from '#shared/moveAutomation/expressions'
import type { SpawnedPokemon } from '~/types/pokemon'
import type {
  MoveAutomationDamageBreakdown,
  MoveAutomationResolvedDamageStat,
  MoveAutomationResolvedDamageStats,
  MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'
import {
  resolveMoveAutomationTargetDamageBreakdown,
} from '~/utils/moveAutomationTargetResolution'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { AuthoritativeMoveRulesContext } from './context'
import type { MoveContextualDamageBaseResolution } from './damageBase'
import type { MoveDamagePipelineResult } from '~/utils/moveAutomationDamagePipeline'
import {
  evaluateMoveExpression,
  type MoveRuleEvaluationTraceEntry,
  type MoveRuleSelectorState,
} from './evaluateExpression'
import {
  MOVE_AUTOMATION_STAT_SHORT_LABELS,
} from './stats'

export type MoveDamageStatSelectionErrorCode = 'non-numeric-stat-selection'

export class MoveDamageStatSelectionError extends Error {
  readonly code: MoveDamageStatSelectionErrorCode
  readonly operationId: string

  constructor(
    code: MoveDamageStatSelectionErrorCode,
    operationId: string,
    message: string,
  ) {
    super(message)
    this.name = 'MoveDamageStatSelectionError'
    this.code = code
    this.operationId = operationId
  }
}

export interface MoveDamageStatSelectionResolution
  extends MoveAutomationResolvedDamageStats {
  readonly trace: readonly MoveRuleEvaluationTraceEntry[]
}

export interface MoveSpecDamageCalculation {
  readonly breakdown: MoveAutomationDamageBreakdown
  readonly stats: MoveDamageStatSelectionResolution
  readonly contextualDamageBase: MoveContextualDamageBaseResolution | null
  readonly damagePipeline: MoveDamagePipelineResult | null
  /** Contextual DB nodes precede attack/defense selection nodes in audit order. */
  readonly evaluationTrace: readonly MoveRuleEvaluationTraceEntry[]
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const selectorStateFor = (recipientId: string): MoveRuleSelectorState => ({
  targetIds: [recipientId],
  hitTargetIds: [recipientId],
  missedTargetIds: [],
  damagedTargetIds: [],
  faintedTargetIds: [],
})

const statSelectionLabel = (
  expression: MoveStatSelectionExpression,
): string => {
  if (expression.kind === 'min') return 'Lower Stat'
  if (expression.kind === 'max') return 'Higher Stat'
  const label = MOVE_AUTOMATION_STAT_SHORT_LABELS[expression.stat]
  const actorOwned = expression.subject.kind === 'actor'
    || expression.subject.kind === 'source-placement'
  return actorOwned ? label : `Target ${label}`
}

const appliesActorOffenseModifiers = (
  expression: MoveStatSelectionExpression,
): boolean => {
  if (expression.kind === 'min' || expression.kind === 'max') {
    return expression.values.every(appliesActorOffenseModifiers)
  }
  const actorOwned = expression.subject.kind === 'actor'
    || expression.subject.kind === 'source-placement'
  return actorOwned
    && (expression.stat === 'attack' || expression.stat === 'special-attack')
}

const evaluateStatSelection = (options: {
  readonly expression: MoveStatSelectionExpression
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
  readonly field: 'attackStat' | 'defenseStat'
}): {
  readonly stat: MoveAutomationResolvedDamageStat
  readonly trace: readonly MoveRuleEvaluationTraceEntry[]
} => {
  const result = evaluateMoveExpression({
    expression: options.expression,
    context: options.context,
    selectorState: selectorStateFor(options.recipientId),
    rootNodeId: `${options.operation.id}.${options.field}.${options.recipientId}`,
  })
  if (typeof result.value !== 'number' || !Number.isFinite(result.value)) {
    throw new MoveDamageStatSelectionError(
      'non-numeric-stat-selection',
      options.operation.id,
      `${options.operation.id} ${options.field} did not resolve to a finite number.`,
    )
  }
  return {
    stat: {
      value: result.value,
      label: statSelectionLabel(options.expression),
      source: { kind: 'operation', id: options.operation.id },
      ...(options.field === 'attackStat' ? {
        applyActorOffenseModifiers: appliesActorOffenseModifiers(options.expression),
      } : {}),
    },
    trace: result.trace,
  }
}

/** Resolve optional reviewed attack/defense expressions for one damage recipient. */
export const resolveMoveDamageStatSelections = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
}): MoveDamageStatSelectionResolution => {
  const attack = options.operation.payload.attackStat
    ? evaluateStatSelection({
        ...options,
        expression: options.operation.payload.attackStat,
        field: 'attackStat',
      })
    : null
  const defense = options.operation.payload.defenseStat
    ? evaluateStatSelection({
        ...options,
        expression: options.operation.payload.defenseStat,
        field: 'defenseStat',
      })
    : null

  return deepFreeze({
    ...(attack ? { attackStat: attack.stat } : {}),
    ...(defense ? { defenseStat: defense.stat } : {}),
    trace: [
      ...(attack?.trace ?? []),
      ...(defense?.trace ?? []),
    ],
  })
}

export interface ResolveMoveSpecDamageCalculationInput {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly script: MoveAutomationScript
  readonly recipient: SpawnedPokemon
  readonly resolution: MoveAutomationTargetResolutionState
  readonly fieldEffects?: MapFieldEffects
  readonly selectedTargets?: readonly SpawnedPokemon[]
  /** Interpreter-owned per-recipient result; fixed DB operations omit it. */
  readonly contextualDamageBase?: MoveContextualDamageBaseResolution
}

/** Resolve reviewed DB/stat inputs through the single ordered damage pipeline. */
export const resolveMoveSpecDamageCalculation = (
  options: ResolveMoveSpecDamageCalculationInput,
): MoveSpecDamageCalculation => {
  const stats = resolveMoveDamageStatSelections({
    context: options.context,
    operation: options.operation,
    recipientId: options.recipient.id,
  })
  const contextualDamageBase = options.contextualDamageBase ?? null
  const damageBase = contextualDamageBase?.finalDamageBase
    ?? options.script.damageBase
    ?? (typeof options.operation.payload.damageBase === 'number'
      ? options.operation.payload.damageBase
      : null)
  const breakdown = resolveMoveAutomationTargetDamageBreakdown(
    options.script,
    options.context.actor.token,
    options.recipient,
    options.resolution,
    options.fieldEffects,
    options.selectedTargets,
    { stats, damageBase },
  )
  return deepFreeze({
    breakdown,
    stats,
    contextualDamageBase,
    damagePipeline: breakdown.kind === 'standard' ? breakdown.pipeline ?? null : null,
    evaluationTrace: [
      ...(contextualDamageBase?.evaluationTrace ?? []),
      ...stats.trace,
    ],
  })
}

export const resolveMoveSpecDamageBreakdown = (
  options: ResolveMoveSpecDamageCalculationInput,
): MoveAutomationDamageBreakdown => resolveMoveSpecDamageCalculation(options).breakdown
