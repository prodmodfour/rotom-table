import type {
  EncounterCapabilityEffect,
  EncounterConditionEffect,
  EncounterNumericModifierEffect,
} from '#shared/moveAutomation/encounterEffects'

export const conditionEncounterEffectFixture = (): EncounterConditionEffect => ({
  id: 'effect.condition.target-token',
  kind: 'condition',
  source: {
    operationId: 'op_effect_condition_01',
    moveId: 'move.test-condition',
    placementId: 'actor-token',
  },
  affected: {
    placementIds: ['target-token'],
    sideIds: [],
    cells: [{ x: 2, y: 0, z: 1 }],
  },
  createdRound: 2,
  createdTurn: 4,
  duration: { kind: 'turns', remaining: 1 },
  stacks: 1,
  charges: 1,
  tags: ['condition', 'temporary'],
  payload: {
    conditionId: 'sleep',
    action: 'apply',
  },
  dispel: {
    policy: 'matching-tags',
    tags: ['condition'],
  },
  suppression: {
    sources: [],
  },
})

export const numericEncounterEffectFixture = (): EncounterNumericModifierEffect => ({
  id: 'effect.numeric.target-token',
  kind: 'numeric-modifier',
  source: {
    operationId: 'op_effect_numeric_01',
    moveId: 'move.test-numeric',
    placementId: 'ally-token',
  },
  affected: {
    placementIds: ['target-token'],
    sideIds: [],
    cells: [],
  },
  createdRound: 2,
  createdTurn: 5,
  duration: { kind: 'until-triggered', remaining: null },
  stacks: 1,
  charges: 1,
  tags: ['damage', 'next-attack'],
  payload: {
    attribute: 'damage',
    operation: 'multiply',
    value: 1.5,
    rounding: 'floor',
  },
  dispel: {
    policy: 'none',
    tags: [],
  },
  suppression: {
    sources: [],
  },
})

export const capabilityEncounterEffectFixture = (): EncounterCapabilityEffect => ({
  id: 'effect.capability.actor-token',
  kind: 'capability',
  source: {
    operationId: 'op_effect_capability_01',
    moveId: 'move.test-capability',
    placementId: 'actor-token',
  },
  affected: {
    placementIds: ['actor-token'],
    sideIds: [],
    cells: [],
  },
  createdRound: 3,
  createdTurn: 7,
  duration: { kind: 'rounds', remaining: 5 },
  stacks: 1,
  charges: null,
  tags: ['movement'],
  payload: {
    capabilityId: 'movement.levitate',
    action: 'grant',
  },
  dispel: {
    policy: 'matching-tags',
    tags: ['movement'],
  },
  suppression: {
    sources: [],
  },
})
