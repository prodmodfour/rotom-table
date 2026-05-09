import { describe, expect, it } from 'vitest'
import {
  buildRuleCategoryCounts,
  filterRulesForIndex,
  groupRulesForIndex,
  ruleMatchesSearch,
  toggledRuleCategory,
} from '~/utils/reference/ruleIndex'
import type { PtuRule } from '~/types/ptuReference'

const rule = (overrides: Partial<PtuRule> & Pick<PtuRule, 'name' | 'category'>): PtuRule => ({
  name: overrides.name,
  category: overrides.category,
  text: overrides.text,
  aliases: overrides.aliases,
  source: overrides.source,
  statPointFormulas: overrides.statPointFormulas,
})

const sampleRules: PtuRule[] = [
  rule({
    name: 'Action Types',
    category: 'Combat',
    text: 'Trainers and Pokémon spend Standard Actions.',
    aliases: ['Actions'],
  }),
  rule({
    name: 'Injuries',
    category: 'Combat',
    source: 'Core',
    text: 'Injuries reduce maximum Hit Points.',
  }),
  rule({
    name: 'Experience',
    category: 'Advancement',
    text: 'Award EXP after encounters.',
  }),
  rule({
    name: 'Travel Speeds',
    category: 'Exploration',
    text: 'Overland movement depends on terrain.',
  }),
]

describe('rule index helpers', () => {
  it('counts rule categories by frequency then name', () => {
    expect(buildRuleCategoryCounts(sampleRules)).toEqual([
      { category: 'Combat', count: 2 },
      { category: 'Advancement', count: 1 },
      { category: 'Exploration', count: 1 },
    ])
  })

  it('matches rule search haystacks', () => {
    expect(ruleMatchesSearch(sampleRules[0]!, 'standard')).toBe(true)
    expect(ruleMatchesSearch(sampleRules[0]!, 'actions')).toBe(true)
    expect(ruleMatchesSearch(sampleRules[1]!, 'core')).toBe(true)
    expect(ruleMatchesSearch(sampleRules[2]!, 'missing')).toBe(false)
  })

  it('filters by category and search term', () => {
    expect(filterRulesForIndex(sampleRules, { category: 'Combat' }).map((r) => r.name)).toEqual([
      'Action Types',
      'Injuries',
    ])
    expect(filterRulesForIndex(sampleRules, { searchTerm: 'terrain' }).map((r) => r.name)).toEqual([
      'Travel Speeds',
    ])
    expect(filterRulesForIndex(sampleRules, { category: 'Combat', searchTerm: 'hit points' }).map((r) => r.name)).toEqual([
      'Injuries',
    ])
  })

  it('groups filtered rules alphabetically by category', () => {
    expect(groupRulesForIndex([sampleRules[0]!, sampleRules[2]!, sampleRules[3]!])).toEqual([
      { category: 'Advancement', entries: [sampleRules[2]!] },
      { category: 'Combat', entries: [sampleRules[0]!] },
      { category: 'Exploration', entries: [sampleRules[3]!] },
    ])
  })

  it('toggles the active category filter', () => {
    expect(toggledRuleCategory(null, 'Combat')).toBe('Combat')
    expect(toggledRuleCategory('Advancement', 'Combat')).toBe('Combat')
    expect(toggledRuleCategory('Combat', 'Combat')).toBeNull()
  })
})
