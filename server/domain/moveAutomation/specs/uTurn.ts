import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU U-Turn.
 *
 * A server-owned accuracy roll gates Physical Bug damage and the replacement
 * window. A successful hit always recalls the user—even while Trapped—after an
 * authorized choice: selecting a server-issued roster option sends it out,
 * while passing recalls without a replacement. Stuck still blocks the Dash
 * declaration before costs or randomness.
 */
export const U_TURN_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'U-Turn',
  version: 2,
  targeting: {
    kind: 'single-target',
    minTargets: 1,
    maxTargets: 1,
    selector: { kind: 'selected-targets' },
  },
  preconditions: [{
    id: 'u-turn.dash-not-stuck',
    predicate: {
      kind: 'not',
      predicate: {
        kind: 'comparison',
        operator: 'equal',
        left: {
          kind: 'condition',
          subject: { kind: 'actor' },
          conditionId: 'stuck',
        },
        right: { kind: 'constant', value: true },
      },
    },
    failureReasonCode: 'u-turn.dash-blocked-by-stuck',
  }],
  costs: [{
    id: 'u-turn.cost.standard-action',
    phase: 'pay',
    cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
  }],
  phases: [
    {
      phase: 'accuracy',
      operations: [{
        id: 'u-turn.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.u-turn' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'u-turn.accuracy-check',
        payload: {
          rollId: 'u-turn.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'u-turn.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'u-turn.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'u-turn.physical-damage',
        payload: {
          damageClass: 'physical',
          damageBase: 7,
          moveType: 'bug',
          accuracyRollId: 'u-turn.accuracy-roll',
          criticalRollId: 'u-turn.accuracy-roll',
        },
      }],
    },
    {
      phase: 'movement',
      operations: [{
        id: 'u-turn.choose-replacement',
        kind: 'switch-request',
        source: { kind: 'operation', id: 'u-turn.damage' },
        recipients: { kind: 'actor' },
        phase: 'movement',
        reasonCode: 'u-turn.choose-optional-replacement',
        payload: {
          requestId: 'u-turn.replacement-window',
          replacementSetId: 'u-turn.replacements',
          promptKey: 'move.u-turn.choose-replacement-or-recall',
          trigger: 'on-hit',
          required: false,
          passPolicy: 'recall',
          positionPolicy: 'recalled-position',
          initiativePolicy: 'inherit-slot',
          stateTransferPolicy: 'none',
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'u-turn.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.u-turn' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'u-turn.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'u-turn.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'u-turn.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.u-turn' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'u-turn.completed',
        payload: {
          messageKey: 'move.u-turn.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'U-Turn',
    vfxKey: 'move.u-turn',
    tags: ['bug', 'damage', 'recall', 'switch'],
  },
} as const satisfies MoveSpec)

export const U_TURN_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'U-Turn',
  sourceModule: 'server/domain/moveAutomation/specs/uTurn.ts',
  spec: U_TURN_MOVE_SPEC,
})
