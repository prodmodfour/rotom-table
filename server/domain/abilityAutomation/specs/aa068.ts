import type { AbilitySpecV1Registration } from '../registry'
import {
  noAbilityTarget as noneTarget,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const moveTrigger = (input: {
  readonly timings: readonly ('declared' | 'accuracy-resolved')[]
  readonly userRelation: 'owner' | 'other'
  readonly targetRelation: 'hit' | 'any'
  readonly moveTypes?: readonly string[]
  readonly damageClasses?: readonly ('physical' | 'special' | 'status')[]
  readonly keywordsAny?: readonly string[]
}) => ({
  kind: 'ability-move-fact' as const,
  timings: [...input.timings],
  moveTypes: [...(input.moveTypes ?? [])],
  damageClasses: [...(input.damageClasses ?? [])],
  keywordsAny: [...(input.keywordsAny ?? [])],
  keywordsAll: [],
  userRelation: input.userRelation,
  targetRelation: input.targetRelation,
})

export const DRAGONS_MAW_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Dragon’s Maw', mechanicId: 'aa068.dragons-maw',
  config: {
    action: 'free', frequency: 'scene-x2', trigger: 'damaging-dragon-hit',
    moveType: 'dragon', target: 'one-hit-target', vulnerabilitySteps: 1,
    immuneBaselineResistanceSteps: 2,
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: moveTrigger({
    timings: ['accuracy-resolved'], userRelation: 'owner', targetRelation: 'hit',
    moveTypes: ['dragon'], damageClasses: ['physical', 'special'],
  }),
  tags: ['action', 'choice', 'damage', 'move-overlay', 'reaction', 'scene', 'triggered', 'type'],
})

export const DREAM_SMOKE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Dream Smoke', mechanicId: 'aa068.dream-smoke',
  config: {
    action: 'free', frequency: 'scene', trigger: 'hit-by-melee-attack',
    requiredRange: 'melee', condition: 'asleep',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({
    timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'condition', 'reaction', 'scene', 'triggered'],
})

export const DREAMSPINNER_ABILITY_SPEC = activatedSpec('Dreamspinner', 'aa068.dreamspinner', {
  action: 'swift', frequency: 'scene-x3', radius: 3, relationship: 'enemy',
  requiredCondition: 'asleep', foeHpLoss: 'tick', temporaryHpGain: 'tick',
}, noneTarget('activate'), ['action', 'condition', 'hp-loss', 'mode.activated', 'scene', 'target', 'temporary-hp'])

export const DRIZZLE_ABILITY_SPEC = activatedSpec('Drizzle', 'aa068.drizzle', {
  action: 'swift', frequency: 'scene-x3', weather: 'rainy', durationRounds: 1,
}, noneTarget('activate'), ['action', 'field', 'lifecycle', 'mode.activated', 'scene', 'weather'])

export const DROUGHT_ABILITY_SPEC = activatedSpec('Drought', 'aa068.drought', {
  action: 'swift', frequency: 'scene-x3', weather: 'sunny', durationRounds: 1,
}, noneTarget('activate'), ['action', 'field', 'lifecycle', 'mode.activated', 'scene', 'weather'])

export const DROWN_OUT_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Drown Out', mechanicId: 'aa068.drown-out',
  config: {
    action: 'free', frequency: 'scene-x2', trigger: 'foe-uses-sonic-move',
    keyword: 'sonic', cancelMove: true, retainTriggeringUsage: true,
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: moveTrigger({
    timings: ['declared'], userRelation: 'other', targetRelation: 'any',
    keywordsAny: ['sonic'],
  }),
  tags: ['action', 'interrupt', 'reaction', 'scene', 'sonic', 'triggered'],
})

export const DRY_SKIN_ABILITY_SPEC = staticSpec('Dry Skin', 'aa068.dry-skin', {
  fireHitHpLoss: 'tick', sunnyTurnEndHpLoss: 'tick', waterMoveImmunity: true,
  waterHitHealing: 'tick', rainyTurnEndHealing: 'tick',
}, ['damage', 'healing', 'hp-loss', 'immunity', 'lifecycle', 'move-overlay', 'static', 'weather'])

export const DUST_CLOUD_ABILITY_SPEC = staticSpec('Dust Cloud', 'aa068.dust-cloud', {
  connectionMoveId: 'Poison Powder', keyword: 'powder', alternateRange: 'burst-1',
}, ['choice', 'connection', 'geometry', 'move-overlay', 'static'])

export const EARLY_BIRD_ABILITY_SPEC = staticSpec('Early Bird', 'aa068.early-bird', {
  initiativeSpeedNumerator: 1, initiativeSpeedDenominator: 2, sleepSaveBonus: 3,
}, ['initiative', 'save-check', 'static'])

export const EFFECT_SPORE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Effect Spore', mechanicId: 'aa068.effect-spore',
  config: {
    action: 'free', frequency: 'scene', trigger: 'hit-by-melee-attack',
    requiredRange: 'melee', rollSides: 6,
    conditions: ['poisoned', 'poisoned', 'paralyzed', 'paralyzed', 'asleep', 'asleep'],
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({
    timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'condition', 'random', 'reaction', 'scene', 'triggered'],
})

export const EGGSCELLENCE_ABILITY_SPEC = staticSpec('Eggscellence', 'aa068.eggscellence', {
  connectionMoveId: 'Barrage', affectedMoveIds: ['Barrage', 'Egg Bomb'],
  grantStab: true, requiredUserType: 'normal', accuracyThreshold: 16,
  effectivenessSteps: 1,
}, ['connection', 'damage', 'move-overlay', 'random', 'static', 'type'])

export const ELECTRIC_SURGE_ABILITY_SPEC = activatedSpec('Electric Surge', 'aa068.electric-surge', {
  action: 'swift', frequency: 'scene-x3', terrain: 'electric', durationRounds: 1,
}, noneTarget('activate'), ['action', 'field', 'lifecycle', 'mode.activated', 'scene', 'terrain'])

export const AA068_ABILITY_SPECS = Object.freeze([
  DRAGONS_MAW_ABILITY_SPEC, DREAM_SMOKE_ABILITY_SPEC, DREAMSPINNER_ABILITY_SPEC,
  DRIZZLE_ABILITY_SPEC, DROUGHT_ABILITY_SPEC, DROWN_OUT_ABILITY_SPEC,
  DRY_SKIN_ABILITY_SPEC, DUST_CLOUD_ABILITY_SPEC, EARLY_BIRD_ABILITY_SPEC,
  EFFECT_SPORE_ABILITY_SPEC, EGGSCELLENCE_ABILITY_SPEC, ELECTRIC_SURGE_ABILITY_SPEC,
])

export const AA068_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA068_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa068.ts',
    spec,
  })),
)
