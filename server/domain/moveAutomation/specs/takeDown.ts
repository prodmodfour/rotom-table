import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import { TAKE_DOWN_HANDLER_ID } from '../handlers/takeDown'

const skillChoice = (
  role: 'actor' | 'target',
) => ({
  kind: 'choice' as const,
  requestId: `take-down.trip-${role}-skill`,
  promptKey: `move.take-down.trip.choose-${role}-skill`,
  options: [
    {
      id: 'combat',
      labelKey: 'skill.combat',
      source: { kind: 'skill' as const, skill: 'combat' },
    },
    {
      id: 'acrobatics',
      labelKey: 'skill.acrobatics',
      source: { kind: 'skill' as const, skill: 'acrobatics' },
    },
  ],
})

const checkRoll = (role: 'actor' | 'target') => ({
  rollId: `take-down.trip-${role}-roll`,
  source: skillChoice(role),
  modifiers: [],
  reroll: { count: 0, keep: 'latest' as const },
  resourceReroll: null,
})

/**
 * Reviewed native-v2 definition for canonical PTU Take Down.
 *
 * The registered pure handler selects the reviewed DB 9/12 Reckless branch and
 * omits recoil only for Rock Head or Magic Guard. Damage and one-third recoil
 * are reduced in order before an optional, durable Free Action Trip. If chosen,
 * each participant selects Combat or Acrobatics and the server owns both rolls;
 * only an actor win applies Tripped.
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
  preconditions: [],
  costs: [],
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
          id: 'take-down.trip-choice',
          kind: 'branch',
          source: { kind: 'move', id: 'move.take-down' },
          recipients: { kind: 'hit-targets' },
          phase: 'after-damage',
          reasonCode: 'take-down.offer-trip',
          payload: {
            kind: 'choice',
            selectionId: 'take-down.trip-choice',
            scope: 'recipient',
            requestId: 'take-down.trip-choice',
            promptKey: 'move.take-down.trip.optional',
            options: [{
              id: 'trip',
              labelKey: 'move.take-down.trip.perform',
              operationIds: [
                'take-down.trip-check',
                'take-down.trip-result',
              ],
            }],
            pass: { id: 'pass', operationIds: [] },
          },
        },
        {
          id: 'take-down.trip-check',
          kind: 'check',
          source: { kind: 'move', id: 'move.take-down' },
          recipients: { kind: 'hit-targets' },
          phase: 'after-damage',
          reasonCode: 'take-down.trip-opposed-check',
          payload: {
            kind: 'opposed',
            checkId: 'take-down.trip-check',
            actorRoll: checkRoll('actor'),
            targetRoll: checkRoll('target'),
            tie: { kind: 'failure' },
            branches: {
              success: 'take-down.trip-success',
              failure: 'take-down.trip-failure',
            },
          },
        },
        {
          id: 'take-down.trip-result',
          kind: 'branch',
          source: { kind: 'operation', id: 'take-down.trip-check' },
          recipients: { kind: 'hit-targets' },
          phase: 'after-damage',
          reasonCode: 'take-down.trip-result',
          payload: {
            kind: 'check',
            selectionId: 'take-down.trip-result',
            scope: 'recipient',
            checkId: 'take-down.trip-check',
            branches: {
              success: {
                id: 'take-down.trip-success',
                operationIds: ['take-down.apply-tripped'],
              },
              failure: {
                id: 'take-down.trip-failure',
                operationIds: [],
              },
            },
          },
        },
        {
          id: 'take-down.apply-tripped',
          kind: 'condition',
          source: { kind: 'operation', id: 'take-down.trip-check' },
          recipients: { kind: 'hit-targets' },
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
    tags: ['damage', 'normal', 'opposed-check', 'recoil'],
  },
} as const satisfies MoveSpec)

export const TAKE_DOWN_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Take Down',
  sourceModule: 'server/domain/moveAutomation/specs/takeDown.ts',
  spec: TAKE_DOWN_MOVE_SPEC,
})
