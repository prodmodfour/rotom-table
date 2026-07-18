import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import { FURY_CUTTER_CHAIN_DETAIL_CODE } from '../furyCutter'

/**
 * Reviewed native-v2 definition for canonical PTU Fury Cutter.
 *
 * The target-bound successful chain is read from authoritative encounter
 * history before damage. DB advances 4, 8, 12, then 16, while the completion
 * history operation advances or resets that chain only after actual damage is
 * known. STAB remains ordered after the canonical capped base.
 */
export const FURY_CUTTER_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Fury Cutter',
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
        id: 'fury-cutter.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.fury-cutter' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'fury-cutter.accuracy-check',
        payload: {
          rollId: 'fury-cutter.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'fury-cutter.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'fury-cutter.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'fury-cutter.physical-damage',
        payload: {
          damageClass: 'physical',
          damageBase: {
            kind: 'expression',
            expression: {
              kind: 'arithmetic',
              operator: 'multiply',
              operands: [
                { kind: 'constant', value: 4 },
                {
                  kind: 'arithmetic',
                  operator: 'add',
                  operands: [
                    { kind: 'constant', value: 1 },
                    {
                      kind: 'move-history',
                      subject: { kind: 'actor' },
                      query: 'consecutive-use-count',
                    },
                  ],
                },
              ],
            },
            minimum: 4,
            maximum: 16,
            rounding: 'floor',
            stabTiming: 'after-bounds',
          },
          moveType: 'bug',
          accuracyRollId: 'fury-cutter.accuracy-roll',
          criticalRollId: 'fury-cutter.accuracy-roll',
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'fury-cutter.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.fury-cutter' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'fury-cutter.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'fury-cutter.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'fury-cutter.chain-completed',
        kind: 'history',
        source: { kind: 'operation', id: 'fury-cutter.damage' },
        recipients: { kind: 'actor' },
        phase: 'cleanup',
        reasonCode: 'fury-cutter.chain-completed',
        payload: {
          event: 'move-completed',
          detailCode: FURY_CUTTER_CHAIN_DETAIL_CODE,
        },
      }, {
        id: 'fury-cutter.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.fury-cutter' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'fury-cutter.completed',
        payload: {
          messageKey: 'move.fury-cutter.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Fury Cutter',
    vfxKey: 'move.fury-cutter',
    tags: ['bug', 'damage', 'dynamic-damage-base', 'history'],
  },
} as const satisfies MoveSpec)

export const FURY_CUTTER_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Fury Cutter',
  sourceModule: 'server/domain/moveAutomation/specs/furyCutter.ts',
  spec: FURY_CUTTER_MOVE_SPEC,
})
