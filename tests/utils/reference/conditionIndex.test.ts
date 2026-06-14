import { describe, expect, it } from 'vitest'
import {
  conditionMatchesSearch,
  filterConditionsForIndex,
} from '~/utils/reference/conditionIndex'
import type { PtuConditionRecord } from '~/utils/statusConditions'

const condition = (
  overrides: Partial<PtuConditionRecord> & Pick<PtuConditionRecord, 'name' | 'category'>,
): PtuConditionRecord => ({
  name: overrides.name,
  category: overrides.category,
  effect: overrides.effect,
  aliases: overrides.aliases,
  source: overrides.source,
})

const burned = condition({
  name: 'Burned',
  category: 'Persistent Affliction',
  effect: 'Loses Hit Points each turn.',
  aliases: ['Burn'],
})
const flinch = condition({
  name: 'Flinch',
  category: 'Volatile Affliction',
  source: 'Core',
  effect: 'May not take actions this round.',
})
const vulnerable = condition({
  name: 'Vulnerable',
  category: 'Other Affliction',
  effect: 'Attacks gain a bonus against this target.',
})

const sampleConditions = [burned, flinch, vulnerable]

describe('condition index helpers', () => {
  it('matches condition search haystacks', () => {
    expect(conditionMatchesSearch(burned, 'burn')).toBe(true)
    expect(conditionMatchesSearch(flinch, 'core')).toBe(true)
    expect(conditionMatchesSearch(vulnerable, 'bonus')).toBe(true)
    expect(conditionMatchesSearch(vulnerable, 'missing')).toBe(false)
  })

  it('filters conditions by search term while preserving source order', () => {
    expect(filterConditionsForIndex(sampleConditions, { searchTerm: 'affliction' }).map((c) => c.name)).toEqual([
      'Burned',
      'Flinch',
      'Vulnerable',
    ])
    expect(filterConditionsForIndex(sampleConditions, { searchTerm: 'round' }).map((c) => c.name)).toEqual([
      'Flinch',
    ])
    expect(filterConditionsForIndex(sampleConditions, {}).map((c) => c.name)).toEqual([
      'Burned',
      'Flinch',
      'Vulnerable',
    ])
  })
})
