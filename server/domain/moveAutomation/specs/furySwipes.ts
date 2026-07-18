import type { MoveSpecV2Registration } from '../registry'
import { createReviewedFiveStrikeMoveSpec } from './fiveStrike'

/** Reviewed native-v2 definition for canonical PTU Fury Swipes. */
export const FURY_SWIPES_MOVE_SPEC = createReviewedFiveStrikeMoveSpec({
  canonicalId: 'Fury Swipes',
  slug: 'fury-swipes',
  damageBase: 3,
  moveType: 'normal',
})

export const FURY_SWIPES_MOVE_SPEC_REGISTRATION: MoveSpecV2Registration = Object.freeze({
  canonicalId: 'Fury Swipes',
  sourceModule: 'server/domain/moveAutomation/specs/furySwipes.ts',
  spec: FURY_SWIPES_MOVE_SPEC,
})
