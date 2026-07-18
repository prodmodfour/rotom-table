import type { MoveSpecV2Registration } from '../registry'
import { createReviewedFiveStrikeMoveSpec } from './fiveStrike'

/** Reviewed native-v2 definition for canonical PTU Pin Missile. */
export const PIN_MISSILE_MOVE_SPEC = createReviewedFiveStrikeMoveSpec({
  canonicalId: 'Pin Missile',
  slug: 'pin-missile',
  damageBase: 3,
  moveType: 'bug',
})

export const PIN_MISSILE_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Pin Missile',
  sourceModule: 'server/domain/moveAutomation/specs/pinMissile.ts',
  spec: PIN_MISSILE_MOVE_SPEC,
})
