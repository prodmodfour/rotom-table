import type { MoveSpec } from '#shared/moveAutomation/spec'
import { ASTONISH_HANDLER_ID } from '../handlers/astonish'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Astonish.
 *
 * One server-owned accuracy roll gates Physical Ghost damage and the ordinary
 * 15+ Flinch. The registered pure handler owns the once-per-scene marker and,
 * after a damaging hit, the durable target-owned awareness answer required for
 * the automatic Flinch branch.
 */
export const ASTONISH_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Astonish',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [{
    id: 'astonish.cost.standard-action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'astonish.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.astonish' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'astonish.accuracy-check',
        payload: {
          rollId: 'astonish.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'astonish.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'astonish.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'astonish.physical-damage',
        payload: {
          damageClass: 'physical',
          damageBase: 3,
          moveType: 'ghost',
          accuracyRollId: 'astonish.accuracy-roll',
          criticalRollId: 'astonish.accuracy-roll',
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'astonish.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.astonish' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'astonish.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'astonish.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'astonish.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.astonish' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'astonish.completed',
        payload: {
          messageKey: 'move.astonish.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: ASTONISH_HANDLER_ID,
  presentation: {
    displayName: 'Astonish',
    vfxKey: 'move.astonish',
    tags: ['choice', 'condition', 'damage', 'ghost', 'opening-action'],
  },
} as const satisfies MoveSpec)

export const ASTONISH_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Astonish',
  sourceModule: 'server/domain/moveAutomation/specs/astonish.ts',
  spec: ASTONISH_MOVE_SPEC,
})
