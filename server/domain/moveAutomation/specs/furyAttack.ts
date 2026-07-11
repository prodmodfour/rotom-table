import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Fury Attack.
 *
 * One server-owned Accuracy Roll gates the sequence, then one reviewed 1d8
 * table fixes its one-to-five strike count. Every scheduled strike receives an
 * independent server-owned critical roll and resolves ordinary DB 2 Normal
 * damage in order. A knockout stops all remaining draws and strikes.
 */
export const FURY_ATTACK_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Fury Attack',
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
        id: 'fury-attack.multi-hit',
        kind: 'multi-hit',
        source: { kind: 'move', id: 'move.fury-attack' },
        recipients: { kind: 'attacked-targets' },
        phase: 'damage',
        reasonCode: 'fury-attack.five-strike',
        payload: {
          count: {
            kind: 'table',
            scope: 'sequence',
            rollId: 'fury-attack.hit-count-roll',
            tableId: 'fury-attack.five-strike-count',
            drawFormula: { kind: 'dice', count: 1, sides: 8, modifier: 0 },
            entries: [
              { minimum: 1, maximum: 1, hits: 1 },
              { minimum: 2, maximum: 3, hits: 2 },
              { minimum: 4, maximum: 6, hits: 3 },
              { minimum: 7, maximum: 7, hits: 4 },
              { minimum: 8, maximum: 8, hits: 5 },
            ],
          },
          accuracy: {
            kind: 'once',
            rollId: 'fury-attack.accuracy-roll',
            formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
          },
          critical: {
            kind: 'per-hit',
            rollId: 'fury-attack.critical-roll',
            formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
          },
          damage: {
            damageClass: 'physical',
            damageBase: 2,
            moveType: 'normal',
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
        id: 'fury-attack.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.fury-attack' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'fury-attack.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'fury-attack.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'fury-attack.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.fury-attack' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'fury-attack.completed',
        payload: {
          messageKey: 'move.fury-attack.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Fury Attack',
    vfxKey: 'move.fury-attack',
    tags: ['damage', 'five-strike', 'multi-hit'],
  },
} as const satisfies MoveSpec)

export const FURY_ATTACK_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Fury Attack',
  sourceModule: 'server/domain/moveAutomation/specs/furyAttack.ts',
  spec: FURY_ATTACK_MOVE_SPEC,
})
