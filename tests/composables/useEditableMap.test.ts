import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { useEditableMap } from '~/composables/useEditableMap'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import type { RealtimeEvent } from '#shared/realtime'
import type { TabletopMap } from '~/types/map'

const apiMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  realtimeHandlers: [] as Array<(event: RealtimeEvent) => void>,
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    getJson: apiMocks.getJson,
    postJson: apiMocks.postJson,
  }),
}))

vi.mock('~/composables/useRealtime', () => ({
  useRealtimeChannel: vi.fn((_channel: string, handler: (event: RealtimeEvent) => void) => {
    apiMocks.realtimeHandlers.push(handler)
    return vi.fn()
  }),
}))

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-pikachu',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
  ...overrides,
})

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useEditableMap autosave boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMocks.getJson.mockReset()
    apiMocks.postJson.mockReset()
    apiMocks.realtimeHandlers.length = 0
    apiMocks.getJson.mockResolvedValue({ map: mapFixture() })
    apiMocks.postJson.mockImplementation(async (_request: string, body: { map: TabletopMap }) => ({
      map: { ...body.map, updatedAt: 200 },
    }))
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('autosaves whole-map edits through local-first persistence when enabled', async () => {
    const autosaveEnabled = ref(true)
    const editable = useEditableMap('arena-map', { debounceMs: 10, autosaveEnabled })
    await flushPromises()

    editable.map.value!.name = 'Renamed Arena'
    await nextTick()

    expect(editable.status.value).toBe('saving')
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.save, {
      slug: 'arena-map',
      map: expect.objectContaining({ name: 'Renamed Arena' }),
      clientId: 'ssr',
    })
    expect(editable.status.value).toBe('saved')
    expect(editable.map.value?.updatedAt).toBe(200)
  })

  it('increments a map data revision for full persisted replacements without treating autosave as a reload', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    expect(editable.mapDataRevision.value).toBe(1)

    editable.map.value!.name = 'Autosaved Arena'
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(editable.map.value?.updatedAt).toBe(200)
    expect(editable.mapDataRevision.value).toBe(1)

    editable.applyPersistedMap(mapFixture({ name: 'Document-backed Arena', updatedAt: 250 }))

    expect(editable.map.value?.name).toBe('Document-backed Arena')
    expect(editable.mapDataRevision.value).toBe(2)
  })

  it('includes the selected player profile id in whole-map save requests when available', async () => {
    const playerProfileId = ref(parsePlayerProfileId('profile_ash00000'))
    const editable = useEditableMap('arena-map', { debounceMs: 10, playerProfileId })
    await flushPromises()

    editable.map.value!.placements[0]!.position = { x: 2, y: 0, z: 1 }
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.save, {
      slug: 'arena-map',
      map: expect.objectContaining({
        placements: [expect.objectContaining({ position: { x: 2, y: 0, z: 1 } })],
      }),
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    })
  })

  it('adopts document-backed token action responses without scheduling another whole-map save', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    editable.applyPersistedMap(mapFixture({
      placements: [
        {
          id: 'token-pikachu',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
          position: { x: 3, y: 0, z: 2 },
          facing: 'south-east',
          turned: false,
        },
      ],
      updatedAt: 250,
    }))
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(editable.map.value?.placements[0]?.position).toEqual({ x: 3, y: 0, z: 2 })
    expect(editable.map.value?.updatedAt).toBe(250)
    expect(apiMocks.postJson).not.toHaveBeenCalled()
    expect(editable.status.value).toBe('idle')
  })

  it('applies non-echo realtime map updates without echo-saving through whole-map autosave', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      clientId: 'other-tab',
      timestamp: 300,
      data: mapFixture({
        placements: [
          {
            id: 'token-pikachu',
            sheetKind: 'pokemon',
            sheetSlug: 'pikachu',
            position: { x: 4, y: 0, z: 2 },
            facing: 'north-west',
            turned: true,
          },
        ],
        updatedAt: 300,
      }),
    })
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(editable.map.value?.placements[0]).toMatchObject({
      position: { x: 4, y: 0, z: 2 },
      facing: 'north-west',
      turned: true,
    })
    expect(editable.map.value?.updatedAt).toBe(300)
    expect(editable.status.value).toBe('idle')
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('drops own realtime echoes so a local tab does not overwrite itself', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      clientId: 'ssr',
      timestamp: 300,
      data: mapFixture({ name: 'Echoed Arena', updatedAt: 300 }),
    })
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(editable.map.value?.name).toBe('Arena Map')
    expect(editable.map.value?.updatedAt).toBe(100)
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('cancels pending dirty saves when another viewer publishes an authoritative map update', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    editable.map.value!.name = 'Locally queued rename'
    await nextTick()
    expect(editable.status.value).toBe('saving')

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      clientId: 'other-tab',
      timestamp: 400,
      data: mapFixture({ name: 'Remote authoritative rename', updatedAt: 400 }),
    })
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(editable.map.value?.name).toBe('Remote authoritative rename')
    expect(editable.map.value?.updatedAt).toBe(400)
    expect(editable.status.value).toBe('idle')
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('ignores stale realtime map updates that arrive after a newer saved map', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      clientId: 'other-tab',
      timestamp: 500,
      data: mapFixture({ name: 'Newer Arena', updatedAt: 500 }),
    })
    await nextTick()

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      clientId: 'other-tab',
      timestamp: 450,
      data: mapFixture({ name: 'Older Arena', updatedAt: 450 }),
    })
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(editable.map.value?.name).toBe('Newer Arena')
    expect(editable.map.value?.updatedAt).toBe(500)
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('pauses whole-map autosave while disabled and resumes it for local-first editing', async () => {
    const autosaveEnabled = ref(false)
    const editable = useEditableMap('arena-map', { debounceMs: 10, autosaveEnabled })
    await flushPromises()

    editable.map.value!.placements[0]!.position = { x: 2, y: 0, z: 1 }
    await nextTick()
    await vi.advanceTimersByTimeAsync(25)
    await flushPromises()

    expect(apiMocks.postJson).not.toHaveBeenCalled()
    expect(editable.status.value).toBe('idle')

    await editable.saveNow()
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    autosaveEnabled.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.save, {
      slug: 'arena-map',
      map: expect.objectContaining({
        placements: [expect.objectContaining({ position: { x: 2, y: 0, z: 1 } })],
      }),
      clientId: 'ssr',
    })
  })
})
