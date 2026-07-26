import { POKEMON_TYPE_IDS } from '#shared/pokemonTypes'
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

const mudShieldConfig = {
  action: 'swift', frequency: 'scene', temporaryHpTicks: 2,
  terrainTags: ['dirty', 'muddy', 'rough', 'slow'], damageReduction: 5,
  classification: 'defensive',
} as const
const naturalCureConfig = {
  action: 'free', frequency: 'scene', triggers: ['recall', 'take-a-breather'],
  curedConditionGroup: 'persistent-status',
} as const

export const MUD_DWELLER_ABILITY_SPEC = staticSpec('Mud Dweller', 'aa081.mud-dweller', {
  moveTypes: ['ground', 'water'], resistanceSteps: 1,
}, ['defensive', 'resistance', 'static', 'type'])

export const MUD_SHIELD_ABILITY_SPEC = activatedSpec(
  'Mud Shield', 'aa081.mud-shield', mudShieldConfig,
  noAbilityTarget('activate'),
  ['action', 'damage-reduction', 'mode.activated', 'scene', 'temporary-hp', 'terrain'],
)

export const MULTISCALE_ABILITY_SPEC = staticSpec('Multiscale', 'aa081.multiscale', {
  hpRequirement: 'full', resistanceSteps: 1, classification: 'defensive',
}, ['defensive', 'hp-threshold', 'resistance', 'static'])

export const MULTITYPE_ABILITY_SPEC = activatedSpec('Multitype', 'aa081.multitype', {
  action: 'free', frequency: 'at-will', typeOptions: [...POKEMON_TYPE_IDS],
  copyable: false, disableable: false,
}, [{
  id: 'activate.type', modeId: 'activate', kind: 'type', minSelections: 1, maxSelections: 1,
  selector: null, predicate: null,
}], ['action', 'form', 'mode.activated', 'protected', 'type'])

export const MUMMY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Mummy', mechanicId: 'aa081.mummy',
  config: {
    action: 'free', frequency: 'at-will', trigger: 'melee-hit',
    duration: 'scene', endsOnSwitch: true,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['effects-resolved'], damageClasses: ['physical', 'special', 'status'],
    userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['ability-suppression', 'action', 'choice', 'mode.triggered', 'reaction'],
})

export const NATURAL_CURE_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Natural Cure',
  modes: [{ id: 'trigger', kind: 'triggered' }],
  subscriptions: [
    {
      id: 'recall.subscription', modeId: 'trigger', eventKind: 'presence', checkpoint: 'post-effect',
      response: 'optional', priority: 0, oncePerCausalChain: true,
      predicate: { kind: 'ability-presence-fact', operations: ['recall'], ownerRole: 'outgoing', sideId: null },
    },
    {
      id: 'breather.subscription', modeId: 'trigger', eventKind: 'action', checkpoint: 'post-effect',
      response: 'optional', priority: 0, oncePerCausalChain: true,
      predicate: null,
    },
  ],
  targeting: noAbilityTarget('trigger'),
  phases: [{
    modeId: 'trigger', phase: 'effect',
    operations: [mechanic('trigger.mechanic', 'aa081.natural-cure', naturalCureConfig)],
  }],
  tags: ['action', 'condition', 'cure', 'mode.triggered', 'scene'],
})

export const NEEDLES_ABILITY_SPEC = staticSpec('Needles', 'aa081.needles', {
  connectionMoveId: 'Needle Arm', trigger: 'physical-melee-hit', hitPointLossTicks: 1,
}, ['connection', 'hp', 'melee', 'reactive', 'static'])

export const NEUROFORCE_ABILITY_SPEC = staticSpec('Neuroforce', 'aa081.neuroforce', {
  triggerEffectiveness: 'super-effective', damageBonus: 10, modifierOrder: 'pre-type',
}, ['damage', 'effectiveness', 'offensive', 'static'])

export const NEUTRALIZING_GAS_ABILITY_SPEC = staticSpec('Neutralizing Gas', 'aa081.neutralizing-gas', {
  radius: 1, blockedModes: ['triggered'], blockedClassification: 'defensive',
  extendedMoveIds: ['Clear Smog', 'Poison Gas', 'Smog', 'Strange Steam'],
  extendedDurationRounds: 1, excludeSelf: true,
}, ['ability-suppression', 'area', 'defensive-suppression', 'static', 'trigger-suppression'])

export const NIMBLE_STRIKES_ABILITY_SPEC = staticSpec('Nimble Strikes', 'aa081.nimble-strikes', {
  damageClass: 'physical', moveType: 'normal', stat: 'speed',
  fractionNumerator: 1, fractionDenominator: 2,
}, ['damage', 'offensive', 'stat', 'static', 'type'])

export const NO_GUARD_ABILITY_SPEC = staticSpec('No Guard', 'aa081.no-guard', {
  outgoingAccuracyBonus: 3, incomingAccuracyBonus: 3,
}, ['accuracy', 'evasion', 'static'])

export const NORMALIZE_ABILITY_SPEC = staticSpec('Normalize', 'aa081.normalize', {
  outgoingRelations: ['resisted', 'super-effective'],
  incomingRelations: ['resisted', 'super-effective'], preserveImmunity: true,
}, ['defensive', 'effectiveness', 'offensive', 'static', 'type'])

export const AA081_ABILITY_SPECS = Object.freeze([
  MUD_DWELLER_ABILITY_SPEC,
  MUD_SHIELD_ABILITY_SPEC,
  MULTISCALE_ABILITY_SPEC,
  MULTITYPE_ABILITY_SPEC,
  MUMMY_ABILITY_SPEC,
  NATURAL_CURE_ABILITY_SPEC,
  NEEDLES_ABILITY_SPEC,
  NEUROFORCE_ABILITY_SPEC,
  NEUTRALIZING_GAS_ABILITY_SPEC,
  NIMBLE_STRIKES_ABILITY_SPEC,
  NO_GUARD_ABILITY_SPEC,
  NORMALIZE_ABILITY_SPEC,
])

export const AA081_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA081_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa081.ts',
    spec,
  })),
)
