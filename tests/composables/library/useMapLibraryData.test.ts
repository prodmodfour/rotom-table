import { describe, expect, it, vi } from 'vitest'
import { mapsChannel, type RealtimeEvent } from '#shared/realtime'
import { useMapLibraryData } from '~/composables/library/useMapLibraryData'
import type { MapSummary } from '~/types/map'

const makeSummary = (slug: string, folder = ''): MapSummary => ({
  slug,
  name: slug.replace(/-/g, ' '),
  folder,
  dimensions: { x: 10, y: 4, z: 8 },
  placementCount: 0,
  playerVisible: true,
  schemaVersion: 2,
})

describe('useMapLibraryData', () => {
  it('refreshes map summaries and folder paths through injected fetchers', async () => {
    const fetchMapList = vi.fn(async () => ({ maps: [makeSummary('atrium', 'guild')] }))
    const fetchMapFolders = vi.fn(async () => ({ folders: ['guild', 'archive'] }))

    const data = useMapLibraryData({
      clientId: 'client-a',
      autoRefreshOnMounted: false,
      subscribeRealtime: vi.fn(),
      fetchMapList,
      fetchMapFolders,
    })

    expect(data.loading.value).toBe(true)

    await data.refresh()

    expect(fetchMapList).toHaveBeenCalledTimes(1)
    expect(fetchMapFolders).toHaveBeenCalledTimes(1)
    expect(data.maps.get('atrium')).toEqual(makeSummary('atrium', 'guild'))
    expect([...data.extraFolders].sort()).toEqual(['archive', 'guild'])
    expect(data.loading.value).toBe(false)
    expect(data.loadError.value).toBeNull()
  })

  it('normalizes refresh errors and leaves existing data intact', async () => {
    const existing = makeSummary('old-map')
    const data = useMapLibraryData({
      clientId: 'client-a',
      autoRefreshOnMounted: false,
      subscribeRealtime: vi.fn(),
      fetchMapList: vi.fn(async () => {
        throw { data: { statusMessage: 'Could not load maps.' } }
      }),
      fetchMapFolders: vi.fn(async () => ({ folders: [] })),
    })
    data.maps.set(existing.slug, existing)
    data.extraFolders.add('existing-folder')

    await data.refresh()

    expect(data.loadError.value).toBe('Could not load maps.')
    expect(data.loading.value).toBe(false)
    expect(data.maps.get(existing.slug)).toEqual(existing)
    expect(data.extraFolders.has('existing-folder')).toBe(true)
  })

  it('subscribes to maps realtime events with client echo suppression', () => {
    let handler: (event: RealtimeEvent) => void = () => {
      throw new Error('Realtime handler was not registered')
    }
    const subscribeRealtime = vi.fn((next: (event: RealtimeEvent) => void) => {
      handler = next
    })

    const data = useMapLibraryData({
      clientId: 'client-a',
      autoRefreshOnMounted: false,
      subscribeRealtime,
      fetchMapList: vi.fn(async () => ({ maps: [] })),
      fetchMapFolders: vi.fn(async () => ({ folders: [] })),
    })

    expect(subscribeRealtime).toHaveBeenCalledTimes(1)
    expect(handler).toBeTruthy()

    handler({
      channel: mapsChannel,
      type: 'created',
      clientId: 'other-client',
      timestamp: 123,
      data: makeSummary('new-map', 'new-folder'),
    })
    expect(data.maps.get('new-map')?.folder).toBe('new-folder')

    handler({
      channel: mapsChannel,
      type: 'deleted',
      clientId: 'client-a',
      timestamp: 124,
      data: { slug: 'new-map' },
    })
    expect(data.maps.has('new-map')).toBe(true)
  })
})
