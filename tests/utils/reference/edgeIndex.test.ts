import { describe, expect, it } from 'vitest'
import { edgeMatchesSearch, filterEdgesForIndex } from '~/utils/reference/edgeIndex'
import type { PtuEdge } from '~/types/ptuReference'

const edge = (overrides: Partial<PtuEdge> & Pick<PtuEdge, 'name'>): PtuEdge => ({
  name: overrides.name,
  tags: overrides.tags ?? [],
  prerequisites: overrides.prerequisites,
  effect: overrides.effect,
})

const sampleEdges: PtuEdge[] = [
  edge({
    name: 'Basic Skills',
    prerequisites: 'Novice General Education',
    effect: 'Gain a Skill Edge.',
  }),
  edge({
    name: 'Medic Training',
    prerequisites: 'Adept Medicine Education',
    effect: 'You may treat injuries during rest.',
  }),
  edge({
    name: 'Weapon of Choice',
    prerequisites: 'Novice Combat',
    effect: 'Choose one weapon category and gain bonuses.',
  }),
]

describe('edge index helpers', () => {
  it('matches edge search haystacks', () => {
    expect(edgeMatchesSearch(sampleEdges[0]!, 'general education')).toBe(true)
    expect(edgeMatchesSearch(sampleEdges[1]!, 'injuries')).toBe(true)
    expect(edgeMatchesSearch(sampleEdges[2]!, 'weapon')).toBe(true)
    expect(edgeMatchesSearch(sampleEdges[2]!, 'missing')).toBe(false)
  })

  it('filters by search term while preserving source order', () => {
    expect(filterEdgesForIndex(sampleEdges, { searchTerm: 'novice' }).map((e) => e.name)).toEqual([
      'Basic Skills',
      'Weapon of Choice',
    ])
    expect(filterEdgesForIndex(sampleEdges, { searchTerm: 'medicine' }).map((e) => e.name)).toEqual([
      'Medic Training',
    ])
    expect(filterEdgesForIndex(sampleEdges, {}).map((e) => e.name)).toEqual([
      'Basic Skills',
      'Medic Training',
      'Weapon of Choice',
    ])
  })
})
