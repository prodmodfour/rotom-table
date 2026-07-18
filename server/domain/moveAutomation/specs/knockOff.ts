import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'

/**
 * Reviewed native-v2 definition for canonical PTU Knock Off.
 *
 * One server-owned accuracy roll gates ordinary Physical Dark damage. A
 * qualifying non-immune damaging hit enumerates only the target's Pokémon Held
 * Items or Trainer Accessory Slot Items. An itemless target completes without a
 * window; otherwise the actor chooses one private server-issued item identity,
 * and the terminal continuation removes that exact item and creates one ground
 * item at the target's authoritative cell.
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
        {
          id: 'knock-off.choose-item',
          kind: 'choice-request',
          source: { kind: 'operation', id: 'knock-off.damage' },
          recipients: { kind: 'damaged-targets' },
          phase: 'after-damage',
          reasonCode: 'knock-off.choose-target-item',
          payload: {
            requestId: 'knock-off.item-window',
            promptKey: 'move.knock-off.choose-item',
            options: [],
            allowPass: false,
            itemChoice: {
              setId: 'knock-off.target-items',
              requirementId: 'knock-off.target-equipped',
              owner: 'actor',
              emptyPolicy: 'no-op',
              filter: {
                referenceKinds: ['pokemon-held', 'trainer-equipment-slot'],
                canonicalItemIds: null,
                trainerEquipmentSlots: ['accessory'],
                minimumQuantity: 1,
              },
              destinations: [{
                id: 'knock-off.to-ground',
                kind: 'map-ground',
                labelKey: 'move.item.destination.map-ground',
              }],
              noneOption: null,
            },
          },
        },
        {
          id: 'knock-off.ground-item',
          kind: 'item',
          source: { kind: 'operation', id: 'knock-off.choose-item' },
          recipients: { kind: 'damaged-targets' },
          phase: 'after-damage',
          reasonCode: 'knock-off.move-item-to-ground',
          payload: {
            action: 'knock-to-ground',
            item: {
              kind: 'choice',
              requestId: 'knock-off.item-window',
              destinationId: 'knock-off.to-ground',
            },
            quantity: 1,
            onUnavailable: 'no-op',
          },
        },
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
