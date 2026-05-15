import { describe, expect, it } from 'vitest'
import { findFeature } from '~~/data/ptuReference'

describe('PTU feature reference data', () => {
  it('exposes Terrain Talent as a Survivalist feature', () => {
    const terrainTalent = findFeature('Terrain Talent')

    expect(terrainTalent).toMatchObject({
      name: 'Terrain Talent',
      className: 'Survivalist',
      frequency: 'Static',
    })
    expect(terrainTalent?.tags).toContain('Ranked 2')
    expect(terrainTalent?.tags).toContain('+HP')
  })

  it('does not merge Terrain Talent into Wilderness Guide', () => {
    const wildernessGuide = findFeature('Wilderness Guide')

    expect(wildernessGuide?.effect).not.toContain('Terrain Talent')
  })
})
