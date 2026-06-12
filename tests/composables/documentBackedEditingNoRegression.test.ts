import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { mapChannel, sheetChannel } from '#shared/realtime'
import { useEditableMap } from '~/composables/useEditableMap'
import { useEditableSheet } from '~/composables/useEditableSheet'
import { MAP_API_PATHS, SHEET_API_PATHS } from '~/utils/apiRoutes'
import { mapEditorPath, mapLibraryPath } from '~/utils/mapRoutes'
import { sheetEditorPath, sheetLibraryPath } from '~/utils/sheetRoutes'
import type { TabletopMap } from '~/types/map'

const localMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  mapSubscriptions: [] as Array<{ channel: string; handler: (event: unknown) => void }>,
  sheetSubscriptions: [] as Array<{ channel: string; handler: (event: unknown) => void }>,
  addWindowListener: vi.fn(),
  removeWindowListener: vi.fn(),
}))

vi.mock('~/utils/clientId', () => ({
  getClientId: () => 'local-client',
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    getJson: localMocks.getJson,
    postJson: localMocks.postJson,
  }),
}))

vi.mock('~/composables/useRealtime', () => ({
  subscribeRealtimeConnection: vi.fn(() => vi.fn()),
  useRealtimeChannel: vi.fn((channel: string, handler: (event: unknown) => void) => {
    localMocks.mapSubscriptions.push({ channel, handler })
    return vi.fn()
  }),
  subscribeChannel: vi.fn((channel: string, handler: (event: unknown) => void) => {
    localMocks.sheetSubscriptions.push({ channel, handler })
    return vi.fn()
  }),
}))

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'local-arena',
  name: 'Local Arena',
  dimensions: { x: 5, y: 2, z: 5 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
  ...overrides,
})

interface LocalPokemonSheet {
  slug: string
  nickname: string
  level: number
}

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('document-backed editing no-regression boundaries', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localMocks.getJson.mockReset()
    localMocks.postJson.mockReset()
    localMocks.mapSubscriptions.length = 0
    localMocks.sheetSubscriptions.length = 0
    localMocks.addWindowListener.mockReset()
    localMocks.removeWindowListener.mockReset()
    localMocks.getJson.mockResolvedValue({ map: mapFixture() })
    localMocks.postJson.mockImplementation(async (path: string, body: { map?: TabletopMap; sheet?: LocalPokemonSheet }) => {
      if (path === MAP_API_PATHS.save && body.map) {
        return { map: { ...body.map, updatedAt: 200 } }
      }
      if (path === SHEET_API_PATHS.save && body.sheet) {
        return { ok: true, sheet: { ...body.sheet } }
      }
      return { ok: true }
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps plain map editing on local autosave and legacy realtime when session hosting is absent', async () => {
    const editable = useEditableMap('local-arena', {
      debounceMs: 10,
      interactionMode: { value: MAP_INTERACTION_MODES.SETUP_EDIT },
    })
    await flushPromises()

    expect(localMocks.getJson).toHaveBeenCalledWith(MAP_API_PATHS.load, { params: { slug: 'local-arena' } })
    expect(localMocks.mapSubscriptions.map((subscription) => subscription.channel)).toEqual([
      mapChannel('local-arena'),
    ])

    editable.map.value!.name = 'Local Arena Revised'
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(localMocks.postJson).toHaveBeenCalledTimes(1)
    expect(localMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.save, {
      slug: 'local-arena',
      map: expect.objectContaining({ name: 'Local Arena Revised' }),
      clientId: 'local-client',
      interactionMode: 'setup-edit',
    })
    expect(localMocks.postJson.mock.calls.flat().join(' ')).not.toContain('/api/sessions')
    expect(localMocks.mapSubscriptions.map((subscription) => subscription.channel).join(' ')).not.toContain(
      '/api/sessions/socket',
    )
  })

  it('keeps plain sheet editing on local autosave and legacy realtime when session hosting is absent', async () => {
    vi.stubGlobal('window', {
      addEventListener: localMocks.addWindowListener,
      removeEventListener: localMocks.removeWindowListener,
    })

    const editable = useEditableSheet<LocalPokemonSheet>(
      { slug: 'local-pikachu', nickname: 'local pikachu', level: 5 },
      'pokemon',
      { debounceMs: 10 },
    )

    expect(localMocks.sheetSubscriptions.map((subscription) => subscription.channel)).toEqual([
      sheetChannel('pokemon', 'local-pikachu'),
    ])
    expect(localMocks.addWindowListener).toHaveBeenCalledWith('pagehide', expect.any(Function))
    expect(localMocks.addWindowListener).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    editable.sheet.value.level = 6
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(localMocks.postJson).toHaveBeenCalledTimes(1)
    expect(localMocks.postJson).toHaveBeenCalledWith(SHEET_API_PATHS.save, {
      kind: 'pokemon',
      slug: 'local-pikachu',
      sheet: { revision: 0, slug: 'local-pikachu', nickname: 'local pikachu', level: 6 },
      clientId: 'local-client',
      allowSlugSync: false,
    })
    expect(localMocks.postJson.mock.calls.flat().join(' ')).not.toContain('/api/sessions')
    expect(localMocks.sheetSubscriptions.map((subscription) => subscription.channel).join(' ')).not.toContain(
      '/api/sessions/socket',
    )
  })

  it('keeps normal map and sheet navigation free of session query links', () => {
    expect(mapLibraryPath()).toBe('/maps')
    expect(mapEditorPath('table map')).toBe('/maps/table%20map')
    expect(sheetLibraryPath()).toBe('/sheets')
    expect(sheetEditorPath('pokemon', 'pika chu')).toBe('/sheets/pika%20chu')
    expect(sheetEditorPath('trainer', 'misty/kanto')).toBe('/sheets/trainers/misty%2Fkanto')

    expect(mapEditorPath('table map')).not.toContain('?session=1')
    expect(sheetEditorPath('pokemon', 'pika chu')).not.toContain('?session=1')
  })
})
