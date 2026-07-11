import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Double Kick.
 *
 * The sequence owns both Accuracy Rolls. Each successful strike resolves its
 * own DB 3 Fighting damage and derives its own critical result from that
 * strike's natural Accuracy Roll. A miss does not stop the other scheduled
 * strike, while a knockout stops the sequence before another server roll.
 */
export const DOUBLE_KICK_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Double Kick',
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
      phase: 'damage',
      operations: [{
        id: 'double-kick.multi-hit',
        kind: 'multi-hit',
        source: { kind: 'move', id: 'move.double-kick' },
        recipients: { kind: 'attacked-targets' },
        phase: 'damage',
        reasonCode: 'double-kick.double-strike',
        payload: {
          count: { kind: 'fixed', hits: 2 },
          accuracy: {
            kind: 'per-hit',
            rollId: 'double-kick.accuracy-roll',
            formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
            stopOnMiss: false,
          },
          critical: { kind: 'accuracy' },
          damage: {
            damageClass: 'physical',
            damageBase: 3,
            moveType: 'fighting',
            accuracyRollId: null,
            criticalRollId: null,
          },
          effects: [],
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'double-kick.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.double-kick' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'double-kick.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'double-kick.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'double-kick.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.double-kick' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'double-kick.completed',
        payload: {
          messageKey: 'move.double-kick.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Double Kick',
    vfxKey: 'move.double-kick',
    tags: ['damage', 'double-strike', 'multi-hit'],
  },
} as const satisfies MoveSpec)

export const DOUBLE_KICK_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Double Kick',
  sourceModule: 'server/domain/moveAutomation/specs/doubleKick.ts',
  spec: DOUBLE_KICK_MOVE_SPEC,
})
