import { describe, expect, it } from 'vitest'
import type { MapSummary, TabletopMap } from '../../types/map'
import { compareMapSummaries, sortMapSummaries, summarizeMap } from '../../server/utils/mapSummaries'

const makeMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'city-square',
  name: 'City Square',
  folder: 'helix/maps',
  dimensions: { x: 10, y: 4, z: 8 },
  placements: [
    {
      id: 'token-1',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
    },
  ],
  voxels: [],
  playerVisible: true,
  updatedAt: 123,
  ...overrides,
})

describe('map summary helpers', () => {
  it('summarizes map documents with compatible folder/count/visibility fields', () => {
    expect(summarizeMap(makeMap())).toEqual({
      slug: 'city-square',
      name: 'City Square',
      folder: 'helix/maps',
      dimensions: { x: 10, y: 4, z: 8 },
      placementCount: 1,
      playerVisible: true,
      schemaVersion: 2,
      updatedAt: 123,
    })

    const rootMap = makeMap({ placements: [], playerVisible: false })
    delete rootMap.folder
    const rootSummary = summarizeMap(rootMap)
    expect(rootSummary.folder).toBe('')
    expect(rootSummary.placementCount).toBe(0)
    expect(rootSummary.playerVisible).toBe(false)
  })

  it('sorts summaries by folder and then display name without mutating the input array', () => {
    const summaries: MapSummary[] = [
      { slug: 'z', name: 'Zoo', folder: 'beta', dimensions: { x: 1, y: 1, z: 1 }, placementCount: 0 },
      { slug: 'b', name: 'Baker', folder: 'alpha', dimensions: { x: 1, y: 1, z: 1 }, placementCount: 0 },
      { slug: 'a', name: 'Atrium', folder: 'alpha', dimensions: { x: 1, y: 1, z: 1 }, placementCount: 0 },
    ]

    expect(sortMapSummaries(summaries).map((summary) => summary.slug)).toEqual(['a', 'b', 'z'])
    expect(summaries.map((summary) => summary.slug)).toEqual(['z', 'b', 'a'])
    expect(compareMapSummaries(summaries[1]!, summaries[2]!)).toBeGreaterThan(0)
  })
})
