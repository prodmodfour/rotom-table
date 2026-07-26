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
  readonly moveTypes?: readonly string[]
  readonly damageClasses?: readonly ('physical' | 'special' | 'status')[]
  readonly userRelation: 'owner' | 'other'
  readonly targetRelation?: 'any' | 'hit' | 'attacked'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: input.timings,
  moveTypes: input.moveTypes ?? [],
  damageClasses: input.damageClasses ?? [],
  keywordsAny: [] as const,
  keywordsAll: [] as const,
  userRelation: input.userRelation,
  targetRelation: input.targetRelation ?? 'any',
})

export const POWER_CONSTRUCT_ABILITY_SPEC = activatedSpec('Power Construct', 'aa084.power-construct', {
  action: 'swift', frequency: 'daily', maximumHpPercent: 50,
  requiredSpecies: 'zygarde', targetForm: 'zygarde-complete-forme',
  temporaryHpNumerator: 1, temporaryHpDenominator: 2,
  preserveOriginalHpMaximum: true, blocksOtherTemporaryHp: true, duration: 'scene',
}, noAbilityTarget('activate'), ['action', 'daily', 'form', 'mode.activated', 'temporary-hp'])

export const POWER_SPOT_ABILITY_SPEC = staticSpec('Power Spot', 'aa084.power-spot', {
  range: 2, relationship: 'ally', damageBonus: 5, excludesSelf: true,
}, ['ally', 'aura', 'damage', 'mode.static'])

export const POWER_OF_ALCHEMY_ABILITY_SPEC = activatedSpec('Power of Alchemy', 'aa084.power-of-alchemy', {
  action: 'free', frequency: 'scene', range: 10, duration: 'encounter',
  clearOn: ['knockout'], copyPolicy: 'target-effective-copyable-ability',
}, [{
  id: 'activate.target', modeId: 'activate', kind: 'token', minSelections: 1, maxSelections: 1,
  selector: { kind: 'candidate-targets' },
  predicate: {
    kind: 'ability-targeting', relationship: 'other', willingness: 'any', excludeActor: true,
    minimumRange: 0, maximumRange: 10, visibility: 'required', lineOfSight: 'ignored',
    geometry: { kind: 'direct' },
  },
}, {
  id: 'activate.ability', modeId: 'activate', kind: 'ability', minSelections: 1, maxSelections: 1,
  selector: null, predicate: null,
}], ['ability-copy', 'action', 'choice', 'mode.activated', 'scene'])

export const PRANKSTER_ABILITY_SPEC = staticSpec('Prankster', 'aa084.prankster', {
  damageClass: 'status', priority: 'advanced', optional: true,
}, ['action', 'mode.static', 'priority', 'status-move'])

export const PRESSURE_ABILITY_SPEC = activatedSpec('Pressure', 'aa084.pressure', {
  action: 'swift', frequency: 'scene', radius: 3, relationship: 'foe',
  conditionId: 'suppressed', durationRounds: 1,
}, noAbilityTarget('activate'), ['action', 'area', 'condition', 'mode.activated', 'scene'])

export const PRIDE_ABILITY_SPEC = staticSpec('Pride', 'aa084.pride', {
  conditions: ['burned', 'poisoned', 'badly-poisoned', 'paralysis', 'frozen', 'sleep', 'bad-sleep'],
  stat: 'satk', stages: 2, dynamic: true,
}, ['condition', 'mode.static', 'stage'])

export const PRIME_FURY_ABILITY_SPEC = activatedSpec('Prime Fury', 'aa084.prime-fury', {
  action: 'swift', frequency: 'scene', conditionId: 'rage',
  stages: ['atk:1', 'satk:1'],
}, noAbilityTarget('activate'), ['action', 'condition', 'mode.activated', 'scene', 'stage'])

export const PRISM_ARMOR_ABILITY_SPEC = staticSpec('Prism Armor', 'aa084.prism-armor', {
  effectiveness: 'super-effective', damageReduction: 5, classification: 'defensive',
}, ['damage-reduction', 'defensive', 'mode.static', 'super-effective'])

const probabilityConfig = {
  action: 'free', frequency: 'scene', rollScope: 'self-or-ally',
  rerollPolicy: 'server-random-replace-result', residue: 'psychic',
} as const
export const PROBABILITY_CONTROL_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Probability Control',
  modes: [{ id: 'trigger', kind: 'triggered' }],
  subscriptions: [
    {
      id: 'trigger.owner-roll', modeId: 'trigger', eventKind: 'move', checkpoint: 'post-effect',
      response: 'optional', priority: 0, oncePerCausalChain: true,
      predicate: movePredicate({ timings: ['accuracy-resolved'], userRelation: 'owner' }),
    },
    {
      id: 'trigger.ally-roll', modeId: 'trigger', eventKind: 'move', checkpoint: 'post-effect',
      response: 'optional', priority: 1, oncePerCausalChain: true,
      predicate: movePredicate({ timings: ['accuracy-resolved'], userRelation: 'other' }),
    },
  ],
  targeting: noAbilityTarget('trigger'),
  phases: [{
    modeId: 'trigger', phase: 'effect',
    operations: [mechanic('trigger.mechanic', 'aa084.probability-control', probabilityConfig)],
  }],
  tags: ['action', 'ally', 'mode.triggered', 'random', 'reroll', 'scene'],
})

export const PROPELLER_TAIL_ABILITY_SPEC = activatedSpec('Propeller Tail', 'aa084.propeller-tail', {
  action: 'swift', frequency: 'scene', maneuverId: 'sprint', maneuverAction: 'free',
}, noAbilityTarget('activate'), ['action', 'maneuver', 'mode.activated', 'movement', 'scene'])

export const PROTEAN_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Protean', mechanicId: 'aa084.protean',
  config: {
    action: 'swift', frequency: 'at-will', trigger: 'uses-move',
    typePolicy: 'triggering-move-type', timing: 'before-move', duration: 'until-replaced',
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({ timings: ['declared'], userRelation: 'owner' }),
  tags: ['action', 'form', 'mode.triggered', 'move-type', 'type'],
})

export const PSIONIC_SCREECH_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Psionic Screech', mechanicId: 'aa084.psionic-screech',
  config: {
    action: 'free', frequency: 'scene-x2', triggerType: 'flying', targetType: 'psychic',
    hitConditionId: 'flinch',
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({ timings: ['declared'], moveTypes: ['flying'], userRelation: 'owner' }),
  tags: ['action', 'condition', 'mode.triggered', 'move-type', 'scene', 'type'],
})

export const AA084_ABILITY_SPECS = Object.freeze([
  POWER_CONSTRUCT_ABILITY_SPEC, POWER_SPOT_ABILITY_SPEC, POWER_OF_ALCHEMY_ABILITY_SPEC,
  PRANKSTER_ABILITY_SPEC, PRESSURE_ABILITY_SPEC, PRIDE_ABILITY_SPEC,
  PRIME_FURY_ABILITY_SPEC, PRISM_ARMOR_ABILITY_SPEC, PROBABILITY_CONTROL_ABILITY_SPEC,
  PROPELLER_TAIL_ABILITY_SPEC, PROTEAN_ABILITY_SPEC, PSIONIC_SCREECH_ABILITY_SPEC,
])

export const AA084_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA084_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId, version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa084.ts', spec,
  })),
)
