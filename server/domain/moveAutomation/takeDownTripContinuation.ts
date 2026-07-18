import type { MoveEffectOperation } from '#shared/moveAutomation/effects'

/**
 * Server-owned recipient sets that can establish Take Down's optional Trip.
 * A focused continuation fixture may pass an already-qualified attacked set;
 * the catalog integration must narrow this to its authoritative hit/damage set.
 */
export type TakeDownTripRecipientKind =
  | 'attacked-targets'
  | 'hit-targets'
  | 'damaged-targets'

export const TAKE_DOWN_TRIP_OPERATION_IDS = Object.freeze({
  offer: 'take-down.trip-offer',
  check: 'take-down.trip-check',
  result: 'take-down.trip-result',
  condition: 'take-down.apply-tripped',
} as const)

export const TAKE_DOWN_TRIP_REQUEST_IDS = Object.freeze({
  offer: 'take-down.trip-offer',
  actorSkill: 'take-down.trip-actor-skill',
  targetSkill: 'take-down.trip-target-skill',
} as const)

const TRIP_SKILL_OPTIONS = Object.freeze([
  Object.freeze({
    id: 'combat',
    labelKey: 'skill.combat',
    source: Object.freeze({ kind: 'skill' as const, skill: 'combat' }),
  }),
  Object.freeze({
    id: 'acrobatics',
    labelKey: 'skill.acrobatics',
    source: Object.freeze({ kind: 'skill' as const, skill: 'acrobatics' }),
  }),
] as const)

/**
 * Build the bounded MoveSpec operation fragment for Take Down's optional Free
 * Action Trip. The caller supplies only a server-derived qualifying recipient
 * set; responses can select stable option IDs but cannot author skills, dice,
 * modifiers, tie policy, branches, or the Tripped operation.
 */
export const buildTakeDownTripContinuationOperations = (
  qualifyingRecipients: TakeDownTripRecipientKind,
) => Object.freeze([
  {
    id: TAKE_DOWN_TRIP_OPERATION_IDS.offer,
    kind: 'branch',
    source: { kind: 'move', id: 'move.take-down' },
    recipients: { kind: qualifyingRecipients },
    phase: 'after-damage',
    reasonCode: 'take-down.optional-free-action-trip',
    payload: {
      kind: 'choice',
      selectionId: 'take-down.trip-choice',
      scope: 'recipient',
      owner: 'actor',
      requestId: TAKE_DOWN_TRIP_REQUEST_IDS.offer,
      promptKey: 'move.take-down.offer-trip',
      options: [{
        id: 'trip',
        labelKey: 'move.take-down.perform-trip',
        operationIds: [
          TAKE_DOWN_TRIP_OPERATION_IDS.check,
          TAKE_DOWN_TRIP_OPERATION_IDS.result,
        ],
      }],
      pass: {
        id: 'take-down.trip-pass',
        operationIds: [],
      },
    },
  },
  {
    id: TAKE_DOWN_TRIP_OPERATION_IDS.check,
    kind: 'check',
    source: { kind: 'operation', id: TAKE_DOWN_TRIP_OPERATION_IDS.offer },
    recipients: { kind: qualifyingRecipients },
    phase: 'after-damage',
    reasonCode: 'take-down.opposed-trip-check',
    payload: {
      kind: 'opposed',
      checkId: TAKE_DOWN_TRIP_OPERATION_IDS.check,
      actorRoll: {
        rollId: 'take-down.trip-actor-roll',
        source: {
          kind: 'choice',
          requestId: TAKE_DOWN_TRIP_REQUEST_IDS.actorSkill,
          promptKey: 'move.take-down.choose-actor-trip-skill',
          options: TRIP_SKILL_OPTIONS,
        },
        modifiers: [],
        reroll: { count: 0, keep: 'latest' },
        resourceReroll: null,
      },
      targetRoll: {
        rollId: 'take-down.trip-target-roll',
        source: {
          kind: 'choice',
          requestId: TAKE_DOWN_TRIP_REQUEST_IDS.targetSkill,
          promptKey: 'move.take-down.choose-target-trip-skill',
          options: TRIP_SKILL_OPTIONS,
        },
        modifiers: [],
        reroll: { count: 0, keep: 'latest' },
        resourceReroll: null,
      },
      tie: { kind: 'failure' },
      branches: {
        success: 'take-down.trip-succeeded',
        failure: 'take-down.trip-failed',
      },
    },
  },
  {
    id: TAKE_DOWN_TRIP_OPERATION_IDS.result,
    kind: 'branch',
    source: { kind: 'operation', id: TAKE_DOWN_TRIP_OPERATION_IDS.check },
    recipients: { kind: qualifyingRecipients },
    phase: 'after-damage',
    reasonCode: 'take-down.trip-result',
    payload: {
      kind: 'check',
      selectionId: 'take-down.trip-result',
      scope: 'recipient',
      checkId: TAKE_DOWN_TRIP_OPERATION_IDS.check,
      branches: {
        success: {
          id: 'take-down.trip-succeeded',
          operationIds: [TAKE_DOWN_TRIP_OPERATION_IDS.condition],
        },
        failure: {
          id: 'take-down.trip-failed',
          operationIds: [],
        },
      },
    },
  },
  {
    id: TAKE_DOWN_TRIP_OPERATION_IDS.condition,
    kind: 'condition',
    source: { kind: 'operation', id: TAKE_DOWN_TRIP_OPERATION_IDS.result },
    recipients: { kind: qualifyingRecipients },
    phase: 'after-damage',
    reasonCode: 'take-down.trip-succeeded',
    payload: {
      action: 'apply',
      conditionId: 'tripped',
      conditionSource: null,
      filter: null,
      randomChoice: null,
      duration: null,
      saveTiming: 'canonical',
      stackPolicy: { kind: 'refresh', maxStacks: null },
    },
  },
] satisfies readonly MoveEffectOperation[])
