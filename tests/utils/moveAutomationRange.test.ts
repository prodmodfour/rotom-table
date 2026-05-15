import { describe, expect, it } from 'vitest'
import { parseSingleTargetMoveRangeMeters } from '~/utils/moveAutomationRange'

describe('move automation range helpers', () => {
  it('parses numeric, melee, and Focus Rank single-target ranges', () => {
    expect(parseSingleTargetMoveRangeMeters('6, 1 Target')).toBe(6)
    expect(parseSingleTargetMoveRangeMeters('Melee, 1 Target')).toBe(1)
    expect(parseSingleTargetMoveRangeMeters('Focus Rank, 1 Target', { focusSkillRankValue: 4 })).toBe(4)
    expect(parseSingleTargetMoveRangeMeters('Focus Rank, 1 Target')).toBeNull()
  })
})
