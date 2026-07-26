import { AA078_LIQUID_OOZE_DRAIN_MOVE_IDS } from '#shared/abilityAutomation/aa078'
import type { AbilitySpecV1Registration } from '../registry'
import {
  noAbilityTarget,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const movePredicate = (input: {
  readonly timings: readonly ('declared' | 'accuracy-resolved' | 'effects-resolved')[]
  readonly moveTypes?: readonly string[]
  readonly keywordsAny?: readonly string[]
  readonly userRelation: 'owner' | 'other'
  readonly targetRelation: 'any' | 'hit' | 'attacked'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: input.timings,
  moveTypes: input.moveTypes ?? [],
  damageClasses: [] as const,
  keywordsAny: input.keywordsAny ?? [],
  keywordsAll: [] as const,
  userRelation: input.userRelation,
  targetRelation: input.targetRelation,
})

export const LIGHTNING_KICKS_ABILITY_SPEC = activatedSpec('Lightning Kicks', 'aa078.lightning-kicks', {
  action: 'free', frequency: 'scene', moveNameIncludes: 'Kick', priority: true, accuracyBonus: 4,
}, noAbilityTarget('activate'), ['accuracy', 'action', 'mode.activated', 'priority', 'scene'])

export const LIGHTNING_ROD_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Lightning Rod', mechanicId: 'aa078.lightning-rod',
  config: {
    action: 'free', frequency: 'scene', triggerType: 'electric', triggerRange: 10,
    rangedOnly: true, redirectToOneTarget: true, automaticHit: true,
    damageAndEffectImmunity: true, specialAttackStageDelta: 1,
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({ timings: ['declared'], moveTypes: ['electric'], userRelation: 'other', targetRelation: 'any' }),
  tags: ['action', 'combat-stage', 'defensive', 'immunity', 'reaction', 'redirection', 'scene', 'triggered', 'type'],
})

export const LIMBER_ABILITY_SPEC = staticSpec('Limber', 'aa078.limber', {
  blockedConditions: ['Paralysis'],
}, ['condition', 'defensive', 'immunity', 'static'])

export const LINE_CHARGE_ABILITY_SPEC = staticSpec('Line Charge', 'aa078.line-charge', {
  cardinalDirectionsOnly: true, provokeAttacksOfOpportunity: false,
}, ['movement', 'protection', 'static'])

export const LIQUID_OOZE_ABILITY_SPEC = staticSpec('Liquid Ooze', 'aa078.liquid-ooze', {
  poisonResistanceSteps: 1, drainMoveIds: AA078_LIQUID_OOZE_DRAIN_MOVE_IDS,
  recoilPercent: 50, suppressDrainHealing: true, reverseLeechSeed: true,
}, ['damage', 'defensive', 'healing', 'lifecycle', 'recoil', 'resistance', 'static', 'type'])

export const LIQUID_VOICE_ABILITY_SPEC = activatedSpec('Liquid Voice', 'aa078.liquid-voice', {
  action: 'free', frequency: 'at-will', requiredKeyword: 'sonic', removedKeyword: 'sonic',
  addedKeyword: 'friendly', moveType: 'water', statusDamageClass: 'special', statusDamageBase: 1,
}, [{
  id: 'activate.mode', modeId: 'activate', kind: 'branch',
  minSelections: 1, maxSelections: 1, selector: null, predicate: null,
}], ['action', 'choice', 'mode.activated', 'move-overlay', 'triggered', 'type'])

export const LONG_REACH_ABILITY_SPEC = staticSpec('Long Reach', 'aa078.long-reach', {
  damagingOnly: true, replacementRange: '8, 1 Target', optionalReplacement: true,
}, ['choice', 'range', 'static', 'targeting'])

export const LULLABY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Lullaby', mechanicId: 'aa078.lullaby',
  config: { connectionMoveId: 'Sing', action: 'free', frequency: 'scene', automaticHitTargets: 1 },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({ timings: ['declared'], userRelation: 'owner', targetRelation: 'attacked' }),
  tags: ['accuracy', 'action', 'choice', 'connection', 'reaction', 'scene', 'triggered'],
})

export const LUNCHBOX_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Lunchbox', mechanicId: 'aa078.lunchbox',
  config: {
    action: 'free', frequency: 'scene', trigger: 'trade-food-buff',
    temporaryHpTicks: 1, stacksWithTriggeringBuff: true,
  },
  eventKind: 'item', checkpoint: 'post-effect',
  predicate: {
    kind: 'ability-item-fact', changes: ['consumed'], outcomes: ['applied'],
    resourceKinds: [], itemIds: [], ownerRole: 'owner-before',
    sourceRelation: 'owner', minimumQuantityApplied: 1,
  },
  tags: ['action', 'food', 'item', 'reaction', 'scene', 'temporary-hp', 'triggered'],
})

export const MACH_SPEED_ABILITY_SPEC = staticSpec('Mach Speed', 'aa078.mach-speed', {
  lastChanceType: 'flying', hpThresholdNumerator: 1, hpThresholdDenominator: 3, damageBonus: 5,
}, ['damage', 'last-chance', 'static', 'type'])

export const MAELSTROM_PULSE_ABILITY_SPEC = activatedSpec('Maelstrom Pulse', 'aa078.maelstrom-pulse', {
  action: 'free', frequency: 'scene-x2', moveType: 'water', priority: true,
  damagingSpeedFractionNumerator: 1, damagingSpeedFractionDenominator: 2,
}, noAbilityTarget('activate'), ['action', 'damage', 'mode.activated', 'priority', 'scene', 'type'])

export const MAGIC_BOUNCE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Magic Bounce', mechanicId: 'aa078.magic-bounce',
  config: {
    action: 'free', frequency: 'scene', statusMovesOnly: true, hazardRange: 10,
    reflectToAttacker: true, hazardPlacementAndAffiliation: true, recursionPolicy: 'do-not-retrigger',
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({ timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit' }),
  tags: ['action', 'choice', 'defensive', 'hazard', 'reaction', 'reflection', 'scene', 'triggered'],
})

export const AA078_ABILITY_SPECS = Object.freeze([
  LIGHTNING_KICKS_ABILITY_SPEC, LIGHTNING_ROD_ABILITY_SPEC, LIMBER_ABILITY_SPEC,
  LINE_CHARGE_ABILITY_SPEC, LIQUID_OOZE_ABILITY_SPEC, LIQUID_VOICE_ABILITY_SPEC,
  LONG_REACH_ABILITY_SPEC, LULLABY_ABILITY_SPEC, LUNCHBOX_ABILITY_SPEC,
  MACH_SPEED_ABILITY_SPEC, MAELSTROM_PULSE_ABILITY_SPEC, MAGIC_BOUNCE_ABILITY_SPEC,
])

export const AA078_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA078_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa078.ts',
    spec,
  })),
)
