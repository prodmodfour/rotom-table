import type { MoveSpecV2Registration } from '../registry'
import { createReviewedFiveStrikeMoveSpec } from './fiveStrike'

/** Reviewed native-v2 definition for canonical PTU Fury Attack. */
export const FURY_ATTACK_MOVE_SPEC = createReviewedFiveStrikeMoveSpec({
  canonicalId: 'Fury Attack',
  slug: 'fury-attack',
  damageBase: 2,
  moveType: 'normal',
})

export const FURY_ATTACK_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Fury Attack',
  sourceModule: 'server/domain/moveAutomation/specs/furyAttack.ts',
  spec: FURY_ATTACK_MOVE_SPEC,
})
