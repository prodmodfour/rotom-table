import { describe, expect, it } from 'vitest'
import {
  buildFeatureTagCounts,
  featureMatchesSearch,
  filterFeaturesForIndex,
  toggledFeatureTag,
} from '~/utils/reference/featureIndex'
import type { PtuFeature } from '~/types/ptuReference'

const feature = (overrides: Partial<PtuFeature> & Pick<PtuFeature, 'name'>): PtuFeature => ({
  name: overrides.name,
  tags: overrides.tags ?? [],
  prerequisites: overrides.prerequisites,
  frequency: overrides.frequency,
  trigger: overrides.trigger,
  target: overrides.target,
  condition: overrides.condition,
  effect: overrides.effect,
  className: overrides.className,
})

const sampleFeatures: PtuFeature[] = [
  feature({
    name: 'Ace Trainer',
    tags: ['Class', 'Ranked 2'],
    prerequisites: 'Novice Command',
    className: 'Ace Trainer',
    effect: 'You become an Ace Trainer.',
  }),
  feature({
    name: 'Agility Training',
    tags: ['Training', 'Orders'],
    frequency: 'At-Will – Extended Action',
    target: 'Your Pokémon',
    effect: 'The target becomes Agile.',
  }),
  feature({
    name: 'Type Ace',
    tags: ['Class', 'Branch'],
    prerequisites: 'Elemental Connection',
    className: 'Type Ace',
    effect: 'Pick one Pokémon Type.',
  }),
  feature({
    name: 'Inspired Orders',
    tags: ['Orders'],
    trigger: 'You give orders',
    effect: 'An ally gains bonuses.',
  }),
]

describe('feature index helpers', () => {
  it('counts feature tags by frequency then name', () => {
    expect(buildFeatureTagCounts(sampleFeatures)).toEqual([
      { tag: 'Class', count: 2 },
      { tag: 'Orders', count: 2 },
      { tag: 'Branch', count: 1 },
      { tag: 'Ranked 2', count: 1 },
      { tag: 'Training', count: 1 },
    ])
  })

  it('matches feature search haystacks', () => {
    expect(featureMatchesSearch(sampleFeatures[0]!, 'command')).toBe(true)
    expect(featureMatchesSearch(sampleFeatures[1]!, 'agile')).toBe(true)
    expect(featureMatchesSearch(sampleFeatures[2]!, 'type ace')).toBe(true)
    expect(featureMatchesSearch(sampleFeatures[3]!, 'missing')).toBe(false)
  })

  it('filters by tag and search term', () => {
    expect(filterFeaturesForIndex(sampleFeatures, { tag: 'Class' }).map((f) => f.name)).toEqual([
      'Ace Trainer',
      'Type Ace',
    ])
    expect(filterFeaturesForIndex(sampleFeatures, { searchTerm: 'orders' }).map((f) => f.name)).toEqual([
      'Inspired Orders',
    ])
    expect(filterFeaturesForIndex(sampleFeatures, { tag: 'Orders', searchTerm: 'ally' }).map((f) => f.name)).toEqual([
      'Inspired Orders',
    ])
  })

  it('toggles the active tag filter', () => {
    expect(toggledFeatureTag(null, 'Class')).toBe('Class')
    expect(toggledFeatureTag('Orders', 'Class')).toBe('Class')
    expect(toggledFeatureTag('Class', 'Class')).toBeNull()
  })
})
