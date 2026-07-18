import type { MoveSpec } from '#shared/moveAutomation/spec'
import type { MoveSpecV2Registration } from '../registry'
import {
  REFLECT_ACTIVATIONS,
  REFLECT_EFFECT_BASE_ID,
  REFLECT_MOVE_SOURCE_ID,
  REFLECT_OPERATION_ID,
  REFLECT_RESISTANCE_STEPS,
} from '../reflect'

/**
 * Reviewed native-v2 definition for canonical PTU Reflect.
 *
 * The Blessing belongs to the actor's explicit encounter side, lasts for the
 * scene, and owns two shared trigger charges. Damage resolution activates one
 * charge only for a placement on that side receiving Physical Damage, then
 * moves its effectiveness one resistance step before committing HP loss.
 */
export const REFLECT_MOVE_SPEC = Object.freeze({
  schemaVersion: 2,
  canonicalId: 'Reflect',
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
      phase: 'schedule',
      operations: [{
        id: REFLECT_OPERATION_ID,
        kind: 'temporary-effect',
        source: { kind: 'move', id: REFLECT_MOVE_SOURCE_ID },
        recipients: { kind: 'actor' },
        phase: 'schedule',
        reasonCode: 'reflect.apply-side-blessing',
        payload: {
          action: 'add',
          effectId: REFLECT_EFFECT_BASE_ID,
          recipientScope: 'side',
          definition: {
            kind: 'numeric-modifier',
            duration: { kind: 'scene', remaining: null },
            stacks: 1,
            charges: REFLECT_ACTIVATIONS,
            stackPolicy: { kind: 'replace', maxStacks: null },
            chargePolicy: { kind: 'consume-on-trigger', amount: 1 },
            tags: ['blessing', 'damage-resistance', 'reflect', 'side-condition'],
            payload: {
              attribute: 'damage-reduction',
              operation: 'resist-step',
              value: REFLECT_RESISTANCE_STEPS,
              rounding: 'none',
              damageClass: 'physical',
            },
            dispel: { policy: 'matching-tags', tags: ['blessing'] },
            transferPolicy: 'retain',
          },
        },
      }],
    },
    {
      phase: 'usage',
      operations: [{
        id: 'reflect.usage',
        kind: 'usage',
        source: { kind: 'move', id: REFLECT_MOVE_SOURCE_ID },
        recipients: { kind: 'actor' },
        phase: 'usage',
        reasonCode: 'reflect.frequency-use',
        payload: {
          action: 'spend',
          resourceId: 'reflect.frequency-use',
          amount: 1,
        },
      }],
    },
    {
      phase: 'cleanup',
      operations: [{
        id: 'reflect.log-completed',
        kind: 'log',
        source: { kind: 'move', id: REFLECT_MOVE_SOURCE_ID },
        recipients: { kind: 'none' },
        phase: 'cleanup',
        reasonCode: 'reflect.completed',
        payload: {
          messageKey: 'move.reflect.completed',
          arguments: [],
        },
      }],
    },
  ],
  registeredHandlerId: null,
  presentation: {
    displayName: 'Reflect',
    vfxKey: 'move.reflect',
    tags: ['blessing', 'damage-resistance', 'side-condition'],
  },
} as const satisfies MoveSpec)

export const REFLECT_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Reflect',
  sourceModule: 'server/domain/moveAutomation/specs/reflect.ts',
  spec: REFLECT_MOVE_SPEC,
})
