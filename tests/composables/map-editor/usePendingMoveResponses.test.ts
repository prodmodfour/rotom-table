import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import type { AuthRole } from '#shared/auth'
import {
  MOVE_RESPONSE_COMMAND_TYPES,
} from '#shared/moveAutomation/responseCommands'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import {
  usePendingMoveResponses,
  pendingMoveResponseWindowKey,
} from '~/composables/map-editor/usePendingMoveResponses'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import {
  createLivePlayCommandOutbox,
  type LivePlayCommandOutbox,
} from '~/utils/livePlayCommandOutbox'
import type { TabletopMap } from '~/types/map'

const apiMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => apiMocks,
}))

let outboxSequence = 0
const createOutbox = (): LivePlayCommandOutbox => {
  outboxSequence += 1
  return createLivePlayCommandOutbox({
    databaseName: `pending-move-responses-${outboxSequence}`,
    indexedDBFactory: new FakeIDBFactory() as unknown as IDBFactory,
  })
}

const profileId = parsePlayerProfileId('profile_responder1')
const responseList = (windows: readonly unknown[] = [responseWindow()]) => ({
  schemaVersion: 1,
  mapSlug: 'pending-arena',
  windows,
})

function responseWindow() {
  return {
    schemaVersion: 1,
    resolution: {
      schemaVersion: 1,
      resolutionId: 'resolution-pending-1',
      actorPlacementId: 'actor-token',
      canonicalMoveId: 'Pending Test',
      phase: 'hit',
      status: 'pending',
      outstandingWindowCount: 1,
      createdAt: 1_000,
      updatedAt: 1_000,
    },
    window: {
      windowId: 'window.branch',
      kind: 'choice',
      phase: 'hit',
      reasonCode: 'move.pending-test.choose',
      promptKey: 'move.pending-test.choose',
      options: [
        { id: 'option.attack', labelKey: 'move.pending-test.attack' },
        { id: 'option.support', labelKey: 'move.pending-test.support' },
      ],
      allowPass: true,
      priority: null,
    },
  }
}

const mapDocument = (revision = 13): TabletopMap => ({
  schemaVersion: 2,
  slug: 'pending-arena',
  name: 'Pending Arena',
  folder: '',
  revision,
  dimensions: { x: 8, y: 3, z: 8 },
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const acceptedEnvelope = (opId: string, revision = 13) => ({
  result: {
    ok: true,
    opId,
    mapSlug: 'pending-arena',
    previousRevision: revision - 1,
    revision,
    patches: [],
  },
  map: mapDocument(revision),
  sheetUpdates: [{
    kind: 'pokemon',
    slug: 'actor-mon',
    sheet: { slug: 'actor-mon', currentHp: 20 },
  }],
})

const deferred = <TValue>() => {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const createHarness = (options: {
  readonly outbox?: LivePlayCommandOutbox
  readonly role?: AuthRole
  readonly applyPersistedMap?: (map: TabletopMap) => void
  readonly applySheetUpdate?: (update: { kind: 'pokemon' | 'trainer'; slug: string; sheet: Record<string, unknown> }) => void
  readonly leaseOwner?: string
} = {}) => {
  const outbox = options.outbox ?? createOutbox()
  const actions = usePendingMoveResponses({
    slug: 'pending-arena',
    authRole: ref<AuthRole>(options.role ?? 'player'),
    playerProfileId: ref(profileId),
    mapRevision: ref(12),
    enabled: ref(true),
    outbox,
    leaseOwner: options.leaseOwner ?? 'pending-response-test-owner',
    autoLoad: false,
    applyPersistedMap: options.applyPersistedMap,
    applySheetUpdate: options.applySheetUpdate,
  })
  return { actions, outbox }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('usePendingMoveResponses', () => {
  it('loads only the selected profile prompt and journals the exact ID-only response before sending', async () => {
    apiMocks.getJson
      .mockResolvedValueOnce(responseList())
      .mockResolvedValueOnce(responseList([]))
    const pendingPost = deferred<unknown>()
    apiMocks.postJson.mockReturnValueOnce(pendingPost.promise)
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const { actions, outbox } = createHarness({ applyPersistedMap, applySheetUpdate })

    await actions.refresh()
    expect(apiMocks.getJson).toHaveBeenCalledWith(MAP_API_PATHS.pendingMoveResponses, {
      params: { slug: 'pending-arena', profileId },
    })
    expect(actions.windows.value).toHaveLength(1)

    const first = actions.choose({
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
      optionId: 'option.attack',
    })
    await vi.waitFor(() => expect(apiMocks.postJson).toHaveBeenCalledTimes(1))

    const [requestPath, body] = apiMocks.postJson.mock.calls[0] as [string, Record<string, unknown>]
    expect(requestPath).toBe(MAP_API_PATHS.chooseMoveResponse)
    expect(body).toEqual({
      schemaVersion: 1,
      opId: expect.stringMatching(/^op_/),
      mapSlug: 'pending-arena',
      baseRevision: 12,
      profileId,
      type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
      payload: {
        resolutionId: 'resolution-pending-1',
        windowId: 'window.branch',
        optionId: 'option.attack',
      },
    })
    expect(body).not.toHaveProperty('scopes')
    expect(body).not.toHaveProperty('mechanics')
    expect(body).not.toHaveProperty('labelKey')

    const stored = await outbox.get(String(body.opId))
    expect(stored?.body).toEqual(body)
    expect(stored?.state).toBe('sending')
    expect(actions.responseStateByWindow.value[pendingMoveResponseWindowKey({
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
    })]).toMatchObject({ status: 'sending', opId: body.opId })

    const duplicateClick = await actions.choose({
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
      optionId: 'option.support',
    })
    expect(duplicateClick).toMatchObject({ dispatched: false, opId: body.opId })
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)

    pendingPost.resolve(acceptedEnvelope(String(body.opId)))
    await expect(first).resolves.toMatchObject({ dispatched: true, accepted: true, opId: body.opId })
    expect(applyPersistedMap).toHaveBeenCalledTimes(1)
    expect(applySheetUpdate).toHaveBeenCalledTimes(1)
    await expect(outbox.get(String(body.opId))).resolves.toBeNull()
    expect(actions.windows.value).toEqual([])
  })

  it('restores an uncertain authoritative prompt after reconnect and retries the exact body and opId', async () => {
    apiMocks.getJson.mockResolvedValue(responseList())
    apiMocks.postJson.mockRejectedValueOnce(new Error('connection lost'))
    const outbox = createOutbox()
    const firstHarness = createHarness({ outbox, leaseOwner: 'first-tab' })
    await firstHarness.actions.refresh()

    const uncertain = await firstHarness.actions.pass({
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
    })
    expect(uncertain).toMatchObject({ dispatched: false, uncertain: true })
    const stored = await outbox.get(uncertain.opId!)
    expect(stored).toMatchObject({ state: 'uncertain', opId: uncertain.opId })
    const exactBody = structuredClone(stored!.body)

    const applyPersistedMap = vi.fn()
    const reconnected = createHarness({
      outbox,
      leaseOwner: 'reconnected-tab',
      applyPersistedMap,
    })
    await reconnected.actions.refresh()
    expect(reconnected.actions.windows.value).toHaveLength(1)
    expect(reconnected.actions.responseStateByWindow.value[pendingMoveResponseWindowKey({
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
    })]).toMatchObject({ status: 'uncertain', opId: uncertain.opId })

    apiMocks.postJson.mockImplementationOnce((_path: string, body: Record<string, unknown>) => (
      Promise.resolve(acceptedEnvelope(String(body.opId), 14))
    ))
    const retried = await reconnected.actions.retry(uncertain.opId!)
    expect(retried).toMatchObject({ dispatched: true, accepted: true, opId: uncertain.opId })
    expect(apiMocks.postJson.mock.calls[1]?.[0]).toBe(MAP_API_PATHS.passMoveResponse)
    expect(apiMocks.postJson.mock.calls[1]?.[1]).toEqual(exactBody)
    expect(applyPersistedMap).toHaveBeenCalledTimes(1)
    await expect(outbox.get(uncertain.opId!)).resolves.toBeNull()
  })

  it('sends GM force-pass and cancel controls through their dedicated exact command routes', async () => {
    apiMocks.getJson.mockResolvedValue(responseList())
    apiMocks.postJson.mockImplementation((_path: string, body: Record<string, unknown>) => (
      Promise.resolve(acceptedEnvelope(String(body.opId)))
    ))
    const forced = createHarness({ role: 'gm', leaseOwner: 'gm-force-tab' })
    await forced.actions.refresh()
    await forced.actions.forcePass({
      resolutionId: 'resolution-pending-1',
      windowId: 'window.branch',
    })

    expect(apiMocks.postJson.mock.calls[0]?.[0]).toBe(MAP_API_PATHS.forceResolveMoveResolution)
    expect(apiMocks.postJson.mock.calls[0]?.[1]).toMatchObject({
      type: MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE,
      payload: {
        resolutionId: 'resolution-pending-1',
        windowId: 'window.branch',
      },
    })
    expect(apiMocks.postJson.mock.calls[0]?.[1]).not.toHaveProperty('profileId')

    const cancelled = createHarness({ role: 'gm', leaseOwner: 'gm-cancel-tab' })
    await cancelled.actions.refresh()
    await cancelled.actions.cancel('resolution-pending-1')
    expect(apiMocks.postJson.mock.calls.at(-1)?.[0]).toBe(MAP_API_PATHS.cancelMoveResolution)
    expect(apiMocks.postJson.mock.calls.at(-1)?.[1]).toMatchObject({
      type: MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL,
      payload: { resolutionId: 'resolution-pending-1' },
    })
  })
})
