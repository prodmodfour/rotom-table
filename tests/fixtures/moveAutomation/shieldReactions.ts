import {
  createMoveAutomationRelationshipResolver,
  type MoveAutomationRelationshipPlacement,
} from '~~/server/domain/moveAutomation/relationships'
import {
  applyMoveShieldReaction,
  createMoveShieldProvokingPlan,
  type ApplyMoveShieldReactionResult,
  type MoveShieldProvokingActionTiming,
  type MoveShieldProvokingMoveCategory,
  type MoveShieldProvokingRange,
  type MoveShieldReactionAuthority,
} from '~~/server/domain/moveAutomation/shieldReactions'
import type { MoveShieldReactionDefinition } from '~~/server/domain/moveAutomation/shieldReactionDefinitions'

const PLACEMENTS = Object.freeze([
  { id: 'attacker', sideId: 'red' },
  { id: 'guardian', sideId: 'blue' },
  { id: 'ally', sideId: 'blue' },
  { id: 'area-foe', sideId: 'red' },
  { id: 'outside-target', sideId: 'red' },
  { id: 'unknown-side' },
] satisfies readonly MoveAutomationRelationshipPlacement[])

export const createShieldReactionCanaryAuthority = (): MoveShieldReactionAuthority => Object.freeze({
  placementIds: Object.freeze(PLACEMENTS.map(placement => placement.id)),
  relationships: createMoveAutomationRelationshipResolver({
    placements: PLACEMENTS,
    sides: {
      blue: { id: 'blue', label: 'Blue', status: 'active' },
      red: { id: 'red', label: 'Red', status: 'active' },
    },
  }),
})

export interface ShieldReactionCanaryScenario {
  readonly scenarioId: string
  readonly canonicalMoveId: MoveShieldReactionDefinition['canonicalId']
  readonly moveCategory: MoveShieldProvokingMoveCategory
  readonly actionTiming: MoveShieldProvokingActionTiming
  readonly range: MoveShieldProvokingRange
  readonly encounterRound: number
  readonly scopePlacementIds: readonly string[]
  readonly expectedCancelledTargetIds: readonly string[]
  readonly expectedRetaliationKind: string | null
}

const selfScenario = (
  canonicalMoveId: Extract<MoveShieldReactionDefinition['canonicalId'],
    'Protect' | 'Detect' | 'Baneful Bunker' | 'King’s Shield' | 'Obstruct' | 'Spiky Shield'>,
  expectedRetaliationKind: string | null,
): ShieldReactionCanaryScenario => Object.freeze({
  scenarioId: `shield.${canonicalMoveId.toLowerCase().replaceAll('’', '').replaceAll(' ', '-')}`,
  canonicalMoveId,
  moveCategory: canonicalMoveId === 'Protect' || canonicalMoveId === 'Detect' || canonicalMoveId === 'Obstruct'
    ? 'status'
    : 'damaging',
  actionTiming: 'ordinary',
  range: 'melee',
  encounterRound: 2,
  scopePlacementIds: [],
  expectedCancelledTargetIds: ['guardian'],
  expectedRetaliationKind,
})

/** One reviewed mechanics example for every MA-111 shield family canary. */
export const SHIELD_REACTION_CANARY_SCENARIOS: readonly ShieldReactionCanaryScenario[] = Object.freeze([
  selfScenario('Protect', null),
  selfScenario('Detect', null),
  selfScenario('Baneful Bunker', 'condition'),
  selfScenario('King’s Shield', 'combat-stage'),
  selfScenario('Obstruct', 'combat-stage'),
  selfScenario('Spiky Shield', 'direct-hp'),
  Object.freeze({
    scenarioId: 'shield.crafty-shield.area-status',
    canonicalMoveId: 'Crafty Shield',
    moveCategory: 'status',
    actionTiming: 'ordinary',
    range: 'ranged',
    encounterRound: 2,
    scopePlacementIds: ['guardian', 'ally', 'area-foe'],
    expectedCancelledTargetIds: ['guardian', 'ally', 'area-foe'],
    expectedRetaliationKind: null,
  }),
  Object.freeze({
    scenarioId: 'shield.mat-block.first-round-side',
    canonicalMoveId: 'Mat Block',
    moveCategory: 'damaging',
    actionTiming: 'ordinary',
    range: 'ranged',
    encounterRound: 1,
    scopePlacementIds: ['guardian', 'ally'],
    expectedCancelledTargetIds: ['guardian', 'ally', 'area-foe', 'outside-target'],
    expectedRetaliationKind: null,
  }),
  Object.freeze({
    scenarioId: 'shield.quick-guard.priority-side',
    canonicalMoveId: 'Quick Guard',
    moveCategory: 'damaging',
    actionTiming: 'priority',
    range: 'ranged',
    encounterRound: 2,
    scopePlacementIds: ['guardian', 'ally'],
    expectedCancelledTargetIds: ['guardian', 'ally', 'area-foe', 'outside-target'],
    expectedRetaliationKind: null,
  }),
  Object.freeze({
    scenarioId: 'shield.wide-guard.area',
    canonicalMoveId: 'Wide Guard',
    moveCategory: 'damaging',
    actionTiming: 'ordinary',
    range: 'ranged',
    encounterRound: 2,
    scopePlacementIds: ['guardian', 'ally', 'area-foe'],
    expectedCancelledTargetIds: ['guardian', 'ally', 'area-foe'],
    expectedRetaliationKind: null,
  }),
])

export const runShieldReactionCanaryScenario = (
  scenario: ShieldReactionCanaryScenario,
): ApplyMoveShieldReactionResult => {
  const authority = createShieldReactionCanaryAuthority()
  const attackedTargetIds = ['guardian', 'ally', 'area-foe', 'outside-target']
  const plan = createMoveShieldProvokingPlan(authority, {
    actorPlacementId: 'attacker',
    moveCategory: scenario.moveCategory,
    actionTiming: scenario.actionTiming,
    range: scenario.range,
    encounterRound: scenario.encounterRound,
    attackedTargetIds,
    hitTargetIds: attackedTargetIds,
    effects: [
      { operationId: 'provoking.damage', recipientIds: attackedTargetIds },
      { operationId: 'provoking.secondary-effect', recipientIds: attackedTargetIds },
    ],
  })
  return applyMoveShieldReaction({
    authority,
    plan,
    canonicalMoveId: scenario.canonicalMoveId,
    guardianPlacementId: 'guardian',
    reactionOperationId: `reaction.${scenario.canonicalMoveId
      .toLowerCase()
      .replaceAll('’', '')
      .replaceAll(' ', '-')}`,
    authoritativeScopePlacementIds: scenario.scopePlacementIds,
  })
}
