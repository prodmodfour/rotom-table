import { describe, expect, it } from 'vitest'
import type { PtuCapability } from '~/types/ptuReference'
import {
  capabilitySearchHaystack,
  filterCapabilities,
  matchesCapabilityQuery,
} from '~/utils/reference/capabilityIndex'
import { normalizeReferenceSearch } from '~/utils/reference/search'

const capabilities: PtuCapability[] = [
  { name: 'Threaded', effect: 'May use Threaded movement.' },
  { name: 'Naturewalk', effect: 'Ignores Slow Terrain in listed environments.' },
  { name: 'Zapper' },
]

describe('capability index helpers', () => {
  it('builds search haystacks from capability names and effects', () => {
    expect(capabilitySearchHaystack(capabilities[0])).toEqual([
      'Threaded',
      'May use Threaded movement.',
    ])
    expect(capabilitySearchHaystack(capabilities[2])).toEqual(['Zapper', ''])
  })

  it('matches normalized queries against names and effects', () => {
    expect(matchesCapabilityQuery(capabilities[1], normalizeReferenceSearch('slow terrain'))).toBe(true)
    expect(matchesCapabilityQuery(capabilities[0], normalizeReferenceSearch('thread'))).toBe(true)
    expect(matchesCapabilityQuery(capabilities[2], normalizeReferenceSearch('terrain'))).toBe(false)
  })

  it('filters capabilities while preserving source order', () => {
    expect(filterCapabilities(capabilities, 'terrain').map((capability) => capability.name)).toEqual([
      'Naturewalk',
    ])
    expect(filterCapabilities(capabilities, '').map((capability) => capability.name)).toEqual([
      'Threaded',
      'Naturewalk',
      'Zapper',
    ])
  })
})
