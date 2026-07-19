import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Supersonic.
 *
 * The server-owned Accuracy Roll chooses exactly one branch: a hit applies
 * Confused, while a miss applies the -2 Accuracy marker as an encounter-local
 * effect until the source's next turn begins. Sonic immunity is evaluated by
 * the typed condition reducer for both branches.
 */
export const SUPERSONIC_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Supersonic',
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
        id: 'supersonic.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.supersonic' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'supersonic.accuracy-check',
        payload: {
          rollId: 'supersonic.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'hit',
      operations: [{
        id: 'supersonic.confusion',
        kind: 'condition',
        source: { kind: 'move', id: 'move.supersonic' },
        recipients: { kind: 'hit-targets' },
        phase: 'hit',
        reasonCode: 'supersonic.apply-confusion',
        payload: {
          action: 'apply',
          conditionId: 'confused',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          duration: null,
          saveTiming: 'canonical',
          stackPolicy: { kind: 'refresh', maxStacks: null },
        },
      }],
    },
    {
      phase: 'miss',
      operations: [{
        id: 'supersonic.accuracy-penalty',
        kind: 'condition',
        source: { kind: 'move', id: 'move.supersonic' },
        recipients: { kind: 'missed-targets' },
        phase: 'miss',
        reasonCode: 'supersonic.apply-miss-accuracy-penalty',
        payload: {
          action: 'apply',
          conditionId: 'supersonic-accuracy-penalty',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          duration: {
            effectId: 'supersonic.accuracy-penalty',
            duration: {
              kind: 'turns',
              subject: 'source',
              boundary: 'start',
              remaining: 1,
            },
            transferPolicy: 'expire',
          },
          saveTiming: 'none',
          stackPolicy: { kind: 'refresh', maxStacks: null },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'supersonic.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.supersonic' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'supersonic.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'supersonic.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'supersonic.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.supersonic' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'supersonic.completed',
        payload: {
          messageKey: 'move.supersonic.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Supersonic',
    vfxKey: 'move.supersonic',
    tags: ['condition', 'lifecycle', 'sonic'],
  },
} as const satisfies MoveSpec)

export const SUPERSONIC_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Supersonic',
  sourceModule: 'server/domain/moveAutomation/specs/supersonic.ts',
  spec: SUPERSONIC_MOVE_SPEC,
})
