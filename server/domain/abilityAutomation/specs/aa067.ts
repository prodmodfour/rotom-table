import type { AbilitySpecV1Registration } from '../registry'
import {
  noAbilityTarget as noneTarget,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const moveTrigger = (input: {
  timings: readonly ('declared' | 'use-started' | 'accuracy-resolved' | 'effects-resolved' | 'completed' | 'cancelled')[]
  userRelation: 'owner' | 'other' | 'any'
  targetRelation: 'hit' | 'attacked' | 'missed' | 'critical' | 'declared' | 'not-targeted' | 'any'
  damageClasses?: readonly ('physical' | 'special' | 'status')[]
}) => ({
  kind: 'ability-move-fact' as const,
  timings: [...input.timings], moveTypes: [], damageClasses: [...(input.damageClasses ?? [])],
  keywordsAny: [], keywordsAll: [], userRelation: input.userRelation,
  targetRelation: input.targetRelation,
})

const combatStatPredicate = {
  kind: 'ability-stat-options' as const,
  statIds: ['attack', 'defense', 'special-attack', 'special-defense', 'speed'] as const,
}

const anyTokenTarget = [{
  id: 'activate.target', modeId: 'activate', kind: 'token' as const,
  minSelections: 1, maxSelections: 1, selector: null,
  predicate: {
    kind: 'ability-targeting' as const, relationship: 'any' as const,
    willingness: 'any' as const, excludeActor: false,
    minimumRange: 0, maximumRange: null,
    visibility: 'required' as const, lineOfSight: 'required' as const,
    geometry: { kind: 'direct' as const },
  },
}]

export const DEFY_DEATH_ABILITY_SPEC = activatedSpec('Defy Death', 'aa067.defy-death', {
  action: 'swift', maximumInjuriesPerUse: 3, dailyInjuryLimit: 3,
  healingPerInjury: 'tick', ignoreNormalDailyInjuryLimit: true,
}, [{
  id: 'activate.injury-count', modeId: 'activate', kind: 'branch',
  minSelections: 1, maxSelections: 1, selector: null, predicate: null,
}], ['action', 'healing', 'injury', 'mode.activated', 'usage'])

export const DELAYED_REACTION_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Delayed Reaction', mechanicId: 'aa067.delayed-reaction',
  config: {
    action: 'free', frequency: 'scene', trigger: 'hit-by-direct-damaging-attack',
    immediateDamageFraction: 0.5, deferredDamageTiming: 'end-of-next-turn',
    deferredDamageKind: 'hp-loss',
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: moveTrigger({
    timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit',
    damageClasses: ['physical', 'special'],
  }),
  tags: ['action', 'damage', 'hp-loss', 'lifecycle', 'reaction', 'scene', 'triggered'],
})

export const DELIVERY_BIRD_ABILITY_SPEC = staticSpec('Delivery Bird', 'aa067.delivery-bird', {
  heldItemCapacity: 2, chooseAffectedItem: true,
}, ['choice', 'item', 'static'])

export const DESERT_WEATHER_ABILITY_SPEC = staticSpec('Desert Weather', 'aa067.desert-weather', {
  sandstormImmunity: true, sunnyFireResistanceSteps: 1,
  rainyTurnEndTemporaryHealing: 'tick',
}, ['damage', 'healing', 'lifecycle', 'static', 'weather'])

export const DESIGNER_ABILITY_SPEC = activatedSpec('Designer', 'aa067.designer', {
  action: 'extended', selectedTypeCount: 2, resistanceSteps: 1,
  maximumSuits: 1, replacementPolicy: 'destroy-old',
}, [{
  id: 'activate.types', modeId: 'activate', kind: 'type',
  minSelections: 2, maxSelections: 2, selector: null, predicate: null,
}], ['action', 'choice', 'lifecycle', 'mode.activated', 'resistance', 'state', 'type'])

export const DIAMOND_DEFENSE_ABILITY_SPEC = staticSpec('Diamond Defense', 'aa067.diamond-defense', {
  connectionMoveId: 'Stealth Rock', moveFrequency: 'scene-x2',
  damageTypeOptions: ['rock', 'fairy'], selectionPolicy: 'most-effective',
}, ['connection', 'damage', 'hazard', 'move-overlay', 'static', 'usage'])

export const DIG_AWAY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Dig Away', mechanicId: 'aa067.dig-away',
  config: {
    action: 'free', frequency: 'daily', connectionMoveId: 'Dig', trigger: 'hit-by-move',
    avoidAttack: true, consumeMoveFrequency: true, requireDiggableTerrain: true,
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: moveTrigger({ timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit' }),
  tags: ['action', 'connection', 'daily', 'interrupt', 'movement', 'nested', 'triggered'],
})

export const DIRE_SPORE_ABILITY_SPEC = staticSpec('Dire Spore', 'aa067.dire-spore', {
  connectionMoveId: 'Spore', trigger: 'spore-hit', condition: 'poisoned',
}, ['condition', 'connection', 'move-overlay', 'static'])

export const DISCIPLINE_ABILITY_SPEC = activatedSpec('Discipline', 'aa067.discipline', {
  action: 'free', frequency: 'scene', trigger: 'gains-initiative',
  curedConditions: ['confused', 'enraged', 'infatuated', 'flinched'],
}, noneTarget('activate'), ['action', 'condition', 'initiative', 'mode.activated', 'scene'])

export const DISGUISE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Disguise', mechanicId: 'aa067.disguise',
  config: {
    action: 'free', frequency: 'daily', trigger: 'hit-by-damaging-move',
    avoidAttack: true, stageDelta: 1, selectedStat: true,
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: moveTrigger({
    timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit',
    damageClasses: ['physical', 'special'],
  }),
  tags: ['action', 'combat-stage', 'daily', 'interrupt', 'triggered'],
})

export const DODGE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Dodge', mechanicId: 'aa067.dodge',
  config: { action: 'free', frequency: 'daily', trigger: 'hit-by-damaging-move', avoidAttack: true },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: moveTrigger({
    timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit',
    damageClasses: ['physical', 'special'],
  }),
  tags: ['action', 'daily', 'interrupt', 'triggered'],
})

export const DOWNLOAD_ABILITY_SPEC = activatedSpec('Download', 'aa067.download', {
  action: 'swift', frequency: 'scene', target: 'trainer-or-pokemon',
  lowerDefenseStage: 'attack', lowerSpecialDefenseStage: 'special-attack',
  tieStage: 'chosen-non-hp-stat',
}, [
  ...anyTokenTarget,
  {
    id: 'activate.tie-stat', modeId: 'activate', kind: 'stat' as const,
    minSelections: 0, maxSelections: 1, selector: null, predicate: combatStatPredicate,
  },
], ['action', 'choice', 'combat-stage', 'mode.activated', 'scene', 'target'])

export const AA067_ABILITY_SPECS = Object.freeze([
  DEFY_DEATH_ABILITY_SPEC, DELAYED_REACTION_ABILITY_SPEC, DELIVERY_BIRD_ABILITY_SPEC,
  DESERT_WEATHER_ABILITY_SPEC, DESIGNER_ABILITY_SPEC, DIAMOND_DEFENSE_ABILITY_SPEC,
  DIG_AWAY_ABILITY_SPEC, DIRE_SPORE_ABILITY_SPEC, DISCIPLINE_ABILITY_SPEC,
  DISGUISE_ABILITY_SPEC, DODGE_ABILITY_SPEC, DOWNLOAD_ABILITY_SPEC,
])

export const AA067_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA067_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa067.ts',
    spec,
  })),
)
