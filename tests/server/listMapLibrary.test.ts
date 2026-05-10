import { describe, expect, it, vi } from 'vitest'
import type { MapSummary } from '../../types/map'
import {
  canListMapSummary,
  listMapFoldersUseCase,
  listMapSummariesUseCase,
} from '../../server/useCases/listMapLibrary'

const publicSummary: MapSummary = {
  slug: 'public-map',
  name: 'Public Map',
  folder: 'helix',
  dimensions: { x: 10, y: 4, z: 10 },
  placementCount: 2,
  playerVisible: true,
  schemaVersion: 2,
  updatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
}

const hiddenSummary: MapSummary = {
  ...publicSummary,
  slug: 'hidden-map',
  name: 'Hidden Map',
  playerVisible: false,
}

describe('map library list use cases', () => {
  it('returns every map summary to GMs without re-sorting or reshaping', () => {
    const summaries = [hiddenSummary, publicSummary]
    const listMapSummaries = vi.fn(() => summaries)

    const result = listMapSummariesUseCase({ role: 'gm' }, { listMapSummaries })

    expect(result).toEqual({ maps: summaries })
    expect(result.maps).toBe(summaries)
    expect(listMapSummaries).toHaveBeenCalledOnce()
  })

  it('filters player map summaries to player-visible maps only', () => {
    const summaries = [hiddenSummary, publicSummary]

    expect(canListMapSummary('player', publicSummary)).toBe(true)
    expect(canListMapSummary('player', hiddenSummary)).toBe(false)
    expect(canListMapSummary('gm', hiddenSummary)).toBe(true)
    expect(listMapSummariesUseCase({ role: 'player' }, {
      listMapSummaries: () => summaries,
    })).toEqual({ maps: [publicSummary] })
  })

  it('lists map folders for GMs', () => {
    const folders = ['helix', 'helix/lab']
    const listFolders = vi.fn(() => folders)

    const result = listMapFoldersUseCase({ role: 'gm' }, { listFolders })

    expect(result).toEqual({ folders })
    expect(result.folders).toBe(folders)
    expect(listFolders).toHaveBeenCalledOnce()
  })

  it('hides map folders from players without touching storage', () => {
    const listFolders = vi.fn(() => ['secret'])

    expect(listMapFoldersUseCase({ role: 'player' }, { listFolders })).toEqual({ folders: [] })
    expect(listFolders).not.toHaveBeenCalled()
  })
})
