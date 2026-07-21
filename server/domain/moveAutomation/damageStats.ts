import type {
  MoveComparedDamageClassSelection,
  MoveDamageEffectOperation,
  MoveEffectDamageClass,
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
import {
  MOVE_CONTEXTUAL_DAMAGE_BASE_STAB_BONUS,
  type MoveContextualDamageBaseResolution,
} from './damageBase'
import {
  resolveMoveDamageType,
  type MoveDamageTypeResolution,
} from './damageTypes'
import {
  resolveMoveCriticalHit,
  type MoveCriticalHitResolution,
} from './criticalHits'
import type {
  MoveDamageModifier,
  MoveDamagePipelineResult,
} from '~/utils/moveAutomationDamagePipeline'
import {
  evaluateMoveExpression,
  type MoveRuleEvaluationTraceEntry,
  type MoveRuleSelectorState,
} from './evaluateExpression'
import {
  MOVE_AUTOMATION_STAT_SHORT_LABELS,
} from './stats'
import type { TerrainDamageResolution } from './terrain'
import type { WeatherDamageResolution } from './weather'
import type { SideDamageResistanceEvaluation } from './sideDamageResistance'
import {
  HELPING_HAND_DAMAGE_BONUS,
  activeHelpingHandBonusEffects,
  withoutHelpingHandCondition,
} from './helpingHand'
import { hasAa060MoveMark, resolveAa060MoveDamageIntegration } from '../abilityAutomation/mechanics/aa060MoveIntegration'
import { aa061MoveDamageModifiers } from '../abilityAutomation/mechanics/aa061MoveIntegration'
import { aa062MoveDamageModifiers } from '../abilityAutomation/mechanics/aa062MoveIntegration'
import { aa065CourageDamageModifiers } from '../abilityAutomation/mechanics/aa065StaticIntegration'

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

export interface MoveDamageClassResolution {
  readonly damageClass: MoveEffectDamageClass
  readonly source: 'static' | 'stat-comparison' | 'ability'
  readonly comparison: {
    readonly operator: 'less-than'
    readonly left: number
    readonly right: number
    readonly matched: boolean
  } | null
  readonly trace: readonly MoveRuleEvaluationTraceEntry[]
}

export interface MoveSpecDamageCalculation {
  readonly damageClass: MoveDamageClassResolution
  readonly breakdown: MoveAutomationDamageBreakdown
  readonly stats: MoveDamageStatSelectionResolution
  readonly moveType: MoveDamageTypeResolution
  readonly criticalHit: MoveCriticalHitResolution
  readonly contextualDamageBase: MoveContextualDamageBaseResolution | null
  readonly damagePipeline: MoveDamagePipelineResult | null
  /** Active terrain membership and damage decisions with stable reasons. */
  readonly terrain: TerrainDamageResolution
  /** Active weather decisions, including immunity prevention, with stable reasons. */
  readonly weather: WeatherDamageResolution
  /** Side-owned class predicate, effectiveness adjustment, and reserved trigger charge. */
  readonly sideDamageResistance: SideDamageResistanceEvaluation
  /** Type, contextual DB, then attack/defense nodes appear in deterministic audit order. */
  readonly evaluationTrace: readonly MoveRuleEvaluationTraceEntry[]
}

const reviewedPreTypeDamageModifiers = (
  operation: MoveDamageEffectOperation,
): readonly MoveDamageModifier[] => (operation.payload.preTypeDamageModifiers ?? []).map(
  modifier => ({
    ...modifier,
    stage: 'pre-type-modifiers' as const,
    source: {
      kind: operation.source.kind,
      id: operation.source.id,
    },
    operation: 'add' as const,
  }),
)

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

const evaluateDamageClassStat = (options: {
  readonly expression: MoveStatSelectionExpression
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
  readonly side: 'left' | 'right'
}): { readonly value: number; readonly trace: readonly MoveRuleEvaluationTraceEntry[] } => {
  const result = evaluateMoveExpression({
    expression: options.expression,
    context: options.context,
    selectorState: selectorStateFor(options.recipientId),
    rootNodeId: `${options.operation.id}.damageClass.${options.side}.${options.recipientId}`,
  })
  if (typeof result.value !== 'number' || !Number.isFinite(result.value)) {
    throw new MoveDamageStatSelectionError(
      'non-numeric-stat-selection',
      options.operation.id,
      `${options.operation.id} damageClass ${options.side} did not resolve to a finite number.`,
    )
  }
  return { value: result.value, trace: result.trace }
}

/** Resolve one static or stat-compared damage class for an authoritative recipient. */
export const resolveMoveDamageClass = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
}): MoveDamageClassResolution => {
  if (hasAa060MoveMark(options.context, 'Anchored', options.context.intent.moveName)) {
    return deepFreeze({
      damageClass: 'physical', source: 'ability' as const,
      comparison: null, trace: [],
    })
  }
  const selection = options.operation.payload.damageClass
  if (typeof selection === 'string') {
    return deepFreeze({
      damageClass: selection,
      source: 'static' as const,
      comparison: null,
      trace: [],
    })
  }
  const compared = selection as MoveComparedDamageClassSelection
  const left = evaluateDamageClassStat({ ...options, expression: compared.left, side: 'left' })
  const right = evaluateDamageClassStat({ ...options, expression: compared.right, side: 'right' })
  const matched = left.value < right.value
  return deepFreeze({
    damageClass: matched ? compared.whenTrue : compared.whenFalse,
    source: 'stat-comparison' as const,
    comparison: {
      operator: compared.operator,
      left: left.value,
      right: right.value,
      matched,
    },
    trace: [...left.trace, ...right.trace],
  })
}

/** Resolve optional reviewed attack/defense expressions for one damage recipient. */
export const resolveMoveDamageStatSelections = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
}): MoveDamageStatSelectionResolution => {
  if (hasAa060MoveMark(options.context, 'Anchored', options.context.intent.moveName)) {
    return deepFreeze({ trace: [] })
  }
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
  /** Current sequence projection when an earlier strike changed the actor. */
  readonly actor?: SpawnedPokemon
  /** Current sequence projection when an earlier strike changed the target. */
  readonly recipient: SpawnedPokemon
  readonly resolution: MoveAutomationTargetResolutionState
  readonly fieldEffects?: MapFieldEffects
  readonly selectedTargets?: readonly SpawnedPokemon[]
  /** Interpreter-owned type result reused by roll and reduction rather than re-evaluated. */
  readonly resolvedMoveType?: MoveDamageTypeResolution
  /** Natural server-owned roll used by reviewed critical triggers. */
  readonly naturalCriticalRoll?: number | null
  /** Interpreter-owned per-recipient result; fixed DB operations omit it. */
  readonly contextualDamageBase?: MoveContextualDamageBaseResolution
}

/** Resolve reviewed DB/stat inputs through the single ordered damage pipeline. */
export const resolveMoveSpecDamageCalculation = (
  options: ResolveMoveSpecDamageCalculationInput,
): MoveSpecDamageCalculation => {
  const baseMoveType = options.resolvedMoveType ?? resolveMoveDamageType({
    context: options.context,
    operation: options.operation,
    script: options.script,
    recipientId: options.recipient.id,
    canonicalMoveId: options.script.moveName,
  })
  const damageClass = resolveMoveDamageClass({
    context: options.context,
    operation: options.operation,
    recipientId: options.recipient.id,
  })
  const actor = options.actor ?? options.context.actor.token
  const aa060 = resolveAa060MoveDamageIntegration({
    context: options.context,
    operation: options.operation,
    script: options.script,
    actor,
    recipient: options.recipient,
    damageClass,
    moveType: baseMoveType,
  })
  const moveType = aa060.moveType
  const aa061Modifiers = aa061MoveDamageModifiers({
    context: options.context,
    operation: options.operation,
    script: options.script,
    actor,
    recipient: options.recipient,
    moveTypeSources: moveType.passiveSources,
  })
  const aa062Modifiers = aa062MoveDamageModifiers({
    context: options.context,
    operation: options.operation,
    script: options.script,
    actor,
    recipient: options.recipient,
    moveType: moveType.moveType,
  })
  const aa065Modifiers = aa065CourageDamageModifiers({
    context: options.context,
    operation: options.operation,
    actor,
    recipient: options.recipient,
  })
  const sideDamageResistance = options.context.queries.sideDamageResistance.resolve({
    damageOperationId: options.operation.id,
    targetPlacementId: options.recipient.id,
    damageClass: damageClass.damageClass,
    effectivenessMultiplier: moveType.finalMultiplier,
  })
  const criticalHit = resolveMoveCriticalHit({
    context: options.context,
    operation: options.operation,
    script: options.script,
    recipientId: options.recipient.id,
    naturalRoll: options.naturalCriticalRoll ?? null,
    legacyCritical: options.resolution.crit,
  })
  const stats = resolveMoveDamageStatSelections({
    context: options.context,
    operation: options.operation,
    recipientId: options.recipient.id,
  })
  const contextualDamageBase = options.contextualDamageBase ?? null
  const damageBase = contextualDamageBase?.finalDamageBase
    ?? (typeof options.operation.payload.damageBase === 'number'
      ? options.operation.payload.damageBase
        + (moveType.hasStab ? MOVE_CONTEXTUAL_DAMAGE_BASE_STAB_BONUS : 0)
      : options.script.damageBase)
  const terrain = options.context.queries.terrain.damage({
    placementId: actor.id,
    targetPlacementId: options.recipient.id,
    moveType: moveType.moveType,
    targetImmune: moveType.finalMultiplier === 0,
  })
  const weather = options.context.queries.weather.damage({
    moveType: moveType.moveType,
    targetImmune: moveType.finalMultiplier === 0,
    actor: {
      placementId: actor.id,
      abilityNames: actor.abilityNames,
    },
  })
  const authoritativeWeatherFieldEffects = options.context.queries.weather.projectFieldEffects(
    options.fieldEffects ?? options.context.map.fieldEffects,
  )
  const authoritativeTerrainFieldEffects = options.context.queries.terrain.projectFieldEffects(
    actor.id,
    authoritativeWeatherFieldEffects,
    options.recipient.id,
  )
  const authoritativeFieldEffects = options.context.queries.rooms.projectFieldEffects(
    authoritativeTerrainFieldEffects,
  )
  const helpingHand = activeHelpingHandBonusEffects({
    map: options.context.map,
    placementId: actor.id,
  })
  const helpingHandModifiers: readonly MoveDamageModifier[] = helpingHand[0]
    ? [{
        id: 'helping-hand.damage-roll',
        stage: 'pre-type-modifiers',
        priority: 100,
        source: { kind: 'encounter-effect', id: helpingHand[0].id },
        stackingGroup: 'condition-damage-roll',
        reasonCode: 'helping-hand.damage-roll-bonus',
        operation: 'add',
        value: HELPING_HAND_DAMAGE_BONUS,
      }]
    : []
  // Native weather and Terrain modifiers carry exact zone identity and trace
  // reasons. Keep them out of the compatibility lane.
  const nonAuthoritativeFieldEffects: MapFieldEffects = {
    ...authoritativeFieldEffects,
    weather: [],
    terrains: [],
  }
  const resolvedScript: MoveAutomationScript = {
    ...options.script,
    damageClass: damageClass.damageClass === 'physical' ? 'Physical' : 'Special',
  }
  const breakdown = resolveMoveAutomationTargetDamageBreakdown(
    resolvedScript,
    helpingHand.length > 0 ? withoutHelpingHandCondition(actor) : actor,
    options.recipient,
    { ...options.resolution, crit: criticalHit.critical },
    nonAuthoritativeFieldEffects,
    options.selectedTargets,
    {
      stats,
      damageBase,
      typeEffectiveness: {
        moveType: moveType.moveType,
        multiplier: sideDamageResistance.adjustedMultiplier,
      },
      additionalModifiers: [
        ...reviewedPreTypeDamageModifiers(options.operation),
        ...aa060.modifiers,
        ...aa061Modifiers,
        ...aa062Modifiers,
        ...aa065Modifiers,
        ...helpingHandModifiers,
        ...weather.modifiers,
        ...terrain.modifiers,
      ],
    },
  )
  return deepFreeze({
    breakdown,
    damageClass,
    stats,
    moveType,
    criticalHit,
    contextualDamageBase,
    damagePipeline: breakdown.kind === 'standard' ? breakdown.pipeline ?? null : null,
    terrain,
    weather,
    sideDamageResistance,
    evaluationTrace: [
      ...moveType.evaluationTrace,
      ...(contextualDamageBase?.evaluationTrace ?? []),
      ...damageClass.trace,
      ...stats.trace,
    ],
  })
}

export const resolveMoveSpecDamageBreakdown = (
  options: ResolveMoveSpecDamageCalculationInput,
): MoveAutomationDamageBreakdown => resolveMoveSpecDamageCalculation(options).breakdown
