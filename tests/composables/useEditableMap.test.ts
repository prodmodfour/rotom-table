import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import { useEditableMap } from '~/composables/useEditableMap'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES, LIVE_PLAY_PATCH_TYPES } from '#shared/livePlayCommands'
import { LIVE_PLAY_REALTIME_EVENT_TYPES, type RealtimeEvent } from '#shared/realtime'
import type { LivePlayLocalPrediction } from '~/utils/livePlayPredictions'
import type { TabletopMap } from '~/types/map'

const apiMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  realtimeHandlers: [] as Array<(event: RealtimeEvent) => void>,
  connectionHandlers: [] as Array<(change: {
    state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'replaying'
    previousState: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'replaying'
    reconnected: boolean
    reason?: string
    reconciliation?: { reason: 'gap' | 'ahead'; requestedAfterSequence: number; earliestAvailableSequence: number; latestSequence: number }
  }) => void>,
}))

vi.mock('~/utils/clientId', () => ({
  getClientId: () => 'map-client',
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    getJson: apiMocks.getJson,
    postJson: apiMocks.postJson,
  }),
}))

vi.mock('~/composables/useRealtime', () => ({
  subscribeRealtimeConnection: vi.fn((handler: (change: {
    state: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'replaying'
    previousState: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'replaying'
    reconnected: boolean
    reason?: string
    reconciliation?: { reason: 'gap' | 'ahead'; requestedAfterSequence: number; earliestAvailableSequence: number; latestSequence: number }
  }) => void) => {
    apiMocks.connectionHandlers.push(handler)
    return vi.fn()
  }),
  useRealtimeChannel: vi.fn((_channel: string, handler: (event: RealtimeEvent) => void) => {
    apiMocks.realtimeHandlers.push(handler)
    return vi.fn()
  }),
}))

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 1,
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

const acceptedCommandEvent = (overrides: Partial<RealtimeEvent & { mapSlug: string }> = {}): RealtimeEvent & { mapSlug: string } => ({
  channel: 'map:arena-map',
  type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
  mapSlug: 'arena-map',
  previousRevision: 1,
  revision: 2,
  opId: 'op_realtime001',
  clientId: 'other-tab',
  timestamp: 350,
  patches: [{
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
    mapSlug: 'arena-map',
    revision: 2,
    scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
    payload: {
      placementId: 'token-pikachu',
      position: { x: 4, y: 0, z: 2 },
      facing: 'north-west',
      turned: true,
    },
  }],
  ...overrides,
})

const pendingPredictionFixture = (
  overrides: Partial<LivePlayLocalPrediction> = {},
): LivePlayLocalPrediction => {
  const previousPlacement = {
    id: 'token-eevee',
    sheetKind: 'pokemon' as const,
    sheetSlug: 'eevee',
    position: { x: 2, y: 0, z: 2 },
    facing: 'south-east' as const,
    turned: false,
  }
  const predictedPlacement = {
    ...previousPlacement,
    position: { x: 3, y: 0, z: 2 },
  }

  return {
    kind: 'live-play-local-prediction',
    localOnly: true,
    opId: 'op_localprediction001',
    commandType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    mapSlug: 'arena-map',
    baseRevision: 1,
    placementId: previousPlacement.id,
    scopes: [{ kind: 'token', placementId: previousPlacement.id, field: 'position' }],
    changedFields: ['position'],
    previousPlacement,
    predictedPlacement,
    patches: [],
    rollbackPatches: [],
    ...overrides,
  }
}

const flushPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

type UnloadEventType = 'pagehide' | 'beforeunload'

let restoreUnloadGlobals: (() => void) | null = null

const installUnloadGlobals = () => {
  const listeners = new Map<UnloadEventType, Set<() => void>>()
  const addEventListener = vi.fn((type: UnloadEventType, listener: () => void) => {
    const bucket = listeners.get(type) ?? new Set<() => void>()
    bucket.add(listener)
    listeners.set(type, bucket)
  })
  const removeEventListener = vi.fn((type: UnloadEventType, listener: () => void) => {
    listeners.get(type)?.delete(listener)
  })
  const sendBeacon = vi.fn((_url: string, _data: BodyInit) => true)
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener, removeEventListener },
  })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { sendBeacon },
  })

  restoreUnloadGlobals = () => {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else Reflect.deleteProperty(globalThis, 'window')

    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
    else Reflect.deleteProperty(globalThis, 'navigator')
  }

  return {
    addEventListener,
    removeEventListener,
    sendBeacon,
    dispatch: (type: UnloadEventType) => {
      for (const listener of listeners.get(type) ?? []) listener()
    },
  }
}

const readLastBeaconJson = async (sendBeacon: { mock: { calls: unknown[][] } }): Promise<Record<string, unknown>> => {
  const body = sendBeacon.mock.calls.at(-1)?.[1]
  if (!(body instanceof Blob)) throw new Error('Expected beacon body to be a Blob')
  return JSON.parse(await body.text()) as Record<string, unknown>
}

const setupEditMode = () => ref<MapInteractionMode>(MAP_INTERACTION_MODES.SETUP_EDIT)
const livePlayMode = () => ref<MapInteractionMode>(MAP_INTERACTION_MODES.LIVE_PLAY)

describe('useEditableMap autosave boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMocks.getJson.mockReset()
    apiMocks.postJson.mockReset()
    apiMocks.realtimeHandlers.length = 0
    apiMocks.connectionHandlers.length = 0
    apiMocks.getJson.mockResolvedValue({ map: mapFixture() })
    apiMocks.postJson.mockImplementation(async (_request: string, body: { map: TabletopMap }) => ({
      map: { ...body.map, updatedAt: 200 },
    }))
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    restoreUnloadGlobals?.()
    restoreUnloadGlobals = null
  })

  it('autosaves whole-map edits through document-backed persistence when setup/edit mode is enabled', async () => {
    const autosaveEnabled = ref(true)
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      interactionMode: setupEditMode(),
      autosaveEnabled,
    })
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
      expectedRevision: 1,
      clientId: 'map-client',
      interactionMode: 'setup-edit',
    })
    expect(editable.status.value).toBe('saved')
    expect(editable.map.value?.updatedAt).toBe(200)
  })

  it('autosaves newly added setup/edit token placements through the normal debounce path', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10, interactionMode: setupEditMode() })
    await flushPromises()

    editable.map.value!.placements.push({
      id: 'token-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 2, y: 0, z: 2 },
      facing: 'south-east',
      turned: false,
    })
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.save, {
      slug: 'arena-map',
      map: expect.objectContaining({
        placements: expect.arrayContaining([
          expect.objectContaining({ id: 'token-eevee', sheetSlug: 'eevee' }),
        ]),
      }),
      expectedRevision: 1,
      clientId: 'map-client',
      interactionMode: 'setup-edit',
    })
  })

  it('adopts authoritative setup/edit shop interface replacements', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10, interactionMode: setupEditMode() })
    await flushPromises()

    editable.applyPersistedMap(mapFixture({
      revision: 2,
      shopInterfaces: [{
        id: 'counter-a',
        shopSlug: 'viridian-mart',
        label: 'Potion Counter',
        playerVisible: true,
      }],
    }))

    expect(editable.map.value?.shopInterfaces).toEqual([{
      id: 'counter-a',
      shopSlug: 'viridian-mart',
      label: 'Potion Counter',
      playerVisible: true,
    }])
  })

  it('increments a map data revision for full persisted replacements without treating autosave as a reload', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10, interactionMode: setupEditMode() })
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

  it('does not whole-map autosave live-play mutations by default', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    editable.map.value!.placements[0]!.position = { x: 2, y: 0, z: 1 }
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(apiMocks.postJson).not.toHaveBeenCalled()
    expect(editable.status.value).toBe('idle')
  })

  it('does not later save mutations that were made while in live-play mode', async () => {
    const interactionMode = livePlayMode()
    const editable = useEditableMap('arena-map', { debounceMs: 10, interactionMode })
    await flushPromises()

    editable.map.value!.name = 'Live-only local name'
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    interactionMode.value = MAP_INTERACTION_MODES.SETUP_EDIT
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    editable.map.value!.name = 'Setup edit name'
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.save, {
      slug: 'arena-map',
      map: expect.objectContaining({ name: 'Setup edit name' }),
      expectedRevision: 1,
      clientId: 'map-client',
      interactionMode: 'setup-edit',
    })
  })

  it('flushes dirty pending setup/edit map placements through pagehide beacon and cancels the debounced save', async () => {
    const unload = installUnloadGlobals()
    const editable = useEditableMap('arena-map', { debounceMs: 50, interactionMode: setupEditMode() })
    await flushPromises()

    editable.map.value!.placements.push({
      id: 'token-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 2, y: 0, z: 2 },
      facing: 'south-east',
      turned: false,
    })
    await nextTick()

    expect(editable.status.value).toBe('saving')
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    unload.dispatch('pagehide')

    expect(unload.sendBeacon).toHaveBeenCalledTimes(1)
    expect(unload.sendBeacon).toHaveBeenCalledWith(MAP_API_PATHS.save, expect.any(Blob))
    expect(await readLastBeaconJson(unload.sendBeacon)).toMatchObject({
      slug: 'arena-map',
      clientId: 'map-client',
      interactionMode: 'setup-edit',
      map: {
        placements: expect.arrayContaining([
          expect.objectContaining({ id: 'token-eevee', sheetSlug: 'eevee' }),
        ]),
      },
    })
    expect(editable.status.value).toBe('saved')
    expect(editable.error.value).toBeNull()

    unload.dispatch('beforeunload')
    expect(unload.sendBeacon).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(50)
    await flushPromises()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('flushes newly spawned setup/edit placements even before the debounce watcher runs', async () => {
    const unload = installUnloadGlobals()
    const editable = useEditableMap('arena-map', { debounceMs: 50, interactionMode: setupEditMode() })
    await flushPromises()

    editable.map.value!.placements.push({
      id: 'token-immediate',
      sheetKind: 'trainer',
      sheetSlug: 'runtime-trainer',
      position: { x: 3, y: 0, z: 3 },
    })

    unload.dispatch('beforeunload')

    expect(unload.sendBeacon).toHaveBeenCalledTimes(1)
    expect(await readLastBeaconJson(unload.sendBeacon)).toMatchObject({
      interactionMode: 'setup-edit',
      map: {
        placements: expect.arrayContaining([
          expect.objectContaining({ id: 'token-immediate', sheetSlug: 'runtime-trainer' }),
        ]),
      },
    })

    await nextTick()
    await vi.advanceTimersByTimeAsync(50)
    await flushPromises()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('does not unload-write when the map is clean', async () => {
    const unload = installUnloadGlobals()
    useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    unload.dispatch('pagehide')

    expect(unload.sendBeacon).not.toHaveBeenCalled()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('does not unload-write while setup/edit map autosave is disabled', async () => {
    const unload = installUnloadGlobals()
    const autosaveEnabled = ref(false)
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      interactionMode: setupEditMode(),
      autosaveEnabled,
    })
    await flushPromises()

    editable.map.value!.placements.push({
      id: 'token-disabled',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 2, y: 0, z: 2 },
    })
    await nextTick()
    unload.dispatch('beforeunload')
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(unload.sendBeacon).not.toHaveBeenCalled()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('does not unload-write when the map failed to load', async () => {
    const unload = installUnloadGlobals()
    apiMocks.getJson.mockRejectedValueOnce({ statusCode: 404 })
    const editable = useEditableMap('missing-map', { debounceMs: 10 })
    await flushPromises()

    expect(editable.map.value).toBeNull()
    expect(editable.status.value).toBe('not-found')

    unload.dispatch('pagehide')

    expect(unload.sendBeacon).not.toHaveBeenCalled()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('adopts authoritative map responses without scheduling another whole-map save', async () => {
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

  it('applies accepted live-play command patches without reloading or replacing terrain', async () => {
    apiMocks.getJson.mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()
    const originalVoxels = editable.map.value?.voxels

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
      mapSlug: 'arena-map',
      previousRevision: 1,
      revision: 2,
      opId: 'op_patchmove001',
      clientId: 'other-tab',
      timestamp: 350,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: 'arena-map',
        revision: 2,
        scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
        payload: {
          placementId: 'token-pikachu',
          position: { x: 4, y: 0, z: 2 },
          facing: 'north-west',
          turned: true,
        },
      }],
    } as RealtimeEvent & { mapSlug: string })
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(apiMocks.getJson).toHaveBeenCalledTimes(1)
    expect(editable.map.value?.placements[0]).toMatchObject({
      position: { x: 4, y: 0, z: 2 },
      facing: 'north-west',
      turned: true,
    })
    expect(editable.map.value?.voxels).toBe(originalVoxels)
    expect(editable.mapRevision.value).toBe(2)
    expect(editable.mapDataRevision.value).toBe(1)
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('runs live-play patch adoption hooks around accepted patch application with pending predictions', async () => {
    apiMocks.getJson.mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
    const prediction = pendingPredictionFixture()
    const pendingLivePlayPredictions = ref<Readonly<Record<string, LivePlayLocalPrediction>>>({
      [prediction.opId]: prediction,
    })
    const hookSnapshots: Array<{
      phase: 'before' | 'after'
      revision: number | null
      position: unknown
      pendingPredictionOpIds: readonly string[]
    }> = []
    let editable: ReturnType<typeof useEditableMap> | null = null

    editable = useEditableMap('arena-map', {
      debounceMs: 10,
      pendingLivePlayPredictions,
      beforeLivePlayPatchesApply: (context) => {
        hookSnapshots.push({
          phase: 'before',
          revision: editable?.mapRevision.value ?? null,
          position: editable?.map.value?.placements[0]?.position,
          pendingPredictionOpIds: Object.keys(context.pendingPredictions),
        })
        expect(context).toMatchObject({
          mapSlug: 'arena-map',
          previousRevision: 1,
          nextRevision: 2,
        })
        expect(context.patches).toHaveLength(1)
        expect(context.patches[0]).toMatchObject({ type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION })
        expect(context.pendingPredictions[prediction.opId]).toMatchObject({
          opId: prediction.opId,
          placementId: prediction.placementId,
        })
      },
      afterLivePlayPatchesApply: (context) => {
        hookSnapshots.push({
          phase: 'after',
          revision: editable?.mapRevision.value ?? null,
          position: editable?.map.value?.placements[0]?.position,
          pendingPredictionOpIds: Object.keys(context.pendingPredictions),
        })
      },
    })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.(acceptedCommandEvent())
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(hookSnapshots).toEqual([
      {
        phase: 'before',
        revision: 1,
        position: { x: 1, y: 0, z: 1 },
        pendingPredictionOpIds: [prediction.opId],
      },
      {
        phase: 'after',
        revision: 2,
        position: { x: 4, y: 0, z: 2 },
        pendingPredictionOpIds: [prediction.opId],
      },
    ])
    expect(editable.map.value?.placements[0]?.position).toEqual({ x: 4, y: 0, z: 2 })
  })

  it('requests reconciliation and skips patch application when a live-play patch adoption hook fails', async () => {
    apiMocks.getJson.mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const requestAuthoritativeReconciliation = vi.fn(async () => undefined)
    const afterLivePlayPatchesApply = vi.fn()
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      requestAuthoritativeReconciliation,
      beforeLivePlayPatchesApply: () => {
        throw new Error('prediction adoption setup failed')
      },
      afterLivePlayPatchesApply,
    })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.(acceptedCommandEvent())
    await flushPromises()

    expect(requestAuthoritativeReconciliation).toHaveBeenCalledTimes(1)
    expect(requestAuthoritativeReconciliation).toHaveBeenCalledWith(
      'Live-play patch adoption before hook failed. Reloading the live table snapshot.',
    )
    expect(consoleWarn).toHaveBeenCalledWith(
      '[useEditableMap] live-play patch adoption hook failed',
      expect.any(Error),
    )
    expect(afterLivePlayPatchesApply).not.toHaveBeenCalled()
    expect(editable.mapRevision.value).toBe(1)
    expect(editable.map.value?.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
    consoleWarn.mockRestore()
  })

  it('does not invoke live-play patch adoption hooks for whole-map realtime updates', async () => {
    const beforeLivePlayPatchesApply = vi.fn()
    const afterLivePlayPatchesApply = vi.fn()
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      interactionMode: setupEditMode(),
      beforeLivePlayPatchesApply,
      afterLivePlayPatchesApply,
    })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      revision: 2,
      clientId: 'other-tab',
      timestamp: 380,
      data: mapFixture({ revision: 2, name: 'Setup Edit Whole Map Update' }),
    })
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(beforeLivePlayPatchesApply).not.toHaveBeenCalled()
    expect(afterLivePlayPatchesApply).not.toHaveBeenCalled()
    expect(editable.map.value?.name).toBe('Setup Edit Whole Map Update')
    expect(editable.mapRevision.value).toBe(2)
  })

  it('reloads when an accepted live-play command patch is unknown', async () => {
    apiMocks.getJson
      .mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
      .mockResolvedValueOnce({ map: mapFixture({ revision: 2, name: 'Reloaded After Unknown Patch' }), revision: 2 })
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
      mapSlug: 'arena-map',
      previousRevision: 1,
      revision: 2,
      opId: 'op_unknownpatch',
      clientId: 'other-tab',
      timestamp: 360,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: 'unknown.patch',
        mapSlug: 'arena-map',
        revision: 2,
        scopes: [{ kind: 'map', lane: 'metadata' }],
        payload: {},
      }],
    } as unknown as RealtimeEvent & { mapSlug: string })
    await flushPromises()

    expect(apiMocks.getJson).toHaveBeenCalledTimes(2)
    expect(editable.map.value?.name).toBe('Reloaded After Unknown Patch')
    expect(editable.realtimeReconciliationStatus.value).toBe('reconciled')
  })

  it('drops own realtime echoes so a local tab does not overwrite itself', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      clientId: 'map-client',
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

  it('does not suppress same-client accepted command events and notifies after patching', async () => {
    apiMocks.getJson.mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
    let callbackRevision: number | null = null
    let callbackPosition: unknown = null
    let editable: ReturnType<typeof useEditableMap> | null = null
    const onAccepted = vi.fn(() => {
      callbackRevision = editable?.mapRevision.value ?? null
      callbackPosition = editable?.map.value?.placements[0]?.position
    })
    editable = useEditableMap('arena-map', {
      debounceMs: 10,
      onLivePlayCommandAcceptedEvent: onAccepted,
    })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.(acceptedCommandEvent({ clientId: 'map-client' }))
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({
      type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
      opId: 'op_realtime001',
      clientId: 'map-client',
    }))
    expect(callbackRevision).toBe(2)
    expect(callbackPosition).toEqual({ x: 4, y: 0, z: 2 })
    expect(editable.map.value?.placements[0]).toMatchObject({
      position: { x: 4, y: 0, z: 2 },
      facing: 'north-west',
      turned: true,
    })
    expect(editable.mapRevision.value).toBe(2)
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('logs accepted callback failures without blocking patch application', async () => {
    apiMocks.getJson.mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      onLivePlayCommandAcceptedEvent: () => { throw new Error('ack failed') },
    })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.(acceptedCommandEvent())
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(consoleError).toHaveBeenCalledWith(
      '[useEditableMap] accepted live-play command event callback failed',
      expect.any(Error),
    )
    expect(editable.mapRevision.value).toBe(2)
    expect(editable.map.value?.placements[0]?.position).toEqual({ x: 4, y: 0, z: 2 })
    consoleError.mockRestore()
  })

  it('invokes accepted callbacks for repeated events without applying patches twice', async () => {
    apiMocks.getJson.mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
    const onAccepted = vi.fn()
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      onLivePlayCommandAcceptedEvent: onAccepted,
    })
    await flushPromises()

    const event = acceptedCommandEvent()
    apiMocks.realtimeHandlers[0]?.(event)
    apiMocks.realtimeHandlers[0]?.(event)
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(onAccepted).toHaveBeenCalledTimes(2)
    expect(editable.mapRevision.value).toBe(2)
    expect(editable.map.value?.placements[0]?.position).toEqual({ x: 4, y: 0, z: 2 })
    expect(apiMocks.getJson).toHaveBeenCalledTimes(1)
  })

  it('ignores stale non-local accepted command replays without patching or reconciliation', async () => {
    apiMocks.getJson.mockResolvedValueOnce({ map: mapFixture({ revision: 3 }) })
    const requestAuthoritativeReconciliation = vi.fn(async () => undefined)
    const beforeLivePlayPatchesApply = vi.fn()
    const afterLivePlayPatchesApply = vi.fn()
    const onAccepted = vi.fn()
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      requestAuthoritativeReconciliation,
      beforeLivePlayPatchesApply,
      afterLivePlayPatchesApply,
      onLivePlayCommandAcceptedEvent: onAccepted,
    })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.(acceptedCommandEvent({
      opId: 'op_stalereplay1',
      previousRevision: 1,
      revision: 2,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: 'arena-map',
        revision: 2,
        scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
        payload: {
          placementId: 'token-pikachu',
          position: { x: 5, y: 0, z: 5 },
        },
      }],
    }))
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(beforeLivePlayPatchesApply).not.toHaveBeenCalled()
    expect(afterLivePlayPatchesApply).not.toHaveBeenCalled()
    expect(requestAuthoritativeReconciliation).not.toHaveBeenCalled()
    expect(apiMocks.getJson).toHaveBeenCalledTimes(1)
    expect(editable.mapRevision.value).toBe(3)
    expect(editable.map.value?.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
  })

  it('requests reconciliation for valid accepted events whose map patch cannot apply after acknowledgement', async () => {
    apiMocks.getJson
      .mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
      .mockResolvedValueOnce({ map: mapFixture({ revision: 2, name: 'Reloaded After Invalid Patch' }), revision: 2 })
    const onAccepted = vi.fn()
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      onLivePlayCommandAcceptedEvent: onAccepted,
    })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.(acceptedCommandEvent({
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: 'arena-map',
        revision: 2,
        scopes: [{ kind: 'token', placementId: 'missing-token', field: 'position' }],
        payload: { placementId: 'missing-token', position: { x: 4, y: 0, z: 2 } },
      }],
    }))
    await flushPromises()

    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(apiMocks.getJson).toHaveBeenCalledTimes(2)
    expect(editable.map.value?.name).toBe('Reloaded After Invalid Patch')
  })

  it('rejects invalid accepted command events without invoking the acknowledgement callback', async () => {
    apiMocks.getJson
      .mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
      .mockResolvedValueOnce({ map: mapFixture({ revision: 2, name: 'Reloaded After Invalid Event' }), revision: 2 })
    const onAccepted = vi.fn()
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      onLivePlayCommandAcceptedEvent: onAccepted,
    })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.(acceptedCommandEvent({ opId: undefined }))
    await flushPromises()

    expect(onAccepted).not.toHaveBeenCalled()
    expect(apiMocks.getJson).toHaveBeenCalledTimes(2)
    expect(editable.map.value?.name).toBe('Reloaded After Invalid Event')
  })

  it('cancels pending dirty setup/edit saves when another viewer publishes an authoritative map update', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10, interactionMode: setupEditMode() })
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
      revision: 2,
      clientId: 'other-tab',
      timestamp: 500,
      data: mapFixture({ revision: 2, name: 'Newer Arena', updatedAt: 500 }),
    })
    await nextTick()

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      revision: 1,
      clientId: 'other-tab',
      timestamp: 450,
      data: mapFixture({ revision: 1, name: 'Older Arena', updatedAt: 450 }),
    })
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(editable.map.value?.name).toBe('Newer Arena')
    expect(editable.map.value?.updatedAt).toBe(500)
    expect(editable.mapRevision.value).toBe(2)
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('does not reload the authoritative map after a successful replay reconnect', async () => {
    apiMocks.getJson.mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })

    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    apiMocks.connectionHandlers[0]?.({
      state: 'reconnecting',
      previousState: 'connected',
      reconnected: false,
      reason: 'transport-loss',
    })

    expect(editable.livePlayCommandsBlocked.value).toBe(true)
    expect(editable.livePlayRealtimeNotice.value).toContain('Realtime stream is synchronizing')

    apiMocks.connectionHandlers[0]?.({
      state: 'replaying',
      previousState: 'reconnecting',
      reconnected: true,
      reason: 'transport-open',
    })
    expect(editable.livePlayCommandsBlocked.value).toBe(true)

    apiMocks.connectionHandlers[0]?.({
      state: 'connected',
      previousState: 'replaying',
      reconnected: true,
      reason: 'replay-caught-up',
    })
    await flushPromises()

    expect(apiMocks.getJson).toHaveBeenCalledTimes(1)
    expect(editable.mapRevision.value).toBe(1)
    expect(editable.realtimeReconciliationStatus.value).toBe('reconciled')
    expect(editable.livePlayCommandsBlocked.value).toBe(false)
    expect(editable.livePlayRealtimeNotice.value).toContain('map revision 1')
  })

  it('notifies prediction cleanup before reconnect and gap reconciliation reloads', async () => {
    apiMocks.getJson.mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
    const order: string[] = []
    const requestAuthoritativeReconciliation = vi.fn(async (reason: string) => {
      order.push(`request:${reason}`)
    })
    const onBeforeAuthoritativeReconciliation = vi.fn((reason: string) => {
      order.push(`clear:${reason}`)
    })
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      requestAuthoritativeReconciliation,
      onBeforeAuthoritativeReconciliation,
    })
    await flushPromises()

    apiMocks.connectionHandlers[0]?.({
      state: 'reconnecting',
      previousState: 'connected',
      reconnected: false,
      reason: 'transport-loss',
    })

    expect(onBeforeAuthoritativeReconciliation).toHaveBeenCalledWith(
      'Realtime stream is synchronizing before live play resumes.',
    )
    expect(editable.realtimeReconciliationStatus.value).toBe('reconnecting')

    apiMocks.connectionHandlers[0]?.({
      state: 'replaying',
      previousState: 'replaying',
      reconnected: true,
      reason: 'reconcile-required',
      reconciliation: {
        reason: 'gap',
        requestedAfterSequence: 1,
        earliestAvailableSequence: 3,
        latestSequence: 6,
      },
    })
    await flushPromises()

    const gapReason = 'Realtime replay history has a gap. Reloading the live table snapshot.'
    expect(requestAuthoritativeReconciliation).toHaveBeenCalledWith(gapReason)
    expect(order.slice(-2)).toEqual([
      `clear:${gapReason}`,
      `request:${gapReason}`,
    ])
    expect(editable.realtimeReconciliationStatus.value).toBe('reconciled')
  })

  it('reloads instead of applying a revision-gap realtime event directly', async () => {
    apiMocks.getJson
      .mockResolvedValueOnce({ map: mapFixture({ revision: 1 }) })
      .mockResolvedValueOnce({
        revision: 3,
        map: mapFixture({ revision: 3, name: 'Reloaded Arena', updatedAt: 700 }),
      })

    const editable = useEditableMap('arena-map', { debounceMs: 10 })
    await flushPromises()

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      revision: 3,
      clientId: 'other-tab',
      timestamp: 650,
      data: mapFixture({ revision: 3, name: 'Gap Event Arena', updatedAt: 650 }),
    })
    await flushPromises()

    expect(apiMocks.getJson).toHaveBeenCalledTimes(2)
    expect(editable.map.value?.name).toBe('Reloaded Arena')
    expect(editable.mapRevision.value).toBe(3)
    expect(editable.realtimeReconciliationStatus.value).toBe('reconciled')
  })

  it('can skip automatic /api/maps/load for aggregate snapshot ownership', async () => {
    const editable = useEditableMap('arena-map', { debounceMs: 10, autoLoad: false })
    await flushPromises()

    expect(apiMocks.getJson).not.toHaveBeenCalled()
    expect(editable.status.value).toBe('loading')
    expect(editable.map.value).toBeNull()
  })

  it('requests external authoritative reconciliation for replay gap and ahead controls', async () => {
    const requestAuthoritativeReconciliation = vi.fn(async () => undefined)
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      autoLoad: false,
      requestAuthoritativeReconciliation,
    })

    apiMocks.connectionHandlers[0]?.({
      state: 'replaying',
      previousState: 'replaying',
      reconnected: true,
      reason: 'reconcile-required',
      reconciliation: {
        reason: 'gap',
        requestedAfterSequence: 1,
        earliestAvailableSequence: 3,
        latestSequence: 6,
      },
    })
    await flushPromises()

    expect(requestAuthoritativeReconciliation).toHaveBeenCalledTimes(1)
    expect(requestAuthoritativeReconciliation).toHaveBeenLastCalledWith(
      'Realtime replay history has a gap. Reloading the live table snapshot.',
    )
    expect(editable.realtimeReconciliationStatus.value).toBe('reconciled')
    expect(editable.livePlayCommandsBlocked.value).toBe(false)

    apiMocks.connectionHandlers[0]?.({
      state: 'replaying',
      previousState: 'replaying',
      reconnected: true,
      reason: 'reconcile-required',
      reconciliation: {
        reason: 'ahead',
        requestedAfterSequence: 9,
        earliestAvailableSequence: 1,
        latestSequence: 6,
      },
    })
    await flushPromises()

    expect(requestAuthoritativeReconciliation).toHaveBeenCalledTimes(2)
    expect(requestAuthoritativeReconciliation).toHaveBeenLastCalledWith(
      'Realtime replay cursor was ahead of the server. Reloading the live table snapshot.',
    )
    expect(apiMocks.getJson).not.toHaveBeenCalled()
  })

  it('supersedes active external reconciliation when the authoritative access key changes', async () => {
    const reconciliationKey = ref('player:profile-a')
    const resolvers: Array<() => void> = []
    const requestAuthoritativeReconciliation = vi.fn(() => new Promise<void>((resolve) => {
      resolvers.push(resolve)
    }))
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      autoLoad: false,
      requestAuthoritativeReconciliation,
      authoritativeReconciliationKey: reconciliationKey,
    })

    const profileA = editable.reconcileAuthoritativeMap('profile A')
    reconciliationKey.value = 'player:profile-b'
    const profileB = editable.reconcileAuthoritativeMap('profile B')

    expect(requestAuthoritativeReconciliation).toHaveBeenCalledTimes(2)
    expect(editable.livePlayCommandsBlocked.value).toBe(true)

    resolvers[1]?.()
    await profileB
    expect(editable.realtimeReconciliationStatus.value).toBe('reconciled')

    resolvers[0]?.()
    await profileA
    expect(editable.realtimeReconciliationStatus.value).toBe('reconciled')
  })

  it('coalesces external reconciliation requests from simultaneous revision gaps', async () => {
    let resolveReconciliation!: () => void
    const requestAuthoritativeReconciliation = vi.fn(() => new Promise<void>((resolve) => {
      resolveReconciliation = resolve
    }))
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      autoLoad: false,
      requestAuthoritativeReconciliation,
    })
    editable.applyPersistedMap(mapFixture({ revision: 1 }))

    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: 'updated',
      revision: 3,
      previousRevision: 2,
      clientId: 'other-tab',
      timestamp: 650,
      data: mapFixture({ revision: 3, name: 'Gap Event Arena', updatedAt: 650 }),
    })
    apiMocks.realtimeHandlers[0]?.({
      channel: 'map:arena-map',
      type: LIVE_PLAY_REALTIME_EVENT_TYPES.COMMAND_ACCEPTED,
      mapSlug: 'arena-map',
      previousRevision: 2,
      revision: 3,
      opId: 'op_gap',
      clientId: 'other-tab',
      timestamp: 651,
      patches: [],
    } as unknown as RealtimeEvent & { mapSlug: string })

    expect(requestAuthoritativeReconciliation).toHaveBeenCalledTimes(1)
    expect(editable.livePlayCommandsBlocked.value).toBe(true)

    resolveReconciliation()
    await flushPromises()

    expect(editable.realtimeReconciliationStatus.value).toBe('reconciled')
  })

  it('does not setup-autosave the initial authoritative map adopted from an aggregate snapshot', async () => {
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      autoLoad: false,
      interactionMode: setupEditMode(),
    })

    editable.applyPersistedMap(mapFixture({ name: 'Prepared Arena' }))
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    await flushPromises()

    expect(editable.map.value?.name).toBe('Prepared Arena')
    expect(editable.status.value).toBe('idle')
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('pauses whole-map autosave while disabled and resumes it for document-backed editing', async () => {
    const autosaveEnabled = ref(false)
    const editable = useEditableMap('arena-map', {
      debounceMs: 10,
      interactionMode: setupEditMode(),
      autosaveEnabled,
    })
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
      expectedRevision: 1,
      clientId: 'map-client',
      interactionMode: 'setup-edit',
    })
  })
})
