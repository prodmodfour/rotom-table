import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const ownerMovePredicate = (input: {
  readonly timings: readonly ('declared' | 'accuracy-resolved' | 'effects-resolved')[]
  readonly moveTypes?: readonly string[]
  readonly targetRelation?: 'any' | 'hit' | 'attacked'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: input.timings,
  moveTypes: input.moveTypes ?? [],
  damageClasses: [] as const,
  keywordsAny: [] as const,
  keywordsAll: [] as const,
  userRelation: 'owner' as const,
  targetRelation: input.targetRelation ?? 'any' as const,
})

export const HEAVY_METAL_ABILITY_SPEC = staticSpec('Heavy Metal', 'aa074.heavy-metal', {
  weightClassBonus: 2, defenseBaseStatBonus: 2, speedBaseStatPenalty: -2,
}, ['static', 'stat', 'weight'])

export const HELIOVOLT_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Heliovolt', mechanicId: 'aa074.heliovolt',
  config: {
    action: 'swift', frequency: 'at-will', triggerType: 'electric',
    evasionBonus: 1, consideredWeather: 'sunny', durationRounds: 1,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: ownerMovePredicate({ timings: ['effects-resolved'], moveTypes: ['electric'] }),
  tags: ['action', 'evasion', 'triggered', 'type', 'weather'],
})

export const HELPER_ABILITY_SPEC = staticSpec('Helper', 'aa074.helper', {
  connectionMoveId: 'Helping Hand', targetRelationship: 'ally', targetCount: 1,
  accuracyBonus: 1, skillCheckBonus: 1, duration: 'until-user-next-turn-end',
}, ['ally', 'accuracy', 'connection', 'move-overlay', 'skill-check', 'static'])

export const HONEY_PAWS_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Honey Paws',
  modes: [{ id: 'prepare-leftovers', kind: 'configuration' }],
  targeting: [],
  phases: [{
    modeId: 'prepare-leftovers', phase: 'effect',
    operations: [mechanic('prepare-leftovers.mechanic', 'aa074.honey-paws', {
      consumedItemId: 'honey', equivalentBuffItemId: 'leftovers',
      ignoresNormalDigestionCapacity: true,
      explicitPreparationRequired: true,
      preparationDuration: 'scene-or-consumed',
    })],
  }],
  tags: ['capacity', 'choice', 'configuration', 'digestion', 'item', 'mode.static'],
})

export const HONEY_THIEF_ABILITY_SPEC = staticSpec('Honey Thief', 'aa074.honey-thief', {
  connectionMoveId: 'Bug Bite', trigger: 'digestion-buff-stolen', temporaryHpTicks: 1,
}, ['connection', 'digestion', 'item', 'move-overlay', 'static', 'temporary-hp'])

export const HORDE_BREAK_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Horde Break', mechanicId: 'aa074.horde-break',
  config: {
    action: 'free', frequency: 'at-will', fromForm: 'school-form',
    toForm: 'solo-form', cureConditionGroup: 'all-status',
  },
  eventKind: 'lifecycle', checkpoint: 'lifecycle',
  predicate: {
    kind: 'ability-lifecycle-fact', boundaries: ['form'], transitions: ['changed'],
    subjectRelation: 'owner', minimumOrdinal: null,
  },
  tags: ['action', 'condition', 'form', 'lifecycle', 'triggered'],
})

export const HUGE_POWER_ABILITY_SPEC = staticSpec('Huge Power', 'aa074.huge-power', {
  stat: 'attack', operation: 'double-base',
  includeNature: true, includeVitamins: true, includeTrainerFeatures: false,
}, ['static', 'stat'])

export const HUGE_POWER_PURE_POWER_ABILITY_SPEC = staticSpec(
  'Huge Power / Pure Power', 'aa074.huge-power-pure-power', {
    stat: 'attack', baseBonus: 5, bonusPerLevels: 10, cannotBeDisabled: true,
  }, ['protection', 'static', 'stat'],
)

export const HUNGER_SWITCH_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Hunger Switch',
  modes: [{ id: 'choose-mode', kind: 'configuration' }],
  targeting: [{
    id: 'choose-mode.mode', modeId: 'choose-mode', kind: 'branch',
    minSelections: 1, maxSelections: 1, selector: null, predicate: null,
  }],
  phases: [{
    modeId: 'choose-mode', phase: 'effect',
    operations: [mechanic('choose-mode.mechanic', 'aa074.hunger-switch', {
      timing: 'turn-start', fullBellyMode: 'full-belly', hangryMode: 'hangry',
      fullBellyAccuracyBonus: 2, hangryDamageBonus: 5,
      duration: 'until-next-turn-start', choiceRequired: true,
    })],
  }],
  tags: ['accuracy', 'choice', 'configuration', 'damage', 'form', 'mode.static'],
})

export const HUSTLE_ABILITY_SPEC = staticSpec('Hustle', 'aa074.hustle', {
  accuracyPenalty: -2, damageRollBonus: 10, appliesToAllMoves: true,
}, ['accuracy', 'damage', 'move-overlay', 'static'])

export const HYDRATION_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Hydration',
  modes: [{ id: 'activate', kind: 'activated' }],
  targeting: [{
    id: 'activate.condition', modeId: 'activate', kind: 'branch',
    minSelections: 1, maxSelections: 1, selector: null, predicate: null,
  }],
  phases: [{
    modeId: 'activate', phase: 'effect', operations: [mechanic(
      'activate.mechanic', 'aa074.hydration', {
        action: 'swift', frequency: 'scene', cureCount: 1,
        rainyWeatherIgnoresFrequency: true,
      },
    )],
  }],
  tags: ['action', 'choice', 'condition', 'mode.activated', 'scene', 'weather'],
})

export const HYPER_CUTTER_ABILITY_SPEC = staticSpec('Hyper Cutter', 'aa074.hyper-cutter', {
  protectedStat: 'attack', preventStatLowering: true, preventCombatStageLowering: true,
}, ['combat-stage', 'defensive', 'protection', 'stat', 'static'])

export const AA074_ABILITY_SPECS = Object.freeze([
  HEAVY_METAL_ABILITY_SPEC, HELIOVOLT_ABILITY_SPEC, HELPER_ABILITY_SPEC,
  HONEY_PAWS_ABILITY_SPEC, HONEY_THIEF_ABILITY_SPEC, HORDE_BREAK_ABILITY_SPEC,
  HUGE_POWER_ABILITY_SPEC, HUGE_POWER_PURE_POWER_ABILITY_SPEC,
  HUNGER_SWITCH_ABILITY_SPEC, HUSTLE_ABILITY_SPEC, HYDRATION_ABILITY_SPEC,
  HYPER_CUTTER_ABILITY_SPEC,
])

export const AA074_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA074_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa074.ts',
    spec,
  })),
)
