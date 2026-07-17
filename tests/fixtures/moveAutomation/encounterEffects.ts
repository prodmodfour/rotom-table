import type {
  EncounterCapabilityEffect,
  EncounterConditionEffect,
  EncounterItemSuppressionEffect,
  EncounterMoveListOverlayEffect,
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
  duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
  stacks: 1,
  charges: 1,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
  tags: ['condition', 'temporary'],
  payload: {
    conditionId: 'sleep',
    action: 'apply',
    saveTiming: 'end-turn',
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
  stackPolicy: { kind: 'refresh', maxStacks: null },
  chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
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

export const itemSuppressionEncounterEffectFixture = (): EncounterItemSuppressionEffect => ({
  id: 'effect.item.target-token',
  kind: 'item-suppression',
  source: {
    operationId: 'op_effect_item_suppression_01',
    moveId: 'move.embargo',
    placementId: 'actor-token',
  },
  affected: {
    placementIds: ['target-token'],
    sideIds: [],
    cells: [],
  },
  createdRound: 3,
  createdTurn: 6,
  duration: { kind: 'scene', remaining: null },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'independent-instance', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['item', 'item-suppression'],
  payload: {
    familyId: 'embargo.item-suppression',
    scope: 'all-equipped',
    itemBindingIds: [],
    blocksUse: true,
    blocksBenefit: true,
  },
  dispel: {
    policy: 'matching-tags',
    tags: ['item-suppression'],
  },
  transferPolicy: 'expire',
  suppression: { sources: [] },
})

export const moveListOverlayEncounterEffectFixture = (
  payload: EncounterMoveListOverlayEffect['payload'] = {
    action: 'add',
    canonicalMoveId: 'Scratch',
    copiedSpecHash: 'a'.repeat(64),
  },
): EncounterMoveListOverlayEffect => ({
  id: 'effect.move-list.target-token',
  kind: 'move-list-overlay',
  source: {
    operationId: 'op_effect_move_list_01',
    moveId: 'move.mimic',
    placementId: 'actor-token',
  },
  affected: {
    placementIds: ['target-token'],
    sideIds: [],
    cells: [],
  },
  createdRound: 3,
  createdTurn: 7,
  duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 2 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['move-list', 'temporary'],
  payload,
  dispel: {
    policy: 'matching-tags',
    tags: ['move-list'],
  },
  transferPolicy: 'expire',
  suppression: { sources: [] },
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
  duration: { kind: 'rounds', boundary: 'end', remaining: 5 },
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'independent-instance', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['movement'],
  payload: {
    capabilityId: 'movement.levitate',
    action: 'grant',
    value: 4,
  },
  dispel: {
    policy: 'matching-tags',
    tags: ['movement'],
  },
  suppression: {
    sources: [],
  },
})
