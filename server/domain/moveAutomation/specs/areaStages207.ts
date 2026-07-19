import type {
  MoveBranchEffectOperation,
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDamageClass,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveMovementRequestEffectOperation,
} from '#shared/moveAutomation/effects'
import type {
  MoveSpec,
  MoveSpecEffectOperation,
  MoveSpecTargetingDeclaration,
} from '#shared/moveAutomation/spec'
import { AREA_STAGES_207_HANDLER_ID } from '../handlers/areaStages207'
import type { MoveSpecV2Registration } from '../registry'
import {
  createAccuracyTriggeredConditionOperation,
  createStandardMoveAccuracyOperation,
  createStandardMoveCompletionLogOperation,
  createStandardMoveUsageOperation,
} from '../standardDamageOperations'

export const MA_207_MOVE_NAMES = Object.freeze([
  'Gear Up',
  'Glaciate',
  'Haze',
  'Heart Swap',
  'Hyper Voice',
  'Hyperspace Fury',
  'Leaf Storm',
  'Leaf Tornado',
] as const)

export type AreaStages207MoveName = (typeof MA_207_MOVE_NAMES)[number]

const anyAreaTargets = (): MoveSpecTargetingDeclaration => ({
  kind: 'area',
  minTargets: 0,
  maxTargets: 32,
  selector: { kind: 'area-targets' },
  predicate: {
    relationship: 'any',
    willingness: 'any',
    excludeActor: true,
  },
})

const steelAreaTargets = (): MoveSpecTargetingDeclaration => ({
  ...anyAreaTargets(),
  predicate: {
    relationship: 'any',
    willingness: 'any',
    excludeActor: true,
    statePredicates: [{ kind: 'type', typeIds: ['steel'], match: 'any' }],
  },
})

const leafTornadoAreaTargets = (): MoveSpecTargetingDeclaration => ({
  ...anyAreaTargets(),
  predicate: {
    relationship: 'any',
    willingness: 'any',
    excludeActor: true,
    areaGeometry: {
      kind: 'exclude-center-by-size',
      sizes: ['small', 'medium'],
    },
  },
})

const selfTarget = (): MoveSpecTargetingDeclaration => ({
  kind: 'self',
  minTargets: 1,
  maxTargets: 1,
  selector: { kind: 'actor' },
})

const twoSelectedTargets = (): MoveSpecTargetingDeclaration => ({
  kind: 'multi-target',
  minTargets: 2,
  maxTargets: 2,
  selector: { kind: 'selected-targets' },
})

const asSpecOperations = (
  operations: readonly MoveEffectOperation[],
): readonly MoveSpecEffectOperation[] => operations as unknown as readonly MoveSpecEffectOperation[]

interface ReviewedDefinition {
  readonly canonicalId: AreaStages207MoveName
  readonly slug: string
  readonly targeting: MoveSpecTargetingDeclaration
  readonly operations: readonly MoveEffectOperation[]
  readonly tags: readonly string[]
  readonly handlerId?: string | null
}

const reviewedSpec = (definition: ReviewedDefinition): MoveSpec => {
  const byPhase = new Map<MoveEffectOperation['phase'], MoveEffectOperation[]>()
  for (const operation of definition.operations) {
    const operations = byPhase.get(operation.phase) ?? []
    operations.push(operation)
    byPhase.set(operation.phase, operations)
  }
  const spec: MoveSpec = {
    schemaVersion: 2,
    canonicalId: definition.canonicalId,
    version: 2,
    targeting: definition.targeting,
    preconditions: [],
    costs: [{
      id: `${definition.slug}.cost.standard-action`,
      phase: 'pay',
      cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
    }],
    phases: [...byPhase].map(([phase, operations]) => ({
      phase,
      operations: asSpecOperations(operations),
    })),
    registeredHandlerId: definition.handlerId ?? null,
    presentation: {
      displayName: definition.canonicalId,
      vfxKey: `move.${definition.slug}`,
      tags: [...definition.tags],
    },
  }
  return Object.freeze(spec)
}

const accuracy = (slug: string): MoveEffectOperation => (
  createStandardMoveAccuracyOperation({ slug })
)

const damage = (input: {
  readonly slug: string
  readonly damageBase: number
  readonly damageClass: MoveDamageClass
  readonly moveType: string
  readonly smite?: boolean
}): MoveDamageEffectOperation => ({
  id: `${input.slug}.damage`,
  kind: 'damage',
  source: { kind: 'operation', id: `${input.slug}.accuracy` },
  recipients: { kind: input.smite ? 'attacked-targets' : 'hit-targets' },
  phase: 'damage',
  reasonCode: `${input.slug}.damage`,
  payload: {
    damageClass: input.damageClass,
    damageBase: input.damageBase,
    moveType: input.moveType,
    accuracyRollId: `${input.slug}.accuracy-roll`,
    criticalRollId: `${input.slug}.accuracy-roll`,
  },
})

const stage = (input: {
  readonly slug: string
  readonly id: string
  readonly recipients: MoveCombatStageEffectOperation['recipients']['kind']
  readonly action?: MoveCombatStageEffectOperation['payload']['action']
  readonly stage: MoveCombatStageEffectOperation['payload']['stage']
  readonly value: number | null
  readonly sourceOperationId?: string
  readonly phase?: MoveCombatStageEffectOperation['phase']
  readonly trigger?: MoveCombatStageEffectOperation['payload']['trigger']
  readonly applyTypeImmunity?: boolean
}): MoveCombatStageEffectOperation => ({
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
    selectedStage: null,
    value: input.value,
    stageSource: null,
    rounding: null,
    ...(input.applyTypeImmunity ? { applyTypeImmunity: true } : {}),
    ...(input.trigger ? { trigger: input.trigger } : {}),
  },
})

const terminal = (slug: string): readonly MoveEffectOperation[] => [
  createStandardMoveUsageOperation(slug),
  createStandardMoveCompletionLogOperation(slug),
]

export const GEAR_UP_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Gear Up',
  slug: 'gear-up',
  targeting: steelAreaTargets(),
  operations: [
    stage({
      slug: 'gear-up',
      id: 'raise-attack',
      recipients: 'area-targets',
      stage: 'atk',
      value: 1,
      phase: 'hit',
    }),
    stage({
      slug: 'gear-up',
      id: 'raise-special-attack',
      recipients: 'area-targets',
      stage: 'satk',
      value: 1,
      phase: 'hit',
    }),
    ...terminal('gear-up'),
  ],
  tags: ['area', 'steel', 'stage', 'type-filter'],
})

const glaciateGroundingBranch: MoveBranchEffectOperation = {
  id: 'glaciate.grounded-branch',
  kind: 'branch',
  source: { kind: 'operation', id: 'glaciate.damage' },
  recipients: { kind: 'hit-targets' },
  phase: 'after-damage',
  reasonCode: 'glaciate.grounded-slow-eligibility',
  payload: {
    kind: 'predicate',
    selectionId: 'glaciate.grounded-selection',
    scope: 'recipient',
    predicate: {
      kind: 'comparison',
      operator: 'equal',
      left: { kind: 'grounding', subject: { kind: 'current-target' } },
      right: { kind: 'constant', value: 'grounded' },
    },
    whenTrue: {
      id: 'glaciate.grounded',
      operationIds: ['glaciate.slowed'],
    },
    whenFalse: {
      id: 'glaciate.airborne',
      operationIds: [],
    },
  },
}

const glaciateSlowed: MoveConditionEffectOperation = createAccuracyTriggeredConditionOperation({
  slug: 'glaciate',
  id: 'slowed',
  conditionId: 'slowed',
  trigger: {
    kind: 'natural-rolls',
    values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
  },
})

export const GLACIATE_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Glaciate',
  slug: 'glaciate',
  targeting: anyAreaTargets(),
  operations: [
    accuracy('glaciate'),
    damage({ slug: 'glaciate', damageBase: 7, damageClass: 'special', moveType: 'ice' }),
    stage({
      slug: 'glaciate',
      id: 'lower-speed',
      recipients: 'hit-targets',
      stage: 'spd',
      value: -1,
      sourceOperationId: 'glaciate.damage',
      applyTypeImmunity: true,
    }),
    glaciateGroundingBranch,
    glaciateSlowed,
    ...terminal('glaciate'),
  ],
  tags: ['area', 'condition', 'damage', 'grounded', 'ice', 'stage', 'threshold'],
})

export const HAZE_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Haze',
  slug: 'haze',
  // The no-target wire envelope is self; the operation itself addresses the
  // complete authoritative encounter placement set in map order.
  targeting: selfTarget(),
  operations: [
    stage({
      slug: 'haze',
      id: 'reset-all-stages',
      recipients: 'all-placements',
      action: 'reset',
      stage: 'all',
      value: null,
      phase: 'hit',
    }),
    ...terminal('haze'),
  ],
  tags: ['combat-stage', 'field', 'ice', 'reset'],
})

const heartSwapOperation: MoveCombatStageEffectOperation = {
  id: 'heart-swap.swap-all-stages',
  kind: 'combat-stage',
  source: { kind: 'move', id: 'move.heart-swap' },
  recipients: { kind: 'selected-targets' },
  phase: 'hit',
  reasonCode: 'heart-swap.swap-all-stages',
  payload: {
    action: 'swap',
    stage: 'all',
    selectedStage: null,
    value: null,
    stageSource: null,
    rounding: null,
  },
}

export const HEART_SWAP_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Heart Swap',
  slug: 'heart-swap',
  targeting: twoSelectedTargets(),
  operations: [heartSwapOperation, ...terminal('heart-swap')],
  tags: ['combat-stage', 'multi-target', 'psychic', 'swap'],
})

const hyperVoicePush: MoveMovementRequestEffectOperation = {
  id: 'hyper-voice.push-outside-blast',
  kind: 'movement-request',
  source: { kind: 'operation', id: 'hyper-voice.damage' },
  recipients: { kind: 'damaged-targets' },
  phase: 'movement',
  reasonCode: 'hyper-voice.push-outside-blast',
  payload: {
    requestId: 'hyper-voice.push-outside-blast',
    mode: 'forced',
    distance: { kind: 'area-exit', maximum: 16 },
    destinationSetId: null,
    displacement: {
      vector: { kind: 'away', source: { kind: 'actor' } },
      distancePolicy: 'up-to-distance',
      opportunityAttacks: 'ignore',
    },
  },
}

export const HYPER_VOICE_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Hyper Voice',
  slug: 'hyper-voice',
  targeting: anyAreaTargets(),
  operations: [
    accuracy('hyper-voice'),
    damage({
      slug: 'hyper-voice',
      damageBase: 9,
      damageClass: 'special',
      moveType: 'normal',
      smite: true,
    }),
    hyperVoicePush,
    ...terminal('hyper-voice'),
  ],
  tags: ['area', 'damage', 'forced-movement', 'normal', 'smite', 'sonic'],
})

export const HYPERSPACE_FURY_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Hyperspace Fury',
  slug: 'hyperspace-fury',
  targeting: anyAreaTargets(),
  handlerId: AREA_STAGES_207_HANDLER_ID,
  operations: [
    accuracy('hyperspace-fury'),
    damage({
      slug: 'hyperspace-fury',
      damageBase: 10,
      damageClass: 'physical',
      moveType: 'dark',
    }),
    stage({
      slug: 'hyperspace-fury',
      id: 'lower-defense',
      recipients: 'actor',
      stage: 'def',
      value: -1,
      sourceOperationId: 'hyperspace-fury.damage',
      trigger: {
        kind: 'operation-outcome',
        operationId: 'hyperspace-fury.damage',
        outcome: 'applied',
      },
    }),
    ...terminal('hyperspace-fury'),
  ],
  tags: ['area', 'damage', 'dark', 'interrupt-suppression', 'self-stage'],
})

export const LEAF_STORM_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Leaf Storm',
  slug: 'leaf-storm',
  targeting: anyAreaTargets(),
  operations: [
    accuracy('leaf-storm'),
    damage({
      slug: 'leaf-storm',
      damageBase: 13,
      damageClass: 'special',
      moveType: 'grass',
      smite: true,
    }),
    stage({
      slug: 'leaf-storm',
      id: 'lower-special-attack',
      recipients: 'actor',
      stage: 'satk',
      value: -2,
      sourceOperationId: 'leaf-storm.damage',
      trigger: {
        kind: 'operation-outcome',
        operationId: 'leaf-storm.damage',
        outcome: 'applied',
      },
    }),
    ...terminal('leaf-storm'),
  ],
  tags: ['area', 'damage', 'grass', 'self-stage', 'smite'],
})

export const LEAF_TORNADO_MOVE_SPEC = reviewedSpec({
  canonicalId: 'Leaf Tornado',
  slug: 'leaf-tornado',
  targeting: leafTornadoAreaTargets(),
  operations: [
    accuracy('leaf-tornado'),
    damage({
      slug: 'leaf-tornado',
      damageBase: 7,
      damageClass: 'special',
      moveType: 'grass',
    }),
    stage({
      slug: 'leaf-tornado',
      id: 'lower-accuracy',
      recipients: 'hit-targets',
      stage: 'acc',
      value: -1,
      sourceOperationId: 'leaf-tornado.damage',
      applyTypeImmunity: true,
      trigger: {
        kind: 'accuracy-roll',
        rollId: 'leaf-tornado.accuracy-roll',
        trigger: { kind: 'range', minimum: 15 },
        scope: 'recipient',
        application: 'once',
      },
    }),
    ...terminal('leaf-tornado'),
  ],
  tags: ['area', 'damage', 'geometry-filter', 'grass', 'stage', 'threshold'],
})

const registration = (
  canonicalId: AreaStages207MoveName,
  spec: MoveSpec,
): MoveSpecV2Registration => Object.freeze({
  canonicalId,
  sourceModule: 'server/domain/moveAutomation/specs/areaStages207.ts',
  spec,
})

export const AREA_STAGES_207_MOVE_SPEC_REGISTRATIONS = Object.freeze([
  registration('Gear Up', GEAR_UP_MOVE_SPEC),
  registration('Glaciate', GLACIATE_MOVE_SPEC),
  registration('Haze', HAZE_MOVE_SPEC),
  registration('Heart Swap', HEART_SWAP_MOVE_SPEC),
  registration('Hyper Voice', HYPER_VOICE_MOVE_SPEC),
  registration('Hyperspace Fury', HYPERSPACE_FURY_MOVE_SPEC),
  registration('Leaf Storm', LEAF_STORM_MOVE_SPEC),
  registration('Leaf Tornado', LEAF_TORNADO_MOVE_SPEC),
])
