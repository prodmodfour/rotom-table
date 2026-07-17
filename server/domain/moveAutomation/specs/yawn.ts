import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import {
  YAWN_DROWSY_EFFECT_BASE_ID,
  YAWN_MOVE_SOURCE_ID,
} from '../yawn'

/**
 * Reviewed native-v2 definition for canonical PTU Yawn.
 *
 * Yawn cannot miss. Its target receives one refreshable, target-linked
 * encounter condition through the end of that target's next turn. The
 * lifecycle handler owns the later Sleep attempt and fresh immunity query.
 */
export const YAWN_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Yawn',
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
        id: 'yawn.drowsy',
        kind: 'condition',
        source: { kind: 'move', id: YAWN_MOVE_SOURCE_ID },
        recipients: { kind: 'hit-targets' },
        phase: 'hit',
        reasonCode: 'yawn.apply-drowsy',
        payload: {
          action: 'apply',
          conditionId: 'yawn',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          duration: {
            effectId: YAWN_DROWSY_EFFECT_BASE_ID,
            duration: {
              kind: 'turns',
              subject: 'target',
              boundary: 'end',
              remaining: 1,
            },
            // Yawn follows its target, not its source. The switch lifecycle
            // handler removes it only when the affected target leaves.
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
        id: 'yawn.usage',
        kind: 'usage',
        source: { kind: 'move', id: YAWN_MOVE_SOURCE_ID },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'yawn.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'yawn.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'yawn.log-completed',
        kind: 'log',
        source: { kind: 'move', id: YAWN_MOVE_SOURCE_ID },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'yawn.completed',
        payload: {
          messageKey: 'move.yawn.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Yawn',
    vfxKey: 'move.yawn',
    tags: ['condition', 'delayed', 'lifecycle'],
  },
} as const satisfies MoveSpec)

export const YAWN_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Yawn',
  sourceModule: 'server/domain/moveAutomation/specs/yawn.ts',
  spec: YAWN_MOVE_SPEC,
})
