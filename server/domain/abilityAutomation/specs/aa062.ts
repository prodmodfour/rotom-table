import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget as noneTarget,
  reviewedAbilitySpec as base,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const directTargetPredicate = (input: {
  relationship: 'ally' | 'enemy' | 'other'
  maximumRange: number | null
}) => ({
  kind: 'ability-targeting', relationship: input.relationship,
  willingness: 'any', excludeActor: true,
  minimumRange: 0, maximumRange: input.maximumRange,
  visibility: 'required', lineOfSight: 'ignored', geometry: { kind: 'direct' },
})
const hpThresholdPredicate = {
  kind: 'ability-hp-fact', changeKinds: ['damage', 'drain', 'recoil', 'cost', 'set'],
  faintTransitions: [], ownerRole: 'subject', massiveDamage: 'any', crossedZero: 'any',
  injuryChange: 'any', temporaryChange: 'any', hpThreshold: 'below-half', minimumAppliedAmount: 1,
}
const enragedPredicate = {
  kind: 'ability-condition-fact', operations: ['apply'], outcomes: ['applied'],
  conditionIds: ['enraged'], ownerRole: 'subject', sourceRelation: 'any',
  resultingState: 'present', save: 'any',
}

export const BEAUTIFUL_ABILITY_SPEC = base({
  canonicalId: 'Beautiful',
  modes: [
    { id: 'battle', kind: 'activated' },
    { id: 'contest', kind: 'activated' },
  ],
  targeting: [...noneTarget('battle'), ...noneTarget('contest')],
  phases: [
    { modeId: 'battle', phase: 'effect', operations: [mechanic('battle.mechanic', 'aa062.beautiful-battle', {
      branch: 'battle', action: 'standard', frequency: 'scene', specialAttackStages: 1,
      allyRadius: 5, curedConditions: ['enraged'],
    })] },
    { modeId: 'contest', phase: 'effect', operations: [mechanic('contest.mechanic', 'aa062.beautiful-contest', {
      branch: 'contest', action: 'standard', frequency: 'scene', contestStat: 'beauty', bonusDice: 2,
    })] },
  ],
  tags: ['action', 'branch', 'contest', 'stage', 'condition'],
})

export const BERRY_STORAGE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Berry Storage', mechanicId: 'aa062.berry-storage',
  config: {
    itemCategory: 'berry', storedBuffInstances: 3, sceneTradeLimit: 1,
    ignoreNormalDigestionLimits: true, expiresAt: 'extended-rest',
  },
  eventKind: 'item', checkpoint: 'post-effect',
  predicate: {
    kind: 'ability-item-fact', changes: ['consumed'], outcomes: ['applied'],
    resourceKinds: ['inventory', 'held-item'], itemIds: [], ownerRole: 'owner-before',
    sourceRelation: 'owner', minimumQuantityApplied: 1,
  },
  tags: ['berry', 'daily', 'digestion', 'item', 'triggered'],
})

export const BERSERK_ABILITY_SPEC = base({
  canonicalId: 'Berserk',
  modes: [{ id: 'trigger', kind: 'triggered' }],
  subscriptions: [
    { id: 'half-hp.subscription', modeId: 'trigger', eventKind: 'hp', checkpoint: 'post-effect', response: 'mandatory', priority: 0, oncePerCausalChain: true, predicate: hpThresholdPredicate },
    { id: 'enraged.subscription', modeId: 'trigger', eventKind: 'condition', checkpoint: 'post-effect', response: 'mandatory', priority: 0, oncePerCausalChain: true, predicate: enragedPredicate },
  ],
  targeting: noneTarget('trigger'),
  phases: [{ modeId: 'trigger', phase: 'effect', operations: [mechanic('trigger.mechanic', 'aa062.berserk', {
    firstHalfHpCrossingPerEncounter: true, enragedAlwaysTriggers: true, specialAttackStages: 1,
  })] }],
  tags: ['condition', 'hp-threshold', 'stage', 'triggered'],
})

export const BIG_PECKS_ABILITY_SPEC = staticSpec('Big Pecks', 'aa062.big-pecks', {
  protectedStat: 'defense', preventStatLowering: true, preventCombatStageLowering: true,
}, ['defensive', 'immunity', 'stage', 'stat', 'static'])

export const BIG_SWALLOW_ABILITY_SPEC = staticSpec('Big Swallow', 'aa062.big-swallow', {
  connectionMoveId: 'Stockpile', affectedMoveIds: ['Spit Up', 'Swallow'],
  virtualCountBonus: 1, maximumStockpileCount: 3,
}, ['connection', 'counter', 'move-overlay', 'static'])

export const BLAZE_ABILITY_SPEC = staticSpec('Blaze', 'aa062.blaze', {
  moveType: 'fire', normalDamageBonus: 5, lowHpDamageBonus: 10,
  lowHpThreshold: { numerator: 1, denominator: 3 },
}, ['damage', 'hp-threshold', 'static', 'type'])

export const BLESSED_TOUCH_ABILITY_SPEC = activatedSpec('Blessed Touch', 'aa062.blessed-touch', {
  action: 'standard', frequency: 'daily-x2', adjacency: 1,
  healing: { kind: 'fraction-max-hp', numerator: 1, denominator: 4 },
}, [{
  id: 'activate.target', modeId: 'activate', kind: 'token', minSelections: 1, maxSelections: 1,
  selector: { kind: 'candidate-targets' }, predicate: directTargetPredicate({ relationship: 'other', maximumRange: 1 }),
}], ['action', 'daily', 'healing', 'target'])

export const BLOW_AWAY_ABILITY_SPEC = staticSpec('Blow Away', 'aa062.blow-away', {
  connectionMoveId: 'Whirlwind', additionalPushMeters: 2, hitPointLossTicks: 1,
}, ['connection', 'forced-movement', 'hp', 'move-overlay', 'static'])

export const BLUR_ABILITY_SPEC = staticSpec('Blur', 'aa062.blur', {
  appliesToMovesWithoutAccuracyCheck: true, imposedAccuracyCheck: 2,
  targetEvasionMultiplier: 0.5,
}, ['accuracy', 'defensive', 'evasion', 'static'])

export const BODYGUARD_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Bodyguard', mechanicId: 'aa062.bodyguard',
  config: {
    adjacency: 1, action: 'free', frequency: 'scene-x2', swapPositions: true,
    redirectAttack: true, resistanceSteps: 1, areaEscapeRequired: true,
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: {
    kind: 'ability-move-fact', timings: ['accuracy-resolved'], moveTypes: [], damageClasses: [],
    keywordsAny: [], keywordsAll: [], userRelation: 'other', targetRelation: 'hit',
  },
  tags: ['defensive', 'reaction', 'redirection', 'resistance', 'swap', 'triggered'],
})

export const BONE_LORD_ABILITY_SPEC = base({
  canonicalId: 'Bone Lord',
  modes: [{ id: 'passive', kind: 'static' }, { id: 'empower', kind: 'activated' }],
  targeting: [
    ...noneTarget('passive'),
    { id: 'empower.move', modeId: 'empower', kind: 'move', minSelections: 1, maxSelections: 1, selector: null, predicate: null },
  ],
  phases: [
    { modeId: 'passive', phase: 'effect', operations: [mechanic('passive.mechanic', 'aa062.bone-lord-passive', {
      connectionMoveId: 'Bonemerang', eligibleMoveIds: ['Bone Club', 'Bone Rush', 'Bonemerang'],
    })] },
    { modeId: 'empower', phase: 'effect', operations: [mechanic('empower.mechanic', 'aa062.bone-lord-empower', {
      action: 'free', usage: 'scene-per-move', eligibleMoveIds: ['Bone Club', 'Bone Rush', 'Bonemerang'],
      boneClubStageLosses: { defense: 1, specialAttack: 1 },
      bonemerangRange: 'line-6', removeKeyword: 'double-strike', boneRushAutomaticHits: 4,
    })] },
  ],
  tags: ['connection', 'move-overlay', 'multi-hit', 'stage', 'static'],
})

export const BONE_WIELDER_ABILITY_SPEC = staticSpec('Bone Wielder', 'aa062.bone-wielder', {
  moveIds: ['Bone Club', 'Bone Rush', 'Bonemerang'], moveType: 'ground', ignoreTypeImmunity: true,
}, ['immunity', 'move-overlay', 'static', 'type'])

export const AA062_ABILITY_SPECS = Object.freeze([
  BEAUTIFUL_ABILITY_SPEC, BERRY_STORAGE_ABILITY_SPEC, BERSERK_ABILITY_SPEC,
  BIG_PECKS_ABILITY_SPEC, BIG_SWALLOW_ABILITY_SPEC, BLAZE_ABILITY_SPEC,
  BLESSED_TOUCH_ABILITY_SPEC, BLOW_AWAY_ABILITY_SPEC, BLUR_ABILITY_SPEC,
  BODYGUARD_ABILITY_SPEC, BONE_LORD_ABILITY_SPEC, BONE_WIELDER_ABILITY_SPEC,
])

export const AA062_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA062_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa062.ts',
    spec,
  })),
)
