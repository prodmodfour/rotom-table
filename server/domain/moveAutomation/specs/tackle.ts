import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Tackle.
 *
 * One server-owned accuracy roll drives hit and critical decisions. A hit deals
 * ordinary Physical Normal damage, then the authoritative displacement oracle
 * pushes the target two meters directly away from the user, shortening only to
 * the longest collision-free in-bounds prefix.
 */
export const TACKLE_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Tackle',
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
        id: 'tackle.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.tackle' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'tackle.accuracy-check',
        payload: {
          rollId: 'tackle.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'tackle.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'tackle.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'tackle.physical-damage',
        payload: {
          damageClass: 'physical',
          damageBase: 4,
          moveType: 'normal',
          accuracyRollId: 'tackle.accuracy-roll',
          criticalRollId: 'tackle.accuracy-roll',
        },
      }],
    },
    {
      phase: 'movement',
      operations: [{
        id: 'tackle.push',
        kind: 'movement-request',
        source: { kind: 'operation', id: 'tackle.damage' },
        recipients: { kind: 'hit-targets' },
        phase: 'movement',
        reasonCode: 'tackle.push-two-meters',
        payload: {
          requestId: 'tackle.push',
          mode: 'forced',
          distance: 2,
          destinationSetId: null,
          displacement: {
            vector: { kind: 'away', source: { kind: 'actor' } },
            distancePolicy: 'up-to-distance',
            opportunityAttacks: 'ignore',
          },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'tackle.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.tackle' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'tackle.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'tackle.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'tackle.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.tackle' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'tackle.completed',
        payload: {
          messageKey: 'move.tackle.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Tackle',
    vfxKey: 'move.tackle',
    tags: ['damage', 'displacement', 'normal', 'push'],
  },
} as const satisfies MoveSpec)

export const TACKLE_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Tackle',
  sourceModule: 'server/domain/moveAutomation/specs/tackle.ts',
  spec: TACKLE_MOVE_SPEC,
})
