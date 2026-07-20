import type {
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDamageClass,
  MoveDamageEffectOperation,
  MoveDirectHpEffectOperation,
  MoveEffectOperation,
  MoveHealEffectOperation,
  MoveMultiHitEffectOperation,
  MoveEffectRecipientSelectorKind,
} from '#shared/moveAutomation/effects'
import type { MovePredicate } from '#shared/moveAutomation/predicates'
import type {
  MoveSpec,
  MoveSpecCostDeclaration,
  MoveSpecEffectOperation,
  MoveSpecJsonObject,
  MoveSpecTargetingDeclaration,
} from '#shared/moveAutomation/spec'
import {
  createStandardMoveAccuracyOperation,
  createStandardMoveCompletionLogOperation,
  createStandardMoveUsageOperation,
} from '../standardDamageOperations'

export interface ReviewedMoveSpecDefinition {
  readonly canonicalId: string
  readonly slug?: string
  readonly targeting: MoveSpecTargetingDeclaration
  readonly operations: readonly MoveEffectOperation[]
  readonly preconditions?: MoveSpec['preconditions']
  readonly costs?: readonly MoveSpecCostDeclaration[]
  readonly registeredHandlerId?: string | null
  readonly tags?: readonly string[]
  readonly version?: number
}

export const moveSlug = (canonicalId: string): string => canonicalId
  .normalize('NFKD')
  .replace(/[’']/g, '')
  .replace(/[^A-Za-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .toLowerCase()

export const asMoveSpecOperations = (
  operations: readonly MoveEffectOperation[],
): readonly MoveSpecEffectOperation[] => (
  operations as unknown as readonly MoveSpecEffectOperation[]
)

export const standardActionCost = (slug: string): MoveSpecCostDeclaration => ({
  id: `${slug}.cost.standard-action`,
  phase: 'pay',
  cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
})

export const automaticSetupExecuteCost = (slug: string): MoveSpecCostDeclaration => ({
  id: `${slug}.cost.setup-execute`,
  phase: 'declare',
  cost: { kind: 'setup-execute', step: 'auto' },
})

export const createReviewedMoveSpec = (
  definition: ReviewedMoveSpecDefinition,
): MoveSpec => {
  const slug = definition.slug ?? moveSlug(definition.canonicalId)
  const byPhase = new Map<MoveEffectOperation['phase'], MoveEffectOperation[]>()
  for (const operation of definition.operations) {
    const phase = byPhase.get(operation.phase) ?? []
    phase.push(operation)
    byPhase.set(operation.phase, phase)
  }
  return Object.freeze({
    schemaVersion: 2,
    canonicalId: definition.canonicalId,
    version: definition.version ?? 2,
    targeting: definition.targeting,
    preconditions: definition.preconditions ?? [],
    costs: definition.costs ?? [standardActionCost(slug)],
    phases: [...byPhase].map(([phase, operations]) => ({
      phase,
      operations: asMoveSpecOperations(operations),
    })),
    registeredHandlerId: definition.registeredHandlerId ?? null,
    presentation: {
      displayName: definition.canonicalId,
      vfxKey: `move.${slug}`,
      tags: [...(definition.tags ?? [])],
    },
  })
}

export const selfTargeting = (): MoveSpecTargetingDeclaration => ({
  kind: 'self',
  minTargets: 1,
  maxTargets: 1,
  selector: { kind: 'actor' },
})

export const singleTargeting = (): MoveSpecTargetingDeclaration => ({
  kind: 'single-target',
  minTargets: 1,
  maxTargets: 1,
  selector: { kind: 'selected-targets' },
})

export const multiTargeting = (
  minimum: number,
  maximum: number,
): MoveSpecTargetingDeclaration => ({
  kind: 'multi-target',
  minTargets: minimum,
  maxTargets: maximum,
  selector: { kind: 'selected-targets' },
})

export const areaTargeting = (
  predicate: MoveSpecJsonObject = {
    relationship: 'any',
    willingness: 'any',
    excludeActor: true,
  },
): MoveSpecTargetingDeclaration => ({
  kind: 'area',
  minTargets: 0,
  maxTargets: 32,
  selector: { kind: 'area-targets' },
  predicate,
})

export const fieldTargeting = (): MoveSpecTargetingDeclaration => ({
  kind: 'field',
  minTargets: 0,
  maxTargets: 0,
  selector: null,
})

export const standardAccuracy = (slug: string): MoveEffectOperation => (
  createStandardMoveAccuracyOperation({ slug })
)

export interface ReviewedDamageInput {
  readonly slug: string
  readonly id?: string
  readonly damageBase: MoveDamageEffectOperation['payload']['damageBase']
  readonly damageClass: MoveDamageClass
  readonly moveType: MoveDamageEffectOperation['payload']['moveType']
  readonly recipients?: MoveEffectRecipientSelectorKind
  readonly sourceOperationId?: string
  readonly accuracyRollId?: string | null
  readonly criticalRollId?: string | null
  readonly attackStat?: MoveDamageEffectOperation['payload']['attackStat']
  readonly defenseStat?: MoveDamageEffectOperation['payload']['defenseStat']
  readonly typeEffectiveness?: MoveDamageEffectOperation['payload']['typeEffectiveness']
  readonly criticalHit?: MoveDamageEffectOperation['payload']['criticalHit']
  readonly preTypeDamageModifiers?: MoveDamageEffectOperation['payload']['preTypeDamageModifiers']
}

export const reviewedDamage = (input: ReviewedDamageInput): MoveDamageEffectOperation => ({
  id: `${input.slug}.${input.id ?? 'damage'}`,
  kind: 'damage',
  source: input.sourceOperationId
    ? { kind: 'operation', id: input.sourceOperationId }
    : { kind: 'operation', id: `${input.slug}.accuracy` },
  recipients: { kind: input.recipients ?? 'hit-targets' },
  phase: 'damage',
  reasonCode: `${input.slug}.damage`,
  payload: {
    damageClass: input.damageClass,
    damageBase: input.damageBase,
    moveType: input.moveType,
    accuracyRollId: input.accuracyRollId === undefined
      ? `${input.slug}.accuracy-roll`
      : input.accuracyRollId,
    criticalRollId: input.criticalRollId === undefined
      ? `${input.slug}.accuracy-roll`
      : input.criticalRollId,
    ...(input.attackStat ? { attackStat: input.attackStat } : {}),
    ...(input.defenseStat ? { defenseStat: input.defenseStat } : {}),
    ...(input.typeEffectiveness ? { typeEffectiveness: input.typeEffectiveness } : {}),
    ...(input.criticalHit ? { criticalHit: input.criticalHit } : {}),
    ...(input.preTypeDamageModifiers
      ? { preTypeDamageModifiers: input.preTypeDamageModifiers }
      : {}),
  },
})

export interface ReviewedMultiHitInput {
  readonly slug: string
  readonly damageBase: MoveMultiHitEffectOperation['payload']['damage']['damageBase']
  readonly damageClass: MoveDamageClass
  readonly moveType: MoveMultiHitEffectOperation['payload']['damage']['moveType']
  readonly count: MoveMultiHitEffectOperation['payload']['count']
  readonly accuracy: MoveMultiHitEffectOperation['payload']['accuracy']
  readonly critical?: MoveMultiHitEffectOperation['payload']['critical']
  readonly effects?: MoveMultiHitEffectOperation['payload']['effects']
  readonly attackStat?: MoveMultiHitEffectOperation['payload']['damage']['attackStat']
  readonly defenseStat?: MoveMultiHitEffectOperation['payload']['damage']['defenseStat']
  readonly preTypeDamageModifiers?: MoveMultiHitEffectOperation['payload']['damage']['preTypeDamageModifiers']
  readonly id?: string
}

export const reviewedMultiHit = (
  input: ReviewedMultiHitInput,
): MoveMultiHitEffectOperation => ({
  id: `${input.slug}.${input.id ?? 'multi-hit'}`,
  kind: 'multi-hit',
  source: { kind: 'move', id: `move.${input.slug}` },
  recipients: { kind: 'attacked-targets' },
  phase: 'damage',
  reasonCode: `${input.slug}.multi-hit`,
  payload: {
    count: input.count,
    accuracy: input.accuracy,
    critical: input.critical ?? (
      input.accuracy.kind === 'per-hit'
        ? { kind: 'accuracy' }
        : {
            kind: 'per-hit',
            rollId: `${input.slug}.critical-roll`,
            formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
          }
    ),
    damage: {
      damageClass: input.damageClass,
      damageBase: input.damageBase,
      moveType: input.moveType,
      accuracyRollId: null,
      criticalRollId: null,
      ...(input.attackStat ? { attackStat: input.attackStat } : {}),
      ...(input.defenseStat ? { defenseStat: input.defenseStat } : {}),
      ...(input.preTypeDamageModifiers
        ? { preTypeDamageModifiers: input.preTypeDamageModifiers }
        : {}),
    },
    effects: input.effects ?? [],
  },
})

export interface ReviewedDirectHpInput {
  readonly slug: string
  readonly id: string
  readonly recipients: MoveEffectRecipientSelectorKind
  readonly calculation: MoveDirectHpEffectOperation['payload']['calculation']
  readonly mode?: MoveDirectHpEffectOperation['payload']['mode']
  readonly pool?: MoveDirectHpEffectOperation['payload']['pool']
  readonly sourceOperationId?: string
  readonly phase?: MoveDirectHpEffectOperation['phase']
  readonly bounds?: MoveDirectHpEffectOperation['payload']['bounds']
  readonly rounding?: MoveDirectHpEffectOperation['payload']['rounding']
  readonly accuracyRollId?: string | null
  readonly applyTypeImmunity?: boolean
  readonly cost?: MoveDirectHpEffectOperation['payload']['cost']
  readonly copySource?: MoveDirectHpEffectOperation['payload']['copySource']
  readonly hitPointMarkers?: MoveDirectHpEffectOperation['payload']['injury']['hitPointMarkers']
}

export const reviewedDirectHp = (
  input: ReviewedDirectHpInput,
): MoveDirectHpEffectOperation => ({
  id: `${input.slug}.${input.id}`,
  kind: 'direct-hp',
  source: input.sourceOperationId
    ? { kind: 'operation', id: input.sourceOperationId }
    : { kind: 'move', id: `move.${input.slug}` },
  recipients: { kind: input.recipients },
  phase: input.phase ?? 'after-damage',
  reasonCode: `${input.slug}.${input.id}`,
  payload: {
    mode: input.mode ?? 'lose',
    pool: input.pool ?? 'hit-points',
    calculation: input.calculation,
    copySource: input.copySource ?? null,
    bounds: input.bounds ?? { minimum: null, maximum: null },
    rounding: input.rounding ?? 'floor',
    ...(input.accuracyRollId === undefined ? {} : { accuracyRollId: input.accuracyRollId }),
    applyTypeImmunity: input.applyTypeImmunity ?? false,
    cost: input.cost ?? null,
    injury: {
      hitPointMarkers: input.hitPointMarkers ?? 'apply-after-operation',
      massiveDamage: 'never',
    },
  },
})

export interface ReviewedHealInput {
  readonly slug: string
  readonly id: string
  readonly recipients: MoveEffectRecipientSelectorKind
  readonly calculation: MoveHealEffectOperation['payload']['calculation']
  readonly mode?: MoveHealEffectOperation['payload']['mode']
  readonly pool?: MoveHealEffectOperation['payload']['pool']
  readonly sourceOperationId?: string
  readonly phase?: MoveHealEffectOperation['phase']
  readonly bounds?: MoveHealEffectOperation['payload']['bounds']
  readonly rounding?: MoveHealEffectOperation['payload']['rounding']
  readonly operationOutcomeTrigger?: MoveHealEffectOperation['payload']['operationOutcomeTrigger']
}

export const reviewedHeal = (input: ReviewedHealInput): MoveHealEffectOperation => ({
  id: `${input.slug}.${input.id}`,
  kind: 'heal',
  source: input.sourceOperationId
    ? { kind: 'operation', id: input.sourceOperationId }
    : { kind: 'move', id: `move.${input.slug}` },
  recipients: { kind: input.recipients },
  phase: input.phase ?? 'after-damage',
  reasonCode: `${input.slug}.${input.id}`,
  payload: {
    mode: input.mode ?? 'gain',
    pool: input.pool ?? 'hit-points',
    calculation: input.calculation,
    bounds: input.bounds ?? { minimum: null, maximum: null },
    rounding: input.rounding ?? 'floor',
    ...(input.operationOutcomeTrigger
      ? { operationOutcomeTrigger: input.operationOutcomeTrigger }
      : {}),
    injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
  },
})

export interface ReviewedStageInput {
  readonly slug: string
  readonly id: string
  readonly recipients: MoveEffectRecipientSelectorKind
  readonly stage: MoveCombatStageEffectOperation['payload']['stage']
  readonly value: number | null
  readonly action?: MoveCombatStageEffectOperation['payload']['action']
  readonly sourceOperationId?: string
  readonly phase?: MoveCombatStageEffectOperation['phase']
  readonly selectedStage?: MoveCombatStageEffectOperation['payload']['selectedStage']
  readonly stageSource?: MoveCombatStageEffectOperation['payload']['stageSource']
  readonly rounding?: MoveCombatStageEffectOperation['payload']['rounding']
  readonly applyTypeImmunity?: boolean
  readonly trigger?: MoveCombatStageEffectOperation['payload']['trigger']
}

export const reviewedStage = (input: ReviewedStageInput): MoveCombatStageEffectOperation => ({
  id: `${input.slug}.${input.id}`,
  kind: 'combat-stage',
  source: input.sourceOperationId
    ? { kind: 'operation', id: input.sourceOperationId }
    : { kind: 'move', id: `move.${input.slug}` },
  recipients: { kind: input.recipients },
  phase: input.phase ?? 'after-damage',
  reasonCode: `${input.slug}.${input.id}`,
  payload: {
    action: input.action ?? 'modify',
    stage: input.stage,
    selectedStage: input.selectedStage ?? null,
    value: input.value,
    stageSource: input.stageSource ?? null,
    rounding: input.rounding ?? null,
    ...(input.applyTypeImmunity ? { applyTypeImmunity: true } : {}),
    ...(input.trigger ? { trigger: input.trigger } : {}),
  },
})

export interface ReviewedConditionInput {
  readonly slug: string
  readonly id: string
  readonly recipients: MoveEffectRecipientSelectorKind
  readonly conditionId: string
  readonly action?: Extract<MoveConditionEffectOperation['payload']['action'], 'apply' | 'remove'>
  readonly sourceOperationId?: string
  readonly phase?: MoveConditionEffectOperation['phase']
  readonly accuracyRollTrigger?: MoveConditionEffectOperation['payload']['accuracyRollTrigger']
  readonly operationOutcomeTrigger?: MoveConditionEffectOperation['payload']['operationOutcomeTrigger']
  readonly applyTypeImmunity?: boolean
  readonly duration?: MoveConditionEffectOperation['payload']['duration']
  readonly saveTiming?: MoveConditionEffectOperation['payload']['saveTiming']
}

export const reviewedCondition = (
  input: ReviewedConditionInput,
): MoveConditionEffectOperation => ({
  id: `${input.slug}.${input.id}`,
  kind: 'condition',
  source: input.sourceOperationId
    ? { kind: 'operation', id: input.sourceOperationId }
    : { kind: 'move', id: `move.${input.slug}` },
  recipients: { kind: input.recipients },
  phase: input.phase ?? 'after-damage',
  reasonCode: `${input.slug}.${input.id}`,
  payload: {
    action: input.action ?? 'apply',
    conditionId: input.conditionId,
    conditionSource: null,
    filter: null,
    randomChoice: null,
    ...(input.accuracyRollTrigger ? { accuracyRollTrigger: input.accuracyRollTrigger } : {}),
    ...(input.operationOutcomeTrigger
      ? { operationOutcomeTrigger: input.operationOutcomeTrigger }
      : {}),
    ...(input.applyTypeImmunity ? { applyTypeImmunity: true } : {}),
    duration: input.duration ?? null,
    saveTiming: input.saveTiming ?? 'canonical',
    stackPolicy: input.conditionId === 'flinch'
      ? { kind: 'add-stack', maxStacks: 64 }
      : { kind: 'refresh', maxStacks: null },
  },
})

export const predicatePrecondition = (input: {
  readonly id: string
  readonly predicate: MovePredicate
  readonly failureReasonCode: string
}): MoveSpec['preconditions'][number] => ({
  ...input,
  predicate: input.predicate as unknown as MoveSpecJsonObject,
})

export const standardTerminalOperations = (slug: string): readonly MoveEffectOperation[] => [
  createStandardMoveUsageOperation(slug),
  createStandardMoveCompletionLogOperation(slug),
]
