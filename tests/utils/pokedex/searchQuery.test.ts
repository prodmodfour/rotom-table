import { describe, expect, it } from 'vitest'
import {
  matchesActiveSearchFilters,
  matchesSearchExpression,
  normalizeSearchQuery,
  parseSearchExpression,
  tokenizeSearchQuery,
  type ActiveSearchFilter,
} from '~/utils/pokedex/searchQuery'

describe('pokedex search query helpers', () => {
  it('normalizes dash exclusions while preserving hyphenated terms', () => {
    expect(normalizeSearchQuery('Fire - Gen 1')).toBe('fire not gen 1')
    expect(normalizeSearchQuery('Jangmo-o')).toBe('jangmo-o')
  })

  it('tokenizes boolean operators and grouping', () => {
    expect(tokenizeSearchQuery('fire and (water or not grass)')).toEqual([
      { kind: 'term', value: 'fire' },
      { kind: 'and' },
      { kind: 'open' },
      { kind: 'term', value: 'water' },
      { kind: 'or' },
      { kind: 'not' },
      { kind: 'term', value: 'grass' },
      { kind: 'close' },
    ])
  })

  it('matches implicit AND, OR, NOT, and compact aliases', () => {
    const expression = parseSearchExpression('fire (thunder punch or -water)')
    expect(expression).not.toBeNull()
    expect(matchesSearchExpression('fire thunderpunch', expression!)).toBe(true)
    expect(matchesSearchExpression('fire water', expression!)).toBe(false)
    expect(matchesSearchExpression('ice thunderpunch', expression!)).toBe(false)
  })

  it('combines field filters with stored filter operators', () => {
    const filters: ActiveSearchFilter[] = [
      { key: 'type', expression: parseSearchExpression('fire')!, operator: 'and' },
      { key: 'ability', expression: parseSearchExpression('intimidate')!, operator: 'or' },
      { key: 'move', expression: parseSearchExpression('surf')!, operator: 'and' },
    ]

    expect(matchesActiveSearchFilters({
      searchTexts: {
        any: '',
        identity: '',
        type: 'water',
        ability: 'intimidate',
        capability: '',
        move: 'surf',
        habitat: '',
        breeding: '',
        diet: '',
        skill: '',
        stat: '',
        size: '',
      },
    }, filters)).toBe(true)

    expect(matchesActiveSearchFilters({
      searchTexts: {
        any: '',
        identity: '',
        type: 'water',
        ability: 'intimidate',
        capability: '',
        move: 'tackle',
        habitat: '',
        breeding: '',
        diet: '',
        skill: '',
        stat: '',
        size: '',
      },
    }, filters)).toBe(false)
  })
})
