import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import {
  HELPING_HAND_EFFECT_BASE_ID,
  HELPING_HAND_MOVE_SOURCE_ID,
  HELPING_HAND_OPERATION_ID,
} from '../helpingHand'

/**
 * Reviewed native-v2 definition for canonical PTU Helping Hand.
 *
 * The cannot-miss declaration stores one refreshable target-linked bonus with
 * a single trigger charge through the current round. Authoritative Accuracy
 * and Damage Roll queries project its +2/+10 modifiers; completed move planning
 * consumes the charge only after one qualifying attack has been calculated.
 */
export const HELPING_HAND_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Helping Hand',
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
      phase: 'hit',
      operations: [{
        id: HELPING_HAND_OPERATION_ID,
        kind: 'condition',
        source: { kind: 'move', id: HELPING_HAND_MOVE_SOURCE_ID },
        recipients: { kind: 'hit-targets' },
        phase: 'hit',
        reasonCode: 'helping-hand.apply-bonus',
        payload: {
          action: 'apply',
          conditionId: 'helping-hand',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          duration: {
            effectId: HELPING_HAND_EFFECT_BASE_ID,
            duration: {
              kind: 'rounds',
              boundary: 'end',
              remaining: 1,
            },
            charges: 1,
            transferPolicy: 'retain',
          },
          saveTiming: 'none',
          stackPolicy: { kind: 'refresh', maxStacks: null },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'helping-hand.usage',
        kind: 'usage',
        source: { kind: 'move', id: HELPING_HAND_MOVE_SOURCE_ID },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'helping-hand.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'helping-hand.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'helping-hand.log-completed',
        kind: 'log',
        source: { kind: 'move', id: HELPING_HAND_MOVE_SOURCE_ID },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'helping-hand.completed',
        payload: {
          messageKey: 'move.helping-hand.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Helping Hand',
    vfxKey: 'move.helping-hand',
    tags: ['bonus', 'condition', 'lifecycle'],
  },
} as const satisfies MoveSpec)

export const HELPING_HAND_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Helping Hand',
  sourceModule: 'server/domain/moveAutomation/specs/helpingHand.ts',
  spec: HELPING_HAND_MOVE_SPEC,
})
