import { describe, expect, it } from 'vitest'
import {
  computePtuInjuryAutomation,
  ptuHitPointInjuryMarkersCrossed,
  ptuMassiveDamageThreshold,
} from '~/utils/ptuInjuries'

describe('PTU injury automation', () => {
  it('uses real max HP for massive damage and HP markers', () => {
    const result = computePtuInjuryAutomation({
      beforeHp: 53,
      afterHp: 25,
      fullMaxHp: 53,
      currentInjuries: 0,
      source: 'damage',
    })

    expect(result).toMatchObject({
      injuries: 2,
      injuryDelta: 2,
      massiveDamageInjuries: 1,
      markerInjuries: 1,
      crossedMarkers: [26],
      maxHp: 42,
    })
  })

  it('counts 0 and negative 50% markers crossed by overkill damage', () => {
    expect(ptuHitPointInjuryMarkersCrossed(40, -20, 40)).toEqual([20, 0, -20])
    expect(computePtuInjuryAutomation({
      beforeHp: 40,
      afterHp: -20,
      fullMaxHp: 40,
      currentInjuries: 0,
      source: 'damage',
    })).toMatchObject({
      injuryDelta: 4,
      massiveDamageInjuries: 1,
      markerInjuries: 3,
      injuries: 4,
    })
  })

  it('does not add Massive Damage Injuries for hit point loss', () => {
    expect(computePtuInjuryAutomation({
      beforeHp: 40,
      afterHp: -20,
      fullMaxHp: 40,
      currentInjuries: 1,
      source: 'hp-loss',
    })).toMatchObject({
      injuryDelta: 3,
      massiveDamageInjuries: 0,
      markerInjuries: 3,
      injuries: 4,
    })
  })

  it('only awards marker injuries crossed from above', () => {
    expect(ptuHitPointInjuryMarkersCrossed(19, -5, 40)).toEqual([0])
    expect(ptuHitPointInjuryMarkersCrossed(20, 10, 40)).toEqual([])
  })

  it('rounds massive damage threshold down per PTU fractional rules', () => {
    expect(ptuMassiveDamageThreshold(53)).toBe(26)
  })
})
