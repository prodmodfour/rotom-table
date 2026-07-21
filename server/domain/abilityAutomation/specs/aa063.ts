import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget as noneTarget,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const moveTrigger = (input: {
  timings: readonly ('declared' | 'use-started' | 'accuracy-resolved' | 'effects-resolved' | 'completed' | 'cancelled')[]
  userRelation?: 'owner' | 'other' | 'any'
  targetRelation?: 'hit' | 'attacked' | 'missed' | 'critical' | 'declared' | 'not-targeted' | 'any'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: [...input.timings], moveTypes: [], damageClasses: [], keywordsAny: [], keywordsAll: [],
  userRelation: input.userRelation ?? 'owner', targetRelation: input.targetRelation ?? 'any',
})
const attackerStrikeTrigger = {
  kind: 'ability-strike-fact', timings: ['damage-resolved'], accuracyOutcomes: [],
  rangeContexts: ['melee'], directness: [], moveTypes: [], damageClasses: [],
  effectiveness: ['super-effective', 'double-super-effective'], contact: 'any', critical: 'any',
  ownerRole: 'attacker', prevention: 'any', strikeIndex: 'any', minimumHpLoss: 1, minimumTotalLoss: null,
}
const attackerFaintTrigger = {
  kind: 'ability-hp-fact', changeKinds: ['damage'], faintTransitions: ['fainted'], ownerRole: 'actor',
  massiveDamage: 'any', crossedZero: 'required', injuryChange: 'any', temporaryChange: 'any',
  hpThreshold: 'zero', minimumAppliedAmount: 1,
}

export const BRIMSTONE_ABILITY_SPEC = staticSpec('Brimstone', 'aa063.brimstone', {
  damagingAttackTypes: ['fire', 'poison'],
  triggeringConditions: ['burned', 'poisoned', 'badly-poisoned'],
  resultingConditions: ['burned', 'poisoned'],
}, ['condition', 'move-overlay', 'static', 'type'])

export const BULLETPROOF_ABILITY_SPEC = staticSpec('Bulletproof', 'aa063.bulletproof', {
  resistanceSteps: 1, rangedOnly: true, directTargetOnly: true,
  excludedAreaKinds: ['burst', 'cardinally-adjacent', 'cone', 'line', 'close-blast', 'ranged-blast', 'pass'],
}, ['defensive', 'range', 'resistance', 'static'])

export const BULLY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Bully', mechanicId: 'aa063.bully',
  config: {
    action: 'free', frequency: 'scene', meleeOnly: true, superEffectiveOnly: true,
    pushMeters: 2, conditions: ['tripped'], injuries: 1,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: attackerStrikeTrigger,
  tags: ['condition', 'forced-movement', 'injury', 'reaction', 'triggered'],
})

export const CAVE_CRASHER_ABILITY_SPEC = staticSpec('Cave Crasher', 'aa063.cave-crasher', {
  resistedMoveTypes: ['ground', 'rock'], resistanceSteps: 1,
}, ['defensive', 'resistance', 'static', 'type'])

export const CELEBRATE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Celebrate', mechanicId: 'aa063.celebrate',
  config: {
    action: 'swift', frequency: 'at-will', damagingOnly: true, targetRelationship: 'enemy',
    disengageDistance: 1, disengageAction: 'free', opportunityAttacks: 'ignore',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['effects-resolved'], targetRelation: 'hit' }),
  tags: ['action', 'movement', 'reaction', 'triggered'],
})

export const CHEMICAL_ROMANCE_ABILITY_SPEC = staticSpec('Chemical Romance', 'aa063.chemical-romance', {
  connectionMoveId: 'Sweet Scent',
  triggeringMoveIds: ['Poison Gas', 'Smog', 'Sweet Scent', 'Toxic', 'Venom Drench'],
  targetGender: 'male', condition: 'infatuated', sourceBound: true,
}, ['condition', 'connection', 'move-overlay', 'static', 'target'])

export const CHERRY_POWER_ABILITY_SPEC = activatedSpec('Cherry Power', 'aa063.cherry-power', {
  action: 'swift', frequency: 'daily', temporaryHitPoints: 15,
  curedConditionGroup: 'persistent-status-afflictions',
}, noneTarget('activate'), ['action', 'condition', 'daily', 'temporary-hp'])

export const CHILLING_NEIGH_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Chilling Neigh', mechanicId: 'aa063.chilling-neigh',
  config: {
    action: 'free', frequency: 'at-will', damagingOnly: true, faintedRelationship: 'enemy',
    attackStages: 1, foeRadius: 3, evasionPenalty: 2, duration: 'one-full-round',
  },
  eventKind: 'hp', checkpoint: 'post-effect',
  predicate: attackerFaintTrigger,
  tags: ['evasion', 'reaction', 'stage', 'triggered', 'zone'],
})

export const CHLOROPHYLL_ABILITY_SPEC = staticSpec('Chlorophyll', 'aa063.chlorophyll', {
  initiativeMultiplier: 2, weather: 'sunny', alternativeHpThreshold: { numerator: 1, denominator: 2 },
}, ['hp-threshold', 'initiative', 'static', 'weather'])

export const CLAY_CANNONS_ABILITY_SPEC = activatedSpec('Clay Cannons', 'aa063.clay-cannons', {
  action: 'swift', frequency: 'at-will', duration: 'end-of-round',
  rangedMovesOnly: true, virtualOriginRadius: 2, chooseOriginPerMove: true,
}, noneTarget('activate'), ['action', 'duration', 'geometry', 'move-overlay'])

export const CLEAR_BODY_ABILITY_SPEC = staticSpec('Clear Body', 'aa063.clear-body', {
  preventCombatStageLoweringFrom: ['enemy-feature', 'enemy-ability', 'enemy-move'],
  statusAfflictionStageChangesAllowed: true,
}, ['defensive', 'immunity', 'stage', 'static'])

export const CLOUD_NINE_ABILITY_SPEC = activatedSpec('Cloud Nine', 'aa063.cloud-nine', {
  action: 'free', frequency: 'scene', weatherResult: 'normal', removeAllWeatherZones: true,
}, noneTarget('activate'), ['action', 'field', 'scene', 'weather'])

export const AA063_ABILITY_SPECS = Object.freeze([
  BRIMSTONE_ABILITY_SPEC, BULLETPROOF_ABILITY_SPEC, BULLY_ABILITY_SPEC,
  CAVE_CRASHER_ABILITY_SPEC, CELEBRATE_ABILITY_SPEC, CHEMICAL_ROMANCE_ABILITY_SPEC,
  CHERRY_POWER_ABILITY_SPEC, CHILLING_NEIGH_ABILITY_SPEC, CHLOROPHYLL_ABILITY_SPEC,
  CLAY_CANNONS_ABILITY_SPEC, CLEAR_BODY_ABILITY_SPEC, CLOUD_NINE_ABILITY_SPEC,
])

export const AA063_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA063_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa063.ts',
    spec,
  })),
)
