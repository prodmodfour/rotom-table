import { describe, expect, it } from 'vitest'
import {
  getHpBarDisplayMetrics,
  hpBarPercentFromRatio,
  hpTierForRatio,
} from '~/utils/hpBarDisplay'

describe('HP bar display metrics', () => {
  it('uses the injury-adjusted max as the full track for legacy HP data', () => {
    const metrics = getHpBarDisplayMetrics({ currentHp: 15, maxHp: 30 })

    expect(metrics.trackMaxHp).toBe(30)
    expect(metrics.currentRatio).toBeCloseTo(0.5)
    expect(metrics.blockedRatio).toBe(0)
  })

  it('blackens the injury-blocked portion of the full formula Max HP track', () => {
    const metrics = getHpBarDisplayMetrics({ currentHp: 50, maxHp: 70, fullMaxHp: 100 })

    expect(metrics.trackMaxHp).toBe(100)
    expect(metrics.effectiveMaxHp).toBe(70)
    expect(metrics.currentRatio).toBeCloseTo(0.5)
    expect(metrics.availableRatio).toBeCloseTo(0.7)
    expect(metrics.blockedRatio).toBeCloseTo(0.3)
  })

  it('keeps over-cap current HP out of the blacked-out injury segment', () => {
    const metrics = getHpBarDisplayMetrics({ currentHp: 90, maxHp: 70, fullMaxHp: 100 })

    expect(metrics.currentRatio).toBeCloseTo(0.7)
    expect(metrics.blockedRatio).toBeCloseTo(0.3)
  })

  it('formats HP bar ratios as CSS percentages', () => {
    expect(hpBarPercentFromRatio(0.5)).toBe('50%')
    expect(hpBarPercentFromRatio(1 / 3)).toBe(`${(1 / 3) * 100}%`)
  })

  it('classifies HP ratios into map health tiers', () => {
    expect(hpTierForRatio(0.25)).toBe('critical')
    expect(hpTierForRatio(0.5)).toBe('wounded')
    expect(hpTierForRatio(0.51)).toBe('healthy')
  })
})
