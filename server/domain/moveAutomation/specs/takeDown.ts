import type { MoveSpec } from '#shared/moveAutomation/spec'
import { TAKE_DOWN_HANDLER_ID } from '../handlers/takeDown'
import type { MoveSpecV2Registration } from '../registry'

const TRIP_SKILL_OPTIONS = Object.freeze([
  {
    id: 'combat',
    labelKey: 'skill.combat',
    source: { kind: 'skill', skill: 'combat' },
  },
  {
    id: 'acrobatics',
    labelKey: 'skill.acrobatics',
    source: { kind: 'skill', skill: 'acrobatics' },
  },
] as const)

/**
 * Reviewed native-v2 definition for canonical PTU Take Down.
 *
 * The standard action is paid on declaration. One server-owned accuracy roll
 * gates Physical Normal damage and one-third recoil, including Reckless and
 * recoil-immunity interactions. A non-immune damaging hit then offers the user
 * the move's optional Free Action Trip; actor and target independently choose
 * Combat or Acrobatics before the server owns both opposed rolls. Ties fail
 * because the user must win, and only a win applies Tripped.
 */
export const TAKE_DOWN_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Take Down',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [{
    id: 'take-down.dash-not-stuck',
    predicate: {
      kind: 'not',
      predicate: {
        kind: 'comparison',
        operator: 'equal',
        left: {
          kind: 'condition',
          subject: { kind: 'actor' },
          conditionId: 'stuck',
        },
        right: { kind: 'constant', value: true },
      },
    },
    failureReasonCode: 'take-down.dash-blocked-by-stuck',
  }],
  costs: [{
    id: 'take-down.cost.standard-action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'take-down.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.take-down' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'take-down.accuracy-check',
        payload: {
          rollId: 'take-down.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'after-damage',
      operations: [
        {
          id: 'take-down.trip-offer',
          kind: 'branch',
          source: { kind: 'move', id: 'move.take-down' },
          recipients: { kind: 'damaged-targets' },
          phase: 'after-damage',
          reasonCode: 'take-down.optional-free-action-trip',
          payload: {
            kind: 'choice',
            selectionId: 'take-down.trip-choice',
            scope: 'recipient',
            owner: 'actor',
            requestId: 'take-down.trip-offer',
            promptKey: 'move.take-down.offer-trip',
            options: [{
              id: 'trip',
              labelKey: 'move.take-down.perform-trip',
              operationIds: [
                'take-down.trip-check',
                'take-down.trip-result',
              ],
            }],
            pass: {
              id: 'take-down.trip-pass',
              operationIds: [],
            },
          },
        },
        {
          id: 'take-down.trip-check',
          kind: 'check',
          source: { kind: 'operation', id: 'take-down.trip-offer' },
          recipients: { kind: 'damaged-targets' },
          phase: 'after-damage',
          reasonCode: 'take-down.opposed-trip-check',
          payload: {
            kind: 'opposed',
            checkId: 'take-down.trip-check',
            actorRoll: {
              rollId: 'take-down.trip-actor-roll',
              source: {
                kind: 'choice',
                requestId: 'take-down.trip-actor-skill',
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
                requestId: 'take-down.trip-target-skill',
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
          id: 'take-down.trip-result',
          kind: 'branch',
          source: { kind: 'operation', id: 'take-down.trip-check' },
          recipients: { kind: 'damaged-targets' },
          phase: 'after-damage',
          reasonCode: 'take-down.trip-result',
          payload: {
            kind: 'check',
            selectionId: 'take-down.trip-result',
            scope: 'recipient',
            checkId: 'take-down.trip-check',
            branches: {
              success: {
                id: 'take-down.trip-succeeded',
                operationIds: ['take-down.apply-tripped'],
              },
              failure: {
                id: 'take-down.trip-failed',
                operationIds: [],
              },
            },
          },
        },
        {
          id: 'take-down.apply-tripped',
          kind: 'condition',
          source: { kind: 'operation', id: 'take-down.trip-result' },
          recipients: { kind: 'damaged-targets' },
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
      ],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'take-down.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.take-down' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'take-down.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'take-down.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'take-down.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.take-down' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'take-down.completed',
        payload: {
          messageKey: 'move.take-down.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: TAKE_DOWN_HANDLER_ID,
  presentation: {
    displayName: 'Take Down',
    vfxKey: 'move.take-down',
    tags: ['choice', 'damage', 'normal', 'recoil', 'trip'],
  },
} as const satisfies MoveSpec)

export const TAKE_DOWN_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Take Down',
  sourceModule: 'server/domain/moveAutomation/specs/takeDown.ts',
  spec: TAKE_DOWN_MOVE_SPEC,
})
