import type {
  MoveBranchEffectOperation,
  MoveCombatStageEffectOperation,
  MoveConditionEffectOperation,
  MoveDamageClass,
  MoveDamageEffectOperation,
  MoveEffectOperation,
  MoveLogEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MovePredicate } from '#shared/moveAutomation/predicates'
import type {
  MoveSpec,
  MoveSpecEffectOperation,
  MoveSpecTargetingDeclaration,
} from '#shared/moveAutomation/spec'
import { DIGESTION_BUFF_TRADED_CAPABILITY_ID } from '../digestionBuffTrade'
import type { MoveSpecV2Registration } from '../registry'
import {
  createStandardMoveAccuracyOperation,
  createStandardMoveCompletionLogOperation,
  createStandardMoveUsageOperation,
} from '../standardDamageOperations'

export const MA_206_MOVE_NAMES = Object.freeze([
  'Aeroblast',
  'Aromatherapy',
  'Belch',
  'Bug Buzz',
  'Captivate',
  'Diamond Storm',
  'Draco Meteor',
  'Fleur Cannon',
] as const)

export type AreaEffects206MoveName = (typeof MA_206_MOVE_NAMES)[number]

const allAreaTargets = (): MoveSpecTargetingDeclaration => ({
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

const allyAreaTargets = (): MoveSpecTargetingDeclaration => ({
  kind: 'area',
  minTargets: 0,
  maxTargets: 32,
  selector: { kind: 'area-targets' },
  predicate: {
    relationship: 'ally',
    willingness: 'any',
    excludeActor: true,
  },
})

const oppositeGenderAreaTargets = (): MoveSpecTargetingDeclaration => ({
  kind: 'area',
  minTargets: 0,
  maxTargets: 32,
  selector: { kind: 'area-targets' },
  predicate: {
    relationship: 'any',
    willingness: 'any',
    excludeActor: true,
    statePredicates: [{ kind: 'opposite-gender' }],
  },
})

const asMoveSpecOperations = (
  operations: readonly MoveEffectOperation[],
): readonly MoveSpecEffectOperation[] => operations as unknown as readonly MoveSpecEffectOperation[]

interface AreaMoveDefinition {
  readonly canonicalId: AreaEffects206MoveName
  readonly slug: string
  readonly targeting?: MoveSpecTargetingDeclaration
  readonly preconditions?: MoveSpec['preconditions']
  readonly operations: readonly MoveEffectOperation[]
  readonly tags: readonly string[]
}

const areaMoveSpec = (definition: AreaMoveDefinition): MoveSpec => {
  const phases = definition.operations.reduce((blocks, operation) => {
    const existing = blocks.find(block => block.phase === operation.phase)
    if (existing) existing.operations.push(operation)
    else blocks.push({ phase: operation.phase, operations: [operation] })
    return blocks
  }, [] as Array<{ phase: MoveEffectOperation['phase']; operations: MoveEffectOperation[] }>)

  return Object.freeze({
    schemaVersion: 2,
    canonicalId: definition.canonicalId,
    version: 2,
    targeting: definition.targeting ?? allAreaTargets(),
    preconditions: definition.preconditions ?? [],
    costs: [{
      id: `${definition.slug}.cost.standard-action`,
      phase: 'pay' as const,
      cost: { kind: 'action-resource' as const, resource: 'standard' as const, amount: 1 },
    }],
    phases: phases.map(block => ({
      phase: block.phase,
      operations: asMoveSpecOperations(block.operations),
    })),
    registeredHandlerId: null,
    presentation: {
      displayName: definition.canonicalId,
      vfxKey: `move.${definition.slug}`,
      tags: [...definition.tags],
    },
  })
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
  readonly criticalHit?: MoveDamageEffectOperation['payload']['criticalHit']
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
    ...(input.criticalHit ? { criticalHit: input.criticalHit } : {}),
  },
})

const stage = (input: {
  readonly slug: string
  readonly id: string
  readonly recipients: 'actor' | 'hit-targets'
  readonly stage: 'def' | 'satk' | 'sdef'
  readonly value: number
  readonly sourceOperationId: string
  readonly trigger?: NonNullable<MoveCombatStageEffectOperation['payload']['trigger']>
}): MoveCombatStageEffectOperation => ({
  id: `${input.slug}.${input.id}`,
  kind: 'combat-stage',
  source: { kind: 'operation', id: input.sourceOperationId },
  recipients: { kind: input.recipients },
  phase: 'after-damage',
  reasonCode: `${input.slug}.${input.id}`,
  payload: {
    action: 'modify',
    stage: input.stage,
    selectedStage: null,
    value: input.value,
    stageSource: null,
    rounding: null,
    ...(input.trigger ? { trigger: input.trigger } : {}),
  },
})

const standardTerminalOperations = (slug: string): readonly MoveEffectOperation[] => [
  createStandardMoveUsageOperation(slug),
  createStandardMoveCompletionLogOperation(slug),
]

const conditionPresence = (conditionId: string): MovePredicate => ({
  kind: 'comparison',
  operator: 'equal',
  left: {
    kind: 'condition',
    subject: { kind: 'current-target' },
    conditionId,
  },
  right: { kind: 'constant', value: true },
})

const AROMATHERAPY_STATUS_CONDITIONS = Object.freeze([
  'paralysis',
  'flinch',
  'infatuation',
  'confused',
  'suppressed',
  'burned',
  'frozen',
  'poisoned',
  'badly-poisoned',
  'bad-sleep',
  'cursed',
  'disabled',
  'rage',
  'sleep',
] as const)

const aromatherapyRemoveOperationId = (conditionId: string): string => (
  `aromatherapy.remove-${conditionId}`
)

const aromatherapyConditionChoice = (): MoveBranchEffectOperation => ({
  id: 'aromatherapy.choose-condition',
  kind: 'branch',
  source: { kind: 'move', id: 'move.aromatherapy' },
  recipients: { kind: 'area-targets' },
  phase: 'hit',
  reasonCode: 'aromatherapy.choose-one-status-condition',
  payload: {
    kind: 'choice',
    selectionId: 'aromatherapy.condition-choice',
    scope: 'recipient',
    owner: 'recipients',
    requestId: 'aromatherapy.condition-choice',
    promptKey: 'move.aromatherapy.choose-status-condition',
    options: [
      ...AROMATHERAPY_STATUS_CONDITIONS.map(conditionId => ({
        id: `cure.${conditionId}`,
        labelKey: `condition.${conditionId}`,
        operationIds: [aromatherapyRemoveOperationId(conditionId)],
        predicate: conditionPresence(conditionId),
      })),
      {
        id: 'cure.none',
        labelKey: 'move.aromatherapy.no-status-condition',
        operationIds: ['aromatherapy.no-condition'],
        predicate: {
          kind: 'not',
          predicate: {
            kind: 'any',
            predicates: AROMATHERAPY_STATUS_CONDITIONS.map(conditionPresence),
          },
        },
      },
    ],
    pass: null,
  },
})

const aromatherapyRemoval = (conditionId: string): MoveConditionEffectOperation => ({
  id: aromatherapyRemoveOperationId(conditionId),
  kind: 'condition',
  source: { kind: 'operation', id: 'aromatherapy.choose-condition' },
  recipients: { kind: 'area-targets' },
  phase: 'hit',
  reasonCode: `aromatherapy.cure-${conditionId}`,
  payload: {
    action: 'remove',
    conditionId,
    conditionSource: null,
    filter: null,
    randomChoice: null,
    duration: null,
    saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

const aromatherapyNoConditionLog: MoveLogEffectOperation = {
  id: 'aromatherapy.no-condition',
  kind: 'log',
  source: { kind: 'operation', id: 'aromatherapy.choose-condition' },
  recipients: { kind: 'area-targets' },
  phase: 'hit',
  reasonCode: 'aromatherapy.no-status-condition',
  payload: {
    messageKey: 'move.aromatherapy.no-status-condition',
    arguments: [],
  },
}

export const AEROBLAST_MOVE_SPEC = areaMoveSpec({
  canonicalId: 'Aeroblast',
  slug: 'aeroblast',
  operations: [
    accuracy('aeroblast'),
    damage({
      slug: 'aeroblast',
      damageBase: 10,
      damageClass: 'special',
      moveType: 'flying',
      criticalHit: {
        trigger: { kind: 'natural-rolls', values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
        prevention: 'honor',
      },
    }),
    ...standardTerminalOperations('aeroblast'),
  ],
  tags: ['area', 'critical-hit', 'damage', 'flying', 'line'],
})

export const AROMATHERAPY_MOVE_SPEC = areaMoveSpec({
  canonicalId: 'Aromatherapy',
  slug: 'aromatherapy',
  targeting: allyAreaTargets(),
  operations: [
    aromatherapyConditionChoice(),
    ...AROMATHERAPY_STATUS_CONDITIONS.map(aromatherapyRemoval),
    aromatherapyNoConditionLog,
    ...standardTerminalOperations('aromatherapy'),
  ],
  tags: ['ally', 'area', 'choice', 'cleanse', 'grass'],
})

export const BELCH_MOVE_SPEC = areaMoveSpec({
  canonicalId: 'Belch',
  slug: 'belch',
  preconditions: [{
    id: 'belch.digestion-buff-traded',
    predicate: {
      kind: 'comparison',
      operator: 'equal',
      left: {
        kind: 'capability',
        subject: { kind: 'actor' },
        capabilityId: DIGESTION_BUFF_TRADED_CAPABILITY_ID,
      },
      right: { kind: 'constant', value: true },
    },
    failureReasonCode: 'belch.digestion-buff-required',
  }],
  operations: [
    accuracy('belch'),
    damage({
      slug: 'belch',
      damageBase: 12,
      damageClass: 'special',
      moveType: 'poison',
    }),
    ...standardTerminalOperations('belch'),
  ],
  tags: ['area', 'damage', 'digestion-buff', 'poison', 'precondition'],
})

export const BUG_BUZZ_MOVE_SPEC = areaMoveSpec({
  canonicalId: 'Bug Buzz',
  slug: 'bug-buzz',
  operations: [
    accuracy('bug-buzz'),
    damage({
      slug: 'bug-buzz',
      damageBase: 9,
      damageClass: 'special',
      moveType: 'bug',
      smite: true,
    }),
    stage({
      slug: 'bug-buzz',
      id: 'lower-special-defense',
      recipients: 'hit-targets',
      stage: 'sdef',
      value: -1,
      sourceOperationId: 'bug-buzz.damage',
      trigger: {
        kind: 'accuracy-roll',
        rollId: 'bug-buzz.accuracy-roll',
        trigger: { kind: 'range', minimum: 19 },
        scope: 'recipient',
        application: 'once',
      },
    }),
    ...standardTerminalOperations('bug-buzz'),
  ],
  tags: ['area', 'bug', 'damage', 'smite', 'sonic', 'stage'],
})

export const CAPTIVATE_MOVE_SPEC = areaMoveSpec({
  canonicalId: 'Captivate',
  slug: 'captivate',
  targeting: oppositeGenderAreaTargets(),
  operations: [
    accuracy('captivate'),
    stage({
      slug: 'captivate',
      id: 'lower-special-attack',
      recipients: 'hit-targets',
      stage: 'satk',
      value: -2,
      sourceOperationId: 'captivate.accuracy',
    }),
    ...standardTerminalOperations('captivate'),
  ],
  tags: ['area', 'friendly', 'gender', 'normal', 'social', 'stage'],
})

export const DIAMOND_STORM_MOVE_SPEC = areaMoveSpec({
  canonicalId: 'Diamond Storm',
  slug: 'diamond-storm',
  operations: [
    accuracy('diamond-storm'),
    damage({
      slug: 'diamond-storm',
      damageBase: 10,
      damageClass: 'physical',
      moveType: 'rock',
      smite: true,
    }),
    stage({
      slug: 'diamond-storm',
      id: 'raise-defense',
      recipients: 'actor',
      stage: 'def',
      value: 1,
      sourceOperationId: 'diamond-storm.damage',
      trigger: {
        kind: 'accuracy-roll',
        rollId: 'diamond-storm.accuracy-roll',
        trigger: { kind: 'natural-rolls', values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
        scope: 'resolution',
        application: 'per-match',
      },
    }),
    ...standardTerminalOperations('diamond-storm'),
  ],
  tags: ['area', 'damage', 'friendly', 'rock', 'self-stage', 'smite'],
})

const selfDropAfterDamage = (
  slug: 'draco-meteor' | 'fleur-cannon',
): MoveCombatStageEffectOperation => stage({
  slug,
  id: 'lower-special-attack',
  recipients: 'actor',
  stage: 'satk',
  value: -2,
  sourceOperationId: `${slug}.damage`,
  trigger: {
    kind: 'operation-outcome',
    operationId: `${slug}.damage`,
    outcome: 'applied',
  },
})

export const DRACO_METEOR_MOVE_SPEC = areaMoveSpec({
  canonicalId: 'Draco Meteor',
  slug: 'draco-meteor',
  operations: [
    accuracy('draco-meteor'),
    damage({
      slug: 'draco-meteor',
      damageBase: 13,
      damageClass: 'special',
      moveType: 'dragon',
      smite: true,
    }),
    selfDropAfterDamage('draco-meteor'),
    ...standardTerminalOperations('draco-meteor'),
  ],
  tags: ['area', 'damage', 'dragon', 'self-stage', 'smite'],
})

export const FLEUR_CANNON_MOVE_SPEC = areaMoveSpec({
  canonicalId: 'Fleur Cannon',
  slug: 'fleur-cannon',
  operations: [
    accuracy('fleur-cannon'),
    damage({
      slug: 'fleur-cannon',
      damageBase: 13,
      damageClass: 'special',
      moveType: 'fairy',
      smite: true,
    }),
    selfDropAfterDamage('fleur-cannon'),
    ...standardTerminalOperations('fleur-cannon'),
  ],
  tags: ['area', 'damage', 'fairy', 'line', 'self-stage', 'smite'],
})

const registration = (
  canonicalId: AreaEffects206MoveName,
  spec: MoveSpec,
): MoveSpecV2Registration => Object.freeze({
  canonicalId,
  sourceModule: 'server/domain/moveAutomation/specs/areaEffects206.ts',
  spec,
})

export const AREA_EFFECTS_206_MOVE_SPEC_REGISTRATIONS = Object.freeze([
  registration('Aeroblast', AEROBLAST_MOVE_SPEC),
  registration('Aromatherapy', AROMATHERAPY_MOVE_SPEC),
  registration('Belch', BELCH_MOVE_SPEC),
  registration('Bug Buzz', BUG_BUZZ_MOVE_SPEC),
  registration('Captivate', CAPTIVATE_MOVE_SPEC),
  registration('Diamond Storm', DIAMOND_STORM_MOVE_SPEC),
  registration('Draco Meteor', DRACO_METEOR_MOVE_SPEC),
  registration('Fleur Cannon', FLEUR_CANNON_MOVE_SPEC),
])
