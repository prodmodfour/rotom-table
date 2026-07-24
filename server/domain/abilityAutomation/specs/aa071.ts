import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const directTargetPredicate = (input: {
  readonly relationship: 'other' | 'enemy'
  readonly maximumRange?: number | null
}) => ({
  kind: 'ability-targeting' as const,
  relationship: input.relationship,
  willingness: 'any' as const,
  excludeActor: true,
  minimumRange: 0,
  maximumRange: input.maximumRange ?? null,
  visibility: 'required' as const,
  lineOfSight: 'ignored' as const,
  geometry: { kind: 'direct' as const },
})

const damagingHitPredicate = {
  kind: 'ability-move-fact' as const,
  timings: ['accuracy-resolved'] as const,
  moveTypes: [] as const,
  damageClasses: ['physical', 'special'] as const,
  keywordsAny: [] as const,
  keywordsAll: [] as const,
  userRelation: 'other' as const,
  targetRelation: 'hit' as const,
}

export const FOCUS_ABILITY_SPEC = staticSpec('Focus', 'aa071.focus', {
  lastChanceType: 'fighting', hpThresholdNumerator: 1, hpThresholdDenominator: 3,
  damageBonus: 5,
}, ['damage', 'hp-threshold', 'static', 'type'])

export const FORECAST_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Forecast',
  modes: [{ id: 'choose-weather', kind: 'configuration' }],
  targeting: [{
    id: 'choose-weather.type', modeId: 'choose-weather', kind: 'type',
    minSelections: 1, maxSelections: 1, selector: null, predicate: null,
  }],
  phases: [{
    modeId: 'choose-weather', phase: 'effect',
    operations: [mechanic('choose-weather.mechanic', 'aa071.forecast', {
      weatherKinds: ['sunny', 'hail', 'rainy', 'sandstorm'],
      weatherTypes: ['fire', 'ice', 'water', 'rock'], normalType: 'normal',
      multipleWeatherChoice: true,
    })],
  }],
  tags: ['choice', 'configuration', 'mode.static', 'type', 'weather'],
})

export const FOREST_LORD_ABILITY_SPEC = activatedSpec('Forest Lord', 'aa071.forest-lord', {
  action: 'shift', frequency: 'scene-x2', moveTypes: ['grass', 'ghost'],
  maximumTreeDistance: 10, accuracyBonus: 2, duration: 'turn',
}, [{
  id: 'activate.tree', modeId: 'activate', kind: 'cell', minSelections: 1,
  maxSelections: 1, selector: null, predicate: null,
}], ['accuracy', 'action', 'choice', 'geometry', 'mode.activated', 'scene'])

export const FOREWARN_ABILITY_SPEC = activatedSpec('Forewarn', 'aa071.forewarn', {
  action: 'free', frequency: 'scene', targetRelationship: 'enemy',
  revealHighestDamageDice: true, revealAllTies: true, accuracyPenalty: -2,
  duration: 'encounter',
}, [{
  id: 'activate.target', modeId: 'activate', kind: 'token', minSelections: 1,
  maxSelections: 1, selector: { kind: 'candidate-targets' },
  predicate: directTargetPredicate({ relationship: 'enemy' }),
}], ['accuracy', 'action', 'choice', 'information', 'mode.activated', 'scene'])

export const FOX_FIRE_ABILITY_SPEC = activatedSpec('Fox Fire', 'aa071.fox-fire', {
  action: 'standard', frequency: 'scene', connectionMoveId: 'Ember', wispCount: 3,
  trigger: 'targeted', triggerRelationship: 'enemy', triggerRadius: 6,
  responseAction: 'free', responseTiming: 'after-triggering-move',
}, noAbilityTarget('activate'), ['action', 'connection', 'mode.activated', 'nested-move', 'reaction', 'scene'])

export const FREEZING_POINT_ABILITY_SPEC = staticSpec('Freezing Point', 'aa071.freezing-point', {
  lastChanceType: 'ice', hpThresholdNumerator: 1, hpThresholdDenominator: 3,
  damageBonus: 5,
}, ['damage', 'hp-threshold', 'static', 'type'])

export const FRIEND_GUARD_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Friend Guard', mechanicId: 'aa071.friend-guard',
  config: {
    action: 'free', frequency: 'scene', trigger: 'adjacent-ally-damaged',
    adjacency: 1, resistanceSteps: 1,
  },
  eventKind: 'move', checkpoint: 'pre-effect', predicate: damagingHitPredicate,
  tags: ['action', 'ally', 'defensive', 'reaction', 'resistance', 'scene'],
})

export const FRIGHTEN_ABILITY_SPEC = activatedSpec('Frighten', 'aa071.frighten', {
  action: 'swift', frequency: 'scene', speedStageDelta: -2,
}, [{
  id: 'activate.target', modeId: 'activate', kind: 'token', minSelections: 1,
  maxSelections: 1, selector: { kind: 'candidate-targets' },
  predicate: directTargetPredicate({ relationship: 'other' }),
}], ['action', 'mode.activated', 'scene', 'stage', 'target'])

export const FRISK_ABILITY_SPEC = staticSpec('Frisk', 'aa071.frisk', {
  adjacency: 1, accuracyBonus: 2,
}, ['accuracy', 'geometry', 'static'])

export const FROSTBITE_ABILITY_SPEC = staticSpec('Frostbite', 'aa071.frostbite', {
  moveType: 'ice', damagingOnly: true, slowedMinimum: 18,
  freezeRangeIncrease: 1, defaultFreezeMinimum: 20,
}, ['condition', 'effect-range', 'move-overlay', 'static', 'type'])

export const FULL_GUARD_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Full Guard', mechanicId: 'aa071.full-guard',
  config: {
    action: 'swift', frequency: 'scene', trigger: 'damaged-with-temporary-hp',
    resistanceSteps: 1,
  },
  eventKind: 'move', checkpoint: 'pre-effect', predicate: damagingHitPredicate,
  tags: ['action', 'defensive', 'reaction', 'resistance', 'scene', 'temporary-hp'],
})

export const FULL_METAL_BODY_ABILITY_SPEC = staticSpec('Full Metal Body', 'aa071.full-metal-body', {
  preventCombatStageLoweringFrom: ['features', 'abilities', 'moves'],
  statusAfflictionStageChangesAllowed: true,
}, ['defensive', 'stage', 'static'])

export const AA071_ABILITY_SPECS = Object.freeze([
  FOCUS_ABILITY_SPEC, FORECAST_ABILITY_SPEC, FOREST_LORD_ABILITY_SPEC,
  FOREWARN_ABILITY_SPEC, FOX_FIRE_ABILITY_SPEC, FREEZING_POINT_ABILITY_SPEC,
  FRIEND_GUARD_ABILITY_SPEC, FRIGHTEN_ABILITY_SPEC, FRISK_ABILITY_SPEC,
  FROSTBITE_ABILITY_SPEC, FULL_GUARD_ABILITY_SPEC, FULL_METAL_BODY_ABILITY_SPEC,
])

export const AA071_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA071_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa071.ts',
    spec,
  })),
)
