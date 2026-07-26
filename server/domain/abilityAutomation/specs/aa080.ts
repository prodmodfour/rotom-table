import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const loweredCombatStagePredicate = (ownerRole: 'other' | 'subject') => ({
  kind: 'ability-value-change-fact' as const,
  eventKinds: ['combat-stage'] as const,
  combatStageStats: [] as const,
  statKinds: [] as const,
  statLayers: [] as const,
  outcomes: ['applied'] as const,
  ownerRole,
  sourceRelation: 'other' as const,
  direction: 'lowered' as const,
  minimumAbsoluteDelta: 1,
})

const tokenTarget = (input: {
  readonly modeId: string
  readonly id: string
  readonly minimum: 0 | 1
  readonly maximumRange: number | null
}) => ({
  id: input.id,
  modeId: input.modeId,
  kind: 'token' as const,
  minSelections: input.minimum,
  maxSelections: 1,
  selector: null,
  predicate: {
    kind: 'ability-targeting' as const,
    relationship: 'other' as const,
    willingness: 'any' as const,
    excludeActor: true,
    minimumRange: 0,
    maximumRange: input.maximumRange,
    visibility: 'required' as const,
    lineOfSight: 'required' as const,
    geometry: { kind: 'direct' as const },
  },
})

const cellTarget = (input: {
  readonly modeId: string
  readonly id: string
  readonly minimum: number
  readonly maximum: number
}) => ({
  id: input.id,
  modeId: input.modeId,
  kind: 'cell' as const,
  minSelections: input.minimum,
  maxSelections: input.maximum,
  selector: null,
  predicate: null,
})

const miniNosesConfig = {
  activationAction: 'standard',
  activationFrequency: 'daily',
  maximumEntities: 3,
  hitPointsPerLevel: 1,
  levitateSpeed: 4,
  rangedOrigin: true,
  maximumOwnerRange: 5,
  regrowHours: 24,
  regrowCount: 1,
} as const

export const MINI_NOSES_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Mini-Noses',
  modes: [
    { id: 'deploy', kind: 'activated' },
    { id: 'shift', kind: 'activated' },
  ],
  targeting: [
    cellTarget({ modeId: 'deploy', id: 'deploy.cells', minimum: 1, maximum: 3 }),
    cellTarget({ modeId: 'shift', id: 'shift.cells', minimum: 1, maximum: 3 }),
  ],
  phases: [
    { modeId: 'deploy', phase: 'effect', operations: [mechanic('deploy.effect', 'aa080.mini-noses', miniNosesConfig)] },
    { modeId: 'shift', phase: 'effect', operations: [mechanic('shift.effect', 'aa080.mini-noses', miniNosesConfig)] },
  ],
  tags: ['action', 'daily', 'entity', 'mode.activated', 'movement', 'origin', 'target'],
})

export const MINUS_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Minus',
  mechanicId: 'aa080.minus',
  config: {
    action: 'free-reaction', frequency: 'scene-x2', triggerRelationship: 'foe',
    triggerRange: 10, additionalStageLoss: 1,
  },
  eventKind: 'combat-stage',
  checkpoint: 'post-effect',
  predicate: loweredCombatStagePredicate('other'),
  tags: ['action', 'combat-stage', 'range', 'reaction', 'scene', 'triggered'],
  oncePerCausalChain: false,
})

export const MIRACLE_MILE_ABILITY_SPEC = staticSpec('Miracle Mile', 'aa080.miracle-mile', {
  lastChanceType: 'fairy', hpThresholdNumerator: 1, hpThresholdDenominator: 3, damageBonus: 5,
}, ['damage', 'last-chance', 'static', 'type'])

export const MIRROR_ARMOR_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Mirror Armor',
  mechanicId: 'aa080.mirror-armor',
  config: {
    action: 'free-reaction', frequency: 'at-will', directSources: ['foe-move', 'foe-ability'],
    preventLoss: true, reflectEqualLoss: true, excludeStatus: true,
  },
  eventKind: 'combat-stage',
  checkpoint: 'pre-effect',
  predicate: loweredCombatStagePredicate('subject'),
  tags: ['action', 'combat-stage', 'reaction', 'reflection', 'triggered'],
  oncePerCausalChain: false,
})

const missileLaunchConfig = {
  connectionMoveId: 'Dragon Darts',
  activationAction: 'standard',
  activationFrequency: 'scene-x2',
  placementCount: 2,
  placementRange: 6,
  shiftAction: 'swift',
  shiftDistance: 4,
  accuracyCheck: 2,
  damageBase: 5,
  damageClass: 'physical',
  moveType: 'dragon',
  anyDamageDestroys: true,
} as const

export const MISSILE_LAUNCH_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Missile Launch',
  modes: [
    { id: 'deploy', kind: 'activated' },
    { id: 'shift', kind: 'activated' },
    { id: 'collision', kind: 'activated' },
  ],
  targeting: [
    cellTarget({ modeId: 'deploy', id: 'deploy.cells', minimum: 2, maximum: 2 }),
    cellTarget({ modeId: 'shift', id: 'shift.cells', minimum: 1, maximum: 2 }),
    cellTarget({ modeId: 'collision', id: 'collision.destination', minimum: 1, maximum: 1 }),
    tokenTarget({ modeId: 'collision', id: 'collision.target', minimum: 1, maximumRange: null }),
  ],
  phases: [
    { modeId: 'deploy', phase: 'effect', operations: [mechanic('deploy.effect', 'aa080.missile-launch', missileLaunchConfig)] },
    { modeId: 'shift', phase: 'effect', operations: [mechanic('shift.effect', 'aa080.missile-launch', missileLaunchConfig)] },
    { modeId: 'collision', phase: 'effect', operations: [mechanic('collision.effect', 'aa080.missile-launch', missileLaunchConfig)] },
  ],
  tags: ['action', 'connection', 'damage', 'entity', 'mode.activated', 'movement', 'roll', 'scene', 'target'],
})

export const MISTY_SURGE_ABILITY_SPEC = activatedSpec('Misty Surge', 'aa080.misty-surge', {
  action: 'swift', frequency: 'scene-x3', terrainId: 'misty', durationRounds: 1,
}, noAbilityTarget('activate'), ['action', 'field', 'mode.activated', 'scene', 'terrain'])

export const MOJO_ABILITY_SPEC = staticSpec('Mojo', 'aa080.mojo', {
  moveType: 'ghost', ignoredDefenderTypeImmunity: 'normal',
}, ['immunity-bypass', 'offensive', 'static', 'type'])

export const MOLD_BREAKER_ABILITY_SPEC = staticSpec('Mold Breaker', 'aa080.mold-breaker', {
  ignoredAbilityClassification: 'defensive', targetRelationship: 'enemy',
}, ['ability-bypass', 'offensive', 'provider', 'static'])

export const MOODY_ABILITY_SPEC = staticSpec('Moody', 'aa080.moody', {
  trigger: 'turn-end', dieSides: 6, raisedStageDelta: 2,
  loweredStageDelta: -1, differentStats: true,
}, ['combat-stage', 'lifecycle', 'random', 'static'])

export const MOTOR_DRIVE_ABILITY_SPEC = staticSpec('Motor Drive', 'aa080.motor-drive', {
  immuneMoveType: 'electric', damageAndEffectImmunity: true,
  hitStage: 'speed', hitStageDelta: 1, classification: 'defensive',
}, ['combat-stage', 'defensive', 'immunity', 'static', 'type'])

export const MOUNTAIN_PEAK_ABILITY_SPEC = staticSpec('Mountain Peak', 'aa080.mountain-peak', {
  lastChanceType: 'rock', hpThresholdNumerator: 1, hpThresholdDenominator: 3, damageBonus: 5,
}, ['damage', 'last-chance', 'static', 'type'])

export const MOXIE_ABILITY_SPEC = staticSpec('Moxie', 'aa080.moxie', {
  trigger: 'user-move-faints-target', targetRelationship: 'foe',
  stage: 'attack', stageDelta: 1, oncePerMove: true, optional: true,
}, ['combat-stage', 'follow-up', 'reactive', 'static'])

export const AA080_ABILITY_SPECS = Object.freeze([
  MINI_NOSES_ABILITY_SPEC,
  MINUS_ABILITY_SPEC,
  MIRACLE_MILE_ABILITY_SPEC,
  MIRROR_ARMOR_ABILITY_SPEC,
  MISSILE_LAUNCH_ABILITY_SPEC,
  MISTY_SURGE_ABILITY_SPEC,
  MOJO_ABILITY_SPEC,
  MOLD_BREAKER_ABILITY_SPEC,
  MOODY_ABILITY_SPEC,
  MOTOR_DRIVE_ABILITY_SPEC,
  MOUNTAIN_PEAK_ABILITY_SPEC,
  MOXIE_ABILITY_SPEC,
])

export const AA080_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA080_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa080.ts',
    spec,
  })),
)
