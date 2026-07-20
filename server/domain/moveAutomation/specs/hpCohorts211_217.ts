import type {
  MoveBranchEffectOperation,
  MoveConditionEffectOperation,
  MoveEffectOperation,
  MoveTemporaryEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveSpec, MoveSpecCostDeclaration, MoveSpecTargetingDeclaration } from '#shared/moveAutomation/spec'
import { HP_COHORTS_211_217_HANDLER_ID } from '../handlers/hpCohorts211_217'
import type { MoveSpecV2Registration } from '../registry'
import {
  areaTargeting,
  createReviewedMoveSpec,
  fieldTargeting,
  multiTargeting,
  predicatePrecondition,
  reviewedCondition,
  reviewedDamage,
  reviewedDirectHp,
  reviewedHeal,
  reviewedStage,
  selfTargeting,
  singleTargeting,
  standardAccuracy,
  standardActionCost,
  standardTerminalOperations,
} from './reviewedSpecBuilder'

export const MA_211_217_MOVE_NAMES = Object.freeze([
  'Belly Drum', 'Bind', 'Brine', 'Chloroblast', 'Clamp', 'Clangorous Soul', 'Crush Grip', 'Dragon Energy',
  'Drain Punch', 'Draining Kiss', 'Dream Eater', 'Eruption', 'Explosion', 'Giga Drain', 'Heal Order', 'Heal Pulse',
  'Hold Hands', 'Jungle Healing', 'Leech Life', 'Life Dew', 'Light of Ruin', 'Mega Drain', 'Metal Burst', 'Milk Drink',
  'Mind Blown', 'Mystical Power', 'Oblivion Wing', 'Parabolic Charge', 'Pollen Puff', 'Purify', 'Recover', 'Relic Song',
  'Self-Destruct', 'Slack Off', 'Soft-Boiled', 'Steel Beam', 'Strength Sap', 'Submission', 'Toxic Thread', 'Water Spout',
  'Wave Crash', 'Wrap', 'Wring Out',
  'Final Gambit', 'Flame Burst', 'Nature’s Madness', 'Night Shade', 'Pain Split', 'Seismic Toss', 'Super Fang',
] as const)

export type HpCohort211217MoveName = (typeof MA_211_217_MOVE_NAMES)[number]

const noCost = (slug: string, reasonCode: string): MoveSpecCostDeclaration => ({
  id: `${slug}.cost.passive`, phase: 'declare', cost: { kind: 'no-cost', reasonCode },
})

const staticPassiveSpec = (canonicalId: 'Bind' | 'Clamp' | 'Wrap'): MoveSpec => {
  const slug = canonicalId.toLowerCase()
  return createReviewedMoveSpec({
    canonicalId,
    targeting: fieldTargeting(),
    preconditions: [{
      id: `${slug}.static-passive-only`,
      predicate: { kind: 'constant', value: false },
      failureReasonCode: `${slug}.not-declarable`,
    }],
    costs: [noCost(slug, 'move.static-passive')],
    operations: [],
    tags: ['grapple', 'passive', 'static'],
  })
}

const attackingTargeting = (area = false): MoveSpecTargetingDeclaration => (
  area ? areaTargeting() : singleTargeting()
)

const attackSpec = (input: {
  readonly canonicalId: HpCohort211217MoveName
  readonly slug: string
  readonly damageBase?: number
  readonly damageClass: 'physical' | 'special'
  readonly moveType: string
  readonly area?: boolean
  readonly smite?: boolean
  readonly operations?: readonly MoveEffectOperation[]
  readonly preconditions?: MoveSpec['preconditions']
  readonly handler?: boolean
  readonly costs?: readonly MoveSpecCostDeclaration[]
  readonly tags?: readonly string[]
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId,
  targeting: attackingTargeting(input.area),
  preconditions: input.preconditions,
  costs: input.costs,
  registeredHandlerId: input.handler ? HP_COHORTS_211_217_HANDLER_ID : null,
  operations: [
    standardAccuracy(input.slug),
    ...(input.damageBase === undefined ? [] : [reviewedDamage({
      slug: input.slug,
      damageBase: input.damageBase,
      damageClass: input.damageClass,
      moveType: input.moveType,
      recipients: input.smite ? 'attacked-targets' : 'hit-targets',
    })]),
    ...(input.operations ?? []),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['damage', input.moveType, ...(input.area ? ['area'] : []), ...(input.tags ?? [])],
})

const healSpec = (input: {
  readonly canonicalId: HpCohort211217MoveName
  readonly slug: string
  readonly targeting?: MoveSpecTargetingDeclaration
  readonly recipients: 'actor' | 'selected-targets' | 'area-targets'
  readonly percent: number
  readonly operations?: readonly MoveEffectOperation[]
  readonly tags?: readonly string[]
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId,
  targeting: input.targeting ?? selfTargeting(),
  operations: [
    reviewedHeal({
      slug: input.slug,
      id: 'heal',
      recipients: input.recipients,
      calculation: { kind: 'percent-max', percent: input.percent },
      phase: 'hit',
    }),
    ...(input.operations ?? []),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['heal', ...(input.tags ?? [])],
})

const drainSpec = (input: {
  readonly canonicalId: HpCohort211217MoveName
  readonly slug: string
  readonly damageBase: number
  readonly damageClass: 'physical' | 'special'
  readonly moveType: string
  readonly area?: boolean
  readonly percent?: number
  readonly aggregation?: 'per-target' | 'aggregate'
}): MoveSpec => attackSpec({
  ...input,
  operations: [reviewedHeal({
    slug: input.slug,
    id: 'drain-heal',
    recipients: 'actor',
    calculation: {
      kind: 'damage-dealt',
      damageOperationId: `${input.slug}.damage`,
      percent: input.percent ?? 50,
      aggregation: input.aggregation ?? 'per-target',
      preventedDamage: 'zero',
    },
    sourceOperationId: `${input.slug}.damage`,
  })],
  tags: ['drain'],
})

const recoil = (
  slug: string,
  percent: number,
  damageOperationId = `${slug}.damage`,
): MoveEffectOperation => reviewedDirectHp({
  slug,
  id: 'recoil',
  recipients: 'actor',
  calculation: {
    kind: 'damage-dealt', damageOperationId, percent,
    aggregation: 'aggregate', preventedDamage: 'zero',
  },
  sourceOperationId: damageOperationId,
})

const actorPercentLoss = (
  slug: string,
  percent: number,
  id = 'self-hp-loss',
): MoveEffectOperation => reviewedDirectHp({
  slug, id, recipients: 'actor', calculation: { kind: 'percent-max', percent },
  sourceOperationId: `${slug}.damage`,
})

const negativeHalfMax = {
  kind: 'formula' as const,
  expression: {
    kind: 'arithmetic' as const,
    operator: 'multiply' as const,
    operands: [{
      kind: 'stat' as const,
      subject: { kind: 'actor' as const },
      stat: 'maximum-hp' as const,
      combatStagePolicy: 'ignore' as const,
      stageModifierPolicy: 'ignore' as const,
    }, { kind: 'constant' as const, value: -0.5 }],
  },
}

const selfKoAttack = (input: {
  readonly canonicalId: 'Explosion' | 'Self-Destruct'
  readonly slug: string
  readonly damageBase: number
  readonly areaSizeTag: string
}): MoveSpec => attackSpec({
  canonicalId: input.canonicalId,
  slug: input.slug,
  damageBase: input.damageBase,
  damageClass: 'physical',
  moveType: 'normal',
  area: true,
  operations: [reviewedDirectHp({
    slug: input.slug,
    id: 'self-ko',
    recipients: 'actor',
    mode: 'set',
    calculation: negativeHalfMax,
    sourceOperationId: `${input.slug}.damage`,
    hitPointMarkers: 'apply-after-operation',
  })],
  tags: ['self-ko', input.areaSizeTag],
})

export const BELLY_DRUM_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Belly Drum', targeting: selfTargeting(),
  operations: [
    reviewedDirectHp({
      slug: 'belly-drum', id: 'half-max-cost', recipients: 'actor',
      calculation: { kind: 'percent-max', percent: 50 }, phase: 'pay',
      cost: { kind: 'cost', timing: 'declaration', minimumRemaining: null, damageOperationId: null },
    }),
    reviewedStage({
      slug: 'belly-drum', id: 'raise-attack', recipients: 'actor',
      stage: 'atk', value: 6, phase: 'hit',
    }),
    ...standardTerminalOperations('belly-drum'),
  ],
  tags: ['hp-cost', 'self', 'stage'],
})
export const BIND_MOVE_SPEC = staticPassiveSpec('Bind')
export const CLAMP_MOVE_SPEC = staticPassiveSpec('Clamp')
export const WRAP_MOVE_SPEC = staticPassiveSpec('Wrap')

const dynamicAttack = (input: {
  readonly canonicalId: 'Brine' | 'Crush Grip' | 'Dragon Energy' | 'Eruption' | 'Water Spout' | 'Wring Out'
  readonly slug: string
  readonly damageClass: 'physical' | 'special'
  readonly moveType: string
  readonly area?: boolean
}): MoveSpec => attackSpec({ ...input, handler: true, tags: ['dynamic-damage-base'] })

export const BRINE_MOVE_SPEC = dynamicAttack({ canonicalId: 'Brine', slug: 'brine', damageClass: 'special', moveType: 'water' })
export const CRUSH_GRIP_MOVE_SPEC = dynamicAttack({ canonicalId: 'Crush Grip', slug: 'crush-grip', damageClass: 'physical', moveType: 'normal' })
export const DRAGON_ENERGY_MOVE_SPEC = dynamicAttack({ canonicalId: 'Dragon Energy', slug: 'dragon-energy', damageClass: 'special', moveType: 'dragon', area: true })
export const ERUPTION_MOVE_SPEC = dynamicAttack({ canonicalId: 'Eruption', slug: 'eruption', damageClass: 'special', moveType: 'fire', area: true })
export const WATER_SPOUT_MOVE_SPEC = dynamicAttack({ canonicalId: 'Water Spout', slug: 'water-spout', damageClass: 'special', moveType: 'water', area: true })
export const WRING_OUT_MOVE_SPEC = dynamicAttack({ canonicalId: 'Wring Out', slug: 'wring-out', damageClass: 'special', moveType: 'normal' })

export const CHLOROBLAST_MOVE_SPEC = attackSpec({
  canonicalId: 'Chloroblast', slug: 'chloroblast', damageBase: 12,
  damageClass: 'special', moveType: 'grass', area: true, smite: true,
  operations: [actorPercentLoss('chloroblast', 50)], tags: ['hp-cost', 'smite', 'spirit-surge'],
})

export const CLANGOROUS_SOUL_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Clangorous Soul', targeting: selfTargeting(),
  operations: [
    reviewedDirectHp({
      slug: 'clangorous-soul', id: 'one-third-max-loss', recipients: 'actor',
      calculation: { kind: 'percent-max', percent: 100 / 3 }, phase: 'pay',
      cost: { kind: 'cost', timing: 'declaration', minimumRemaining: null, damageOperationId: null },
    }),
    reviewedStage({
      slug: 'clangorous-soul', id: 'raise-all-stats', recipients: 'actor',
      stage: 'all-stats', value: 1, phase: 'hit',
    }),
    ...standardTerminalOperations('clangorous-soul'),
  ],
  tags: ['hp-cost', 'self', 'stage'],
})

export const DRAIN_PUNCH_MOVE_SPEC = drainSpec({ canonicalId: 'Drain Punch', slug: 'drain-punch', damageBase: 8, damageClass: 'physical', moveType: 'fighting' })
export const DRAINING_KISS_MOVE_SPEC = drainSpec({ canonicalId: 'Draining Kiss', slug: 'draining-kiss', damageBase: 5, damageClass: 'special', moveType: 'fairy' })
export const GIGA_DRAIN_MOVE_SPEC = drainSpec({ canonicalId: 'Giga Drain', slug: 'giga-drain', damageBase: 8, damageClass: 'special', moveType: 'grass' })
export const LEECH_LIFE_MOVE_SPEC = drainSpec({ canonicalId: 'Leech Life', slug: 'leech-life', damageBase: 8, damageClass: 'physical', moveType: 'bug' })
export const MEGA_DRAIN_MOVE_SPEC = drainSpec({ canonicalId: 'Mega Drain', slug: 'mega-drain', damageBase: 4, damageClass: 'special', moveType: 'grass' })

export const DREAM_EATER_MOVE_SPEC = attackSpec({
  canonicalId: 'Dream Eater', slug: 'dream-eater', damageBase: 10,
  damageClass: 'special', moveType: 'psychic',
  preconditions: [predicatePrecondition({
    id: 'dream-eater.sleeping-target',
    predicate: {
      kind: 'comparison', operator: 'equal',
      left: { kind: 'condition', subject: { kind: 'current-target' }, conditionId: 'sleep' },
      right: { kind: 'constant', value: true },
    },
    failureReasonCode: 'dream-eater.target-not-sleeping',
  })],
  operations: [reviewedHeal({
    slug: 'dream-eater', id: 'drain-heal', recipients: 'actor',
    calculation: {
      kind: 'damage-dealt', damageOperationId: 'dream-eater.damage', percent: 50,
      aggregation: 'per-target', preventedDamage: 'zero',
    },
    sourceOperationId: 'dream-eater.damage',
  })],
  tags: ['drain', 'sleep-target'],
})

export const EXPLOSION_MOVE_SPEC = selfKoAttack({ canonicalId: 'Explosion', slug: 'explosion', damageBase: 25, areaSizeTag: 'burst-2' })
export const SELF_DESTRUCT_MOVE_SPEC = selfKoAttack({ canonicalId: 'Self-Destruct', slug: 'self-destruct', damageBase: 20, areaSizeTag: 'burst-3' })

export const HEAL_ORDER_MOVE_SPEC = healSpec({ canonicalId: 'Heal Order', slug: 'heal-order', recipients: 'actor', percent: 50 })
export const RECOVER_MOVE_SPEC = healSpec({ canonicalId: 'Recover', slug: 'recover', recipients: 'actor', percent: 50 })
export const SLACK_OFF_MOVE_SPEC = healSpec({ canonicalId: 'Slack Off', slug: 'slack-off', recipients: 'actor', percent: 50 })
export const HEAL_PULSE_MOVE_SPEC = healSpec({ canonicalId: 'Heal Pulse', slug: 'heal-pulse', targeting: singleTargeting(), recipients: 'selected-targets', percent: 50, tags: ['aura'] })
export const MILK_DRINK_MOVE_SPEC = healSpec({ canonicalId: 'Milk Drink', slug: 'milk-drink', targeting: singleTargeting(), recipients: 'selected-targets', percent: 50 })
export const SOFT_BOILED_MOVE_SPEC = healSpec({ canonicalId: 'Soft-Boiled', slug: 'soft-boiled', targeting: singleTargeting(), recipients: 'selected-targets', percent: 50 })

const saveBonusEffect: MoveTemporaryEffectOperation = {
  id: 'hold-hands.save-bonus', kind: 'temporary-effect',
  source: { kind: 'move', id: 'move.hold-hands' },
  recipients: { kind: 'actor-and-attacked-targets' }, phase: 'schedule',
  reasonCode: 'hold-hands.save-bonus',
  payload: {
    action: 'add', effectId: 'hold-hands.save-bonus',
    definition: {
      kind: 'numeric-modifier',
      duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'refresh', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['hold-hands', 'save-check'],
      payload: { attribute: 'save-check', operation: 'add', value: 2, rounding: 'none' },
      dispel: { policy: 'matching-tags', tags: ['save-check'] },
      transferPolicy: 'expire',
    },
    recipientScope: 'placements',
  },
}

export const HOLD_HANDS_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Hold Hands', targeting: singleTargeting(),
  operations: [
    reviewedHeal({
      slug: 'hold-hands', id: 'temporary-hp', recipients: 'actor-and-attacked-targets',
      pool: 'temporary-hit-points', calculation: { kind: 'percent-max', percent: 30 }, phase: 'hit',
    }),
    saveBonusEffect,
    ...standardTerminalOperations('hold-hands'),
  ],
  tags: ['save-check', 'temporary-effect', 'temporary-hp'],
})

const allyBurst = (): MoveSpecTargetingDeclaration => areaTargeting({
  relationship: 'same-side', willingness: 'any', excludeActor: false,
})

const clearStatuses = (
  slug: string,
  recipients: 'area-targets' | 'selected-targets',
): MoveConditionEffectOperation => ({
  id: `${slug}.clear-statuses`, kind: 'condition',
  source: { kind: 'move', id: `move.${slug}` }, recipients: { kind: recipients },
  phase: 'hit', reasonCode: `${slug}.clear-statuses`,
  payload: {
    action: 'clear', conditionId: null, conditionSource: null,
    filter: { groups: ['persistent', 'volatile'], conditionIds: [], excludedConditionIds: [] },
    randomChoice: null, duration: null, saveTiming: 'canonical',
    stackPolicy: { kind: 'refresh', maxStacks: null },
  },
})

export const JUNGLE_HEALING_MOVE_SPEC = healSpec({
  canonicalId: 'Jungle Healing', slug: 'jungle-healing', targeting: allyBurst(),
  recipients: 'area-targets', percent: 25,
  operations: [clearStatuses('jungle-healing', 'area-targets')],
  tags: ['ally', 'area', 'cleanse'],
})
export const LIFE_DEW_MOVE_SPEC = healSpec({
  canonicalId: 'Life Dew', slug: 'life-dew', targeting: allyBurst(),
  recipients: 'area-targets', percent: 25, tags: ['ally', 'area'],
})

export const LIGHT_OF_RUIN_MOVE_SPEC = attackSpec({
  canonicalId: 'Light of Ruin', slug: 'light-of-ruin', damageBase: 14,
  damageClass: 'special', moveType: 'fairy', area: true, smite: true,
  operations: [recoil('light-of-ruin', 50)], tags: ['recoil', 'smite'],
})

const actorDamageThisRound = {
  kind: 'move-history' as const,
  subject: { kind: 'actor' as const },
  query: 'damage-received-this-round' as const,
}
export const METAL_BURST_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Metal Burst', targeting: areaTargeting(),
  operations: [
    reviewedDirectHp({
      slug: 'metal-burst', id: 'retaliation-loss', recipients: 'area-targets',
      calculation: { kind: 'formula', expression: actorDamageThisRound },
      phase: 'hit', applyTypeImmunity: true,
    }),
    ...standardTerminalOperations('metal-burst'),
  ],
  tags: ['area', 'direct-hp', 'history', 'retaliation'],
})

export const MIND_BLOWN_MOVE_SPEC = attackSpec({
  canonicalId: 'Mind Blown', slug: 'mind-blown', damageBase: 15,
  damageClass: 'special', moveType: 'fire', area: true, smite: true,
  operations: [actorPercentLoss('mind-blown', 50)], tags: ['hp-cost', 'smite'],
})

export const MYSTICAL_POWER_MOVE_SPEC = attackSpec({
  canonicalId: 'Mystical Power', slug: 'mystical-power', damageBase: 7,
  damageClass: 'special', moveType: 'psychic', handler: true,
  tags: ['highest-stat', 'self-stage', 'spirit-surge'],
})

export const OBLIVION_WING_MOVE_SPEC = drainSpec({
  canonicalId: 'Oblivion Wing', slug: 'oblivion-wing', damageBase: 8,
  damageClass: 'special', moveType: 'flying', percent: 100,
})
export const PARABOLIC_CHARGE_MOVE_SPEC = drainSpec({
  canonicalId: 'Parabolic Charge', slug: 'parabolic-charge', damageBase: 7,
  damageClass: 'special', moveType: 'electric', area: true,
  percent: 50, aggregation: 'aggregate',
})

const pollenBranch: MoveBranchEffectOperation = {
  id: 'pollen-puff.relationship', kind: 'branch',
  source: { kind: 'move', id: 'move.pollen-puff' },
  recipients: { kind: 'attacked-targets' }, phase: 'target',
  reasonCode: 'pollen-puff.relationship-branch',
  payload: {
    kind: 'relationship', selectionId: 'pollen-puff.relationship', scope: 'recipient',
    branches: {
      self: { id: 'heal-self', operationIds: ['pollen-puff.heal-ally'] },
      ally: { id: 'heal-ally', operationIds: ['pollen-puff.heal-ally'] },
      enemy: { id: 'damage-enemy', operationIds: ['pollen-puff.accuracy', 'pollen-puff.damage'] },
      unknown: { id: 'unknown', operationIds: [] },
    },
  },
}
export const POLLEN_PUFF_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Pollen Puff', targeting: singleTargeting(),
  operations: [
    pollenBranch,
    standardAccuracy('pollen-puff'),
    reviewedDamage({ slug: 'pollen-puff', damageBase: 9, damageClass: 'special', moveType: 'bug' }),
    reviewedHeal({
      slug: 'pollen-puff', id: 'heal-ally', recipients: 'attacked-targets',
      calculation: { kind: 'percent-max', percent: 50 }, phase: 'hit',
      sourceOperationId: pollenBranch.id,
    }),
    ...standardTerminalOperations('pollen-puff'),
  ],
  registeredHandlerId: HP_COHORTS_211_217_HANDLER_ID,
  tags: ['ally', 'branch', 'damage', 'heal'], 
})

export const PURIFY_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Purify', targeting: singleTargeting(),
  operations: [...standardTerminalOperations('purify')],
  registeredHandlerId: HP_COHORTS_211_217_HANDLER_ID,
  tags: ['cleanse', 'heal', 'status-count'],
})

const relicSleep = reviewedCondition({
  slug: 'relic-song', id: 'sleep', recipients: 'hit-targets', conditionId: 'sleep',
  sourceOperationId: 'relic-song.damage',
  accuracyRollTrigger: { rollId: 'relic-song.accuracy-roll', trigger: { kind: 'range', minimum: 16 } },
  applyTypeImmunity: true,
})
const formEffect = (formId: 'aria-form' | 'step-form'): MoveTemporaryEffectOperation => ({
  id: `relic-song.${formId}`, kind: 'temporary-effect',
  source: { kind: 'operation', id: 'relic-song.choose-form' }, recipients: { kind: 'actor' },
  phase: 'schedule', reasonCode: `relic-song.${formId}`,
  payload: {
    action: 'add', effectId: 'relic-song.form', recipientScope: 'placements',
    definition: {
      kind: 'creature-rule-overlay', duration: { kind: 'permanent', remaining: null },
      stacks: 1, charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['form', 'relic-song'],
      payload: { domain: 'form', action: 'replace', value: formId, referencePlacementId: null },
      dispel: { policy: 'matching-tags', tags: ['form'] }, transferPolicy: 'retain',
    },
  },
})
const relicChoice: MoveBranchEffectOperation = {
  id: 'relic-song.choose-form', kind: 'branch', source: { kind: 'operation', id: 'relic-song.damage' },
  recipients: { kind: 'actor' }, phase: 'schedule', reasonCode: 'relic-song.choose-form',
  payload: {
    kind: 'choice', selectionId: 'relic-song.form', scope: 'resolution', owner: 'actor',
    requestId: 'relic-song.form', promptKey: 'move.relic-song.choose-form',
    options: [
      { id: 'aria-form', labelKey: 'form.aria', operationIds: ['relic-song.aria-form'] },
      { id: 'step-form', labelKey: 'form.step', operationIds: ['relic-song.step-form'] },
    ],
    pass: { id: 'keep-form', operationIds: [] },
  },
}
export const RELIC_SONG_MOVE_SPEC = attackSpec({
  canonicalId: 'Relic Song', slug: 'relic-song', damageBase: 8,
  damageClass: 'special', moveType: 'normal', area: true,
  operations: [relicSleep, relicChoice, formEffect('aria-form'), formEffect('step-form')],
  tags: ['condition', 'form', 'sonic'],
})

export const STEEL_BEAM_MOVE_SPEC = attackSpec({
  canonicalId: 'Steel Beam', slug: 'steel-beam', damageBase: 14,
  damageClass: 'special', moveType: 'steel', area: true, smite: true,
  operations: [actorPercentLoss('steel-beam', 50)], tags: ['hp-cost', 'smite'],
})

export const STRENGTH_SAP_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Strength Sap', targeting: singleTargeting(),
  operations: [standardAccuracy('strength-sap'), ...standardTerminalOperations('strength-sap')],
  registeredHandlerId: HP_COHORTS_211_217_HANDLER_ID,
  tags: ['heal', 'highest-stat', 'stage'],
})

export const SUBMISSION_MOVE_SPEC = attackSpec({
  canonicalId: 'Submission', slug: 'submission', damageBase: 8,
  damageClass: 'physical', moveType: 'fighting',
  operations: [
    recoil('submission', 100 / 3),
    reviewedCondition({
      slug: 'submission', id: 'trip', recipients: 'hit-targets', conditionId: 'tripped',
      sourceOperationId: 'submission.damage',
      accuracyRollTrigger: { rollId: 'submission.accuracy-roll', trigger: { kind: 'range', minimum: 15 } },
      applyTypeImmunity: true,
    }),
  ],
  tags: ['condition', 'recoil', 'threshold'],
})

const toxicThreadBranch: MoveBranchEffectOperation = {
  id: 'toxic-thread.poison-state', kind: 'branch',
  source: { kind: 'operation', id: 'toxic-thread.accuracy' }, recipients: { kind: 'hit-targets' },
  phase: 'hit', reasonCode: 'toxic-thread.poison-state',
  payload: {
    kind: 'predicate', selectionId: 'toxic-thread.poison-state', scope: 'recipient',
    predicate: {
      kind: 'comparison', operator: 'equal',
      left: { kind: 'condition', subject: { kind: 'current-target' }, conditionId: 'poisoned' },
      right: { kind: 'constant', value: true },
    },
    whenTrue: { id: 'already-poisoned', operationIds: ['toxic-thread.tick-loss', 'toxic-thread.lower-speed-two'] },
    whenFalse: { id: 'new-poison', operationIds: ['toxic-thread.poison', 'toxic-thread.lower-speed-one'] },
  },
}
export const TOXIC_THREAD_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Toxic Thread', targeting: singleTargeting(),
  operations: [
    standardAccuracy('toxic-thread'), toxicThreadBranch,
    reviewedCondition({
      slug: 'toxic-thread', id: 'poison', recipients: 'hit-targets', conditionId: 'poisoned',
      phase: 'hit', sourceOperationId: toxicThreadBranch.id, applyTypeImmunity: true,
    }),
    reviewedDirectHp({
      slug: 'toxic-thread', id: 'tick-loss', recipients: 'hit-targets',
      calculation: { kind: 'percent-max', percent: 10 }, phase: 'hit',
      sourceOperationId: toxicThreadBranch.id, applyTypeImmunity: true,
    }),
    reviewedStage({
      slug: 'toxic-thread', id: 'lower-speed-one', recipients: 'hit-targets',
      stage: 'spd', value: -1, phase: 'hit', sourceOperationId: toxicThreadBranch.id,
      applyTypeImmunity: true,
    }),
    reviewedStage({
      slug: 'toxic-thread', id: 'lower-speed-two', recipients: 'hit-targets',
      stage: 'spd', value: -2, phase: 'hit', sourceOperationId: toxicThreadBranch.id,
      applyTypeImmunity: true,
    }),
    ...standardTerminalOperations('toxic-thread'),
  ],
  tags: ['condition', 'direct-hp', 'stage', 'threshold'],
})

const priorityCosts = (slug: string): readonly MoveSpecCostDeclaration[] => [
  { id: `${slug}.cost.priority`, phase: 'declare', cost: { kind: 'priority', mode: 'standard' } },
  standardActionCost(slug),
]
export const WAVE_CRASH_MOVE_SPEC = attackSpec({
  canonicalId: 'Wave Crash', slug: 'wave-crash', damageBase: 8,
  damageClass: 'physical', moveType: 'water', operations: [recoil('wave-crash', 25)],
  costs: priorityCosts('wave-crash'), tags: ['priority', 'recoil'],
})

export const FINAL_GAMBIT_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Final Gambit', targeting: singleTargeting(),
  operations: [
    standardAccuracy('final-gambit'),
    reviewedDirectHp({
      slug: 'final-gambit', id: 'self-sacrifice', recipients: 'actor', mode: 'set',
      calculation: { kind: 'fixed', value: 0 }, phase: 'hit',
    }),
    reviewedDirectHp({
      slug: 'final-gambit', id: 'target-loss', recipients: 'hit-targets',
      calculation: {
        kind: 'hp-lost', hpOperationId: 'final-gambit.self-sacrifice',
        pool: 'hit-points', percent: 100, aggregation: 'aggregate',
      },
      sourceOperationId: 'final-gambit.self-sacrifice', applyTypeImmunity: true,
    }),
    reviewedCondition({
      slug: 'final-gambit', id: 'faint', recipients: 'actor', conditionId: 'fainted',
      phase: 'ko', sourceOperationId: 'final-gambit.self-sacrifice',
      operationOutcomeTrigger: { operationId: 'final-gambit.self-sacrifice', outcome: 'applied' },
    }),
    ...standardTerminalOperations('final-gambit'),
  ],
  tags: ['direct-hp', 'self-ko'],
})

export const FLAME_BURST_MOVE_SPEC = attackSpec({
  canonicalId: 'Flame Burst', slug: 'flame-burst', damageBase: 7,
  damageClass: 'special', moveType: 'fire',
  operations: [reviewedDirectHp({
    slug: 'flame-burst', id: 'adjacent-splash', recipients: 'cardinally-adjacent-to-hit-targets',
    calculation: { kind: 'fixed', value: 5 }, sourceOperationId: 'flame-burst.damage',
  })],
  tags: ['direct-hp', 'splash'],
})

const fractionalTargetLoss = (input: {
  readonly canonicalId: 'Nature’s Madness' | 'Super Fang'
  readonly slug: string
  readonly moveType: string
  readonly damageClass: 'physical' | 'special'
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId, targeting: singleTargeting(),
  operations: [
    standardAccuracy(input.slug),
    reviewedDirectHp({
      slug: input.slug, id: 'half-current-loss', recipients: 'hit-targets',
      calculation: { kind: 'percent-current', percent: 50 }, phase: 'damage',
      accuracyRollId: `${input.slug}.accuracy-roll`, applyTypeImmunity: true,
    }),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['direct-hp', input.moveType],
})
export const NATURES_MADNESS_MOVE_SPEC = fractionalTargetLoss({ canonicalId: 'Nature’s Madness', slug: 'natures-madness', moveType: 'fairy', damageClass: 'special' })
export const SUPER_FANG_MOVE_SPEC = fractionalTargetLoss({ canonicalId: 'Super Fang', slug: 'super-fang', moveType: 'normal', damageClass: 'physical' })

const levelLossSpec = (input: {
  readonly canonicalId: 'Night Shade' | 'Seismic Toss'
  readonly slug: string
  readonly moveType: string
}): MoveSpec => createReviewedMoveSpec({
  canonicalId: input.canonicalId, targeting: singleTargeting(),
  operations: [
    standardAccuracy(input.slug),
    reviewedDirectHp({
      slug: input.slug, id: 'level-loss', recipients: 'hit-targets', phase: 'damage',
      calculation: {
        kind: 'formula', expression: {
          kind: 'stat', subject: { kind: 'actor' }, stat: 'level',
          combatStagePolicy: 'ignore', stageModifierPolicy: 'ignore',
        },
      },
      accuracyRollId: `${input.slug}.accuracy-roll`, applyTypeImmunity: true,
    }),
    ...standardTerminalOperations(input.slug),
  ],
  tags: ['direct-hp', 'level-scaling', input.moveType],
})
export const NIGHT_SHADE_MOVE_SPEC = levelLossSpec({ canonicalId: 'Night Shade', slug: 'night-shade', moveType: 'ghost' })
export const SEISMIC_TOSS_MOVE_SPEC = levelLossSpec({ canonicalId: 'Seismic Toss', slug: 'seismic-toss', moveType: 'fighting' })

export const PAIN_SPLIT_MOVE_SPEC = createReviewedMoveSpec({
  canonicalId: 'Pain Split', targeting: singleTargeting(),
  operations: [
    reviewedDirectHp({
      slug: 'pain-split', id: 'equalize-hp', recipients: 'actor-and-attacked-targets',
      mode: 'split', calculation: null, phase: 'hit', rounding: 'floor',
      hitPointMarkers: 'apply-after-operation',
    }),
    ...standardTerminalOperations('pain-split'),
  ],
  tags: ['direct-hp', 'multi-resource', 'split'],
})

const SPECS: Readonly<Record<HpCohort211217MoveName, MoveSpec>> = {
  'Belly Drum': BELLY_DRUM_MOVE_SPEC, Bind: BIND_MOVE_SPEC, Brine: BRINE_MOVE_SPEC,
  Chloroblast: CHLOROBLAST_MOVE_SPEC, Clamp: CLAMP_MOVE_SPEC,
  'Clangorous Soul': CLANGOROUS_SOUL_MOVE_SPEC, 'Crush Grip': CRUSH_GRIP_MOVE_SPEC,
  'Dragon Energy': DRAGON_ENERGY_MOVE_SPEC, 'Drain Punch': DRAIN_PUNCH_MOVE_SPEC,
  'Draining Kiss': DRAINING_KISS_MOVE_SPEC, 'Dream Eater': DREAM_EATER_MOVE_SPEC,
  Eruption: ERUPTION_MOVE_SPEC, Explosion: EXPLOSION_MOVE_SPEC, 'Giga Drain': GIGA_DRAIN_MOVE_SPEC,
  'Heal Order': HEAL_ORDER_MOVE_SPEC, 'Heal Pulse': HEAL_PULSE_MOVE_SPEC,
  'Hold Hands': HOLD_HANDS_MOVE_SPEC, 'Jungle Healing': JUNGLE_HEALING_MOVE_SPEC,
  'Leech Life': LEECH_LIFE_MOVE_SPEC, 'Life Dew': LIFE_DEW_MOVE_SPEC,
  'Light of Ruin': LIGHT_OF_RUIN_MOVE_SPEC, 'Mega Drain': MEGA_DRAIN_MOVE_SPEC,
  'Metal Burst': METAL_BURST_MOVE_SPEC, 'Milk Drink': MILK_DRINK_MOVE_SPEC,
  'Mind Blown': MIND_BLOWN_MOVE_SPEC, 'Mystical Power': MYSTICAL_POWER_MOVE_SPEC,
  'Oblivion Wing': OBLIVION_WING_MOVE_SPEC, 'Parabolic Charge': PARABOLIC_CHARGE_MOVE_SPEC,
  'Pollen Puff': POLLEN_PUFF_MOVE_SPEC, Purify: PURIFY_MOVE_SPEC, Recover: RECOVER_MOVE_SPEC,
  'Relic Song': RELIC_SONG_MOVE_SPEC, 'Self-Destruct': SELF_DESTRUCT_MOVE_SPEC,
  'Slack Off': SLACK_OFF_MOVE_SPEC, 'Soft-Boiled': SOFT_BOILED_MOVE_SPEC,
  'Steel Beam': STEEL_BEAM_MOVE_SPEC, 'Strength Sap': STRENGTH_SAP_MOVE_SPEC,
  Submission: SUBMISSION_MOVE_SPEC, 'Toxic Thread': TOXIC_THREAD_MOVE_SPEC,
  'Water Spout': WATER_SPOUT_MOVE_SPEC, 'Wave Crash': WAVE_CRASH_MOVE_SPEC,
  Wrap: WRAP_MOVE_SPEC, 'Wring Out': WRING_OUT_MOVE_SPEC,
  'Final Gambit': FINAL_GAMBIT_MOVE_SPEC, 'Flame Burst': FLAME_BURST_MOVE_SPEC,
  'Nature’s Madness': NATURES_MADNESS_MOVE_SPEC, 'Night Shade': NIGHT_SHADE_MOVE_SPEC,
  'Pain Split': PAIN_SPLIT_MOVE_SPEC, 'Seismic Toss': SEISMIC_TOSS_MOVE_SPEC,
  'Super Fang': SUPER_FANG_MOVE_SPEC,
}

export const HP_COHORTS_211_217_MOVE_SPEC_REGISTRATIONS: readonly MoveSpecV2Registration[] =
  Object.freeze(MA_211_217_MOVE_NAMES.map(canonicalId => Object.freeze({
    canonicalId,
    sourceModule: 'server/domain/moveAutomation/specs/hpCohorts211_217.ts',
    spec: SPECS[canonicalId],
  })))
