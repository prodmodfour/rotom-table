import type { MoveSpec, MoveSpecEffectOperation } from '#shared/moveAutomation/spec'
import {
  KNOCK_OFF_ITEM_CHOICE_OPERATION,
  KNOCK_OFF_ITEM_EFFECT_OPERATION,
} from '../knockOff'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 draft for canonical PTU Knock Off.
 *
 * One server-owned accuracy roll gates ordinary Physical Dark damage. A
 * qualifying non-immune damaging hit enumerates only the target's Pokémon Held
 * Items or Trainer Accessory Slot Items. The pure outcome seam handles itemless
 * and unambiguous branches immediately, while ambiguous candidates suspend
 * behind a private actor-owned durable choice. MA-176B uses this definition
 * only through an explicit test/runtime seam; production selection and atomic
 * terminal persistence remain deferred to MA-176C.
 */
export const KNOCK_OFF_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Knock Off',
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
        id: 'knock-off.accuracy',
        kind: 'roll',
        source: { kind: 'move', id: 'move.knock-off' },
        recipients: { kind: 'attacked-targets' },
        phase: 'accuracy',
        reasonCode: 'knock-off.accuracy-check',
        payload: {
          rollId: 'knock-off.accuracy-roll',
          formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
        },
      }],
    },
    {
      phase: 'damage',
      operations: [{
        id: 'knock-off.damage',
        kind: 'damage',
        source: { kind: 'operation', id: 'knock-off.accuracy' },
        recipients: { kind: 'hit-targets' },
        phase: 'damage',
        reasonCode: 'knock-off.physical-damage',
        payload: {
          damageClass: 'physical',
          damageBase: 7,
          moveType: 'dark',
          accuracyRollId: 'knock-off.accuracy-roll',
          criticalRollId: 'knock-off.accuracy-roll',
        },
      }],
    },
    {
      phase: 'after-damage',
      operations: [
        KNOCK_OFF_ITEM_CHOICE_OPERATION as unknown as MoveSpecEffectOperation,
        KNOCK_OFF_ITEM_EFFECT_OPERATION as unknown as MoveSpecEffectOperation,
      ],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'knock-off.usage',
        kind: 'usage',
        source: { kind: 'move', id: 'move.knock-off' },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'knock-off.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'knock-off.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'knock-off.log-completed',
        kind: 'log',
        source: { kind: 'move', id: 'move.knock-off' },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'knock-off.completed',
        payload: {
          messageKey: 'move.knock-off.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Knock Off',
    vfxKey: 'move.knock-off',
    tags: ['damage', 'dark', 'ground-item', 'item-choice'],
  },
} as const satisfies MoveSpec)

export const KNOCK_OFF_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Knock Off',
  sourceModule: 'server/domain/moveAutomation/specs/knockOff.ts',
  spec: KNOCK_OFF_MOVE_SPEC,
})
