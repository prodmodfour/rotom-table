import { AA076_IRON_FIST_MOVE_IDS } from '#shared/abilityAutomation/aa076'
import type { AbilitySpecV1Registration } from '../registry'
import {
  noAbilityTarget,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const movePredicate = (input: {
  readonly timings: readonly ('declared' | 'accuracy-resolved' | 'effects-resolved')[]
  readonly moveTypes?: readonly string[]
  readonly damageClasses?: readonly ('physical' | 'special' | 'status')[]
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

const foeWithinFive = {
  kind: 'ability-targeting' as const,
  relationship: 'enemy' as const,
  willingness: 'any' as const,
  excludeActor: true,
  minimumRange: 0,
  maximumRange: 5,
  visibility: 'required' as const,
  lineOfSight: 'ignored' as const,
  geometry: { kind: 'direct' as const },
}

export const INNER_FOCUS_ABILITY_SPEC = staticSpec('Inner Focus', 'aa076.inner-focus', {
  blockedConditions: ['flinch'], preventUnwillingInitiativeLowering: true,
}, ['condition', 'defensive', 'initiative', 'static'])

export const INSOMNIA_ABILITY_SPEC = staticSpec('Insomnia', 'aa076.insomnia', {
  blockedConditions: ['sleep'], blockedMoveIds: ['Rest'],
}, ['condition', 'defensive', 'move-restriction', 'static'])

export const INSTINCT_ABILITY_SPEC = staticSpec('Instinct', 'aa076.instinct', {
  defaultEvasionBonus: 2,
}, ['defensive', 'evasion', 'static'])

export const INTERFERENCE_ABILITY_SPEC = activatedSpec('Interference', 'aa076.interference', {
  action: 'swift', frequency: 'scene', targetRelationship: 'foes', radius: 3,
  accuracyPenalty: -2, duration: 'one-full-round',
}, noAbilityTarget('activate'), ['accuracy', 'action', 'area', 'mode.activated', 'scene'])

export const INTIMIDATE_ABILITY_SPEC = activatedSpec('Intimidate', 'aa076.intimidate', {
  action: 'swift', frequency: 'at-will', targetRelationship: 'foe', range: 5,
  attackStageDelta: -1, perTargetFrequency: 'scene',
}, [{
  id: 'activate.target', modeId: 'activate', kind: 'token',
  minSelections: 1, maxSelections: 1,
  selector: { kind: 'candidate-targets' }, predicate: foeWithinFive,
}], ['action', 'combat-stage', 'mode.activated', 'targeting', 'usage'])

export const INTREPID_SWORD_ABILITY_SPEC = staticSpec('Intrepid Sword', 'aa076.intrepid-sword', {
  stat: 'attack', defaultStageBonus: 1,
}, ['combat-stage', 'offensive', 'static'])

export const IRON_BARBS_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Iron Barbs', mechanicId: 'aa076.iron-barbs',
  config: {
    action: 'free', frequency: 'at-will', trigger: 'damaging-melee-hit',
    hitPointLossTicks: 1, reaction: true,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['effects-resolved'], damageClasses: ['physical', 'special'],
    userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'hp', 'reaction', 'triggered'],
})

export const IRON_FIST_ABILITY_SPEC = staticSpec('Iron Fist', 'aa076.iron-fist', {
  moveIds: AA076_IRON_FIST_MOVE_IDS, damageBaseBonus: 2,
}, ['damage-base', 'move-filter', 'offensive', 'static'])

export const JUICY_ENERGY_ABILITY_SPEC = activatedSpec('Juicy Energy', 'aa076.juicy-energy', {
  action: 'free', frequency: 'daily', consumedBuffItemId: 'shuckles-berry-juice',
  ordinaryHealing: 30, replacementHealing: 'user-level',
}, [{
  id: 'activate.buff', modeId: 'activate', kind: 'branch',
  minSelections: 1, maxSelections: 1, selector: null, predicate: null,
}], ['action', 'daily', 'healing', 'item', 'mode.activated'])

export const JUSTIFIED_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Justified', mechanicId: 'aa076.justified',
  config: {
    action: 'free', frequency: 'at-will', triggerMoveType: 'dark',
    triggerAttackOfOpportunity: true, attackStageDelta: 1, interceptCheckBonus: 4,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['effects-resolved'], damageClasses: ['physical', 'special'],
    userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'combat-stage', 'reaction', 'skill-check', 'triggered', 'type'],
})

export const KAMPFGEIST_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Kampfgeist', mechanicId: 'aa076.kampfgeist',
  config: {
    action: 'free', frequency: 'scene', triggerTypes: ['bug', 'dark', 'rock'],
    resistanceSteps: 1, bonusStabType: 'fighting',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: movePredicate({
    timings: ['effects-resolved'], moveTypes: ['rock', 'bug', 'dark'],
    damageClasses: ['physical', 'special'], userRelation: 'other', targetRelation: 'hit',
  }),
  tags: ['action', 'damage', 'reaction', 'resistance', 'scene', 'static', 'triggered', 'type'],
})

export const KEEN_EYE_ABILITY_SPEC = staticSpec('Keen Eye', 'aa076.keen-eye', {
  protectAccuracyStage: true, ignoreAccuracyPenalties: true,
  blockedCondition: 'blindness', excludedCondition: 'total-blindness',
  ignoreNonStatEvasion: true,
}, ['accuracy', 'condition', 'evasion', 'immunity', 'static'])

export const AA076_ABILITY_SPECS = Object.freeze([
  INNER_FOCUS_ABILITY_SPEC, INSOMNIA_ABILITY_SPEC, INSTINCT_ABILITY_SPEC,
  INTERFERENCE_ABILITY_SPEC, INTIMIDATE_ABILITY_SPEC, INTREPID_SWORD_ABILITY_SPEC,
  IRON_BARBS_ABILITY_SPEC, IRON_FIST_ABILITY_SPEC, JUICY_ENERGY_ABILITY_SPEC,
  JUSTIFIED_ABILITY_SPEC, KAMPFGEIST_ABILITY_SPEC, KEEN_EYE_ABILITY_SPEC,
])

export const AA076_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA076_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa076.ts',
    spec,
  })),
)
