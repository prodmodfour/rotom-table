import type {
  MoveConditionAccuracyRollTrigger,
  MoveConditionEffectOperation,
  MoveConditionalEvasionRule,
  MoveDamageClass,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MovePreTypeDamageModifier,
  MoveRollEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  MoveSpec,
  MoveSpecEffectOperation,
  MoveSpecTargetingDeclaration,
} from '#shared/moveAutomation/spec'

export interface StandardMoveAccuracyOperationInput {
  readonly slug: string
  readonly evasionRule?: MoveConditionalEvasionRule
}

export const createStandardMoveAccuracyOperation = (
  input: StandardMoveAccuracyOperationInput,
): MoveRollEffectOperation => ({
  id: `${input.slug}.accuracy`,
  kind: 'roll',
  source: { kind: 'move', id: `move.${input.slug}` },
  recipients: { kind: 'attacked-targets' },
  phase: 'accuracy',
  reasonCode: `${input.slug}.accuracy-check`,
  payload: {
    rollId: `${input.slug}.accuracy-roll`,
    formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
    ...(input.evasionRule ? { evasionRule: input.evasionRule } : {}),
  },
})

export interface StandardMoveDamageOperationInput {
  readonly slug: string
  readonly damageBase: number
  readonly damageClass: MoveDamageClass
  readonly moveType: string
  readonly typeEffectiveness?: MoveDamageEffectOperation['payload']['typeEffectiveness']
  readonly attackStat?: MoveDamageEffectOperation['payload']['attackStat']
  readonly preTypeDamageModifiers?: readonly MovePreTypeDamageModifier[]
  /** Defaults to the authoritative accuracy operation. */
  readonly source?: MoveDamageEffectOperation['source']
}

export const createStandardMoveDamageOperation = (
  input: StandardMoveDamageOperationInput,
): MoveDamageEffectOperation => ({
  id: `${input.slug}.damage`,
  kind: 'damage',
  source: input.source ?? { kind: 'operation', id: `${input.slug}.accuracy` },
  recipients: { kind: 'hit-targets' },
  phase: 'damage',
  reasonCode: `${input.slug}.damage`,
  payload: {
    damageClass: input.damageClass,
    damageBase: input.damageBase,
    moveType: input.moveType,
    accuracyRollId: `${input.slug}.accuracy-roll`,
    criticalRollId: `${input.slug}.accuracy-roll`,
    ...(input.typeEffectiveness ? { typeEffectiveness: input.typeEffectiveness } : {}),
    ...(input.attackStat ? { attackStat: input.attackStat } : {}),
    ...(input.preTypeDamageModifiers
      ? { preTypeDamageModifiers: input.preTypeDamageModifiers }
      : {}),
  },
})

export interface AccuracyTriggeredConditionOperationInput {
  readonly slug: string
  readonly id: string
  readonly conditionId: string
  readonly trigger?: MoveConditionAccuracyRollTrigger['trigger']
  readonly sourceOperationId?: string
}

export const createAccuracyTriggeredConditionOperation = (
  input: AccuracyTriggeredConditionOperationInput,
): MoveConditionEffectOperation => ({
  id: `${input.slug}.${input.id}`,
  kind: 'condition',
  source: {
    kind: 'operation',
    id: input.sourceOperationId ?? `${input.slug}.damage`,
  },
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: `${input.slug}.${input.id}`,
  payload: {
    action: 'apply',
    conditionId: input.conditionId,
    conditionSource: null,
    filter: null,
    randomChoice: null,
    ...(input.trigger
      ? {
          accuracyRollTrigger: {
            rollId: `${input.slug}.accuracy-roll`,
            trigger: input.trigger,
          },
        }
      : {}),
    applyTypeImmunity: true,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: input.conditionId === 'flinch'
      ? { kind: 'add-stack', maxStacks: 64 }
      : { kind: 'refresh', maxStacks: null },
  },
})

export const createStandardMoveUsageOperation = (slug: string): MoveEffectOperation => ({
  id: `${slug}.usage`,
  kind: 'usage',
  source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'actor' },
  phase: 'usage',
  reasonCode: `${slug}.frequency-use`,
  payload: {
    action: 'spend',
    resourceId: `${slug}.frequency-use`,
    amount: 1,
  },
})

export const createStandardMoveCompletionLogOperation = (slug: string): MoveEffectOperation => ({
  id: `${slug}.log-completed`,
  kind: 'log',
  source: { kind: 'move', id: `move.${slug}` },
  recipients: { kind: 'none' },
  phase: 'cleanup',
  reasonCode: `${slug}.completed`,
  payload: { messageKey: `move.${slug}.completed`, arguments: [] },
})

/**
 * Build the reviewed 18–19 coin branch plus natural-20 dual outcome shared by
 * the elemental Fang family. The table roll is server-owned and is skipped for
 * misses, results below 18, and natural 20.
 */
export const createFangSecondaryOperations = (
  slug: 'fire-fang' | 'ice-fang' | 'thunder-fang',
  typedCondition: 'burned' | 'frozen' | 'paralysis',
): readonly MoveEffectOperation[] => {
  const typedOperationId = `${slug}.coin-${typedCondition}`
  const flinchOperationId = `${slug}.coin-flinch`
  const coin: MoveRollEffectOperation = {
    id: `${slug}.secondary-coin`,
    kind: 'roll',
    source: { kind: 'operation', id: `${slug}.damage` },
    recipients: { kind: 'none' },
    phase: 'after-damage',
    reasonCode: `${slug}.secondary-coin`,
    payload: {
      rollId: `${slug}.secondary-coin-roll`,
      formula: { kind: 'table', tableId: `${slug}.secondary-coin-table` },
      table: {
        tableId: `${slug}.secondary-coin-table`,
        distribution: 'equal',
        entries: [{
          id: typedCondition,
          weight: null,
          operationIds: [typedOperationId],
          predicate: null,
        }, {
          id: 'flinch',
          weight: null,
          operationIds: [flinchOperationId],
          predicate: null,
        }],
        maximumRerolls: 0,
      },
      accuracyRollTrigger: {
        rollId: `${slug}.accuracy-roll`,
        trigger: { kind: 'natural-rolls', values: [18, 19] },
      },
    },
  }
  const coinTrigger = { kind: 'natural-rolls' as const, values: [18, 19] }
  const exactTwenty = { kind: 'natural-rolls' as const, values: [20] }
  return [
    coin,
    createAccuracyTriggeredConditionOperation({
      slug,
      id: `coin-${typedCondition}`,
      conditionId: typedCondition,
      trigger: coinTrigger,
      sourceOperationId: coin.id,
    }),
    createAccuracyTriggeredConditionOperation({
      slug,
      id: 'coin-flinch',
      conditionId: 'flinch',
      trigger: coinTrigger,
      sourceOperationId: coin.id,
    }),
    createAccuracyTriggeredConditionOperation({
      slug,
      id: `natural-20-${typedCondition}`,
      conditionId: typedCondition,
      trigger: exactTwenty,
    }),
    createAccuracyTriggeredConditionOperation({
      slug,
      id: 'natural-20-flinch',
      conditionId: 'flinch',
      trigger: exactTwenty,
    }),
  ]
}

export const singleTargetMoveSpecTargeting = (): MoveSpecTargetingDeclaration => ({
  kind: 'single-target',
  minTargets: 1,
  maxTargets: 1,
  selector: { kind: 'selected-targets' },
})

const asMoveSpecOperations = (
  operations: readonly MoveEffectOperation[],
): readonly MoveSpecEffectOperation[] => operations as unknown as readonly MoveSpecEffectOperation[]

export interface ReviewedSingleTargetDamageSpecInput {
  readonly canonicalId: string
  readonly slug: string
  readonly targeting?: MoveSpecTargetingDeclaration
  readonly operations: readonly MoveEffectOperation[]
  readonly registeredHandlerId?: string | null
  readonly evasionRule?: MoveConditionalEvasionRule
  readonly tags: readonly string[]
}

/** Assemble the common authoritative accuracy, action, usage, and log envelope. */
export const createReviewedSingleTargetDamageSpec = (
  input: ReviewedSingleTargetDamageSpecInput,
): MoveSpec => Object.freeze({
  schemaVersion: 2,
  canonicalId: input.canonicalId,
  version: 2,
  targeting: input.targeting ?? singleTargetMoveSpecTargeting(),
  preconditions: [],
  costs: [{
    id: `${input.slug}.cost.standard-action`,
    phase: 'pay' as const,
    cost: { kind: 'action-resource' as const, resource: 'standard' as const, amount: 1 },
  }],
  phases: [
    {
      phase: 'accuracy' as const,
      operations: asMoveSpecOperations([createStandardMoveAccuracyOperation({
        slug: input.slug,
        evasionRule: input.evasionRule,
      })]),
    },
    ...(input.operations.some(operation => operation.phase === 'damage')
      ? [{
          phase: 'damage' as const,
          operations: asMoveSpecOperations(
            input.operations.filter(operation => operation.phase === 'damage'),
          ),
        }]
      : []),
    ...(input.operations.some(operation => operation.phase === 'after-damage')
      ? [{
          phase: 'after-damage' as const,
          operations: asMoveSpecOperations(
            input.operations.filter(operation => operation.phase === 'after-damage'),
          ),
        }]
      : []),
    {
      phase: 'usage' as const,
      operations: asMoveSpecOperations([createStandardMoveUsageOperation(input.slug)]),
    },
    {
      phase: 'cleanup' as const,
      operations: asMoveSpecOperations([createStandardMoveCompletionLogOperation(input.slug)]),
    },
  ],
  registeredHandlerId: input.registeredHandlerId ?? null,
  presentation: {
    displayName: input.canonicalId,
    vfxKey: `move.${input.slug}`,
    tags: [...input.tags],
  },
})
