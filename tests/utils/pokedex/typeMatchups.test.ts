import { describe, expect, it } from 'vitest'
import {
  buildTypeMatchupGroups,
  computePtuTypeMultiplier,
  formatPtuMultiplier,
} from '~/utils/pokedex/typeMatchups'

describe('pokedex type matchup helpers', () => {
  it('uses PTU effectiveness-step multipliers for one and two defending types', () => {
    expect(computePtuTypeMultiplier('Fire', ['Grass'])).toBe(1.5)
    expect(computePtuTypeMultiplier('Fire', ['Grass', 'Ice'])).toBe(2)
    expect(computePtuTypeMultiplier('Fire', ['Water'])).toBe(0.5)
    expect(computePtuTypeMultiplier('Fire', ['Water', 'Rock'])).toBe(0.25)
    expect(computePtuTypeMultiplier('Ground', ['Flying'])).toBe(0)
  })

  it('formats PTU multiplier labels', () => {
    expect(formatPtuMultiplier(0)).toBe('0')
    expect(formatPtuMultiplier(0.125)).toBe('1/8')
    expect(formatPtuMultiplier(0.25)).toBe('1/4')
    expect(formatPtuMultiplier(0.5)).toBe('1/2')
    expect(formatPtuMultiplier(1.5)).toBe('1.5')
  })

  it('groups weaknesses, resistances, and immunities for display', () => {
    const groups = buildTypeMatchupGroups(['Ghost'])

    expect(groups.find((group) => group.key === 'weaknesses')?.items.map((item) => item.type)).toEqual(['Ghost', 'Dark'])
    expect(groups.find((group) => group.key === 'resistances')?.items.map((item) => item.type)).toContain('Bug')
    expect(groups.find((group) => group.key === 'immunities')?.items.map((item) => item.type)).toEqual(['Normal', 'Fighting'])
    expect(buildTypeMatchupGroups(['Unknown'])).toEqual([])
  })
})
