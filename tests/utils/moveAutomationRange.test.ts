import { describe, expect, it } from 'vitest'
import {
  parseExplicitMultiTargetMoveRangeMeters,
  parseMoveMinimumRangeMeters,
  parseSingleTargetMoveRangeMeters,
  tokenGridDistance,
} from '~/utils/moveAutomationRange'

describe('move automation range helpers', () => {
  it('parses numeric, melee, and Focus Rank single-target ranges', () => {
    expect(parseSingleTargetMoveRangeMeters('6, 1 Target')).toBe(6)
    expect(parseSingleTargetMoveRangeMeters('Range 6, 1-Target')).toBe(6)
    expect(parseSingleTargetMoveRangeMeters('Melee, 1 Target')).toBe(1)
    expect(parseSingleTargetMoveRangeMeters('Focus Rank, 1 Target', { focusSkillRankValue: 4 })).toBe(4)
    expect(parseSingleTargetMoveRangeMeters('Focus Rank, 1 Target')).toBeNull()
  })

  it('parses explicit multi-target numeric and melee ranges', () => {
    expect(parseExplicitMultiTargetMoveRangeMeters('6, 2 Targets')).toBe(6)
    expect(parseExplicitMultiTargetMoveRangeMeters('Range 6, 2-Targets')).toBe(6)
    expect(parseExplicitMultiTargetMoveRangeMeters('Melee, 3 Targets')).toBe(1)
    expect(parseExplicitMultiTargetMoveRangeMeters('3, 5 Targets')).toBe(3)
    expect(parseExplicitMultiTargetMoveRangeMeters('9, 10 Targets')).toBe(9)
    expect(parseExplicitMultiTargetMoveRangeMeters('6, 1 Target, Double Strike; or 6, 2 Targets')).toBe(6)
    expect(parseExplicitMultiTargetMoveRangeMeters('6, 1 Target; or 10, 2 Targets')).toBe(10)
    expect(parseExplicitMultiTargetMoveRangeMeters('Melee, 1 Target')).toBeNull()
    expect(parseExplicitMultiTargetMoveRangeMeters('Burst 1')).toBeNull()
  })

  it('parses reviewed ranged-weapon lower bounds without changing the ordinary maximum', () => {
    const range = '12, 1 Target, Ranged Weapon, Minimum Range 4'
    expect(parseSingleTargetMoveRangeMeters(range)).toBe(12)
    expect(parseMoveMinimumRangeMeters(range)).toBe(4)
    expect(parseMoveMinimumRangeMeters('4, 1 Target, Ranged Weapon')).toBe(0)
    expect(parseMoveMinimumRangeMeters('12, Minimum Range nope')).toBe(0)
  })

  it('measures token range with PTU alternating diagonal costs', () => {
    const user = { base: 1, clearance: 1, position: { x: 0, y: 0, z: 0 } }

    expect(tokenGridDistance(user, { base: 1, clearance: 1, position: { x: 1, y: 0, z: 1 } })).toBe(1)
    expect(tokenGridDistance(user, { base: 1, clearance: 1, position: { x: 2, y: 0, z: 2 } })).toBe(3)
    expect(tokenGridDistance(user, { base: 1, clearance: 1, position: { x: 3, y: 0, z: 3 } })).toBe(4)
  })
})
