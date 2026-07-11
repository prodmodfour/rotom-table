import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Power Trip.
 *
 * The server sums the actor's positive authored Combat Stages, adds two DB per
 * stage to the canonical DB 2, caps that contextual result at DB 20, and only
 * then applies STAB. Every expression node and ordering step remains in the
 * authoritative damage trace; no mutable pre-resolution script rewrite is
 * involved.
 */
export const POWER_TRIP_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Power Trip',
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
        id: 'power-trip.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.power-trip' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'power-trip.accuracy-check',
        payload: {
          rollId: 'power-trip.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'power-trip.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'power-trip.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'power-trip.physical-damage',
        payload: {
          damageClass: 'physical',
          damageBase: {
            kind: 'expression',
            expression: {
              kind: 'arithmetic',
              operator: 'add',
              operands: [
                { kind: 'constant', value: 2 },
                {
                  kind: 'arithmetic',
                  operator: 'multiply',
                  operands: [
                    {
                      kind: 'combat-stage-total',
                      subject: { kind: 'actor' },
                      direction: 'positive',
                      stageModifierPolicy: 'ignore',
                    },
                    { kind: 'constant', value: 2 },
                  ],
                },
              ],
            },
            minimum: 2,
            maximum: 20,
            rounding: 'floor',
            stabTiming: 'after-bounds',
          },
          moveType: 'dark',
          accuracyRollId: 'power-trip.accuracy-roll',
          criticalRollId: 'power-trip.accuracy-roll',
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'power-trip.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.power-trip' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'power-trip.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'power-trip.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'power-trip.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.power-trip' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'power-trip.completed',
        payload: {
          messageKey: 'move.power-trip.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Power Trip',
    vfxKey: 'move.power-trip',
    tags: ['damage', 'dynamic-damage-base'],
  },
} as const satisfies MoveSpec)

export const POWER_TRIP_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Power Trip',
  sourceModule: 'server/domain/moveAutomation/specs/powerTrip.ts',
  spec: POWER_TRIP_MOVE_SPEC,
})
