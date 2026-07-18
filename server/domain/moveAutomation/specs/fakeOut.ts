import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Fake Out.
 *
 * The entry-local resource precondition rejects declarations after the user's
 * opening action. Standard Priority and the Standard Action are then validated
 * before one server-owned accuracy roll; only a non-immune damaging hit applies
 * Flinch through the authoritative condition reducer.
 */
export const FAKE_OUT_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Fake Out',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [{
    id: 'fake-out.opening-action',
    predicate: {
      kind: 'comparison',
      operator: 'equal',
      left: {
        kind: 'encounter-resource',
        subject: { kind: 'actor' },
        query: 'acted-since-entry',
      },
      right: { kind: 'constant', value: false },
    },
    failureReasonCode: 'fake-out.not-joining-encounter',
  }],
  costs: [{
    id: 'fake-out.cost.priority',
    phase: 'declare',
    cost: { kind: 'priority', mode: 'standard' },
  }, {
    id: 'fake-out.cost.standard-action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'fake-out.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.fake-out' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'fake-out.accuracy-check',
        payload: {
          rollId: 'fake-out.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'fake-out.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'fake-out.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'fake-out.physical-damage',
        payload: {
          damageClass: 'physical',
          damageBase: 4,
          moveType: 'normal',
          accuracyRollId: 'fake-out.accuracy-roll',
          criticalRollId: 'fake-out.accuracy-roll',
        },
      }],
    },
    {
      phase: 'after-damage',
      operations: [{
        id: 'fake-out.flinch',
        kind: 'condition',
        source: { kind: 'operation', id: 'fake-out.damage' },
        recipients: { kind: 'damaged-targets' },
        phase: 'after-damage',
        reasonCode: 'fake-out.joining-flinch',
        payload: {
          action: 'apply',
          conditionId: 'flinch',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          duration: null,
          saveTiming: 'canonical',
          stackPolicy: { kind: 'add-stack', maxStacks: 64 },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'fake-out.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.fake-out' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'fake-out.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'fake-out.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'fake-out.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.fake-out' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'fake-out.completed',
        payload: {
          messageKey: 'move.fake-out.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Fake Out',
    vfxKey: 'move.fake-out',
    tags: ['condition', 'damage', 'normal', 'opening-action', 'priority'],
  },
} as const satisfies MoveSpec)

export const FAKE_OUT_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Fake Out',
  sourceModule: 'server/domain/moveAutomation/specs/fakeOut.ts',
  spec: FAKE_OUT_MOVE_SPEC,
})
