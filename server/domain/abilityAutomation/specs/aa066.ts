import type { AbilitySpecV1Registration } from '../registry'
import {
  abilityMechanicOperation as mechanic,
  noAbilityTarget as noneTarget,
  reviewedAbilitySpec as base,
  reviewedActivatedAbilitySpec as activatedSpec,
  reviewedStaticAbilitySpec as staticSpec,
  reviewedTriggeredAbilitySpec as triggeredSpec,
} from './reviewedSpecBuilder'

const moveTrigger = (input: {
  timings: readonly ('declared' | 'use-started' | 'accuracy-resolved' | 'effects-resolved' | 'completed' | 'cancelled')[]
  userRelation: 'owner' | 'other' | 'any'
  targetRelation: 'hit' | 'attacked' | 'missed' | 'critical' | 'declared' | 'not-targeted' | 'any'
}) => ({
  kind: 'ability-move-fact' as const,
  timings: [...input.timings], moveTypes: [], damageClasses: [], keywordsAny: [], keywordsAll: [],
  userRelation: input.userRelation, targetRelation: input.targetRelation,
})

const target = (input: {
  id: string
  modeId: string
  relationship: 'enemy' | 'any'
  maximumRange: number | null
  geometry: 'direct' | 'adjacent'
  lineOfSight?: 'required' | 'ignored'
}) => ({
  id: input.id, modeId: input.modeId, kind: 'token' as const,
  minSelections: 1, maxSelections: 1, selector: null,
  predicate: {
    kind: 'ability-targeting', relationship: input.relationship,
    willingness: 'any', excludeActor: true,
    minimumRange: 0, maximumRange: input.maximumRange,
    visibility: 'required', lineOfSight: input.lineOfSight ?? 'required',
    geometry: input.geometry === 'adjacent'
      ? { kind: 'adjacent', cardinalOnly: false }
      : { kind: 'direct' },
  },
})

const DANCE_MOVE_IDS = [
  'Victory Dance', 'Quiver Dance', 'Dragon Dance', 'Feather Dance',
  'Swords Dance', 'Teeter Dance', 'Lunar Dance', 'Rain Dance',
] as const

export const DANCER_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Dancer', mechanicId: 'aa066.dancer',
  config: {
    action: 'free', frequency: 'scene-x2', radius: 10, moveClass: 'status',
    danceMoveIds: DANCE_MOVE_IDS, immediateUse: true,
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['use-started'], userRelation: 'other', targetRelation: 'any' }),
  tags: ['action', 'copy', 'move', 'nested', 'reaction', 'scene', 'triggered'],
})

export const DANGER_SYRUP_ABILITY_SPEC = triggeredSpec({
  canonicalId: 'Danger Syrup', mechanicId: 'aa066.danger-syrup',
  config: {
    connectionMoveId: 'Sweet Scent', action: 'free', frequency: 'scene',
    trigger: 'hit-by-attack', ignoreMoveFrequency: true,
    blindOnHit: true, blindDuration: 'one-full-round',
  },
  eventKind: 'move', checkpoint: 'post-effect',
  predicate: moveTrigger({ timings: ['accuracy-resolved'], userRelation: 'other', targetRelation: 'hit' }),
  tags: ['action', 'condition', 'connection', 'nested', 'reaction', 'scene', 'triggered'],
})

export const DARK_ART_ABILITY_SPEC = staticSpec('Dark Art', 'aa066.dark-art', {
  moveType: 'dark', lastChanceThreshold: 1 / 3, damageBonus: 5,
}, ['damage', 'hp-threshold', 'static', 'type'])

export const DARK_AURA_ABILITY_SPEC = staticSpec('Dark Aura', 'aa066.dark-aura', {
  moveType: 'dark', damageBaseBonus: 1, relationships: ['self', 'ally'],
}, ['ally', 'aura', 'damage-base', 'static', 'type'])

export const DAUNTLESS_SHIELD_ABILITY_SPEC = staticSpec('Dauntless Shield', 'aa066.dauntless-shield', {
  stat: 'defense', defaultStageBonus: 1,
}, ['combat-stage', 'defensive', 'static'])

export const DAZE_ABILITY_SPEC = activatedSpec(
  'Daze',
  'aa066.daze',
  { action: 'standard', frequency: 'scene', accuracyCheck: 4, range: 6, condition: 'sleep' },
  [target({ id: 'activate.target', modeId: 'activate', relationship: 'any', maximumRange: 6, geometry: 'direct' })],
  ['accuracy', 'action', 'condition', 'mode.activated', 'scene', 'target'],
)

const dazzlingConfig = {
  action: 'swift', frequency: 'scene-x2', target: 'adjacent-foe', initiativePenalty: -10,
  preventPriorityMoves: true, preventInterruptMovesAgainstUser: true,
}
export const DAZZLING_ABILITY_SPEC = base({
  canonicalId: 'Dazzling',
  modes: [{ id: 'activate', kind: 'activated' }, { id: 'passive', kind: 'static' }],
  targeting: [
    target({ id: 'activate.target', modeId: 'activate', relationship: 'enemy', maximumRange: 1, geometry: 'adjacent' }),
    ...noneTarget('passive'),
  ],
  phases: [
    { modeId: 'activate', phase: 'effect', operations: [mechanic('activate.mechanic', 'aa066.dazzling', dazzlingConfig)] },
    { modeId: 'passive', phase: 'effect', operations: [mechanic('passive.mechanic', 'aa066.dazzling', dazzlingConfig)] },
  ],
  tags: ['action', 'initiative', 'interrupt', 'mode.activated', 'priority', 'scene', 'static'],
})

const deadlyPoisonConfig = {
  action: 'free', frequency: 'daily', triggerCondition: 'poisoned', replacementCondition: 'badly-poisoned',
}
export const DEADLY_POISON_ABILITY_SPEC = base({
  canonicalId: 'Deadly Poison',
  modes: [{ id: 'trigger', kind: 'triggered' }, { id: 'upgrade', kind: 'activated' }],
  subscriptions: [{
    id: 'trigger.subscription', modeId: 'trigger', eventKind: 'condition', checkpoint: 'post-effect',
    response: 'optional', priority: 0, oncePerCausalChain: true,
    predicate: {
      kind: 'ability-condition-fact', operations: ['apply'], outcomes: ['applied'],
      conditionIds: ['poisoned'], ownerRole: 'actor', sourceRelation: 'owner',
      resultingState: 'present', save: 'any',
    },
  }],
  targeting: [
    ...noneTarget('trigger'),
    target({
      id: 'upgrade.target', modeId: 'upgrade', relationship: 'any', maximumRange: null,
      geometry: 'direct', lineOfSight: 'ignored',
    }),
  ],
  phases: [
    { modeId: 'trigger', phase: 'effect', operations: [mechanic('trigger.mechanic', 'aa066.deadly-poison', deadlyPoisonConfig)] },
    { modeId: 'upgrade', phase: 'effect', operations: [mechanic('upgrade.mechanic', 'aa066.deadly-poison', deadlyPoisonConfig)] },
  ],
  tags: ['action', 'condition', 'daily', 'mode.activated', 'triggered'],
})

export const DECOY_ABILITY_SPEC = activatedSpec(
  'Decoy',
  'aa066.decoy',
  {
    action: 'full', frequency: 'scene', nestedMoveId: 'Follow Me',
    evasionBonus: 2, duration: 'end-of-next-turn',
  },
  noneTarget('activate'),
  ['action', 'evasion', 'mode.activated', 'move', 'redirection', 'scene'],
)

export const DEEP_SLEEP_ABILITY_SPEC = staticSpec('Deep Sleep', 'aa066.deep-sleep', {
  requiredCondition: 'sleep', healing: 'tick', timing: 'turn-end',
}, ['condition', 'healing', 'lifecycle', 'static'])

export const DEFEATIST_ABILITY_SPEC = staticSpec('Defeatist', 'aa066.defeatist', {
  threshold: { numerator: 1, denominator: 2 }, highHpBonusDice: { count: 2, sides: 6 },
  lowHpDamagePenalty: -5, lowHpInitiativeBonus: 10,
}, ['damage', 'hp-threshold', 'initiative', 'random', 'static'])

export const DEFIANT_ABILITY_SPEC = staticSpec('Defiant', 'aa066.defiant', {
  trigger: 'combat-stage-lowered', excludedSources: ['own-move', 'own-ability'],
  resultingStage: 'attack', resultingDelta: 2,
}, ['combat-stage', 'reaction', 'source', 'static'])

export const AA066_ABILITY_SPECS = Object.freeze([
  DANCER_ABILITY_SPEC, DANGER_SYRUP_ABILITY_SPEC, DARK_ART_ABILITY_SPEC,
  DARK_AURA_ABILITY_SPEC, DAUNTLESS_SHIELD_ABILITY_SPEC, DAZE_ABILITY_SPEC,
  DAZZLING_ABILITY_SPEC, DEADLY_POISON_ABILITY_SPEC, DECOY_ABILITY_SPEC,
  DEEP_SLEEP_ABILITY_SPEC, DEFEATIST_ABILITY_SPEC, DEFIANT_ABILITY_SPEC,
])

export const AA066_ABILITY_SPEC_REGISTRATIONS: readonly AbilitySpecV1Registration[] = Object.freeze(
  AA066_ABILITY_SPECS.map(spec => ({
    canonicalId: spec.canonicalId,
    version: 1,
    sourceModule: 'server/domain/abilityAutomation/specs/aa066.ts',
    spec,
  })),
)
