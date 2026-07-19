import type { MoveSpec } from '#shared/moveAutomation/spec'
import { STOMP_HANDLER_ID } from '../handlers/stomp'
import type { MoveSpecV2Registration } from '../registry'
import {
  createFangSecondaryOperations,
  createReviewedSingleTargetDamageSpec,
  createStandardMoveDamageOperation,
} from '../standardDamageOperations'

/**
 * Stomp's handler emits its damage and Flinch operations after comparing the
 * effective authoritative actor and target size categories.
 */
export const STOMP_MOVE_SPEC: MoveSpec = createReviewedSingleTargetDamageSpec({
  canonicalId: 'Stomp',
  slug: 'stomp',
  operations: [],
  registeredHandlerId: STOMP_HANDLER_ID,
  tags: ['condition', 'damage', 'normal', 'relative-size'],
})

/** Reviewed native-v2 definition for canonical PTU Thunder Fang. */
export const THUNDER_FANG_MOVE_SPEC: MoveSpec = createReviewedSingleTargetDamageSpec({
  canonicalId: 'Thunder Fang',
  slug: 'thunder-fang',
  operations: [
    createStandardMoveDamageOperation({
      slug: 'thunder-fang',
      damageBase: 7,
      damageClass: 'physical',
      moveType: 'electric',
    }),
    ...createFangSecondaryOperations('thunder-fang', 'paralysis'),
  ],
  tags: ['condition', 'damage', 'electric', 'random'],
})

const registration = (
  canonicalId: string,
  spec: MoveSpec,
): MoveSpecV2Registration => Object.freeze({
  canonicalId,
  sourceModule: 'server/domain/moveAutomation/specs/stompAndThunderFang204.ts',
  spec,
})

export const STOMP_AND_THUNDER_FANG_204_MOVE_SPEC_REGISTRATIONS = Object.freeze([
  registration('Stomp', STOMP_MOVE_SPEC),
  registration('Thunder Fang', THUNDER_FANG_MOVE_SPEC),
])
