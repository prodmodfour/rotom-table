import { describe, expect, it } from 'vitest'
import {
  matchesSearchExpression,
  normalizeSearchQuery,
  parseSearchExpression,
  toSearchCriterion,
  tokenizeSearchQuery,
} from '~/utils/pokedex/searchExpressions'

describe('pokedex search expression helpers', () => {
  it('normalizes boolean query syntax without breaking hyphenated terms', () => {
    expect(normalizeSearchQuery('  Flabébé — Fairy  ')).toBe('flabebe fairy')
    expect(normalizeSearchQuery('Fire - Gen 1')).toBe('fire not gen 1')
    expect(normalizeSearchQuery('Jangmo-o')).toBe('jangmo-o')
  })

  it('tokenizes grouping and boolean operators', () => {
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

  it('builds criteria with compact aliases for spaced queries', () => {
    expect(toSearchCriterion('Thunder Punch')).toEqual({
      kind: 'criterion',
      query: 'thunder punch',
      compactQuery: 'thunderpunch',
    })
    expect(toSearchCriterion('   ')).toBeNull()
  })

  it('parses implicit AND with OR precedence and NOT expressions', () => {
    const expression = parseSearchExpression('fire (thunder punch or -water)')
    expect(expression).toEqual({
      kind: 'and',
      left: { kind: 'criterion', query: 'fire', compactQuery: 'fire' },
      right: {
        kind: 'or',
        left: { kind: 'criterion', query: 'thunder punch', compactQuery: 'thunderpunch' },
        right: { kind: 'not', expression: { kind: 'criterion', query: 'water', compactQuery: 'water' } },
      },
    })
  })

  it('matches parsed expressions against normalized search text', () => {
    const expression = parseSearchExpression('fire (thunder punch or -water)')
    expect(expression).not.toBeNull()
    expect(matchesSearchExpression('fire thunderpunch', expression!)).toBe(true)
    expect(matchesSearchExpression('fire water', expression!)).toBe(false)
    expect(matchesSearchExpression('ice thunderpunch', expression!)).toBe(false)
  })
})
