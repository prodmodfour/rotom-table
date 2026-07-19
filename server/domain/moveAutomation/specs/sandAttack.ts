import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Sand Attack.
 *
 * The server owns the accuracy check. A legal hit stores Blindness as a
 * target-linked encounter effect through the end of that target's next turn,
 * so initiative lifecycle removes it without a manual sheet edit.
 */
export const SAND_ATTACK_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Sand Attack',
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
        id: 'sand-attack.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.sand-attack' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'sand-attack.accuracy-check',
        payload: {
          rollId: 'sand-attack.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'hit',
      operations: [{
        id: 'sand-attack.blindness',
        kind: 'condition',
        source: { kind: 'move', id: 'move.sand-attack' },
        recipients: { kind: 'hit-targets' },
        phase: 'hit',
        reasonCode: 'sand-attack.apply-blindness',
        payload: {
          action: 'apply',
          conditionId: 'blindness',
          conditionSource: null,
          filter: null,
          randomChoice: null,
          duration: {
            effectId: 'sand-attack.blindness',
            duration: {
              kind: 'turns',
              subject: 'target',
              boundary: 'end',
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
        id: 'sand-attack.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.sand-attack' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'sand-attack.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'sand-attack.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'sand-attack.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.sand-attack' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'sand-attack.completed',
        payload: {
          messageKey: 'move.sand-attack.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Sand Attack',
    vfxKey: 'move.sand-attack',
    tags: ['condition', 'ground', 'lifecycle'],
  },
} as const satisfies MoveSpec)

export const SAND_ATTACK_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Sand Attack',
  sourceModule: 'server/domain/moveAutomation/specs/sandAttack.ts',
  spec: SAND_ATTACK_MOVE_SPEC,
})
