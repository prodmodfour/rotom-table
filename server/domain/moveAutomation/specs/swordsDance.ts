import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Swords Dance.
 *
 * Self identity is resolved by the interpreter. The typed stage reducer owns
 * the +2 Attack delta, including the +6 cap and an auditable at-cap no-op.
 */
export const SWORDS_DANCE_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Swords Dance',
  version: 2,
  targeting: {
    kind: 'self',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'actor' },
  },
  preconditions: [],
  costs: [],
  phases: [
    {
      phase: 'hit',
      operations: [{
        id: 'swords-dance.raise-attack',
        kind: 'combat-stage',
        source: { kind: 'move', id: 'move.swords-dance' },
        recipients: { kind: 'actor' },
        phase: 'hit',
        reasonCode: 'swords-dance.raise-attack',
        payload: {
          action: 'modify',
          stage: 'atk',
          selectedStage: null,
          value: 2,
          stageSource: null,
          rounding: null,
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'swords-dance.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.swords-dance' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'swords-dance.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'swords-dance.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'swords-dance.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.swords-dance' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'swords-dance.completed',
        payload: {
          messageKey: 'move.swords-dance.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Swords Dance',
    vfxKey: 'move.swords-dance',
    tags: ['combat-stage', 'self'],
  },
} as const satisfies MoveSpec)

export const SWORDS_DANCE_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Swords Dance',
  sourceModule: 'server/domain/moveAutomation/specs/swordsDance.ts',
  spec: SWORDS_DANCE_MOVE_SPEC,
})
