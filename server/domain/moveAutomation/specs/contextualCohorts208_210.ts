import type {
  MoveBranchEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveItemEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveSpec, MoveSpecTargetingDeclaration } from '#shared/moveAutomation/spec'
import { SETUP_DAMAGE_208_HANDLER_ID } from '../handlers/setupDamage208'
import type { MoveSpecV2Registration } from '../registry'
import {
  areaTargeting,
  automaticSetupExecuteCost,
  createReviewedMoveSpec,
  fieldTargeting,
  multiTargeting,
  predicatePrecondition,
  reviewedCondition,
  reviewedDamage,
  reviewedStage,
  selfTargeting,
  standardAccuracy,
  standardActionCost,
  standardTerminalOperations,
} from './reviewedSpecBuilder'

export const MA_208_210_MOVE_NAMES = Object.freeze([
  'Magnetic Flux',
  'Meteor Beam',
  'Moongeist Beam',
  'Outrage',
  'Overheat',
  'Petal Dance',
  'Photon Geyser',
  'Psycho Boost',
  'Rototiller',
  'Snore',
  'Sparkling Aria',
  'Springtide Storm',
  'String Shot',
  'Sunsteel Strike',
  'Synchronoise',
  'Teatime',
  'Thrash',
  'Uproar',
  'Venom Drench',
] as const)

export type ContextualCohort208210MoveName = (typeof MA_208_210_MOVE_NAMES)[number]

const branch = (operation: MoveBranchEffectOperation): MoveEffectOperation => operation

const magneticTargeting = (): MoveSpecTargetingDeclaration => areaTargeting({
  relationship: 'any',
  willingness: 'any',
  excludeActor: true,
  statePredicates: [{
    kind: 'type-or-capability',
    typeIds: ['electric'],
    capabilityIds: ['capability.magnetic'],
  }],
})

const magneticChoice: MoveBranchEffectOperation = {
  id: 'magnetic-flux.choose-direction',
  kind: 'branch',
  source: { kind: 'move', id: 'move.magnetic-flux' },
  recipients: { kind: 'area-targets' },
  phase: 'hit',
  reasonCode: 'magnetic-flux.choose-stage-direction',
  payload: {
    kind: 'choice',
    selectionId: 'magnetic-flux.stage-direction',
    scope: 'resolution',
    owner: 'actor',
    requestId: 'magnetic-flux.stage-direction',
    promptKey: 'move.magnetic-flux.choose-stage-direction',
    options: [{
      id: 'raise',
      labelKey: 'move.magnetic-flux.raise',
      operationIds: [
        'magnetic-flux.raise-defense',
        'magnetic-flux.raise-special-defense',
      ],
    }, {
      id: 'lower',
      labelKey: 'move.magnetic-flux.lower',
      operationIds: [
        'magnetic-flux.lower-defense',
        'magnetic-flux.lower-special-defense',
      ],
    }],
    pass: null,
  },
}

export const MAGNETIC_FLUX_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Magnetic Flux',
  targeting: magneticTargeting(),
  operations: [
    branch(magneticChoice),
    reviewedStage({
      slug: 'magnetic-flux', id: 'raise-defense', recipients: 'area-targets',
      stage: 'def', value: 1, phase: 'hit', sourceOperationId: magneticChoice.id,
    }),
    reviewedStage({
      slug: 'magnetic-flux', id: 'raise-special-defense', recipients: 'area-targets',
      stage: 'sdef', value: 1, phase: 'hit', sourceOperationId: magneticChoice.id,
    }),
    reviewedStage({
      slug: 'magnetic-flux', id: 'lower-defense', recipients: 'area-targets',
      stage: 'def', value: -1, phase: 'hit', sourceOperationId: magneticChoice.id,
    }),
    reviewedStage({
      slug: 'magnetic-flux', id: 'lower-special-defense', recipients: 'area-targets',
      stage: 'sdef', value: -1, phase: 'hit', sourceOperationId: magneticChoice.id,
    }),
    ...standardTerminalOperations('magnetic-flux'),
  ],
  tags: ['area', 'choice', 'electric', 'magnetic', 'stage'],
})

export const METEOR_BEAM_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Meteor Beam',
  targeting: areaTargeting(),
  operations: [],
  costs: [standardActionCost('meteor-beam'), automaticSetupExecuteCost('meteor-beam')],
  registeredHandlerId: SETUP_DAMAGE_208_HANDLER_ID,
  tags: ['area', 'damage', 'rock', 'set-up', 'stage'],
})

const passiveIgnoringPolicy = Object.freeze({
  immunity: 'honor' as const,
  resistance: 'honor' as const,
  weakness: 'honor' as const,
  passiveImmunity: 'ignore' as const,
  effectivenessOverride: null,
  defenderTypeOverrides: [],
})

const abilityIgnoringAreaAttack = (input: {
  readonly canonicalId: 'Moongeist Beam' | 'Sunsteel Strike'
  readonly slug: string
  readonly damageClass: 'physical' | 'special'
  readonly moveType: string
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId,
  targeting: areaTargeting(),
  operations: [
    standardAccuracy(input.slug),
    reviewedDamage({
      slug: input.slug,
      damageBase: 10,
      damageClass: input.damageClass,
      moveType: input.moveType,
      typeEffectiveness: passiveIgnoringPolicy,
    }),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['ability-ignore', 'area', 'damage', input.moveType],
})

export const MOONGEIST_BEAM_MOVE_SPEC = abilityIgnoringAreaAttack({
  canonicalId: 'Moongeist Beam',
  slug: 'moongeist-beam',
  damageClass: 'special',
  moveType: 'ghost',
})

const rageDanceSpec = (input: {
  readonly canonicalId: 'Outrage' | 'Petal Dance' | 'Thrash'
  readonly slug: string
  readonly damageClass: 'physical' | 'special'
  readonly moveType: string
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId,
  targeting: areaTargeting({
    relationship: 'enemy', willingness: 'any', excludeActor: true,
  }),
  operations: [
    standardAccuracy(input.slug),
    reviewedDamage({
      slug: input.slug,
      damageBase: 12,
      damageClass: input.damageClass,
      moveType: input.moveType,
      recipients: 'attacked-targets',
    }),
    reviewedCondition({
      slug: input.slug,
      id: 'become-enraged',
      recipients: 'actor',
      conditionId: 'rage',
      sourceOperationId: `${input.slug}.damage`,
      operationOutcomeTrigger: { operationId: `${input.slug}.damage`, outcome: 'applied' },
    }),
    reviewedCondition({
      slug: input.slug,
      id: 'become-confused',
      recipients: 'actor',
      conditionId: 'confused',
      sourceOperationId: `${input.slug}.damage`,
      operationOutcomeTrigger: { operationId: `${input.slug}.damage`, outcome: 'applied' },
    }),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['area', 'condition', 'damage', 'rage', 'smite'],
})

export const OUTRAGE_MOVE_SPEC = rageDanceSpec({
  canonicalId: 'Outrage', slug: 'outrage', damageClass: 'physical', moveType: 'dragon',
})
export const PETAL_DANCE_MOVE_SPEC = rageDanceSpec({
  canonicalId: 'Petal Dance', slug: 'petal-dance', damageClass: 'special', moveType: 'grass',
})
export const THRASH_MOVE_SPEC = rageDanceSpec({
  canonicalId: 'Thrash', slug: 'thrash', damageClass: 'physical', moveType: 'normal',
})

const selfDropAttack = (input: {
  readonly canonicalId: 'Overheat' | 'Psycho Boost'
  readonly slug: string
  readonly damageBase: number
  readonly moveType: string
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId,
  targeting: areaTargeting(),
  operations: [
    standardAccuracy(input.slug),
    reviewedDamage({
      slug: input.slug,
      damageBase: input.damageBase,
      damageClass: 'special',
      moveType: input.moveType,
      recipients: 'attacked-targets',
    }),
    reviewedStage({
      slug: input.slug,
      id: 'lower-special-attack',
      recipients: 'actor',
      stage: 'satk',
      value: -2,
      sourceOperationId: `${input.slug}.damage`,
      trigger: {
        kind: 'operation-outcome',
        operationId: `${input.slug}.damage`,
        outcome: 'applied',
      },
    }),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['area', 'damage', 'self-stage', 'smite'],
})

export const OVERHEAT_MOVE_SPEC = selfDropAttack({
  canonicalId: 'Overheat', slug: 'overheat', damageBase: 13, moveType: 'fire',
})
export const PSYCHO_BOOST_MOVE_SPEC = selfDropAttack({
  canonicalId: 'Psycho Boost', slug: 'psycho-boost', damageBase: 14, moveType: 'psychic',
})

const actorAttack = {
  kind: 'stat' as const,
  subject: { kind: 'actor' as const },
  stat: 'attack' as const,
  combatStagePolicy: 'honor' as const,
  stageModifierPolicy: 'honor' as const,
}
const actorSpecialAttack = {
  ...actorAttack,
  stat: 'special-attack' as const,
}

export const PHOTON_GEYSER_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Photon Geyser',
  targeting: areaTargeting(),
  operations: [
    standardAccuracy('photon-geyser'),
    reviewedDamage({
      slug: 'photon-geyser',
      damageBase: 10,
      damageClass: 'special',
      moveType: 'psychic',
      attackStat: { kind: 'max', values: [actorAttack, actorSpecialAttack] },
      typeEffectiveness: passiveIgnoringPolicy,
    }),
    ...standardTerminalOperations('photon-geyser'),
  ],
  tags: ['ability-ignore', 'alternate-stat', 'area', 'damage', 'psychic'],
})

const typeAreaStageSpec = (input: {
  readonly canonicalId: 'Rototiller'
  readonly slug: string
  readonly typeId: string
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId,
  targeting: areaTargeting({
    relationship: 'any',
    willingness: 'any',
    excludeActor: false,
    statePredicates: [{ kind: 'type', typeIds: [input.typeId], match: 'any' }],
  }),
  operations: [
    reviewedStage({
      slug: input.slug, id: 'raise-attack', recipients: 'area-targets',
      stage: 'atk', value: 1, phase: 'hit',
    }),
    reviewedStage({
      slug: input.slug, id: 'raise-special-attack', recipients: 'area-targets',
      stage: 'satk', value: 1, phase: 'hit',
    }),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['area', input.typeId, 'stage', 'type-filter'],
})

export const ROTOTILLER_MOVE_SPEC = typeAreaStageSpec({
  canonicalId: 'Rototiller', slug: 'rototiller', typeId: 'grass',
})

export const SNORE_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Snore',
  targeting: areaTargeting(),
  preconditions: [predicatePrecondition({
    id: 'snore.actor-sleeping',
    predicate: {
      kind: 'comparison',
      operator: 'equal',
      left: { kind: 'condition', subject: { kind: 'actor' }, conditionId: 'sleep' },
      right: { kind: 'constant', value: true },
    },
    failureReasonCode: 'snore.actor-not-sleeping',
  })],
  operations: [
    standardAccuracy('snore'),
    reviewedDamage({ slug: 'snore', damageBase: 5, damageClass: 'special', moveType: 'normal' }),
    reviewedCondition({
      slug: 'snore', id: 'flinch', recipients: 'hit-targets', conditionId: 'flinch',
      sourceOperationId: 'snore.damage',
      accuracyRollTrigger: {
        rollId: 'snore.accuracy-roll',
        trigger: { kind: 'range', minimum: 15 },
      },
      applyTypeImmunity: true,
    }),
    ...standardTerminalOperations('snore'),
  ],
  tags: ['area', 'condition', 'damage', 'sleep', 'sonic'],
})

const cureCondition = (
  conditionId: 'burned' | 'confused' | 'infatuation' | 'rage',
): MoveConditionEffectOperation => reviewedCondition({
  slug: 'sparkling-aria',
  id: `cure-${conditionId}`,
  recipients: 'hit-targets',
  conditionId,
  action: 'remove',
  sourceOperationId: 'sparkling-aria.choose-outcome',
})

const sparklingChoice: MoveBranchEffectOperation = {
  id: 'sparkling-aria.choose-outcome',
  kind: 'branch',
  source: { kind: 'operation', id: 'sparkling-aria.accuracy' },
  recipients: { kind: 'hit-targets' },
  phase: 'hit',
  reasonCode: 'sparkling-aria.damage-or-cure',
  payload: {
    kind: 'choice',
    selectionId: 'sparkling-aria.outcome',
    scope: 'recipient',
    owner: 'actor',
    requestId: 'sparkling-aria.outcome',
    promptKey: 'move.sparkling-aria.choose-outcome',
    options: [{
      id: 'damage',
      labelKey: 'move.sparkling-aria.damage',
      operationIds: ['sparkling-aria.damage'],
    }, ...(['burned', 'confused', 'infatuation', 'rage'] as const).map(conditionId => ({
      id: `cure.${conditionId}`,
      labelKey: `condition.${conditionId}`,
      operationIds: [`sparkling-aria.cure-${conditionId}`],
      predicate: {
        kind: 'comparison' as const,
        operator: 'equal' as const,
        left: {
          kind: 'condition' as const,
          subject: { kind: 'current-target' as const },
          conditionId,
        },
        right: { kind: 'constant' as const, value: true },
      },
    }))],
    pass: null,
  },
}

export const SPARKLING_ARIA_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Sparkling Aria',
  targeting: multiTargeting(1, 2),
  operations: [
    standardAccuracy('sparkling-aria'),
    sparklingChoice,
    reviewedDamage({
      slug: 'sparkling-aria', damageBase: 9, damageClass: 'special', moveType: 'water',
      sourceOperationId: sparklingChoice.id,
    }),
    cureCondition('burned'),
    cureCondition('confused'),
    cureCondition('infatuation'),
    cureCondition('rage'),
    ...standardTerminalOperations('sparkling-aria'),
  ],
  tags: ['choice', 'cleanse', 'damage', 'multi-target', 'water'],
})

export const SPRINGTIDE_STORM_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Springtide Storm',
  targeting: areaTargeting(),
  operations: [
    standardAccuracy('springtide-storm'),
    reviewedDamage({
      slug: 'springtide-storm', damageBase: 10, damageClass: 'special',
      moveType: 'fairy', recipients: 'attacked-targets',
    }),
    ...standardTerminalOperations('springtide-storm'),
  ],
  registeredHandlerId: SETUP_DAMAGE_208_HANDLER_ID,
  tags: ['area', 'damage', 'form', 'smite', 'stage'],
})

const stuckBranch: MoveBranchEffectOperation = {
  id: 'string-shot.stuck-threshold',
  kind: 'branch',
  source: { kind: 'operation', id: 'string-shot.accuracy' },
  recipients: { kind: 'hit-targets' },
  phase: 'hit',
  reasonCode: 'string-shot.stuck-at-minimum-speed',
  payload: {
    kind: 'predicate',
    selectionId: 'string-shot.stuck-threshold',
    scope: 'recipient',
    predicate: {
      kind: 'comparison',
      operator: 'less-than-or-equal',
      left: { kind: 'combat-stage', subject: { kind: 'current-target' }, stage: 'spd' },
      right: { kind: 'constant', value: -5 },
    },
    whenTrue: { id: 'stuck', operationIds: ['string-shot.apply-stuck'] },
    whenFalse: { id: 'not-stuck', operationIds: [] },
  },
}

export const STRING_SHOT_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'String Shot',
  targeting: areaTargeting(),
  operations: [
    standardAccuracy('string-shot'),
    stuckBranch,
    reviewedStage({
      slug: 'string-shot', id: 'lower-speed', recipients: 'hit-targets',
      stage: 'spd', value: -1, phase: 'hit', sourceOperationId: 'string-shot.accuracy',
      applyTypeImmunity: true,
    }),
    reviewedCondition({
      slug: 'string-shot', id: 'apply-stuck', recipients: 'hit-targets',
      conditionId: 'stuck', phase: 'hit', sourceOperationId: stuckBranch.id,
      applyTypeImmunity: true,
    }),
    ...standardTerminalOperations('string-shot'),
  ],
  tags: ['area', 'bug', 'condition', 'stage', 'threshold'],
})

export const SUNSTEEL_STRIKE_MOVE_SPEC = abilityIgnoringAreaAttack({
  canonicalId: 'Sunsteel Strike',
  slug: 'sunsteel-strike',
  damageClass: 'physical',
  moveType: 'steel',
})

export const SYNCHRONOISE_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Synchronoise',
  targeting: areaTargeting({
    relationship: 'any',
    willingness: 'any',
    excludeActor: true,
    statePredicates: [{ kind: 'shares-type-with-actor' }],
  }),
  operations: [
    standardAccuracy('synchronoise'),
    reviewedDamage({
      slug: 'synchronoise', damageBase: 12, damageClass: 'special', moveType: 'psychic',
    }),
    ...standardTerminalOperations('synchronoise'),
  ],
  tags: ['area', 'damage', 'psychic', 'type-filter'],
})

const teatimeDigest: MoveItemEffectOperation = {
  id: 'teatime.digest-food-buff',
  kind: 'item',
  source: { kind: 'operation', id: 'teatime.choose-participation' },
  recipients: { kind: 'all-placements' },
  phase: 'hit',
  reasonCode: 'teatime.digest-food-buff',
  payload: {
    action: 'digest-buff',
    canonicalItemIds: null,
    onUnavailable: 'no-op',
  },
}

const teatimeChoice: MoveBranchEffectOperation = {
  id: 'teatime.choose-participation',
  kind: 'branch',
  source: { kind: 'move', id: 'move.teatime' },
  recipients: { kind: 'all-placements' },
  phase: 'hit',
  reasonCode: 'teatime.participant-choice',
  payload: {
    kind: 'choice',
    selectionId: 'teatime.participation',
    scope: 'recipient',
    owner: 'recipients',
    requestId: 'teatime.participation',
    promptKey: 'move.teatime.consume-food-buff',
    options: [{
      id: 'consume',
      labelKey: 'move.teatime.consume',
      operationIds: [teatimeDigest.id],
    }],
    pass: { id: 'pass', operationIds: [] },
  },
}

export const TEATIME_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Teatime',
  targeting: fieldTargeting(),
  operations: [teatimeChoice, teatimeDigest, ...standardTerminalOperations('teatime')],
  tags: ['choice', 'field', 'food-buff', 'item', 'social'],
})

const uproarRangeBranch: MoveBranchEffectOperation = {
  id: 'uproar.sleep-cure-range',
  kind: 'branch',
  source: { kind: 'operation', id: 'uproar.damage' },
  recipients: { kind: 'all-placements' },
  phase: 'after-damage',
  reasonCode: 'uproar.sleep-cure-within-five',
  payload: {
    kind: 'predicate',
    selectionId: 'uproar.sleep-cure-range',
    scope: 'recipient',
    predicate: {
      kind: 'comparison',
      operator: 'less-than-or-equal',
      left: {
        kind: 'distance',
        from: { kind: 'actor' },
        to: { kind: 'current-target' },
      },
      right: { kind: 'constant', value: 5 },
    },
    whenTrue: { id: 'in-range', operationIds: ['uproar.cure-sleep'] },
    whenFalse: { id: 'out-of-range', operationIds: [] },
  },
}

export const UPROAR_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Uproar',
  targeting: areaTargeting(),
  operations: [
    standardAccuracy('uproar'),
    reviewedDamage({ slug: 'uproar', damageBase: 5, damageClass: 'special', moveType: 'normal' }),
    uproarRangeBranch,
    reviewedCondition({
      slug: 'uproar', id: 'cure-sleep', recipients: 'all-placements',
      conditionId: 'sleep', action: 'remove', sourceOperationId: uproarRangeBranch.id,
    }),
    ...standardTerminalOperations('uproar'),
  ],
  tags: ['area', 'cleanse', 'damage', 'sonic', 'spirit-surge'],
})

export const VENOM_DRENCH_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Venom Drench',
  targeting: areaTargeting({
    relationship: 'any',
    willingness: 'any',
    excludeActor: true,
    statePredicates: [{
      kind: 'condition',
      conditionIds: ['poisoned', 'badly-poisoned'],
      match: 'any',
    }],
  }),
  operations: [
    ...(['atk', 'satk', 'spd'] as const).map(stage => reviewedStage({
      slug: 'venom-drench', id: `lower-${stage}`, recipients: 'area-targets',
      stage, value: -1, phase: 'hit', applyTypeImmunity: true,
    })),
    ...standardTerminalOperations('venom-drench'),
  ],
  tags: ['area', 'condition-filter', 'poison', 'stage'],
})

const SPECS: Readonly<Record<ContextualCohort208210MoveName, MoveSpec>> = {
  'Magnetic Flux': MAGNETIC_FLUX_MOVE_SPEC,
  'Meteor Beam': METEOR_BEAM_MOVE_SPEC,
  'Moongeist Beam': MOONGEIST_BEAM_MOVE_SPEC,
  Outrage: OUTRAGE_MOVE_SPEC,
  Overheat: OVERHEAT_MOVE_SPEC,
  'Petal Dance': PETAL_DANCE_MOVE_SPEC,
  'Photon Geyser': PHOTON_GEYSER_MOVE_SPEC,
  'Psycho Boost': PSYCHO_BOOST_MOVE_SPEC,
  Rototiller: ROTOTILLER_MOVE_SPEC,
  Snore: SNORE_MOVE_SPEC,
  'Sparkling Aria': SPARKLING_ARIA_MOVE_SPEC,
  'Springtide Storm': SPRINGTIDE_STORM_MOVE_SPEC,
  'String Shot': STRING_SHOT_MOVE_SPEC,
  'Sunsteel Strike': SUNSTEEL_STRIKE_MOVE_SPEC,
  Synchronoise: SYNCHRONOISE_MOVE_SPEC,
  Teatime: TEATIME_MOVE_SPEC,
  Thrash: THRASH_MOVE_SPEC,
  Uproar: UPROAR_MOVE_SPEC,
  'Venom Drench': VENOM_DRENCH_MOVE_SPEC,
}

export const CONTEXTUAL_COHORTS_208_210_MOVE_SPEC_REGISTRATIONS: readonly MoveSpecV2Registration[] =
  Object.freeze(MA_208_210_MOVE_NAMES.map(canonicalId => Object.freeze({
    canonicalId,
    sourceModule: 'server/domain/moveAutomation/specs/contextualCohorts208_210.ts',
    spec: SPECS[canonicalId],
  })))
