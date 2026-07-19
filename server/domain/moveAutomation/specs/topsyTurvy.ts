import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Topsy-Turvy.
 *
 * The authoritative accuracy roll gates one all-stage inversion. The combat-
 * stage reducer negates Attack, Defense, Special Attack, Special Defense,
 * Speed, and Accuracy from one operation-entry snapshot; six zero stages are
 * retained as an auditable no-op.
 */
export const TOPSY_TURVY_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Topsy-Turvy',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [],
  costs: [{
    id: 'topsy-turvy.cost.standard-action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'topsy-turvy.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.topsy-turvy' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'topsy-turvy.accuracy-check',
        payload: {
          rollId: 'topsy-turvy.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'hit',
      operations: [{
        id: 'topsy-turvy.invert-stages',
        kind: 'combat-stage',
        source: { kind: 'operation', id: 'topsy-turvy.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'hit',
        reasonCode: 'topsy-turvy.invert-combat-stages',
        payload: {
          action: 'invert',
          stage: 'all',
          selectedStage: null,
          value: null,
          stageSource: null,
          rounding: null,
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'topsy-turvy.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.topsy-turvy' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'topsy-turvy.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'topsy-turvy.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'topsy-turvy.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.topsy-turvy' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'topsy-turvy.completed',
        payload: {
          messageKey: 'move.topsy-turvy.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Topsy-Turvy',
    vfxKey: 'move.topsy-turvy',
    tags: ['combat-stage', 'dark', 'inversion'],
  },
} as const satisfies MoveSpec)

export const TOPSY_TURVY_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Topsy-Turvy',
  sourceModule: 'server/domain/moveAutomation/specs/topsyTurvy.ts',
  spec: TOPSY_TURVY_MOVE_SPEC,
})
