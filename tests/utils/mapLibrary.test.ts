import { describe, expect, it } from 'vitest'
import { mapsChannel, type RealtimeEvent } from '~/shared/realtime'
import {
  applyMapLibraryRealtimeEvent,
  buildMapFolderSet,
  deleteMapFolderFromLibrary,
  filterVisibleMaps,
  mapSummaryMatchesQuery,
  moveMapFolderInLibrary,
  tabletopMapToSummary,
  type MapLibraryCollections,
} from '~/utils/mapLibrary'
import type { MapSummary, TabletopMap } from '~/types/map'

const summary = (slug: string, folder = ''): MapSummary => ({
  slug,
  name: slug,
  folder,
  dimensions: { x: 10, y: 4, z: 10 },
  placementCount: 0,
  playerVisible: false,
  schemaVersion: 2,
})

const event = (type: string, data?: unknown, clientId = 'remote'): RealtimeEvent => ({
  channel: mapsChannel,
  type,
  data,
  clientId,
  timestamp: 123,
})

const collections = (): MapLibraryCollections => ({
  maps: new Map<string, MapSummary>([
    ['root', summary('root', '')],
    ['wild', summary('wild', 'npcs/wild')],
    ['cave', summary('cave', 'npcs/wild/cave')],
  ]),
  extraFolders: new Set(['npcs', 'npcs/wild', 'npcs/wild/cave', 'players']),
})

describe('mapLibrary helpers', () => {
  it('converts tabletop maps to list summaries', () => {
    const map: TabletopMap = {
      schemaVersion: 2,
      slug: 'atrium',
      name: 'Atrium',
      dimensions: { x: 20, y: 5, z: 20 },
      voxels: [],
      placements: [{ id: 'p1', sheetKind: 'pokemon', sheetSlug: 'bolt', position: { x: 1, y: 0, z: 2 } }],
      playerVisible: true,
      updatedAt: 456,
    }

    expect(tabletopMapToSummary(map)).toEqual({
      slug: 'atrium',
      name: 'Atrium',
      folder: '',
      dimensions: { x: 20, y: 5, z: 20 },
      placementCount: 1,
      playerVisible: true,
      schemaVersion: 2,
      updatedAt: 456,
    })
  })

  it('matches map summaries by normalized name or folder query', () => {
    const item = { ...summary('Greywater Aqueduct', 'helix/aqueduct'), name: 'Greywater Aqueduct' }

    expect(mapSummaryMatchesQuery(item, 'greywater')).toBe(true)
    expect(mapSummaryMatchesQuery(item, 'helix')).toBe(true)
    expect(mapSummaryMatchesQuery(item, 'atrium')).toBe(false)
  })

  it('builds map folder sets from summaries and explicit folders', () => {
    expect([...buildMapFolderSet([
      summary('root'),
      summary('wild', 'npcs/wild'),
    ], ['npcs', 'npcs/wild/cave'])].sort()).toEqual([
      'npcs',
      'npcs/wild',
      'npcs/wild/cave',
    ])
  })

  it('filters visible maps by current folder, subtree search, and name sorting', () => {
    const input = [
      { ...summary('b-root'), name: 'B Root' },
      { ...summary('a-root'), name: 'A Root' },
      { ...summary('child', 'npcs/wild'), name: 'Wild Child' },
      { ...summary('cave', 'npcs/wild/cave'), name: 'Cave Map' },
      { ...summary('other', 'players'), name: 'Player Map' },
    ]

    expect(filterVisibleMaps({ items: input, currentPath: '', searchTerm: '' }).map((item) => item.slug)).toEqual([
      'a-root',
      'b-root',
    ])
    expect(filterVisibleMaps({ items: input, currentPath: 'npcs', searchTerm: 'map' }).map((item) => item.slug)).toEqual([
      'cave',
    ])
    expect(filterVisibleMaps({ items: input, currentPath: 'npcs/wild', searchTerm: '' }).map((item) => item.slug)).toEqual([
      'child',
    ])
  })

  it('deletes map folders and descendant maps from local collections', () => {
    const state = collections()
    deleteMapFolderFromLibrary(state, 'npcs/wild')

    expect([...state.extraFolders].sort()).toEqual(['npcs', 'players'])
    expect([...state.maps.keys()].sort()).toEqual(['root'])
  })

  it('moves map folders through local folders and map summaries', () => {
    const state = collections()
    moveMapFolderInLibrary(state, 'npcs/wild', 'archive/wild')

    expect([...state.extraFolders].sort()).toEqual(['archive/wild', 'archive/wild/cave', 'npcs', 'players'])
    expect(state.maps.get('wild')?.folder).toBe('archive/wild')
    expect(state.maps.get('cave')?.folder).toBe('archive/wild/cave')
  })

  it('applies realtime create/update/move, rename, delete, and folder events', () => {
    const state = collections()
    expect(applyMapLibraryRealtimeEvent(state, event('updated', summary('new', 'players')), 'local')).toBe(true)
    expect(state.maps.get('new')?.folder).toBe('players')

    expect(applyMapLibraryRealtimeEvent(state, event('renamed', { oldSlug: 'new', summary: summary('newer') }), 'local')).toBe(true)
    expect(state.maps.has('new')).toBe(false)
    expect(state.maps.has('newer')).toBe(true)

    expect(applyMapLibraryRealtimeEvent(state, event('deleted', { slug: 'newer' }), 'local')).toBe(true)
    expect(state.maps.has('newer')).toBe(false)

    expect(applyMapLibraryRealtimeEvent(state, event('folder-created', { folder: 'archive' }), 'local')).toBe(true)
    expect(state.extraFolders.has('archive')).toBe(true)

    expect(applyMapLibraryRealtimeEvent(state, event('folder-moved', { from: 'npcs/wild', to: 'archive/wild' }), 'local')).toBe(true)
    expect(state.maps.get('cave')?.folder).toBe('archive/wild/cave')

    expect(applyMapLibraryRealtimeEvent(state, event('folder-deleted', { folder: 'archive/wild' }), 'local')).toBe(true)
    expect(state.maps.has('cave')).toBe(false)
  })

  it('ignores local echoes, wrong channels, and malformed payloads', () => {
    const state = collections()
    expect(applyMapLibraryRealtimeEvent(state, event('updated', summary('echo'), 'local'), 'local')).toBe(false)
    expect(applyMapLibraryRealtimeEvent(state, { ...event('updated', summary('wrong')), channel: 'map:wrong' }, 'local')).toBe(false)
    expect(applyMapLibraryRealtimeEvent(state, event('renamed', { oldSlug: 'root' }), 'local')).toBe(false)
    expect(state.maps.has('echo')).toBe(false)
    expect(state.maps.has('wrong')).toBe(false)
    expect(state.maps.has('root')).toBe(true)
  })
})
