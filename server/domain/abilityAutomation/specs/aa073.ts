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

const directOtherAdjacent = {
  kind: 'ability-targeting' as const,
  relationship: 'other' as const,
  willingness: 'any' as const,
  excludeActor: true,
  minimumRange: 0,
  maximumRange: 1,
  visibility: 'required' as const,
  lineOfSight: 'ignored' as const,
  geometry: { kind: 'direct' as const },
}

export const GRASSY_SURGE_ABILITY_SPEC = activatedSpec('Grassy Surge', 'aa073.grassy-surge', {
  action: 'swift', frequency: 'scene', uses: 3, terrain: 'grassy', durationRounds: 1,
}, noAbilityTarget('activate'), ['action', 'field', 'mode.activated', 'scene', 'terrain'])

export const GRIM_NEIGH_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Grim Neigh', mechanicId: 'aa073.grim-neigh',
  config: {
    action: 'free', frequency: 'at-will', damagingOnly: true,
    faintedRelationship: 'enemy', specialAttackStages: 1,
    foeRadius: 3, accuracyPenalty: -2, durationRounds: 1,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['effects-resolved'], damageClasses: ['physical', 'special'],
    userRelation: 'owner', targetRelation: 'hit',
  }),
  tags: ['action', 'area', 'combat-stage', 'faint', 'triggered'],
})

export const GULP_ABILITY_SPEC = activatedSpec('Gulp', 'aa073.gulp', {
  action: 'extended', frequency: 'daily', submergedMinutes: 10,
  healingNumerator: 1, healingDenominator: 4, injuriesRemoved: 1,
}, noAbilityTarget('activate'), ['daily', 'healing', 'injury', 'mode.activated', 'terrain'])

export const GULP_MISSILE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Gulp Missile', mechanicId: 'aa073.gulp-missile',
  config: {
    action: 'free', frequency: 'scene', uses: 2,
    connectionMoveId: 'Stockpile', triggerMoveIds: ['Stockpile', 'Surf', 'Dive'],
    attackAc: 4, attackClass: 'physical', hpLossTicks: 2,
    evenCondition: 'paralyzed', oddDefenseStageDelta: -1,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({ timings: ['effects-resolved'], userRelation: 'owner', targetRelation: 'any' }),
  tags: ['action', 'choice', 'connection', 'damage', 'random', 'scene', 'triggered'],
})

export const GUTS_ABILITY_SPEC = staticSpec('Guts', 'aa073.guts', {
  conditions: ['burned', 'poisoned', 'paralysis', 'frozen', 'sleep'], attackStages: 2,
}, ['combat-stage', 'condition', 'static'])

export const HANDYMAN_ABILITY_SPEC = staticSpec('Handyman', 'aa073.handyman', {
  heldItemCapacity: 2, chooseAffectedItem: true,
}, ['capacity', 'choice', 'item', 'static'])

export const HARVEST_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Harvest', mechanicId: 'aa073.harvest',
  config: {
    action: 'free', frequency: 'at-will', itemFamily: 'berry', coinSides: 2,
    retainOnResult: 'heads', sunnyAlwaysRetains: true, tradesPerTurn: 1,
    stopAfterResult: 'tails',
  },
  eventKind: 'item', checkpoint: 'pre-effect',
  predicate: {
    kind: 'ability-item-fact', changes: ['consumed'], outcomes: ['applied'],
    resourceKinds: [], itemIds: [], ownerRole: 'owner-before',
    sourceRelation: 'owner', minimumQuantityApplied: 1,
  },
  tags: ['item', 'random', 'terrain', 'triggered', 'turn-usage'],
})

export const HAUNT_ABILITY_SPEC = staticSpec('Haunt', 'aa073.haunt', {
  lastChanceType: 'ghost', hpThresholdNumerator: 1, hpThresholdDenominator: 3, damageBonus: 5,
}, ['damage', 'hp-threshold', 'static', 'type'])

export const HAY_FEVER_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Hay Fever',
  modes: [
    { id: 'burst', kind: 'activated' },
    { id: 'close-blast', kind: 'activated' },
  ],
  targeting: [
    ...noAbilityTarget('burst'),
    {
      id: 'close-blast.direction', modeId: 'close-blast', kind: 'direction',
      minSelections: 1, maxSelections: 1, selector: null, predicate: null,
    },
  ],
  phases: [
    { modeId: 'burst', phase: 'effect', operations: [mechanic('burst.mechanic', 'aa073.hay-fever', {
      action: 'swift', frequency: 'at-will', branch: 'burst-2',
      triggers: ['status-move-used', 'asleep-turn-end'], excludedWeather: ['rainy', 'sandstorm', 'hail'],
      immuneTypes: ['bug', 'grass', 'poison'], hpLossTicks: 1,
    })] },
    { modeId: 'close-blast', phase: 'effect', operations: [mechanic('close-blast.mechanic', 'aa073.hay-fever', {
      action: 'swift', frequency: 'at-will', branch: 'close-blast-3',
      triggers: ['status-move-used', 'asleep-turn-end'], excludedWeather: ['rainy', 'sandstorm', 'hail'],
      immuneTypes: ['bug', 'grass', 'poison'], hpLossTicks: 1,
    })] },
  ],
  tags: ['action', 'area', 'choice', 'hp', 'mode.activated', 'weather'],
})

export const HEALER_ABILITY_SPEC = activatedSpec('Healer', 'aa073.healer', {
  action: 'free', frequency: 'scene', adjacency: 1, cureConditionGroup: 'all-status',
}, [{
  id: 'activate.target', modeId: 'activate', kind: 'token', minSelections: 1, maxSelections: 1,
  selector: { kind: 'candidate-targets' }, predicate: directOtherAdjacent,
}], ['action', 'condition', 'mode.activated', 'scene', 'target'])

export const HEAT_MIRAGE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Heat Mirage', mechanicId: 'aa073.heat-mirage',
  config: {
    action: 'free', frequency: 'at-will', triggerType: 'fire',
    evasionBonus: 3, duration: 'until-next-turn-start',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['effects-resolved'], moveTypes: ['fire'],
    userRelation: 'owner', targetRelation: 'any',
  }),
  tags: ['action', 'evasion', 'lifecycle', 'triggered', 'type'],
})

export const HEATPROOF_ABILITY_SPEC = staticSpec('Heatproof', 'aa073.heatproof', {
  moveType: 'fire', resistanceSteps: 1, preventBurnHpLoss: true,
}, ['condition', 'defensive', 'resistance', 'static', 'type'])

export const AA073_ABILITY_SPECS = Object.freeze([
  GRASSY_SURGE_ABILITY_SPEC, GRIM_NEIGH_ABILITY_SPEC, GULP_ABILITY_SPEC,
  GULP_MISSILE_ABILITY_SPEC, GUTS_ABILITY_SPEC, HANDYMAN_ABILITY_SPEC,
  HARVEST_ABILITY_SPEC, HAUNT_ABILITY_SPEC, HAY_FEVER_ABILITY_SPEC,
  HEALER_ABILITY_SPEC, HEAT_MIRAGE_ABILITY_SPEC, HEATPROOF_ABILITY_SPEC,
])

export const AA073_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA073_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa073.ts',
    spec,
  })),
)
