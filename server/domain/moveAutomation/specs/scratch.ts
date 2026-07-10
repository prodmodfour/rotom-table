import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Scratch.
 *
 * Pass geometry and the actor's authoritative damage formula are resolved by
 * the server from the frozen move catalog/context. The spec owns the ordered
 * accuracy, damage, movement, usage, and structured-log operations.
 */
export const SCRATCH_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Scratch',
  version: 2,
  targeting: {
    kind: 'area',
    minTargets: 0,
    maxTargets: 32,
    selector: { kind: 'candidate-targets' },
  },
  preconditions: [],
  costs: [],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'scratch.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.scratch' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'scratch.accuracy-check',
        payload: {
          rollId: 'scratch.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'scratch.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'scratch.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'scratch.damage',
        payload: {
          damageClass: 'physical',
          damageBase: 4,
          moveType: 'normal',
          accuracyRollId: 'scratch.accuracy-roll',
          criticalRollId: null,
        },
      }],
    },
    {
      phase: 'movement',
      operations: [{
        id: 'scratch.pass-movement',
        kind: 'movement-request',
        source: { kind: 'move', id: 'move.scratch' },
        recipients: { kind: 'actor' },
        phase: 'movement',
        reasonCode: 'scratch.pass-movement',
        payload: {
          requestId: 'scratch.pass-destination',
          mode: 'voluntary',
          distance: 4,
          destinationSetId: 'scratch.pass-destinations',
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'scratch.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.scratch' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'scratch.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'scratch.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'scratch.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.scratch' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'scratch.completed',
        payload: {
          messageKey: 'move.scratch.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Scratch',
    vfxKey: 'move.scratch',
    tags: ['damage', 'pass'],
  },
} as const satisfies MoveSpec)

export const SCRATCH_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Scratch',
  sourceModule: 'server/domain/moveAutomation/specs/scratch.ts',
  spec: SCRATCH_MOVE_SPEC,
})
