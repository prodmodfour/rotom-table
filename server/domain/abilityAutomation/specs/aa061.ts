import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget as noneTarget,
  reviewedAbilitySpec as base,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const directTargetPredicate = (input: {
  relationship: 'ally' | 'enemy' | 'other'
  minimumRange?: number
  maximumRange: number | null
}) => ({
  kind: 'ability-targeting', relationship: input.relationship,
  willingness: 'any', excludeActor: true,
  minimumRange: input.minimumRange ?? 0, maximumRange: input.maximumRange,
  visibility: 'required', lineOfSight: 'ignored', geometry: { kind: 'direct' },
})

const movePredicate = (input: {
  timings: string[]
  moveTypes?: string[]
  damageClasses?: string[]
  userRelation: 'any' | 'owner' | 'other'
  targetRelation?: string
}) => ({
  kind: 'ability-move-fact', timings: input.timings,
  moveTypes: input.moveTypes ?? [], damageClasses: input.damageClasses ?? [],
  keywordsAny: [], keywordsAll: [], userRelation: input.userRelation,
  targetRelation: input.targetRelation ?? 'any',
})

export const AQUA_BOOST_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Aqua Boost', mechanicId: 'aa061.aqua-boost',
  config: { moveType: 'water', adjacency: 1, damageBonus: 5, maximumProviders: 1 },
  eventKind: 'move', checkpoint: 'pre-effect',
  predicate: movePredicate({
    timings: ['use-started'], moveTypes: ['water'], damageClasses: ['physical', 'special'],
    userRelation: 'other',
  }),
  tags: ['ally', 'damage', 'triggered'],
})

export const AQUA_BULLET_ABILITY_SPEC = base({
  canonicalId: 'Aqua Bullet',
  modes: [{ id: 'passive', kind: 'static' }, { id: 'launch', kind: 'activated' }],
  targeting: [
    ...noneTarget('passive'),
    { id: 'launch.move', modeId: 'launch', kind: 'move', minSelections: 1, maxSelections: 1, selector: null, predicate: null },
    { id: 'launch.cell', modeId: 'launch', kind: 'cell', minSelections: 1, maxSelections: 1, selector: null, predicate: null },
  ],
  phases: [
    { modeId: 'passive', phase: 'effect', operations: [mechanic('passive.mechanic', 'aa061.aqua-bullet', {
      connectionMoveId: 'Aqua Jet', moveType: 'water', action: 'full', skySpeed: 10,
      movementShape: 'straight-line', movementTiming: 'before-move', provokeAttacksOfOpportunity: false,
    })] },
    { modeId: 'launch', phase: 'effect', operations: [mechanic('launch.mechanic', 'aa061.aqua-bullet', {
      connectionMoveId: 'Aqua Jet', moveType: 'water', action: 'full', skySpeed: 10,
      movementShape: 'straight-line', movementTiming: 'before-move', provokeAttacksOfOpportunity: false,
    })] },
  ],
  tags: ['action', 'connection', 'movement', 'static'],
})

export const ARENA_TRAP_ABILITY_SPEC = base({
  canonicalId: 'Arena Trap',
  modes: [{ id: 'activate', kind: 'activated' }, { id: 'end', kind: 'activated' }],
  targeting: [...noneTarget('activate'), ...noneTarget('end')],
  phases: [
    { modeId: 'activate', phase: 'effect', operations: [mechanic('activate.mechanic', 'aa061.arena-trap', {
      radius: 5, conditions: ['slowed', 'trapped'], excludeTypes: ['flying'],
      excludeCapabilities: [{ kind: 'levitate', minimum: 4 }, { kind: 'sky', minimum: 4 }, { kind: 'burrow', minimum: 4 }],
    })] },
    { modeId: 'end', phase: 'cleanup', operations: [mechanic('end.mechanic', 'aa061.arena-trap-end', {})] },
  ],
  tags: ['aura', 'condition', 'field', 'lifecycle'],
})

export const AROMA_VEIL_ABILITY_SPEC = staticSpec('Aroma Veil', 'aa061.aroma-veil', {
  adjacency: 1, conditions: ['confused', 'enraged', 'suppressed'], includeSelf: true,
}, ['adjacent', 'condition-immunity', 'defensive', 'static'])

export const AURA_BREAK_ABILITY_SPEC = activatedSpec('Aura Break', 'aa061.aura-break', {
  maximumRange: 6, invertDamageBaseBonuses: true, invertDamageRollBonuses: true,
}, [
  {
    id: 'activate.target', modeId: 'activate', kind: 'token', minSelections: 1, maxSelections: 1,
    selector: { kind: 'candidate-targets' }, predicate: directTargetPredicate({ relationship: 'enemy', maximumRange: 6 }),
  },
  {
    id: 'activate.ability', modeId: 'activate', kind: 'ability', minSelections: 1, maxSelections: 1,
    selector: null, predicate: null,
  },
], ['ability-selection', 'damage-inversion', 'hidden-information'])

export const AURA_STORM_ABILITY_SPEC = staticSpec('Aura Storm', 'aa061.aura-storm', {
  damageBonusPerInjury: 3,
}, ['damage', 'injury', 'static'])

export const BAD_DREAMS_ABILITY_SPEC = activatedSpec('Bad Dreams', 'aa061.bad-dreams', {
  radius: 5, requiredCondition: 'sleep', targetTickLoss: 1,
  healTemporaryOnAnyLoss: true, userTemporaryTickGain: 1,
}, noneTarget('activate'), ['area', 'hp', 'temporary-hp'])

export const BALL_FETCH_ABILITY_SPEC = base({
  canonicalId: 'Ball Fetch',
  modes: [{ id: 'trigger', kind: 'triggered' }, { id: 'fetch', kind: 'activated' }],
  subscriptions: [{
    id: 'trigger.subscription', modeId: 'trigger', eventKind: 'presence', checkpoint: 'post-effect',
    response: 'optional', priority: 0, oncePerCausalChain: true,
    predicate: { kind: 'ability-presence-fact', operations: ['send-out'], ownerRole: 'other', sideId: null },
  }],
  targeting: [
    ...noneTarget('trigger'),
    {
      id: 'fetch.target', modeId: 'fetch', kind: 'token', minSelections: 1, maxSelections: 1,
      selector: { kind: 'candidate-targets' }, predicate: directTargetPredicate({ relationship: 'other', maximumRange: null }),
    },
    { id: 'fetch.cell', modeId: 'fetch', kind: 'cell', minSelections: 1, maxSelections: 1, selector: null, predicate: null },
  ],
  phases: [
    { modeId: 'trigger', phase: 'effect', operations: [mechanic('trigger.mechanic', 'aa061.ball-fetch', {
      movementLimit: 'speed', action: 'free', mustEndCloser: true,
    })] },
    { modeId: 'fetch', phase: 'effect', operations: [mechanic('fetch.mechanic', 'aa061.ball-fetch', {
      movementLimit: 'speed', action: 'free', mustEndCloser: true,
    })] },
  ],
  tags: ['movement', 'reaction', 'triggered'],
})

export const BATTERY_ABILITY_SPEC = activatedSpec('Battery', 'aa061.battery', {
  adjacency: 1, damageClass: 'special', baseBonus: { diceCount: 2, diceSides: 6, modifier: 4 },
  electricBonus: { diceCount: 3, diceSides: 6, modifier: 6 }, consumeOnNextEligibleAttack: true,
}, [{
  id: 'activate.target', modeId: 'activate', kind: 'token', minSelections: 1, maxSelections: 1,
  selector: { kind: 'candidate-targets' }, predicate: directTargetPredicate({ relationship: 'ally', maximumRange: 1 }),
}], ['ally', 'damage', 'mark'])

export const BATTLE_ARMOR_ABILITY_SPEC = staticSpec('Battle Armor', 'aa061.battle-armor', {
  preventCriticalHits: true,
}, ['critical-immunity', 'defensive', 'static'])

export const BEAM_CANNON_ABILITY_SPEC = staticSpec('Beam Cannon', 'aa061.beam-cannon', {
  requiredRange: 'ranged-one-target', effectRangeIncrease: 3, criticalRangeIncrease: 3,
}, ['critical-range', 'effect-range', 'ranged', 'static'])

export const BEAST_BOOST_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Beast Boost', mechanicId: 'aa061.beast-boost',
  config: { stageIncrease: 1, statScope: 'highest-non-hp', tieResolution: 'choice' },
  eventKind: 'hp', checkpoint: 'post-effect',
  predicate: {
    kind: 'ability-hp-fact', changeKinds: ['damage'], faintTransitions: ['fainted'], ownerRole: 'actor',
    massiveDamage: 'any', crossedZero: 'required', injuryChange: 'any', temporaryChange: 'any',
    hpThreshold: 'zero', minimumAppliedAmount: 1,
  },
  tags: ['faint', 'stage', 'triggered'],
})

export const AA061_ABILITY_SPECS = Object.freeze([
  AQUA_BOOST_ABILITY_SPEC, AQUA_BULLET_ABILITY_SPEC, ARENA_TRAP_ABILITY_SPEC,
  AROMA_VEIL_ABILITY_SPEC, AURA_BREAK_ABILITY_SPEC, AURA_STORM_ABILITY_SPEC,
  BAD_DREAMS_ABILITY_SPEC, BALL_FETCH_ABILITY_SPEC, BATTERY_ABILITY_SPEC,
  BATTLE_ARMOR_ABILITY_SPEC, BEAM_CANNON_ABILITY_SPEC, BEAST_BOOST_ABILITY_SPEC,
])

export const AA061_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA061_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    sourceModule: 'server/domain/abilityAutomation/specs/aa061.ts',
    spec,
  })),
)
