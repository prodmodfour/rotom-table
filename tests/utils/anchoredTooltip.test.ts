import { describe, expect, it } from 'vitest'
import { computeAnchoredTooltipPosition } from '~/utils/anchoredTooltip'

const anchor = (overrides: Partial<{ top: number; bottom: number; left: number; width: number; height: number }> = {}) => ({
  top: 100,
  bottom: 120,
  left: 200,
  width: 80,
  height: 20,
  ...overrides,
})

const tooltip = (overrides: Partial<{ width: number; height: number }> = {}) => ({
  width: 160,
  height: 80,
  ...overrides,
})

describe('computeAnchoredTooltipPosition', () => {
  it('places tooltips below centered anchors by default', () => {
    expect(computeAnchoredTooltipPosition(anchor(), tooltip(), { width: 800, height: 600 })).toEqual({
      top: 128,
      left: 240,
      placement: 'bottom',
    })
  })

  it('clamps horizontal position to the left viewport margin', () => {
    const result = computeAnchoredTooltipPosition(anchor({ left: 0, width: 20 }), tooltip({ width: 200 }), {
      width: 800,
      height: 600,
    })

    expect(result.left).toBe(112)
    expect(result.placement).toBe('bottom')
  })

  it('clamps horizontal position to the right viewport margin', () => {
    const result = computeAnchoredTooltipPosition(anchor({ left: 760, width: 30 }), tooltip({ width: 200 }), {
      width: 800,
      height: 600,
    })

    expect(result.left).toBe(688)
  })

  it('flips above the anchor when there is enough room above only', () => {
    expect(computeAnchoredTooltipPosition(anchor({ top: 420, bottom: 440 }), tooltip({ height: 120 }), {
      width: 800,
      height: 520,
    })).toEqual({
      top: 292,
      left: 240,
      placement: 'top',
    })
  })

  it('keeps bottom placement but clamps vertically when neither side has ideal room', () => {
    expect(computeAnchoredTooltipPosition(anchor({ top: 20, bottom: 40 }), tooltip({ height: 180 }), {
      width: 800,
      height: 210,
    })).toEqual({
      top: 18,
      left: 240,
      placement: 'bottom',
    })
  })

  it('accepts custom gap and margin values', () => {
    expect(computeAnchoredTooltipPosition(anchor(), tooltip(), { width: 800, height: 600 }, {
      gap: 4,
      margin: 20,
    })).toEqual({
      top: 124,
      left: 240,
      placement: 'bottom',
    })
  })
})
