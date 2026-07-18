import type { MoveSpec } from '#shared/moveAutomation/spec'
import { TAKE_DOWN_HANDLER_ID } from '../handlers/takeDown'
import type { MoveSpecV2Registration } from '../registry'
import { buildTakeDownTripContinuationOperations } from '../takeDownTripContinuation'

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
      operations: buildTakeDownTripContinuationOperations('damaged-targets'),
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
