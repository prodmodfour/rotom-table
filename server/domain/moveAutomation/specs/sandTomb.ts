import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import {
  SAND_TOMB_MOVE_SOURCE_ID,
  SAND_TOMB_VORTEX_DEFINITION,
  SAND_TOMB_VORTEX_OPERATION_ID,
  VORTEX_EFFECT_BASE_ID,
} from '../vortex'

/**
 * Reviewed native-v2 definition for canonical PTU Sand Tomb.
 *
 * Accuracy, ordinary Physical Ground damage, and critical-hit eligibility use
 * one server-owned d20. A legal hit then creates the shared target-local
 * Vortex; initiative lifecycle owns its Tick loss and escalating escape saves.
 */
export const SAND_TOMB_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Sand Tomb',
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
        id: 'sand-tomb.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: SAND_TOMB_MOVE_SOURCE_ID },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'sand-tomb.accuracy-check',
        payload: {
          rollId: 'sand-tomb.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'sand-tomb.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'sand-tomb.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'sand-tomb.physical-damage',
        payload: {
          damageClass: 'physical',
          damageBase: 4,
          moveType: 'ground',
          accuracyRollId: 'sand-tomb.accuracy-roll',
          criticalRollId: 'sand-tomb.accuracy-roll',
        },
      }],
    },
    {
      phase: 'after-damage',
      operations: [{
        id: SAND_TOMB_VORTEX_OPERATION_ID,
        kind: 'temporary-effect',
        source: { kind: 'move', id: SAND_TOMB_MOVE_SOURCE_ID },
        recipients: { kind: 'hit-targets' },
        phase: 'after-damage',
        reasonCode: 'sand-tomb.apply-vortex',
        payload: {
          action: 'add',
          effectId: VORTEX_EFFECT_BASE_ID,
          recipientScope: 'placements',
          definition: SAND_TOMB_VORTEX_DEFINITION,
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'sand-tomb.usage',
        kind: 'usage',
        source: { kind: 'move', id: SAND_TOMB_MOVE_SOURCE_ID },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'sand-tomb.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'sand-tomb.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'sand-tomb.log-completed',
        kind: 'log',
        source: { kind: 'move', id: SAND_TOMB_MOVE_SOURCE_ID },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'sand-tomb.completed',
        payload: {
          messageKey: 'move.sand-tomb.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Sand Tomb',
    vfxKey: 'move.sand-tomb',
    tags: ['damage', 'ground', 'lifecycle', 'vortex'],
  },
} as const satisfies MoveSpec)

export const SAND_TOMB_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Sand Tomb',
  sourceModule: 'server/domain/moveAutomation/specs/sandTomb.ts',
  spec: SAND_TOMB_MOVE_SPEC,
})
