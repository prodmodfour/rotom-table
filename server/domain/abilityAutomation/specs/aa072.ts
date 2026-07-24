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
  readonly damageClasses?: readonly ('physical' | 'special')[]
  readonly keywordsAll?: readonly string[]
  readonly userRelation: 'owner' | 'other'
  readonly targetRelation: 'any' | 'hit' | 'attacked'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: input.timings,
  moveTypes: input.moveTypes ?? [],
  damageClasses: input.damageClasses ?? [],
  keywordsAny: [] as const,
  keywordsAll: input.keywordsAll ?? [],
  userRelation: input.userRelation,
  targetRelation: input.targetRelation,
})

export const FUR_COAT_ABILITY_SPEC = staticSpec('Fur Coat', 'aa072.fur-coat', {
  damageClass: 'physical', resistanceSteps: 1,
}, ['damage', 'defensive', 'resistance', 'static'])

export const GALE_WINGS_ABILITY_SPEC = staticSpec('Gale Wings', 'aa072.gale-wings', {
  connectionMoveId: 'Quick Attack', fromType: 'normal', optionalType: 'flying',
}, ['choice', 'connection', 'move-overlay', 'static', 'type'])

export const GALVANIZE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Galvanize', mechanicId: 'aa072.galvanize',
  config: {
    action: 'free', frequency: 'at-will', triggerType: 'normal',
    requiresDamaging: true, toType: 'electric',
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({
    timings: ['declared'], moveTypes: ['normal'], damageClasses: ['physical', 'special'],
    userRelation: 'owner', targetRelation: 'any',
  }),
  tags: ['action', 'choice', 'move-overlay', 'triggered', 'type'],
})

export const GARDENER_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Gardener',
  modes: [{ id: 'cultivate', kind: 'activated' }],
  targeting: [{
    id: 'cultivate.plant', modeId: 'cultivate', kind: 'cell', minSelections: 1,
    maxSelections: 1, selector: null, predicate: null,
  }],
  phases: [{
    modeId: 'cultivate', phase: 'effect', operations: [mechanic('cultivate.mechanic', 'aa072.gardener', {
      action: 'extended', frequency: 'daily', uses: 3, targetTag: 'yielding-plant',
      soilQualityDelta: 1, oncePerTargetPerDay: true,
    })],
  }],
  tags: ['action', 'choice', 'daily', 'lifecycle', 'map-state', 'mode.activated'],
})

export const GENTLE_VIBE_ABILITY_SPEC = activatedSpec('Gentle Vibe', 'aa072.gentle-vibe', {
  action: 'standard', frequency: 'scene', burstSize: 2,
  resetCombatStages: true, cureConditionGroup: 'volatile',
}, noAbilityTarget('activate'), ['action', 'area', 'condition', 'mode.activated', 'scene', 'stage'])

export const GIVER_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Giver', mechanicId: 'aa072.giver',
  config: {
    action: 'swift', frequency: 'scene', uses: 2,
    connectionMoveId: 'Present', forcedRollValues: [1, 5],
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({ timings: ['effects-resolved'], userRelation: 'owner', targetRelation: 'any' }),
  tags: ['action', 'choice', 'connection', 'random', 'scene', 'triggered'],
})

export const GLISTEN_ABILITY_SPEC = staticSpec('Glisten', 'aa072.glisten', {
  immuneMoveType: 'fairy',
}, ['defensive', 'immunity', 'static', 'type'])

export const GLUTTONY_ABILITY_SPEC = staticSpec('Gluttony', 'aa072.gluttony', {
  foodBuffCapacity: 3, foodBuffUsesPerScene: 3, refreshmentsPerHalfHour: 2,
}, ['capacity', 'food', 'item', 'static'])

export const GOOEY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Gooey', mechanicId: 'aa072.gooey',
  config: { action: 'free', frequency: 'at-will', triggerRange: 'melee', speedStageDelta: -1 },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'combat-stage', 'reaction', 'triggered'],
})

export const GORE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Gore', mechanicId: 'aa072.gore',
  config: {
    action: 'swift', frequency: 'scene', uses: 2, connectionMoveId: 'Horn Attack',
    grantKeyword: 'double-strike', pushDistance: 2,
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({ timings: ['declared'], userRelation: 'owner', targetRelation: 'any' }),
  tags: ['action', 'choice', 'connection', 'forced-movement', 'multi-hit', 'scene', 'triggered'],
})

export const GORILLA_TACTICS_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Gorilla Tactics', mechanicId: 'aa072.gorilla-tactics',
  config: {
    action: 'swift', frequency: 'scene', damageBonus: 10, duration: 'scene',
    restrictToPreviouslyUsedMoves: true,
  },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({ timings: ['declared'], userRelation: 'owner', targetRelation: 'any' }),
  tags: ['action', 'choice', 'damage', 'move-restriction', 'scene', 'triggered'],
})

export const GRASS_PELT_ABILITY_SPEC = activatedSpec('Grass Pelt', 'aa072.grass-pelt', {
  action: 'swift', frequency: 'scene', temporaryHpTicks: 2,
}, noAbilityTarget('activate'), ['action', 'healing', 'mode.activated', 'scene', 'temporary-hp'])

export const AA072_ABILITY_SPECS = Object.freeze([
  FUR_COAT_ABILITY_SPEC, GALE_WINGS_ABILITY_SPEC, GALVANIZE_ABILITY_SPEC,
  GARDENER_ABILITY_SPEC, GENTLE_VIBE_ABILITY_SPEC, GIVER_ABILITY_SPEC,
  GLISTEN_ABILITY_SPEC, GLUTTONY_ABILITY_SPEC, GOOEY_ABILITY_SPEC,
  GORE_ABILITY_SPEC, GORILLA_TACTICS_ABILITY_SPEC, GRASS_PELT_ABILITY_SPEC,
])

export const AA072_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA072_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa072.ts',
    spec,
  })),
)
