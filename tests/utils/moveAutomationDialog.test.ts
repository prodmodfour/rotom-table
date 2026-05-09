import { describe, expect, it } from 'vitest'
import {
  addCombatStageDeltas,
  applyHpSuggestion,
  nonZeroStageDeltas,
  parseHazardCellText,
  parsePositiveInt,
  stageDeltaLabel,
} from '~/utils/moveAutomationDialog'
import type { CombatStageMap } from '~/types/combatStages'

const stages: CombatStageMap = { atk: 0, def: 5, satk: -5, sdef: 1, spd: 0, acc: 0 }

describe('moveAutomationDialog helpers', () => {
  it('parses non-negative integer strings', () => {
    expect(parsePositiveInt('12')).toBe(12)
    expect(parsePositiveInt('12px')).toBe(12)
    expect(parsePositiveInt('0')).toBe(0)
    expect(parsePositiveInt('-1')).toBeNull()
    expect(parsePositiveInt('abc')).toBeNull()
  })

  it('applies HP suggestions for heal and loss modes', () => {
    expect(applyHpSuggestion(8, 10, 5, 'heal-fixed')).toBe(10)
    expect(applyHpSuggestion(8, 10, 5, 'fixed-loss')).toBe(3)
    expect(applyHpSuggestion(2, 10, 5, 'lose-percent-max')).toBe(0)
  })

  it('adds and clamps combat stage deltas', () => {
    expect(addCombatStageDeltas(stages, { def: 2, satk: -2, atk: 1 })).toEqual({
      atk: 1,
      def: 6,
      satk: -6,
      sdef: 1,
      spd: 0,
      acc: 0,
    })
  })

  it('filters and truncates non-zero stage deltas', () => {
    expect(nonZeroStageDeltas({ atk: 1.8, def: 0, satk: -2.4, sdef: Number.NaN, spd: 0, acc: 3 })).toEqual({
      atk: 1,
      satk: -2,
      acc: 3,
    })
  })

  it('parses hazard cells with optional y coordinate and fallback y', () => {
    expect(parseHazardCellText('1, 2, 3\n4 5\nbad\n6.6,7.2,8.8', 9)).toEqual([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 9, z: 5 },
      { x: 7, y: 7, z: 9 },
    ])
  })

  it('formats stage deltas for compact UI labels', () => {
    expect(stageDeltaLabel(2)).toBe('+2')
    expect(stageDeltaLabel(0)).toBe('0')
    expect(stageDeltaLabel(-3)).toBe('-3')
  })
})
