import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const movePredicate = (input: {
  readonly timings: readonly ('declared' | 'accuracy-resolved' | 'effects-resolved')[]
  readonly damageClasses?: readonly ('physical' | 'special' | 'status')[]
  readonly userRelation: 'owner' | 'other'
  readonly targetRelation: 'any' | 'hit' | 'attacked'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: input.timings,
  moveTypes: [] as const,
  damageClasses: input.damageClasses ?? [],
  keywordsAny: [] as const,
  keywordsAll: [] as const,
  userRelation: input.userRelation,
  targetRelation: input.targetRelation,
})

export const OBLIVIOUS_ABILITY_SPEC = staticSpec('Oblivious', 'aa082.oblivious', {
  conditionImmunities: ['enraged', 'infatuated'], classification: 'defensive',
}, ['condition', 'defensive', 'immunity', 'static'])

export const ODIOUS_SPRAY_ABILITY_SPEC = staticSpec('Odious Spray', 'aa082.odious-spray', {
  connectionMoveId: 'Poison Gas', range: '8, 1 Target', accuracyClass: 2,
  hitConditionId: 'flinched',
}, ['accuracy', 'condition', 'connection', 'move-mutation', 'range', 'static'])

export const OMEN_ABILITY_SPEC = activatedSpec('Omen', 'aa082.omen', {
  action: 'swift', frequency: 'scene', range: 5, stage: 'accuracy', stageDelta: -2,
}, [{
  id: 'activate.target', modeId: 'activate', kind: 'token', minSelections: 1, maxSelections: 1,
  selector: { kind: 'union', selectors: [{ kind: 'actor' }, { kind: 'candidate-targets' }] },
  predicate: {
    kind: 'ability-targeting', relationship: 'any', willingness: 'any', excludeActor: false,
    minimumRange: 0, maximumRange: 5, visibility: 'required', lineOfSight: 'ignored',
    geometry: { kind: 'direct' },
  },
}], ['action', 'accuracy', 'mode.activated', 'scene', 'stage', 'target'])

export const OVERCHARGE_ABILITY_SPEC = staticSpec('Overcharge', 'aa082.overcharge', {
  lastChanceType: 'electric', hpThresholdNumerator: 1, hpThresholdDenominator: 3,
  damageBonus: 5,
}, ['damage', 'hp-threshold', 'last-chance', 'static', 'type'])

export const OVERCOAT_ABILITY_SPEC = staticSpec('Overcoat', 'aa082.overcoat', {
  powderImmunity: true, weatherDamageImmunity: true, classification: 'defensive',
}, ['defensive', 'immunity', 'powder', 'static', 'weather'])

export const OVERGROW_ABILITY_SPEC = staticSpec('Overgrow', 'aa082.overgrow', {
  lastChanceType: 'grass', hpThresholdNumerator: 1, hpThresholdDenominator: 3,
  damageBonus: 5,
}, ['damage', 'hp-threshold', 'last-chance', 'static', 'type'])

export const OWN_TEMPO_ABILITY_SPEC = staticSpec('Own Tempo', 'aa082.own-tempo', {
  conditionImmunities: ['confused'], classification: 'defensive',
}, ['condition', 'defensive', 'immunity', 'static'])

export const PACK_HUNT_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Pack Hunt', mechanicId: 'aa082.pack-hunt',
  config: {
    action: 'free', frequency: 'at-will', trigger: 'adjacent-foe-damaged-by-ally-melee',
    range: 1, accuracyClass: 5, hitPointLossTicks: 1,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['effects-resolved'], damageClasses: ['physical', 'special'],
    userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'adjacency', 'ally', 'attack', 'hp', 'mode.triggered'],
})

export const PARENTAL_BOND_ABILITY_SPEC = staticSpec('Parental Bond', 'aa082.parental-bond', {
  babyDamageReduction: 10, tetherRange: 10, motherDamageReduction: 5,
  motherDamageBonus: 5, motherConditionId: 'enraged', duration: 'scene',
  classification: 'defensive',
}, ['damage', 'defensive', 'faint', 'form', 'lifecycle', 'static', 'tether'])

export const PARRY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Parry', mechanicId: 'aa082.parry',
  config: {
    action: 'free', frequency: 'scene', trigger: 'melee-hit', outcome: 'miss',
    classification: 'defensive',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['accuracy-resolved'], damageClasses: ['physical', 'special', 'status'],
    userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'defensive', 'melee', 'miss', 'mode.triggered', 'scene'],
})

export const PASTEL_VEIL_ABILITY_SPEC = staticSpec('Pastel Veil', 'aa082.pastel-veil', {
  radius: 3, conditionImmunities: ['poisoned', 'badly-poisoned'],
  relationships: ['self', 'ally'], classification: 'defensive',
}, ['ally', 'area', 'condition', 'defensive', 'immunity', 'static'])

const perceptionConfig = {
  evasionBonus: 1, trigger: 'ally-damaging-area-would-hit', action: 'free',
  disengageDistance: 1,
} as const
export const PERCEPTION_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Perception',
  modes: [{ id: 'passive', kind: 'static' }, { id: 'trigger', kind: 'triggered' }],
  subscriptions: [{
    id: 'trigger.subscription', modeId: 'trigger', eventKind: 'move', checkpoint: 'pre-effect',
    response: 'optional', priority: 0, oncePerCausalChain: true,
    predicate: movePredicate({
      timings: ['declared'], damageClasses: ['physical', 'special'],
      userRelation: 'other', targetRelation: 'attacked',
    }),
  }],
  targeting: [...noAbilityTarget('passive'), ...noAbilityTarget('trigger')],
  phases: [
    { modeId: 'passive', phase: 'effect', operations: [mechanic('passive.mechanic', 'aa082.perception', perceptionConfig)] },
    { modeId: 'trigger', phase: 'effect', operations: [mechanic('trigger.mechanic', 'aa082.perception', perceptionConfig)] },
  ],
  tags: ['action', 'ally', 'area', 'evasion', 'mode.static', 'mode.triggered', 'movement'],
})

export const AA082_ABILITY_SPECS = Object.freeze([
  OBLIVIOUS_ABILITY_SPEC, ODIOUS_SPRAY_ABILITY_SPEC, OMEN_ABILITY_SPEC,
  OVERCHARGE_ABILITY_SPEC, OVERCOAT_ABILITY_SPEC, OVERGROW_ABILITY_SPEC,
  OWN_TEMPO_ABILITY_SPEC, PACK_HUNT_ABILITY_SPEC, PARENTAL_BOND_ABILITY_SPEC,
  PARRY_ABILITY_SPEC, PASTEL_VEIL_ABILITY_SPEC, PERCEPTION_ABILITY_SPEC,
])

export const AA082_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA082_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId, version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa082.ts', spec,
  })),
)
