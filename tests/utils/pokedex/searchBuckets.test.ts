import { describe, expect, it } from 'vitest'
import {
  addSearchValue,
  addSearchValuesToBucket,
  buildSearchText,
  buildSearchTextsFromBuckets,
  createSearchBuckets,
  normalizeSearchText,
} from '~/utils/pokedex/searchBuckets'

describe('pokedex search bucket primitives', () => {
  it('normalizes text for accent-insensitive compact searching', () => {
    expect(normalizeSearchText("Farfetch’d #083!")).toBe('farfetchd #083')
    expect(buildSearchText(['Thunder Punch', 'TM 35', 'Thunder Punch'])).toBe('thunder punch thunderpunch tm 35 tm35')
  })

  it('ignores nullish and blank values when adding raw bucket values', () => {
    const values: string[] = []

    addSearchValue(values, null)
    addSearchValue(values, undefined)
    addSearchValue(values, '  ')
    addSearchValue(values, 25)
    addSearchValue(values, ' Pikachu ')

    expect(values).toEqual(['25', 'Pikachu'])
  })

  it('adds field-specific values to an aggregate bucket', () => {
    const buckets = createSearchBuckets(['any', 'move', 'type'] as const)

    addSearchValuesToBucket(buckets, 'move', 'any', 'Thunder Punch', null, 'TM 35')
    addSearchValuesToBucket(buckets, 'type', null, 'Electric')

    expect(buildSearchTextsFromBuckets(['any', 'move', 'type'] as const, buckets)).toEqual({
      any: 'thunder punch thunderpunch tm 35 tm35',
      move: 'thunder punch thunderpunch tm 35 tm35',
      type: 'electric',
    })
  })
})
