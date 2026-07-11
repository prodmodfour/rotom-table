import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Absorb.
 *
 * The server owns accuracy, critical-hit, damage, and HP reduction. Healing is
 * linked to the effective HP plus temporary HP actually removed by that damage
 * operation, so immunity, mitigation, knockout overkill, and a full-HP actor
 * cannot inflate or duplicate the drain.
 */
export const ABSORB_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Absorb',
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
        id: 'absorb.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.absorb' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'absorb.accuracy-check',
        payload: {
          rollId: 'absorb.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'absorb.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'absorb.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'absorb.special-damage',
        payload: {
          damageClass: 'special',
          damageBase: 2,
          moveType: 'grass',
          accuracyRollId: 'absorb.accuracy-roll',
          criticalRollId: 'absorb.accuracy-roll',
        },
      }],
    },
    {
      phase: 'after-damage',
      operations: [{
        id: 'absorb.drain',
        kind: 'heal',
        source: { kind: 'operation', id: 'absorb.damage' },
        recipients: { kind: 'actor' },
        phase: 'after-damage',
        reasonCode: 'absorb.drain-half-damage',
        payload: {
          mode: 'gain',
          pool: 'hit-points',
          calculation: {
            kind: 'damage-dealt',
            damageOperationId: 'absorb.damage',
            percent: 50,
            aggregation: 'aggregate',
            preventedDamage: 'zero',
          },
          bounds: { minimum: null, maximum: null },
          rounding: 'round',
          injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'absorb.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.absorb' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'absorb.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'absorb.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'absorb.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.absorb' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'absorb.completed',
        payload: {
          messageKey: 'move.absorb.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Absorb',
    vfxKey: 'move.absorb',
    tags: ['damage', 'drain'],
  },
} as const satisfies MoveSpec)

export const ABSORB_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Absorb',
  sourceModule: 'server/domain/moveAutomation/specs/absorb.ts',
  spec: ABSORB_MOVE_SPEC,
})
