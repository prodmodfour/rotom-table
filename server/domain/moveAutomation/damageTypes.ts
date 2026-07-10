import type {
  MoveDamageEffectOperation,
  MoveDamageTypeEffectivenessPolicy,
  MoveEffectTypeRelation,
} from '#shared/moveAutomation/effects'
import type { MoveRuleEvaluationTraceEntry, MoveRuleSelectorState } from './evaluateExpression'
import { evaluateMoveExpression } from './evaluateExpression'
import type { AuthoritativeMoveRulesContext } from './context'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import {
  resolveSheetPassiveTypeEffectiveness,
} from '~/utils/sheetPassiveAbilityEffects'
import {
  moveAutomationPassiveImmunityKeywordsForTarget,
  moveAutomationPowderImmunitySource,
} from '~/utils/moveAutomationKeywordImmunity'
import { ELECTRIC_RESISTANT_COAT_CONDITION } from '~/utils/moveAutomationSpecialConditions'
import { conditionBaseName, normalizeConditionNames } from '~/utils/statusConditions'
import {
  POKEMON_TYPES,
  multiplierFromEffectivenessSteps,
  resistMultiplierOneStepFurther,
  singleTypeMultiplier,
  type PokemonType,
} from '~/utils/typeChart'

export type MoveDamageTypeResolutionErrorCode =
  | 'move-type-unavailable'
  | 'unknown-move-type'
  | 'unknown-defender-type-override'

export class MoveDamageTypeResolutionError extends Error {
  readonly code: MoveDamageTypeResolutionErrorCode
  readonly operationId: string
  readonly recipientId: string

  constructor(
    code: MoveDamageTypeResolutionErrorCode,
    operationId: string,
    recipientId: string,
    message: string,
  ) {
    super(message)
    this.name = 'MoveDamageTypeResolutionError'
    this.code = code
    this.operationId = operationId
    this.recipientId = recipientId
  }
}

export interface MoveDamageDefenderTypeEvaluation {
  readonly defenderType: PokemonType
  readonly relation: MoveEffectTypeRelation
  readonly source: 'type-chart' | 'move-override'
  readonly ignored: boolean
  /** Null denotes immunity; other values are additive PTU effectiveness steps. */
  readonly effectivenessStep: number | null
}

export interface MoveDamageTypeResolution {
  readonly operationId: string
  readonly recipientId: string
  readonly moveType: PokemonType
  readonly moveTypeSource: 'static' | 'expression'
  readonly defenderTypes: readonly PokemonType[]
  readonly defenderTypeEvaluations: readonly MoveDamageDefenderTypeEvaluation[]
  readonly policy: MoveDamageTypeEffectivenessPolicy
  readonly baseMultiplier: number
  readonly passiveMultiplier: number
  readonly passiveSources: readonly string[]
  readonly finalMultiplier: number
  readonly finalRelation: MoveEffectTypeRelation
  readonly immunitySource: string | null
  readonly hasStab: boolean
  readonly evaluationTrace: readonly MoveRuleEvaluationTraceEntry[]
}

export const DEFAULT_MOVE_DAMAGE_TYPE_EFFECTIVENESS_POLICY = Object.freeze({
  immunity: 'honor',
  resistance: 'honor',
  weakness: 'honor',
  effectivenessOverride: null,
  defenderTypeOverrides: Object.freeze([]),
} satisfies MoveDamageTypeEffectivenessPolicy)

const selectorStateFor = (recipientId: string): MoveRuleSelectorState => ({
  targetIds: [recipientId],
  hitTargetIds: [recipientId],
  missedTargetIds: [],
  damagedTargetIds: [],
  faintedTargetIds: [],
})

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const fail = (
  code: MoveDamageTypeResolutionErrorCode,
  operation: MoveDamageEffectOperation,
  recipientId: string,
  message: string,
): never => {
  throw new MoveDamageTypeResolutionError(code, operation.id, recipientId, message)
}

const canonicalType = (value: string): PokemonType | null => {
  const normalized = value.trim().toLowerCase()
  return POKEMON_TYPES.find(type => type.toLowerCase() === normalized) ?? null
}

const requiredCanonicalType = (
  value: string,
  operation: MoveDamageEffectOperation,
  recipientId: string,
  code: Extract<
    MoveDamageTypeResolutionErrorCode,
    'unknown-move-type' | 'unknown-defender-type-override'
  >,
  label: string,
): PokemonType => canonicalType(value) ?? fail(
  code,
  operation,
  recipientId,
  `${label} ${JSON.stringify(value)} is not one of the 18 canonical types.`,
)

const resolvedMoveType = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly recipientId: string
  readonly canonicalMoveId: string
}): {
  readonly type: PokemonType
  readonly source: MoveDamageTypeResolution['moveTypeSource']
  readonly trace: readonly MoveRuleEvaluationTraceEntry[]
} => {
  const { moveType } = options.operation.payload
  if (typeof moveType === 'string') {
    return {
      type: requiredCanonicalType(
        moveType,
        options.operation,
        options.recipientId,
        'unknown-move-type',
        'Move type',
      ),
      source: 'static',
      trace: [],
    }
  }

  const evaluation = evaluateMoveExpression({
    expression: moveType,
    context: options.context,
    selectorState: selectorStateFor(options.recipientId),
    canonicalMoveId: options.canonicalMoveId,
    rootNodeId: `${options.operation.id}.moveType.${options.recipientId}`,
  })
  if (typeof evaluation.value !== 'string') {
    return fail(
      'move-type-unavailable',
      options.operation,
      options.recipientId,
      `Move type expression for ${options.operation.id} did not resolve a string.`,
    )
  }
  if (evaluation.value !== evaluation.value.trim().toLowerCase()) {
    return fail(
      'unknown-move-type',
      options.operation,
      options.recipientId,
      'Move type expressions must resolve a canonical lowercase type ID.',
    )
  }
  return {
    type: requiredCanonicalType(
      evaluation.value,
      options.operation,
      options.recipientId,
      'unknown-move-type',
      'Resolved move type',
    ),
    source: 'expression',
    trace: evaluation.trace,
  }
}

const relationForMultiplier = (multiplier: number): MoveEffectTypeRelation => {
  if (multiplier === 0) return 'immune'
  if (multiplier < 1) return 'resistant'
  if (multiplier > 1) return 'weak'
  return 'neutral'
}

const relationStep = (relation: MoveEffectTypeRelation): number | null => {
  if (relation === 'immune') return null
  if (relation === 'resistant') return -1
  if (relation === 'weak') return 1
  return 0
}

const targetHasCondition = (
  conditions: readonly string[],
  conditionName: string,
): boolean => normalizeConditionNames(conditions)
  .some(condition => (conditionBaseName(condition) ?? condition) === conditionName)

const policySnapshot = (
  operation: MoveDamageEffectOperation,
): MoveDamageTypeEffectivenessPolicy => operation.payload.typeEffectiveness
  ?? DEFAULT_MOVE_DAMAGE_TYPE_EFFECTIVENESS_POLICY

/** Resolve move type, STAB membership, immunity, and effectiveness for one server-owned recipient. */
export const resolveMoveDamageType = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveDamageEffectOperation
  readonly script: Pick<MoveAutomationScript, 'moveName' | 'keywords'>
  readonly recipientId: string
  readonly canonicalMoveId?: string
}): MoveDamageTypeResolution => {
  const placement = options.context.queries.placements.get(options.recipientId)
  const target = options.context.queries.tokens.get(options.recipientId)
  if (!placement || !target) {
    return fail(
      'move-type-unavailable',
      options.operation,
      options.recipientId,
      `Damage recipient ${options.recipientId} is unavailable.`,
    )
  }
  options.context.reads.recordPlacement(options.context.actor.placement)
  options.context.reads.recordPlacement(placement)

  const moveType = resolvedMoveType({
    ...options,
    canonicalMoveId: options.canonicalMoveId ?? options.script.moveName,
  })
  const policy = policySnapshot(options.operation)
  const overrides = new Map<PokemonType, MoveEffectTypeRelation>()
  for (const override of policy.defenderTypeOverrides) {
    const defenderType = requiredCanonicalType(
      override.defenderType,
      options.operation,
      options.recipientId,
      'unknown-defender-type-override',
      'Defender type override',
    )
    overrides.set(defenderType, override.relation)
  }

  const defenderTypes = target.defenderTypes.flatMap((value) => {
    const type = canonicalType(value)
    return type ? [type] : []
  })
  const defenderTypeEvaluations = defenderTypes.map((defenderType): MoveDamageDefenderTypeEvaluation => {
    const overridden = overrides.get(defenderType)
    const relation = overridden ?? relationForMultiplier(
      singleTypeMultiplier(moveType.type, defenderType),
    )
    const ignored = (relation === 'immune' && policy.immunity === 'ignore')
      || (relation === 'resistant' && policy.resistance === 'ignore')
      || (relation === 'weak' && policy.weakness === 'ignore')
    return {
      defenderType,
      relation,
      source: overridden ? 'move-override' : 'type-chart',
      ignored,
      effectivenessStep: relationStep(relation),
    }
  })

  const chartImmunity = defenderTypeEvaluations.find(evaluation => (
    evaluation.relation === 'immune' && !evaluation.ignored
  )) ?? null
  const effectivenessSteps = defenderTypeEvaluations.reduce((total, evaluation) => (
    total + (evaluation.ignored || evaluation.effectivenessStep === null
      ? 0
      : evaluation.effectivenessStep)
  ), 0)
  const baseMultiplier = chartImmunity
    ? 0
    : multiplierFromEffectivenessSteps(effectivenessSteps)
  const powderImmunity = policy.immunity === 'honor'
    ? moveAutomationPowderImmunitySource(options.script, target)
    : null
  const passive = chartImmunity || powderImmunity
    ? { multiplier: 0, sources: [] as string[] }
    : resolveSheetPassiveTypeEffectiveness(
        moveType.type,
        baseMultiplier,
        target.abilityNames,
        target.defenderCapabilities,
        {
          baseMultiplier,
          moveKeywords: moveAutomationPassiveImmunityKeywordsForTarget(
            options.script.keywords,
            target,
          ),
          ignoreImmunity: policy.immunity === 'ignore',
          ignoreResistance: policy.resistance === 'ignore',
        },
      )
  let passiveMultiplier = passive.multiplier
  const passiveSources = [...passive.sources]
  if (
    policy.resistance === 'honor'
    && moveType.type === 'Electric'
    && passiveMultiplier > 0
    && targetHasCondition(target.conditions, ELECTRIC_RESISTANT_COAT_CONDITION)
  ) {
    passiveMultiplier = resistMultiplierOneStepFurther(passiveMultiplier)
    passiveSources.push(ELECTRIC_RESISTANT_COAT_CONDITION)
  }

  const passiveImmunity = passiveMultiplier === 0 && baseMultiplier !== 0
    ? passiveSources.join(', ') || `${moveType.type} immunity`
    : null
  const honoredImmunitySource = chartImmunity
    ? `${chartImmunity.defenderType} type`
    : powderImmunity ?? passiveImmunity
  const effectivenessOverride = policy.effectivenessOverride
  const finalMultiplier = honoredImmunitySource
    ? 0
    : effectivenessOverride ?? passiveMultiplier
  const immunitySource = honoredImmunitySource
    ?? (finalMultiplier === 0 && effectivenessOverride === 0
      ? 'effectiveness override'
      : null)
  const hasStab = options.context.actor.token.sheetKind === 'pokemon'
    && options.context.actor.token.defenderTypes.some(type => canonicalType(type) === moveType.type)

  return deepFreeze({
    operationId: options.operation.id,
    recipientId: options.recipientId,
    moveType: moveType.type,
    moveTypeSource: moveType.source,
    defenderTypes,
    defenderTypeEvaluations,
    policy: {
      ...policy,
      defenderTypeOverrides: policy.defenderTypeOverrides.map(override => ({ ...override })),
    },
    baseMultiplier,
    passiveMultiplier,
    passiveSources,
    finalMultiplier,
    finalRelation: relationForMultiplier(finalMultiplier),
    immunitySource,
    hasStab,
    evaluationTrace: [...moveType.trace],
  })
}
