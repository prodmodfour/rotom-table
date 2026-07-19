import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/** Reviewed native-v2 definition for canonical PTU Thunder Wave. */
export const THUNDER_WAVE_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Thunder Wave',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [{
    id: 'thunder-wave.cost.standard-action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'thunder-wave.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.thunder-wave' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'thunder-wave.accuracy-check',
        payload: {
          rollId: 'thunder-wave.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'hit',
      operations: [{
        id: 'thunder-wave.paralysis',
        kind: 'condition',
        source: { kind: 'operation', id: 'thunder-wave.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'hit',
        reasonCode: 'thunder-wave.apply-paralysis',
        payload: {
          action: 'apply',
          conditionId: 'paralysis',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          applyTypeImmunity: true,
          duration: null,
          saveTiming: 'canonical',
          stackPolicy: { kind: 'refresh', maxStacks: null },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'thunder-wave.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.thunder-wave' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'thunder-wave.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'thunder-wave.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'thunder-wave.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.thunder-wave' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'thunder-wave.completed',
        payload: {
          messageKey: 'move.thunder-wave.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Thunder Wave',
    vfxKey: 'move.thunder-wave',
    tags: ['condition', 'electric', 'paralysis'],
  },
} as const satisfies MoveSpec)

export const THUNDER_WAVE_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Thunder Wave',
  sourceModule: 'server/domain/moveAutomation/specs/thunderWave.ts',
  spec: THUNDER_WAVE_MOVE_SPEC,
})
