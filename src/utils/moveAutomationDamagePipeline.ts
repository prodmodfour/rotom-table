export const MOVE_DAMAGE_PIPELINE_STAGES = [
  'base-damage-base',
  'attack-stat',
  'defense-stat',
  'pre-type-modifiers',
  'type-effectiveness',
  'critical-modifiers',
  'post-damage-modifiers',
  'minimum-damage',
  'final-hp-loss',
] as const

export const MOVE_DAMAGE_MODIFIER_OPERATIONS = [
  'set',
  'add',
  'subtract',
  'multiply',
  'multiply-floor',
  'add-before-type',
  'floor-at-least',
  'cap-at-most',
  'floor',
] as const

export const MOVE_DAMAGE_PIPELINE_LIMITS = Object.freeze({
  modifiers: 128,
  identifierLength: 160,
  sourceLength: 500,
  priorityMagnitude: 100_000,
  numericMagnitude: 1_000_000_000,
})

export type MoveDamagePipelineStage = (typeof MOVE_DAMAGE_PIPELINE_STAGES)[number]
export type MoveDamageModifierOperation = (typeof MOVE_DAMAGE_MODIFIER_OPERATIONS)[number]

export interface MoveDamageModifierSource {
  /** Stable source category such as move, placement, condition, field, or rules. */
  readonly kind: string
  /** Stable authoritative source identity; display text is not interpreted as mechanics. */
  readonly id: string
}

interface MoveDamageModifierBase {
  readonly id: string
  readonly stage: MoveDamagePipelineStage
  /** Lower priorities resolve first within one stage. Ties use stable metadata ordering. */
  readonly priority: number
  readonly source: MoveDamageModifierSource
  /** Stack eligibility is resolved by the authoritative source query; this family remains in the trace. */
  readonly stackingGroup: string
  readonly reasonCode: string
}

export interface MoveDamageNumericModifier extends MoveDamageModifierBase {
  readonly operation: Exclude<MoveDamageModifierOperation, 'floor'>
  readonly value: number
}

export interface MoveDamageFloorModifier extends MoveDamageModifierBase {
  readonly operation: 'floor'
}

export type MoveDamageModifier = MoveDamageNumericModifier | MoveDamageFloorModifier

export interface MoveDamageModifierTraceEntry extends MoveDamageModifierBase {
  readonly operation: MoveDamageModifierOperation
  readonly value: number | null
  readonly input: number
  readonly output: number
}

export interface MoveDamagePipelineStageTrace {
  readonly stage: MoveDamagePipelineStage
  /** The final reviewed DB is attached to the stage that turns its roll into damage. */
  readonly damageBase: number | null
  readonly input: number
  readonly output: number
  readonly modifiers: readonly MoveDamageModifierTraceEntry[]
}

export interface MoveDamagePipelineResult {
  readonly damageBase: number | null
  readonly preTypeDamage: number
  readonly typeScaledDamage: number
  /** Includes critical dice replayed through the same type-effectiveness stage. */
  readonly criticalScaledDamage: number
  readonly postModifierDamage: number
  readonly minimumDamageApplied: boolean
  readonly hpLoss: number
  readonly stages: readonly MoveDamagePipelineStageTrace[]
}

export interface ResolveMoveDamagePipelineInput {
  readonly damageBase: number | null
  readonly modifiers: readonly MoveDamageModifier[]
}

export type MoveDamagePipelineErrorCode =
  | 'invalid-damage-base'
  | 'invalid-modifier'
  | 'duplicate-modifier-id'
  | 'modifier-limit-exceeded'
  | 'invalid-modifier-stage'
  | 'damage-value-out-of-range'
  | 'invalid-final-hp-loss'

export class MoveDamagePipelineError extends Error {
  readonly code: MoveDamagePipelineErrorCode
  readonly modifierId: string | null

  constructor(
    code: MoveDamagePipelineErrorCode,
    message: string,
    modifierId: string | null = null,
  ) {
    super(message)
    this.name = 'MoveDamagePipelineError'
    this.code = code
    this.modifierId = modifierId
  }
}

const STAGE_ORDER = new Map<MoveDamagePipelineStage, number>(
  MOVE_DAMAGE_PIPELINE_STAGES.map((stage, index) => [stage, index]),
)
const STAGE_SET = new Set<string>(MOVE_DAMAGE_PIPELINE_STAGES)
const OPERATION_SET = new Set<string>(MOVE_DAMAGE_MODIFIER_OPERATIONS)
const STABLE_CODE = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const compareText = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
)

const fail = (
  code: MoveDamagePipelineErrorCode,
  message: string,
  modifierId: string | null = null,
): never => {
  throw new MoveDamagePipelineError(code, message, modifierId)
}

const assertStableCode = (
  value: unknown,
  field: string,
  modifierId: string | null,
): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_DAMAGE_PIPELINE_LIMITS.identifierLength
    || !STABLE_CODE.test(value)
  ) {
    return fail(
      'invalid-modifier',
      `${field} must be a bounded stable code.`,
      modifierId,
    )
  }
  return value
}

const assertSourceId = (value: unknown, modifierId: string): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > MOVE_DAMAGE_PIPELINE_LIMITS.sourceLength
    || value.trim() !== value
  ) {
    return fail(
      'invalid-modifier',
      'Damage modifier source.id must be a bounded non-blank string.',
      modifierId,
    )
  }
  return value
}

const assertFiniteBounded = (
  value: unknown,
  label: string,
  modifierId: string | null,
): number => {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || Math.abs(value) > MOVE_DAMAGE_PIPELINE_LIMITS.numericMagnitude
  ) {
    return fail(
      'damage-value-out-of-range',
      `${label} must be finite and within the damage pipeline numeric bound.`,
      modifierId,
    )
  }
  return value
}

const validateModifier = (value: MoveDamageModifier): MoveDamageModifier => {
  const modifierId = assertStableCode(value?.id, 'Damage modifier id', null)
  if (!STAGE_SET.has(value.stage)) {
    return fail(
      'invalid-modifier',
      `Damage modifier ${modifierId} has an unknown stage.`,
      modifierId,
    )
  }
  if (!OPERATION_SET.has(value.operation)) {
    return fail(
      'invalid-modifier',
      `Damage modifier ${modifierId} has an unknown operation.`,
      modifierId,
    )
  }
  if (
    !Number.isSafeInteger(value.priority)
    || Math.abs(value.priority) > MOVE_DAMAGE_PIPELINE_LIMITS.priorityMagnitude
  ) {
    return fail(
      'invalid-modifier',
      `Damage modifier ${modifierId} priority is out of range.`,
      modifierId,
    )
  }
  if (!value.source || typeof value.source !== 'object') {
    return fail('invalid-modifier', `Damage modifier ${modifierId} requires a source.`, modifierId)
  }
  const source = {
    kind: assertStableCode(value.source.kind, 'Damage modifier source.kind', modifierId),
    id: assertSourceId(value.source.id, modifierId),
  }
  const stackingGroup = assertStableCode(
    value.stackingGroup,
    'Damage modifier stackingGroup',
    modifierId,
  )
  const reasonCode = assertStableCode(
    value.reasonCode,
    'Damage modifier reasonCode',
    modifierId,
  )

  if (value.operation === 'add-before-type' && value.stage !== 'critical-modifiers') {
    return fail(
      'invalid-modifier-stage',
      `Damage modifier ${modifierId} may add before type only in critical-modifiers.`,
      modifierId,
    )
  }
  if (value.stage === 'critical-modifiers' && value.operation !== 'add-before-type') {
    return fail(
      'invalid-modifier-stage',
      `Damage modifier ${modifierId} must use add-before-type in critical-modifiers.`,
      modifierId,
    )
  }
  if (value.stage === 'minimum-damage' && value.operation !== 'floor-at-least') {
    return fail(
      'invalid-modifier-stage',
      `Damage modifier ${modifierId} must use floor-at-least in minimum-damage.`,
      modifierId,
    )
  }
  if (value.operation === 'floor') {
    return { ...value, id: modifierId, source, stackingGroup, reasonCode }
  }
  const numeric = value as MoveDamageNumericModifier
  return {
    ...numeric,
    id: modifierId,
    source,
    stackingGroup,
    reasonCode,
    value: assertFiniteBounded(numeric.value, `Damage modifier ${modifierId} value`, modifierId),
  }
}

const compareModifiers = (left: MoveDamageModifier, right: MoveDamageModifier): number => (
  (STAGE_ORDER.get(left.stage)! - STAGE_ORDER.get(right.stage)!)
  || (left.priority - right.priority)
  || compareText(left.stackingGroup, right.stackingGroup)
  || compareText(left.source.kind, right.source.kind)
  || compareText(left.source.id, right.source.id)
  || compareText(left.id, right.id)
)

const normalizedModifiers = (
  values: readonly MoveDamageModifier[],
): readonly MoveDamageModifier[] => {
  if (values.length > MOVE_DAMAGE_PIPELINE_LIMITS.modifiers) {
    return fail(
      'modifier-limit-exceeded',
      `Damage pipeline accepts at most ${MOVE_DAMAGE_PIPELINE_LIMITS.modifiers} modifiers.`,
    )
  }
  const seen = new Set<string>()
  const modifiers = values.map((value) => {
    const modifier = validateModifier(value)
    if (seen.has(modifier.id)) {
      return fail(
        'duplicate-modifier-id',
        `Damage modifier id ${modifier.id} is duplicated.`,
        modifier.id,
      )
    }
    seen.add(modifier.id)
    return modifier
  })
  return modifiers.sort(compareModifiers)
}

const applyModifier = (input: number, modifier: MoveDamageModifier): number => {
  let output: number
  switch (modifier.operation) {
    case 'set':
      output = modifier.value
      break
    case 'add':
      output = input + modifier.value
      break
    case 'subtract':
      output = input - modifier.value
      break
    case 'multiply':
      output = input * modifier.value
      break
    case 'multiply-floor':
      output = Math.floor(input * modifier.value)
      break
    case 'floor-at-least':
      output = Math.max(input, modifier.value)
      break
    case 'cap-at-most':
      output = Math.min(input, modifier.value)
      break
    case 'floor':
      output = Math.floor(input)
      break
    case 'add-before-type':
      return fail(
        'invalid-modifier-stage',
        `Damage modifier ${modifier.id} requires critical type replay.`,
        modifier.id,
      )
  }
  return assertFiniteBounded(output, `Damage after modifier ${modifier.id}`, modifier.id)
}

const traceEntry = (
  modifier: MoveDamageModifier,
  input: number,
  output: number,
): MoveDamageModifierTraceEntry => ({
  id: modifier.id,
  stage: modifier.stage,
  priority: modifier.priority,
  source: { ...modifier.source },
  stackingGroup: modifier.stackingGroup,
  reasonCode: modifier.reasonCode,
  operation: modifier.operation,
  value: modifier.operation === 'floor' ? null : modifier.value,
  input,
  output,
})

const stageOutput = (
  stages: readonly MoveDamagePipelineStageTrace[],
  stage: MoveDamagePipelineStage,
): number => stages.find(entry => entry.stage === stage)!.output

/**
 * Apply one complete, server-authored damage modifier list in canonical stage
 * and priority order. Critical dice are declared after type effectiveness in
 * the trace, but are replayed through the same type stage so PTU rounding is
 * identical to adding those dice before effectiveness.
 */
export const resolveMoveDamagePipeline = (
  input: ResolveMoveDamagePipelineInput,
): MoveDamagePipelineResult => {
  if (
    input.damageBase !== null
    && (!Number.isSafeInteger(input.damageBase)
      || input.damageBase < 0
      || input.damageBase > MOVE_DAMAGE_PIPELINE_LIMITS.numericMagnitude)
  ) {
    return fail('invalid-damage-base', 'Resolved Damage Base must be a bounded non-negative integer.')
  }

  const modifiers = normalizedModifiers(input.modifiers)
  const byStage = new Map<MoveDamagePipelineStage, readonly MoveDamageModifier[]>(
    MOVE_DAMAGE_PIPELINE_STAGES.map(stage => [
      stage,
      modifiers.filter(modifier => modifier.stage === stage),
    ]),
  )
  const stages: MoveDamagePipelineStageTrace[] = []
  let current = 0
  let preTypeDamage = 0
  let criticalPreTypeBonus = 0
  let typeModifiers: readonly MoveDamageModifier[] = []

  const replayTypeStage = (value: number): number => typeModifiers.reduce(
    (result, modifier) => applyModifier(result, modifier),
    value,
  )

  for (const stage of MOVE_DAMAGE_PIPELINE_STAGES) {
    const stageInput = current
    const stageModifiers = byStage.get(stage) ?? []
    const traces: MoveDamageModifierTraceEntry[] = []

    if (stage === 'critical-modifiers') {
      for (const modifier of stageModifiers) {
        const before = current
        criticalPreTypeBonus = assertFiniteBounded(
          criticalPreTypeBonus + (modifier as MoveDamageNumericModifier).value,
          `Critical modifier aggregate after ${modifier.id}`,
          modifier.id,
        )
        current = replayTypeStage(preTypeDamage + criticalPreTypeBonus)
        traces.push(traceEntry(modifier, before, current))
      }
    }
    else {
      for (const modifier of stageModifiers) {
        const before = current
        current = applyModifier(current, modifier)
        traces.push(traceEntry(modifier, before, current))
      }
    }

    if (stage === 'pre-type-modifiers') preTypeDamage = current
    if (stage === 'type-effectiveness') typeModifiers = stageModifiers
    stages.push({
      stage,
      damageBase: stage === 'base-damage-base' ? input.damageBase : null,
      input: stageInput,
      output: current,
      modifiers: traces,
    })
  }

  if (!Number.isSafeInteger(current) || current < 0) {
    return fail(
      'invalid-final-hp-loss',
      'The final HP loss stage must produce a non-negative safe integer.',
    )
  }

  const postModifierDamage = stageOutput(stages, 'post-damage-modifiers')
  const minimumDamage = stageOutput(stages, 'minimum-damage')
  const result: MoveDamagePipelineResult = {
    damageBase: input.damageBase,
    preTypeDamage,
    typeScaledDamage: stageOutput(stages, 'type-effectiveness'),
    criticalScaledDamage: stageOutput(stages, 'critical-modifiers'),
    postModifierDamage,
    minimumDamageApplied: minimumDamage !== postModifierDamage,
    hpLoss: current,
    stages,
  }
  return deepFreeze(result)
}
