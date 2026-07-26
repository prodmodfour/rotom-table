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
  readonly targetRelation: 'any' | 'hit' | 'attacked'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: input.timings,
  moveTypes: input.moveTypes ?? [],
  damageClasses: input.damageClasses ?? [],
  keywordsAny: [] as const,
  keywordsAll: [] as const,
  userRelation: input.userRelation,
  targetRelation: input.targetRelation,
})

export const PERISH_BODY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Perish Body', mechanicId: 'aa083.perish-body',
  config: {
    action: 'standard', frequency: 'daily', trigger: 'melee-hit', initialCount: 3,
    decrementBoundary: 'target-turn-start', faintAt: 0,
    clearsOn: ['recall', 'take-a-breather', 'knockout'], massiveDamage: false,
    classification: 'defensive',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['accuracy-resolved'], damageClasses: ['physical', 'special', 'status'],
    userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'condition', 'daily', 'defensive', 'faint', 'lifecycle', 'mode.triggered'],
})

export const PERMAFROST_ABILITY_SPEC = staticSpec('Permafrost', 'aa083.permafrost', {
  immuneSources: ['hazard', 'weather', 'status-affliction', 'vortex', 'recoil', 'hay-fever', 'iron-barbs', 'rough-skin', 'leech-seed'],
  classification: 'defensive',
}, ['defensive', 'hazard', 'hp', 'immunity', 'static', 'weather'])

export const PHOTOSYNTHESIS_ABILITY_SPEC = activatedSpec('Photosynthesis', 'aa083.photosynthesis', {
  action: 'extended', frequency: 'daily', minimumMinutes: 10,
  healingPercent: 25, injuryRemoval: 1, requiresNormalSunlight: true,
}, noAbilityTarget('activate'), ['daily', 'extended-action', 'healing', 'injury', 'mode.activated'])

export const PICKPOCKET_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Pickpocket', mechanicId: 'aa083.pickpocket',
  config: {
    action: 'free', frequency: 'scene', trigger: 'opponent-melee-hit',
    requiresUserEmptyHeldSlot: true, requiresAttackerHeldItem: true, transferQuantity: 1,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['accuracy-resolved'], damageClasses: ['physical', 'special', 'status'],
    userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'item', 'mode.triggered', 'scene', 'theft'],
})

export const PICKUP_ABILITY_SPEC = activatedSpec('Pickup', 'aa083.pickup', {
  action: 'extended', frequency: 'daily', minimumMinutes: 5, dieSides: 20,
  bands: ['none:1-5', 'x-item:6-7', 'berry:8-10', 'poke-ball:11-13', 'healing:14-16', 'evolution-stone:17', 'vitamin:18', 'held-item:19', 'tm:20'],
  exactItemPolicy: 'server-random-canonical-category', destination: 'ground-at-user',
}, noAbilityTarget('activate'), ['daily', 'extended-action', 'item', 'mode.activated', 'random'])

export const PIXILATE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Pixilate', mechanicId: 'aa083.pixilate',
  config: { action: 'free', frequency: 'at-will', sourceType: 'normal', targetType: 'fairy', requiresDamaging: true },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({
    timings: ['declared'], moveTypes: ['normal'], damageClasses: ['physical', 'special'],
    userRelation: 'owner', targetRelation: 'any',
  }),
  tags: ['action', 'mode.triggered', 'move-type', 'type'],
})

export const PLUS_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Plus', mechanicId: 'aa083.plus',
  config: {
    action: 'free', frequency: 'scene-x2', trigger: 'ally-stage-raised',
    range: 10, additionalStages: 1, chooseRaisedStat: true,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['effects-resolved'], userRelation: 'other', targetRelation: 'any',
  }),
  tags: ['action', 'ally', 'choice', 'mode.triggered', 'scene', 'stage'],
})

export const POISON_HEAL_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Poison Heal', mechanicId: 'aa083.poison-heal',
  config: {
    action: 'free', frequency: 'daily', trigger: 'becomes-poisoned', duration: 'encounter',
    conditions: ['poisoned', 'badly-poisoned'], turnStartHealingTicks: 1,
    preventsPoisonHpLoss: true, preventsPoisonStageLoss: true, cureAtEncounterEnd: true,
  },
  eventKind: 'condition', checkpoint: 'post-effect',
  predicate: {
    kind: 'ability-condition-fact' as const, operations: ['apply'] as const,
    outcomes: ['applied'] as const, conditionIds: ['badly-poisoned', 'poisoned'] as const,
    ownerRole: 'subject' as const, sourceRelation: 'any' as const,
    resultingState: 'present' as const, save: 'any' as const,
  },
  tags: ['action', 'condition', 'daily', 'healing', 'lifecycle', 'mode.triggered'],
})

export const POISON_POINT_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Poison Point', mechanicId: 'aa083.poison-point',
  config: { action: 'free', frequency: 'scene', trigger: 'melee-hit', conditionId: 'poisoned' },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['accuracy-resolved'], damageClasses: ['physical', 'special', 'status'],
    userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'condition', 'melee', 'mode.triggered', 'scene'],
})

export const POISON_TOUCH_ABILITY_SPEC = staticSpec('Poison Touch', 'aa083.poison-touch', {
  requiresDamaging: true, conditionId: 'poisoned', defaultMinimumRoll: 19,
  existingRangeExpansion: 2, legalTargetsOnly: true,
}, ['condition', 'damage', 'static', 'threshold'])

export const POLTERGEIST_ABILITY_SPEC = staticSpec('Poltergeist', 'aa083.poltergeist', {
  species: 'rotom', moveLevelThreshold: 40,
  forms: [
    'standard:Levitate:none', 'heat:Flash Fire:Overheat', 'wash:Water Absorb:Hydro Pump',
    'frost:Winter’s Kiss:Blizzard', 'fan:Windveiled:Hurricane', 'mow:Sap Sipper:Leaf Storm',
  ],
}, ['ability-grant', 'form', 'move-list', 'static'])

const polycephalyConfig = {
  moveId: 'Struggle', optionalAction: 'swift', normalAction: 'standard',
  resistanceSteps: 1,
} as const
export const POLYCEPHALY_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Polycephaly',
  modes: [{ id: 'passive', kind: 'static' }, { id: 'trigger', kind: 'triggered' }],
  subscriptions: [{
    id: 'trigger.subscription', modeId: 'trigger', eventKind: 'move', checkpoint: 'declaration',
    response: 'optional', priority: 0, oncePerCausalChain: true,
    predicate: movePredicate({ timings: ['declared'], userRelation: 'owner', targetRelation: 'any' }),
  }],
  targeting: [...noAbilityTarget('passive'), ...noAbilityTarget('trigger')],
  phases: [
    { modeId: 'passive', phase: 'effect', operations: [mechanic('passive.mechanic', 'aa083.polycephaly', polycephalyConfig)] },
    { modeId: 'trigger', phase: 'effect', operations: [mechanic('trigger.mechanic', 'aa083.polycephaly', polycephalyConfig)] },
  ],
  tags: ['action', 'choice', 'damage', 'mode.static', 'mode.triggered', 'resistance', 'struggle'],
})

export const AA083_ABILITY_SPECS = Object.freeze([
  PERISH_BODY_ABILITY_SPEC, PERMAFROST_ABILITY_SPEC, PHOTOSYNTHESIS_ABILITY_SPEC,
  PICKPOCKET_ABILITY_SPEC, PICKUP_ABILITY_SPEC, PIXILATE_ABILITY_SPEC,
  PLUS_ABILITY_SPEC, POISON_HEAL_ABILITY_SPEC, POISON_POINT_ABILITY_SPEC,
  POISON_TOUCH_ABILITY_SPEC, POLTERGEIST_ABILITY_SPEC, POLYCEPHALY_ABILITY_SPEC,
])

export const AA083_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA083_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId, version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa083.ts', spec,
  })),
)
