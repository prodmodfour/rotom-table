import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget,
  reviewedAbilitySpec,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'
import { ABILITY_STAT_OPTIONS_PREDICATE_KIND } from '#shared/abilityAutomation/statTargeting'

const moveHitPredicate = (input: {
  readonly moveTypes?: readonly string[]
  readonly damageClasses?: readonly ('physical' | 'special' | 'status')[]
  readonly userRelation: 'owner' | 'other'
  readonly targetRelation: 'hit' | 'any'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: ['accuracy-resolved'] as const,
  moveTypes: input.moveTypes ?? [],
  damageClasses: input.damageClasses ?? [],
  keywordsAny: [] as const,
  keywordsAll: [] as const,
  userRelation: input.userRelation,
  targetRelation: input.targetRelation,
})

export const FLAME_BODY_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Flame Body', mechanicId: 'aa070.flame-body',
  config: {
    action: 'free', frequency: 'scene', trigger: 'hit-by-melee-attack',
    sourceRelation: 'enemy', condition: 'burned',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveHitPredicate({ userRelation: 'other', targetRelation: 'hit' }),
  tags: ['action', 'condition', 'melee', 'mode.triggered', 'scene'],
})

export const FLAME_TONGUE_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Flame Tongue', mechanicId: 'aa070.flame-tongue',
  config: {
    action: 'free', frequency: 'scene', connectionMoveId: 'Lick',
    trigger: 'lick-hit-foe', injuryDelta: 1, condition: 'burned',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveHitPredicate({ userRelation: 'owner', targetRelation: 'any' }),
  tags: ['action', 'condition', 'connection', 'hp', 'mode.triggered', 'scene'],
})

export const FLARE_BOOST_ABILITY_SPEC = activatedSpec('Flare Boost', 'aa070.flare-boost', {
  action: 'swift', frequency: 'scene', requiredCondition: 'burned',
  attackStages: 3, specialAttackStages: 3,
}, noAbilityTarget('activate'), ['action', 'condition', 'mode.activated', 'scene', 'stage'])

export const FLASH_FIRE_ABILITY_SPEC = staticSpec('Flash Fire', 'aa070.flash-fire', {
  immuneMoveType: 'fire', preventDamage: true, preventEffects: true,
  onHitStatChoices: ['attack', 'special-attack'], stageDelta: 1,
}, ['choice', 'defensive', 'immunity', 'move-overlay', 'stage', 'static', 'type'])

export const FLAVORFUL_AROMA_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Flavorful Aroma', mechanicId: 'aa070.flavorful-aroma',
  config: {
    action: 'free', frequency: 'at-will', connectionMoveId: 'Aromatic Mist',
    trigger: 'aromatic-mist-use', affectedRelationship: 'ally',
    accuracyBonus: 1, damageBonus: 5, durationRounds: 1,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveHitPredicate({ userRelation: 'owner', targetRelation: 'any' }),
  tags: ['action', 'ally', 'connection', 'damage', 'mode.triggered', 'numeric-effect'],
})

export const FLOWER_GIFT_ABILITY_SPEC = reviewedAbilitySpec({
  canonicalId: 'Flower Gift',
  modes: [{ id: 'activate', kind: 'activated' }],
  targeting: [{
    id: 'activate.stats', modeId: 'activate', kind: 'stat', minSelections: 2, maxSelections: 2,
    selector: null,
    predicate: {
      kind: ABILITY_STAT_OPTIONS_PREDICATE_KIND,
      statIds: ['attack', 'defense', 'special-attack', 'special-defense', 'speed'],
    },
  }],
  phases: [{
    modeId: 'activate', phase: 'effect', operations: [mechanic('activate.mechanic', 'aa070.flower-gift', {
      action: 'swift', frequency: 'scene', eligibility: ['sunny-weather', 'below-half-hp'],
      statSelections: 2, selfStageDelta: 2, nearbyStageDelta: 1, radius: 2,
    })],
  }],
  tags: ['action', 'choice', 'geometry', 'mode.activated', 'scene', 'stage', 'weather'],
})

export const FLOWER_POWER_ABILITY_SPEC = staticSpec('Flower Power', 'aa070.flower-power', {
  moveType: 'grass', moveFilter: 'damaging', damageClassChoices: ['physical', 'special'],
}, ['choice', 'damage-class', 'move-overlay', 'static', 'type'])

export const FLOWER_VEIL_ABILITY_SPEC = staticSpec('Flower Veil', 'aa070.flower-veil', {
  protectedType: 'grass', radius: 5, protectUserRegardlessOfType: true,
  preventCombatStageLowering: true,
}, ['aura', 'defensive', 'stage', 'static', 'type'])

export const FLUFFY_ABILITY_SPEC = staticSpec('Fluffy', 'aa070.fluffy', {
  meleeResistanceSteps: 1, fireResistanceSteps: -1, damagingOnly: true,
}, ['damage', 'defensive', 'melee', 'static', 'type'])

export const FLUFFY_CHARGE_ABILITY_SPEC = staticSpec('Fluffy Charge', 'aa070.fluffy-charge', {
  connectionMoveId: 'Charge', trigger: 'charge-use', defenseStages: 1,
}, ['connection', 'move-overlay', 'stage', 'static'])

export const FLUTTER_ABILITY_SPEC = activatedSpec('Flutter', 'aa070.flutter', {
  action: 'shift', frequency: 'at-will', evasionBonus: 3,
  duration: 'through-next-turn-end', cannotBeFlanked: true,
}, noAbilityTarget('activate'), ['action', 'evasion', 'mode.activated', 'movement'])

export const FLYING_FLY_TRAP_ABILITY_SPEC = staticSpec('Flying Fly Trap', 'aa070.flying-fly-trap', {
  damageImmuneMoveTypes: ['ground', 'bug'], effectsRemain: true,
}, ['damage', 'defensive', 'immunity', 'static', 'type'])

export const AA070_ABILITY_SPECS = Object.freeze([
  FLAME_BODY_ABILITY_SPEC, FLAME_TONGUE_ABILITY_SPEC, FLARE_BOOST_ABILITY_SPEC,
  FLASH_FIRE_ABILITY_SPEC, FLAVORFUL_AROMA_ABILITY_SPEC, FLOWER_GIFT_ABILITY_SPEC,
  FLOWER_POWER_ABILITY_SPEC, FLOWER_VEIL_ABILITY_SPEC, FLUFFY_ABILITY_SPEC,
  FLUFFY_CHARGE_ABILITY_SPEC, FLUTTER_ABILITY_SPEC, FLYING_FLY_TRAP_ABILITY_SPEC,
])

export const AA070_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA070_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa070.ts',
    spec,
  })),
)
