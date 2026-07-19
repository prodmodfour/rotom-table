import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Hyper Beam.
 *
 * One server-owned accuracy roll gates hit identity and critical hits. Smite
 * still emits damage for an attacked target on a miss so the authoritative
 * damage pipeline can apply its canonical additional resistance step. The
 * Standard Action and next-turn Exhaust forfeiture are explicit reviewed
 * costs and commit atomically with damage and Daily usage.
 */
export const HYPER_BEAM_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Hyper Beam',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [{
    id: 'hyper-beam.cost.standard-action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }, {
    id: 'hyper-beam.cost.exhaust',
    phase: 'cleanup',
    cost: { kind: 'exhaust', timing: 'next-turn', forfeitCommand: true },
  }],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'hyper-beam.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.hyper-beam' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'hyper-beam.accuracy-check',
        payload: {
          rollId: 'hyper-beam.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'hyper-beam.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'hyper-beam.accuracy' },
        // Smite misses retain attacked identity but never gain hit identity.
        recipients: { kind: 'attacked-targets' },
        phase: 'damage',
        reasonCode: 'hyper-beam.special-damage',
        payload: {
          damageClass: 'special',
          damageBase: 15,
          moveType: 'normal',
          accuracyRollId: 'hyper-beam.accuracy-roll',
          criticalRollId: 'hyper-beam.accuracy-roll',
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'hyper-beam.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.hyper-beam' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'hyper-beam.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'hyper-beam.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'hyper-beam.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.hyper-beam' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'hyper-beam.completed',
        payload: {
          messageKey: 'move.hyper-beam.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Hyper Beam',
    vfxKey: 'move.hyper-beam',
    tags: ['damage', 'exhaust', 'smite', 'special'],
  },
} as const satisfies MoveSpec)

export const HYPER_BEAM_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Hyper Beam',
  sourceModule: 'server/domain/moveAutomation/specs/hyperBeam.ts',
  spec: HYPER_BEAM_MOVE_SPEC,
})
