import { describe, expect, it } from 'vitest'
import {
  moveAutomationDamageAppliesOnAccuracyOutcome,
  moveAutomationEffectivenessForAccuracyOutcome,
  moveAutomationHasSmiteKeyword,
  moveAutomationIsSmiteMiss,
} from '~/utils/moveAutomationSmite'

const script = (keywords: readonly string[]) => ({
  damaging: true,
  requiresAccuracy: true,
  keywords: [...keywords],
})

describe('move automation Smite policy', () => {
  it('distinguishes a damaging Smite miss from hit identity and ordinary misses', () => {
    const smite = script(['10', '1 Target', 'Smite'])
    const ordinary = script(['Melee', '1 Target'])

    expect(moveAutomationHasSmiteKeyword(smite)).toBe(true)
    expect(moveAutomationIsSmiteMiss(smite, false)).toBe(true)
    expect(moveAutomationDamageAppliesOnAccuracyOutcome(smite, false)).toBe(true)
    expect(moveAutomationDamageAppliesOnAccuracyOutcome(ordinary, false)).toBe(false)
    expect(moveAutomationIsSmiteMiss(smite, true)).toBe(false)
  })

  it.each([
    [0, 0],
    [0.5, 0.25],
    [1, 0.5],
    [1.5, 1],
    [2, 1.5],
  ])('moves effectiveness %s one resistance step to %s only on a miss', (base, expected) => {
    const smite = script(['Smite'])
    expect(moveAutomationEffectivenessForAccuracyOutcome(smite, false, base)).toBe(expected)
    expect(moveAutomationEffectivenessForAccuracyOutcome(smite, true, base)).toBe(base)
  })
})
