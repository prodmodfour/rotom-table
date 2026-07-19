import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Sweet Scent.
 *
 * Authoritative Burst geometry and Friendly exclusions select the attacked
 * recipients. Each recipient then receives its own server-owned Accuracy Roll;
 * successful hits retain the -2 Evasion marker only for the encounter scene.
 */
export const SWEET_SCENT_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Sweet Scent',
  version: 2,
  targeting: {
    kind: 'area',
    minTargets: 0,
    maxTargets: 32,
    selector: { kind: 'candidate-targets' },
  },
  preconditions: [],
  costs: [],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'sweet-scent.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.sweet-scent' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'sweet-scent.accuracy-check',
        payload: {
          rollId: 'sweet-scent.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'hit',
      operations: [{
        id: 'sweet-scent.evasion-penalty',
        kind: 'condition',
        source: { kind: 'move', id: 'move.sweet-scent' },
        recipients: { kind: 'hit-targets' },
        phase: 'hit',
        reasonCode: 'sweet-scent.apply-evasion-penalty',
        payload: {
          action: 'apply',
          conditionId: 'sweet-scent-evasion-penalty',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          duration: {
            effectId: 'sweet-scent.evasion-penalty',
            duration: { kind: 'scene', remaining: null },
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
        id: 'sweet-scent.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.sweet-scent' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'sweet-scent.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'sweet-scent.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'sweet-scent.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.sweet-scent' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'sweet-scent.completed',
        payload: {
          messageKey: 'move.sweet-scent.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Sweet Scent',
    vfxKey: 'move.sweet-scent',
    tags: ['alluring', 'area', 'evasion'],
  },
} as const satisfies MoveSpec)

export const SWEET_SCENT_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Sweet Scent',
  sourceModule: 'server/domain/moveAutomation/specs/sweetScent.ts',
  spec: SWEET_SCENT_MOVE_SPEC,
})
