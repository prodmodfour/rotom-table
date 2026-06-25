import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import {
  useLivePlayCommands,
  type UseLivePlayCommandsOptions,
} from '~/composables/map-editor/useLivePlayCommands'
import { useLivePlayStateMachine } from '~/composables/map-editor/useLivePlayStateMachine'
import { MAP_API_PATHS, SHEET_API_PATHS } from '~/utils/apiRoutes'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_OP_ID_RE,
  LIVE_PLAY_PATCH_TYPES,
} from '#shared/livePlayCommands'
import { parsePlayerProfileId, type PlayerProfileId } from '#shared/playerProfiles'
import type { LivePlayAcceptedRealtimeEvent } from '#shared/livePlayRealtimeEvents'
import {
  LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION,
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type LivePlayResolvedMoveResult,
} from '#shared/livePlayMoveResolution'
import type { AuthRole } from '#shared/auth'
import type { TabletopMap } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import {
  createLivePlayCommandOutbox,
  type LivePlayCommandOutbox,
  type LivePlayCommandOutboxAuthContext,
  type LivePlayCommandOutboxEntry,
} from '~/utils/livePlayCommandOutbox'

const apiMocks = vi.hoisted(() => ({
  postJson: vi.fn(),
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    postJson: apiMocks.postJson,
  }),
}))

let outboxSequence = 0
let leaseOwnerSequence = 0

const createTestOutbox = (): LivePlayCommandOutbox => {
  outboxSequence += 1
  return createLivePlayCommandOutbox({
    databaseName: `use-live-play-commands-${outboxSequence}`,
    indexedDBFactory: new FakeIDBFactory() as unknown as IDBFactory,
  })
}

type TestUseLivePlayCommandsOptions =
  Omit<UseLivePlayCommandsOptions, 'authRole' | 'outbox' | 'leaseOwner'>
  & Partial<Pick<UseLivePlayCommandsOptions, 'authRole' | 'outbox' | 'leaseOwner'>>

const useTestLivePlayCommands = (options: TestUseLivePlayCommandsOptions) => {
  leaseOwnerSequence += 1
  return useLivePlayCommands({
    authRole: ref<AuthRole>('gm'),
    outbox: createTestOutbox(),
    leaseOwner: `test-lease-owner-${leaseOwnerSequence}`,
    ...options,
  })
}

const createCommandHarness = (options: TestUseLivePlayCommandsOptions) => {
  leaseOwnerSequence += 1
  const outbox = options.outbox ?? createTestOutbox()
  const leaseOwner = options.leaseOwner ?? `test-lease-owner-${leaseOwnerSequence}`
  const actions = useLivePlayCommands({
    authRole: ref<AuthRole>('gm'),
    ...options,
    outbox,
    leaseOwner,
  })
  return { actions, outbox, leaseOwner }
}

let storedCommandSequence = 0

const deferred = <TValue>() => {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const commandRecord = (body: unknown): Record<string, unknown> => (
  body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
)

const nextStoredOpId = (label = 'stored'): string => {
  storedCommandSequence += 1
  return `op_${label}${storedCommandSequence.toString(36).padStart(8, '0')}`
}

const storedMoveCommandBody = (overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: nextStoredOpId(),
  mapSlug: 'arena-map',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
  payload: { placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } },
  clientId: 'stored-client',
  ...overrides,
})

const enqueueStoredCommand = async (
  outbox: LivePlayCommandOutbox,
  input: {
    readonly requestPath?: string
    readonly body?: Record<string, unknown>
    readonly authContext?: LivePlayCommandOutboxAuthContext
    readonly now?: number
  } = {},
): Promise<LivePlayCommandOutboxEntry> => outbox.enqueue({
  requestPath: input.requestPath ?? MAP_API_PATHS.moveToken,
  body: input.body ?? storedMoveCommandBody(),
  authContext: input.authContext ?? { role: 'gm', profileId: null },
  ...(input.now === undefined ? {} : { now: input.now }),
})

const makeStoredCommandUncertain = async (
  outbox: LivePlayCommandOutbox,
  entry: LivePlayCommandOutboxEntry,
  leaseOwner = 'stored-lease-owner',
): Promise<LivePlayCommandOutboxEntry> => {
  const claim = await outbox.claimForSend({ opId: entry.opId, leaseOwner })
  if (!claim.claimed) throw new Error(`Failed to claim test outbox entry ${entry.opId}`)
  const uncertain = await outbox.markUncertain({ opId: entry.opId, leaseOwner, error: 'test uncertainty' })
  if (!uncertain) throw new Error(`Failed to mark test outbox entry ${entry.opId} uncertain`)
  return uncertain
}

const makeStoredCommandSending = async (
  outbox: LivePlayCommandOutbox,
  entry: LivePlayCommandOutboxEntry,
  leaseOwner = 'stored-lease-owner',
): Promise<LivePlayCommandOutboxEntry> => {
  const claim = await outbox.claimForSend({ opId: entry.opId, leaseOwner })
  if (!claim.claimed) throw new Error(`Failed to claim test outbox entry ${entry.opId}`)
  return claim.entry
}

const acceptedRealtimeEventForEntry = (
  entry: LivePlayCommandOutboxEntry,
  overrides: Partial<LivePlayAcceptedRealtimeEvent> = {},
): LivePlayAcceptedRealtimeEvent => {
  const revision = overrides.revision ?? 5
  const mapSlug = overrides.mapSlug ?? entry.mapSlug
  return {
    channel: overrides.channel ?? `map:${mapSlug}`,
    type: 'live-play-command-accepted',
    mapSlug,
    opId: overrides.opId ?? entry.opId,
    previousRevision: overrides.previousRevision ?? 4,
    revision,
    timestamp: overrides.timestamp ?? 1_000,
    clientId: overrides.clientId ?? 'other-tab',
    patches: overrides.patches ?? [{
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
      mapSlug,
      revision,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
      payload: {
        placementId: 'token-pikachu',
        position: { x: 2, y: 0, z: 1 },
      },
    }],
  }
}

const alignTerminalResponseToCommand = <TResponse>(response: TResponse, body: unknown): TResponse => {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return response
  const command = commandRecord(body)
  const opId = command.opId
  const mapSlug = command.mapSlug
  if (typeof opId !== 'string' || typeof mapSlug !== 'string') return response
  const record = response as Record<string, unknown>
  if (record.ok === true && record.duplicate === true && record.original && typeof record.original === 'object') {
    return {
      ...record,
      opId,
      original: {
        ...(record.original as Record<string, unknown>),
        opId,
        mapSlug,
      },
    } as TResponse
  }
  if (record.ok === true || record.ok === false) {
    return { ...record, opId, mapSlug } as TResponse
  }
  return response
}

const mockTerminalResponse = <TResponse>(response: TResponse) => {
  apiMocks.postJson.mockImplementation(async (_request: string, body: unknown) => (
    alignTerminalResponseToCommand(response, body)
  ))
}

const mockTerminalResponseOnce = <TResponse>(response: TResponse) => {
  apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => (
    alignTerminalResponseToCommand(response, body)
  ))
}

const wrapOutbox = (
  delegate: LivePlayCommandOutbox,
  overrides: Partial<LivePlayCommandOutbox>,
): LivePlayCommandOutbox => ({
  enqueue: (input) => (overrides.enqueue ?? delegate.enqueue.bind(delegate))(input),
  claimForSend: (input) => (overrides.claimForSend ?? delegate.claimForSend.bind(delegate))(input),
  markUncertain: (input) => (overrides.markUncertain ?? delegate.markUncertain.bind(delegate))(input),
  acknowledgeTerminal: (opId) => (overrides.acknowledgeTerminal ?? delegate.acknowledgeTerminal.bind(delegate))(opId),
  recoverExpiredLeases: (now) => (overrides.recoverExpiredLeases ?? delegate.recoverExpiredLeases.bind(delegate))(now),
  get: (opId) => (overrides.get ?? delegate.get.bind(delegate))(opId),
  list: (filter) => (overrides.list ?? delegate.list.bind(delegate))(filter),
  inspect: () => (overrides.inspect ?? delegate.inspect.bind(delegate))(),
  hasPending: (filter) => (overrides.hasPending ?? delegate.hasPending.bind(delegate))(filter),
  count: (filter) => (overrides.count ?? delegate.count.bind(delegate))(filter),
  discard: (opId) => (overrides.discard ?? delegate.discard.bind(delegate))(opId),
  close: () => (overrides.close ?? delegate.close.bind(delegate))(),
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
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
    {
      id: 'target-token',
      sheetKind: 'pokemon',
      sheetSlug: 'bulbasaur',
      position: { x: 2, y: 0, z: 1 },
      facing: 'north-west',
      turned: false,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
})

const resolvedMoveFixture = (overrides: Partial<LivePlayResolvedMoveResult> = {}): LivePlayResolvedMoveResult => ({
  schemaVersion: LIVE_PLAY_RESOLVED_MOVE_RESULT_SCHEMA_VERSION,
  actorPlacementId: 'token-pikachu',
  moveName: 'Thunderbolt',
  canonicalMoveName: 'Thunderbolt',
  moveKey: 'thunderbolt',
  frequency: 'At-Will',
  damageFormula: '2d6+8',
  selectedTargetIds: ['target-token'],
  script: {
    kind: 'explicit',
    moveName: 'Thunderbolt',
    version: 1,
    targetMode: 'one-target',
    targetCount: null,
    damaging: true,
    requiresAccuracy: true,
    damageBase: 6,
    damageClass: 'Special',
    type: 'Electric',
    ac: 2,
    range: '6, 1 Target',
    effect: '',
    keywords: [],
    criticalRange: 20,
    conditionSuggestions: [],
    stageSuggestions: [],
    hpSuggestions: [],
    fieldSuggestions: [],
    hazardSuggestions: [],
    automationNotes: [],
  } satisfies MoveAutomationScript,
  transaction: {
    userId: 'token-pikachu',
    userName: 'Pikachu',
    moveName: 'Thunderbolt',
    scriptKind: 'explicit',
    scriptVersion: 1,
    attackedTargetIds: ['target-token'],
    hitTargetIds: ['target-token'],
    hpUpdates: [{ id: 'target-token', currentHp: 12 }],
    conditionUpdates: [],
    combatStageUpdates: [],
    hazardsToAdd: [],
    fieldEffectsToApply: [],
    logLines: ['Pikachu used Thunderbolt!'],
  },
  ...overrides,
})

describe('useLivePlayCommands', () => {
  beforeEach(() => {
    apiMocks.postJson.mockReset()
  })

  it('keeps live-play command dispatch free of unload fallback helpers', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/composables/map-editor/useLivePlayCommands.ts'), 'utf8')

    expect(source).not.toContain('sendJsonWithUnloadFallback')
    expect(source).not.toContain('sendSetupEditJsonWithUnloadFallback')
    expect(source).not.toContain('sendBeacon')
    expect(source).not.toContain('pagehide')
    expect(source).toContain('bindPendingLivePlayCommandUnloadWarning')
  })

  it('journals a command before POST and sends the route/body returned by the claimed entry', async () => {
    const events: string[] = []
    const delegate = createTestOutbox()
    let enqueuedBody: Record<string, unknown> | null = null
    let enqueuedPath: string | null = null
    const outbox = wrapOutbox(delegate, {
      enqueue: async (input) => {
        events.push('enqueue:start')
        const entry = await delegate.enqueue(input)
        events.push('enqueue:done')
        enqueuedBody = entry.body
        enqueuedPath = entry.requestPath
        return entry
      },
      claimForSend: async (input) => {
        events.push('claim:start')
        const result = await delegate.claimForSend(input)
        events.push('claim:done')
        if (!result.claimed) return result
        return {
          claimed: true,
          entry: {
            ...result.entry,
            requestPath: MAP_API_PATHS.turnToken,
            body: {
              ...result.entry.body,
              claimedEnvelope: true,
            },
          },
        }
      },
    })
    apiMocks.postJson.mockImplementation(async (request: string, body: unknown) => {
      events.push('post')
      const command = commandRecord(body)
      expect(events).toEqual(['enqueue:start', 'enqueue:done', 'claim:start', 'claim:done', 'post'])
      expect(request).toBe(MAP_API_PATHS.turnToken)
      expect(command.claimedEnvelope).toBe(true)
      return {
        ok: true,
        opId: command.opId,
        mapSlug: command.mapSlug,
        previousRevision: 4,
        revision: 5,
        patches: [],
      }
    })

    const { actions } = createCommandHarness({
      slug: 'arena-map',
      mapRevision: ref(4),
      outbox,
    })
    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 3, y: 0, z: 2 },
      pathLength: 2,
    })

    expect(result).toMatchObject({ dispatched: true, opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE) })
    expect(enqueuedPath).toBe(MAP_API_PATHS.moveToken)
    expect(enqueuedBody).toMatchObject({
      opId: result.opId,
      baseRevision: 4,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
      payload: {
        placementId: 'token-pikachu',
        position: { x: 3, y: 0, z: 2 },
        pathLength: 2,
      },
    })
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson.mock.calls[0]?.[1]).toMatchObject({ opId: result.opId, claimedEnvelope: true })
    await expect(delegate.get(result.opId!)).resolves.toBeNull()
  })

  it('removes outbox entries for accepted, rejected, duplicate-accepted, and duplicate-rejected terminal responses', async () => {
    const cases = [
      {
        name: 'accepted',
        response: (body: Record<string, unknown>) => ({ ok: true, opId: body.opId, mapSlug: body.mapSlug, previousRevision: 4, revision: 5, patches: [] }),
        expectedDispatched: true,
      },
      {
        name: 'rejected',
        response: (body: Record<string, unknown>) => ({ ok: false, opId: body.opId, mapSlug: body.mapSlug, reason: 'conflict', message: 'Conflict', currentRevision: 5 }),
        expectedDispatched: false,
      },
      {
        name: 'duplicate accepted',
        response: (body: Record<string, unknown>) => ({
          ok: true,
          duplicate: true,
          opId: body.opId,
          original: { ok: true, opId: body.opId, mapSlug: body.mapSlug, previousRevision: 4, revision: 5, patches: [] },
        }),
        expectedDispatched: true,
      },
      {
        name: 'duplicate rejected',
        response: (body: Record<string, unknown>) => ({
          ok: true,
          duplicate: true,
          opId: body.opId,
          original: { ok: false, opId: body.opId, mapSlug: body.mapSlug, reason: 'stale-revision', message: 'Stale', currentRevision: 5 },
        }),
        expectedDispatched: false,
      },
    ] as const

    for (const terminalCase of cases) {
      apiMocks.postJson.mockReset()
      const outbox = createTestOutbox()
      apiMocks.postJson.mockImplementation(async (_request: string, body: unknown) => terminalCase.response(commandRecord(body)))
      const { actions } = createCommandHarness({ slug: 'arena-map', mapRevision: ref(4), outbox })

      const result = await actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })

      expect(result.dispatched, terminalCase.name).toBe(terminalCase.expectedDispatched)
      expect(result.uncertain, terminalCase.name).not.toBe(true)
      expect(result.opId, terminalCase.name).toEqual(expect.stringMatching(LIVE_PLAY_OP_ID_RE))
      await expect(outbox.get(result.opId!), terminalCase.name).resolves.toBeNull()
    }
  })

  it('marks transport failures uncertain while preserving the exact stored route and command body', async () => {
    const outbox = createTestOutbox()
    let postedBody: unknown = null
    apiMocks.postJson.mockImplementation(async (_request: string, body: unknown) => {
      postedBody = body
      throw new Error('Network down')
    })
    const { actions } = createCommandHarness({ slug: 'arena-map', mapRevision: ref(4), outbox })

    const result = await actions.moveToken({ placementId: 'token-pikachu', position: { x: 4, y: 0, z: 1 } })

    expect(result).toMatchObject({ dispatched: false, uncertain: true, opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE) })
    const entry = await outbox.get(result.opId!)
    expect(entry).toMatchObject({
      state: 'uncertain',
      requestPath: MAP_API_PATHS.moveToken,
      body: postedBody,
    })
    expect(entry?.lastError).toContain(result.opId!)
  })

  it('marks malformed or mismatched terminal responses uncertain without applying untrusted data', async () => {
    const untrustedResponses = [
      { ok: true, opId: 'op_badshape1', mapSlug: 'arena-map', previousRevision: 4, revision: 5 },
      { ok: true, opId: 'op_wrongop01', mapSlug: 'arena-map', previousRevision: 4, revision: 5, patches: [] },
      { ok: true, opId: 'op_wrongmap1', mapSlug: 'other-map', previousRevision: 4, revision: 5, patches: [] },
    ]

    for (const response of untrustedResponses) {
      apiMocks.postJson.mockReset()
      const outbox = createTestOutbox()
      const applyPersistedMap = vi.fn()
      const applySheetUpdate = vi.fn()
      apiMocks.postJson.mockResolvedValue(response)
      const { actions } = createCommandHarness({
        slug: 'arena-map',
        mapRevision: ref(4),
        applyPersistedMap,
        applySheetUpdate,
        outbox,
      })

      const result = await actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })

      expect(result).toMatchObject({ dispatched: false, uncertain: true, opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE) })
      await expect(outbox.get(result.opId!)).resolves.toMatchObject({ state: 'uncertain' })
      expect(applyPersistedMap).not.toHaveBeenCalled()
      expect(applySheetUpdate).not.toHaveBeenCalled()
    }
  })

  it('does not send HTTP when enqueue or claim fails before transmission', async () => {
    const enqueueOutbox = wrapOutbox(createTestOutbox(), {
      enqueue: async () => { throw new Error('IndexedDB unavailable') },
    })
    const enqueueHarness = createCommandHarness({ slug: 'arena-map', mapRevision: ref(4), outbox: enqueueOutbox })
    await expect(enqueueHarness.actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })).resolves.toMatchObject({
      dispatched: false,
      outboxError: expect.stringContaining('IndexedDB unavailable'),
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    const missingOutbox = wrapOutbox(createTestOutbox(), {
      claimForSend: async () => ({ claimed: false as const, reason: 'missing' as const }),
    })
    const missingHarness = createCommandHarness({ slug: 'arena-map', mapRevision: ref(4), outbox: missingOutbox })
    await expect(missingHarness.actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('disappeared'),
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    const leasedOutbox = wrapOutbox(createTestOutbox(), {
      claimForSend: async () => ({ claimed: false as const, reason: 'leased-by-another-owner' as const }),
    })
    const leasedHarness = createCommandHarness({ slug: 'arena-map', mapRevision: ref(4), outbox: leasedOutbox })
    await expect(leasedHarness.actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('another tab'),
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('treats local processing failures after accepted responses as terminal and requests reconciliation', async () => {
    const outbox = createTestOutbox()
    const requestReconciliation = vi.fn()
    const applyPersistedMap = vi.fn(() => { throw new Error('adoption failed') })
    mockTerminalResponse({
      ok: true,
      opId: 'op_adoptfail',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      map: mapFixture(),
    })
    const { actions } = createCommandHarness({
      slug: 'arena-map',
      mapRevision: ref(4),
      applyPersistedMap,
      requestReconciliation,
      outbox,
    })

    const result = await actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })

    expect(result).toMatchObject({ dispatched: true, message: expect.stringContaining('adoption failed') })
    expect(result).not.toHaveProperty('uncertain')
    await expect(outbox.get(result.opId!)).resolves.toBeNull()
    expect(requestReconciliation).toHaveBeenCalledWith({ request: MAP_API_PATHS.moveToken, response: expect.any(Object) })
  })

  it('treats sheet-adoption failures as terminal and not uncertain', async () => {
    const outbox = createTestOutbox()
    const requestReconciliation = vi.fn()
    const applySheetUpdate = vi.fn(() => { throw new Error('sheet adoption failed') })
    mockTerminalResponse({
      ok: true,
      opId: 'op_sheetfail',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      sheetUpdates: [{ kind: 'pokemon', slug: 'pikachu', sheet: { slug: 'pikachu' } }],
    })
    const { actions } = createCommandHarness({
      slug: 'arena-map',
      mapRevision: ref(4),
      applySheetUpdate,
      requestReconciliation,
      outbox,
    })

    const result = await actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })

    expect(result).toMatchObject({ dispatched: true, message: expect.stringContaining('sheet adoption failed') })
    expect(result).not.toHaveProperty('uncertain')
    await expect(outbox.get(result.opId!)).resolves.toBeNull()
    expect(requestReconciliation).toHaveBeenCalled()
  })

  it('surfaces outbox acknowledgement failures without changing accepted or rejected semantics', async () => {
    for (const terminal of ['accepted', 'rejected'] as const) {
      apiMocks.postJson.mockReset()
      const delegate = createTestOutbox()
      const outbox = wrapOutbox(delegate, {
        acknowledgeTerminal: async () => { throw new Error('delete failed') },
      })
      apiMocks.postJson.mockImplementation(async (_request: string, body: unknown) => {
        const command = commandRecord(body)
        return terminal === 'accepted'
          ? { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [] }
          : { ok: false, opId: command.opId, mapSlug: command.mapSlug, reason: 'conflict', message: 'Conflict', currentRevision: 5 }
      })
      const { actions } = createCommandHarness({ slug: 'arena-map', mapRevision: ref(4), outbox })

      const result = await actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })

      expect(result.dispatched).toBe(terminal === 'accepted')
      expect(result.uncertain).not.toBe(true)
      expect(result.outboxError).toContain('delete failed')
      await expect(delegate.get(result.opId!)).resolves.toMatchObject({ state: 'sending' })
    }
  })

  it('acknowledges accepted realtime events for queued, sending, and uncertain entries', async () => {
    for (const state of ['queued', 'sending', 'uncertain'] as const) {
      const outbox = createTestOutbox()
      const queued = await enqueueStoredCommand(outbox)
      const entry = state === 'queued'
        ? queued
        : state === 'sending'
          ? await makeStoredCommandSending(outbox, queued)
          : await makeStoredCommandUncertain(outbox, queued)
      const requestReconciliation = vi.fn()
      const { actions } = createCommandHarness({ slug: 'arena-map', outbox, requestReconciliation })
      await actions.refreshOutboxEntries()

      const result = await actions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(entry))

      expect(result, state).toEqual({ status: 'acknowledged', opId: entry.opId })
      await expect(outbox.get(entry.opId), state).resolves.toBeNull()
      expect(actions.outboxEntries.value, state).toEqual([])
      expect(requestReconciliation, state).toHaveBeenCalledTimes(1)
      expect(apiMocks.postJson, state).not.toHaveBeenCalled()
    }
  })

  it('treats missing or mismatched accepted realtime entries as non-local or invalid without deleting outbox data', async () => {
    const emptyActions = createCommandHarness({ slug: 'arena-map' }).actions
    const missingEntry = await enqueueStoredCommand(createTestOutbox())
    await expect(emptyActions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(missingEntry))).resolves.toEqual({
      status: 'not-local',
      opId: missingEntry.opId,
    })

    const outbox = createTestOutbox()
    const entry = await enqueueStoredCommand(outbox)
    const { actions } = createCommandHarness({ slug: 'arena-map', outbox })

    await expect(actions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(entry, {
      channel: 'map:other-map',
      mapSlug: 'other-map',
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: 'other-map',
        revision: 5,
        scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
        payload: { placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } },
      }],
    }))).resolves.toMatchObject({ status: 'invalid' })
    await expect(outbox.get(entry.opId)).resolves.toMatchObject({ opId: entry.opId })
  })

  it('allows a different selected profile or client ID to acknowledge the shared realtime outbox entry', async () => {
    const outbox = createTestOutbox()
    const entry = await enqueueStoredCommand(outbox, {
      authContext: { role: 'player', profileId: parsePlayerProfileId('profile_ash00000') },
      body: storedMoveCommandBody({ profileId: 'profile_ash00000' }),
    })
    const { actions } = createCommandHarness({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: ref<PlayerProfileId | null>(parsePlayerProfileId('profile_misty000')),
      outbox,
    })

    const result = await actions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(entry, {
      clientId: 'different-tab',
    }))

    expect(result).toEqual({ status: 'acknowledged', opId: entry.opId })
    await expect(outbox.get(entry.opId)).resolves.toBeNull()
  })

  it('handles repeated accepted realtime acknowledgements harmlessly', async () => {
    const outbox = createTestOutbox()
    const entry = await enqueueStoredCommand(outbox)
    const event = acceptedRealtimeEventForEntry(entry)
    const { actions } = createCommandHarness({ slug: 'arena-map', outbox, requestReconciliation: vi.fn() })

    await expect(actions.acknowledgeAcceptedRealtimeEvent(event)).resolves.toEqual({
      status: 'acknowledged',
      opId: entry.opId,
    })
    await expect(actions.acknowledgeAcceptedRealtimeEvent(event)).resolves.toEqual({
      status: 'not-local',
      opId: entry.opId,
    })
    await expect(outbox.get(entry.opId)).resolves.toBeNull()
  })

  it('keeps the outbox entry and reports an error when realtime acknowledgement deletion fails', async () => {
    const delegate = createTestOutbox()
    const entry = await enqueueStoredCommand(delegate)
    const outbox = wrapOutbox(delegate, {
      acknowledgeTerminal: async () => { throw new Error('delete failed') },
    })
    const { actions } = createCommandHarness({ slug: 'arena-map', outbox })
    await actions.refreshOutboxEntries()

    const result = await actions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(entry))

    expect(result).toMatchObject({ status: 'error', opId: entry.opId, message: expect.stringContaining('delete failed') })
    expect(actions.outboxRecoveryStatus.value).toBe('error')
    expect(actions.outboxRecoveryError.value).toContain('delete failed')
    await expect(delegate.get(entry.opId)).resolves.toMatchObject({ opId: entry.opId })
    expect(actions.outboxEntries.value).toHaveLength(1)
  })

  it('requests aggregate reconciliation from accepted realtime events without route-specific presentation callbacks', async () => {
    const outbox = createTestOutbox()
    const entry = await enqueueStoredCommand(outbox, { requestPath: MAP_API_PATHS.resolveMove })
    const requestReconciliation = vi.fn()
    const onCommandAccepted = vi.fn()
    const onCommandStarted = vi.fn()
    const { actions } = createCommandHarness({
      slug: 'arena-map',
      outbox,
      requestReconciliation,
      onCommandAccepted,
      onCommandStarted,
    })

    await expect(actions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(entry))).resolves.toEqual({
      status: 'acknowledged',
      opId: entry.opId,
    })

    expect(requestReconciliation).toHaveBeenCalledTimes(1)
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.resolveMove,
      response: {
        ok: true,
        opId: entry.opId,
        mapSlug: 'arena-map',
        previousRevision: 4,
        revision: 5,
        patches: expect.any(Array),
      },
    })
    expect(onCommandAccepted).not.toHaveBeenCalled()
    expect(onCommandStarted).not.toHaveBeenCalled()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('reconciles and acknowledges revision-gap or map-patch-invalid accepted realtime events', async () => {
    const gapOutbox = createTestOutbox()
    const gapEntry = await enqueueStoredCommand(gapOutbox)
    const gapReconciliation = vi.fn()
    const gapActions = createCommandHarness({ slug: 'arena-map', outbox: gapOutbox, requestReconciliation: gapReconciliation }).actions

    await expect(gapActions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(gapEntry, {
      previousRevision: 8,
      revision: 9,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: 'arena-map',
        revision: 9,
        scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
        payload: { placementId: 'token-pikachu', position: { x: 9, y: 0, z: 1 } },
      }],
    }))).resolves.toEqual({ status: 'acknowledged', opId: gapEntry.opId })
    await expect(gapOutbox.get(gapEntry.opId)).resolves.toBeNull()
    expect(gapReconciliation).toHaveBeenCalledTimes(1)

    const invalidPatchOutbox = createTestOutbox()
    const invalidPatchEntry = await enqueueStoredCommand(invalidPatchOutbox)
    const invalidPatchReconciliation = vi.fn()
    const invalidPatchActions = createCommandHarness({
      slug: 'arena-map',
      outbox: invalidPatchOutbox,
      requestReconciliation: invalidPatchReconciliation,
    }).actions

    await expect(invalidPatchActions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(invalidPatchEntry, {
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: 'arena-map',
        revision: 5,
        scopes: [{ kind: 'token', placementId: 'missing-token', field: 'position' }],
        payload: { placementId: 'missing-token' },
      }],
    }))).resolves.toEqual({ status: 'acknowledged', opId: invalidPatchEntry.opId })
    await expect(invalidPatchOutbox.get(invalidPatchEntry.opId)).resolves.toBeNull()
    expect(invalidPatchReconciliation).toHaveBeenCalledTimes(1)
  })

  it('keeps acknowledged realtime operations terminal when reconciliation fails', async () => {
    const outbox = createTestOutbox()
    const entry = await makeStoredCommandUncertain(outbox, await enqueueStoredCommand(outbox))
    const requestReconciliation = vi.fn(async () => { throw new Error('snapshot failed') })
    const { actions } = createCommandHarness({ slug: 'arena-map', outbox, requestReconciliation })

    const result = await actions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(entry))

    expect(result).toMatchObject({ status: 'error', opId: entry.opId, message: expect.stringContaining('snapshot failed') })
    await expect(outbox.get(entry.opId)).resolves.toBeNull()
    expect(actions.outboxRecoveryStatus.value).toBe('error')
    expect(actions.outboxRecoveryError.value).toContain('snapshot failed')
    expect(actions.outboxRecoveryError.value).not.toContain('unknown')
  })

  it('blocks new commands between accepted realtime acknowledgement and reconciliation completion', async () => {
    const outbox = createTestOutbox()
    const entry = await enqueueStoredCommand(outbox)
    const reconciliation = deferred<void>()
    const requestReconciliation = vi.fn(() => reconciliation.promise)
    const { actions } = createCommandHarness({ slug: 'arena-map', outbox, requestReconciliation })

    const acknowledgement = actions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(entry))
    await vi.waitFor(() => expect(requestReconciliation).toHaveBeenCalledTimes(1))
    await flushMicrotasks()

    expect(actions.outboxRecoveryStatus.value).toBe('synchronizing')
    await expect(actions.moveToken({ placementId: 'token-pikachu', position: { x: 4, y: 0, z: 1 } })).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('Synchronizing accepted command'),
    })

    reconciliation.resolve()
    await expect(acknowledgement).resolves.toEqual({ status: 'acknowledged', opId: entry.opId })
    expect(actions.outboxRecoveryStatus.value).toBe('idle')
  })

  it('handles SSE-first and HTTP-first terminal races without retrying or duplicate acknowledgement side effects', async () => {
    const sseFirstOutbox = createTestOutbox()
    const sseFirstReconciliation = vi.fn()
    const sseFirstAccepted = vi.fn()
    let releaseHttp!: () => void
    let sentBody: Record<string, unknown> | null = null
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      sentBody = commandRecord(body)
      await new Promise<void>((resolve) => { releaseHttp = resolve })
      return {
        ok: true,
        opId: sentBody.opId,
        mapSlug: sentBody.mapSlug,
        previousRevision: 4,
        revision: 5,
        patches: [],
      }
    })
    const sseFirstActions = createCommandHarness({
      slug: 'arena-map',
      mapRevision: ref(4),
      outbox: sseFirstOutbox,
      requestReconciliation: sseFirstReconciliation,
      onCommandAccepted: sseFirstAccepted,
    }).actions
    const httpResult = sseFirstActions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })
    await vi.waitFor(() => expect(sentBody).not.toBeNull())
    const sseEntry = await sseFirstOutbox.get(sentBody!.opId as string)
    expect(sseEntry).not.toBeNull()

    await expect(sseFirstActions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(sseEntry!))).resolves.toEqual({
      status: 'acknowledged',
      opId: sseEntry!.opId,
    })
    expect(sseFirstActions.status.value).toBe('saving')
    await expect(sseFirstActions.moveToken({ placementId: 'token-pikachu', position: { x: 4, y: 0, z: 1 } })).resolves.toMatchObject({
      dispatched: false,
      message: 'A live-play command is already in flight.',
    })
    releaseHttp()
    await expect(httpResult).resolves.toMatchObject({ dispatched: true, opId: sseEntry!.opId })
    await expect(sseFirstOutbox.get(sseEntry!.opId)).resolves.toBeNull()
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(sseFirstReconciliation).toHaveBeenCalledTimes(1)
    expect(sseFirstAccepted).toHaveBeenCalledTimes(1)

    apiMocks.postJson.mockReset()
    const httpFirstOutbox = createTestOutbox()
    const httpFirstReconciliation = vi.fn()
    const httpFirstAccepted = vi.fn()
    let httpFirstOpId = ''
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      const command = commandRecord(body)
      httpFirstOpId = command.opId as string
      return { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [] }
    })
    const httpFirstActions = createCommandHarness({
      slug: 'arena-map',
      mapRevision: ref(4),
      outbox: httpFirstOutbox,
      requestReconciliation: httpFirstReconciliation,
      onCommandAccepted: httpFirstAccepted,
    }).actions
    await expect(httpFirstActions.moveToken({ placementId: 'token-pikachu', position: { x: 3, y: 0, z: 1 } })).resolves.toMatchObject({ dispatched: true })
    await expect(httpFirstOutbox.get(httpFirstOpId)).resolves.toBeNull()

    const absentEntry = await enqueueStoredCommand(createTestOutbox(), { body: storedMoveCommandBody({ opId: httpFirstOpId }) })
    await expect(httpFirstActions.acknowledgeAcceptedRealtimeEvent(acceptedRealtimeEventForEntry(absentEntry))).resolves.toEqual({
      status: 'not-local',
      opId: httpFirstOpId,
    })
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(httpFirstReconciliation).not.toHaveBeenCalled()
    expect(httpFirstAccepted).toHaveBeenCalledTimes(1)
  })

  it('lets two tabs race to acknowledge the same accepted realtime operation safely', async () => {
    const outbox = createTestOutbox()
    const entry = await enqueueStoredCommand(outbox)
    const event = acceptedRealtimeEventForEntry(entry)
    const first = createCommandHarness({ slug: 'arena-map', outbox, leaseOwner: 'tab-one', requestReconciliation: vi.fn() }).actions
    const second = createCommandHarness({ slug: 'arena-map', outbox, leaseOwner: 'tab-two', requestReconciliation: vi.fn() }).actions

    const results = await Promise.all([
      first.acknowledgeAcceptedRealtimeEvent(event),
      second.acknowledgeAcceptedRealtimeEvent(event),
    ])

    expect(results.map((result) => result.status).sort()).toEqual(expect.arrayContaining(['acknowledged']))
    expect(results.every((result) => result.status === 'acknowledged' || result.status === 'not-local')).toBe(true)
    await expect(outbox.get(entry.opId)).resolves.toBeNull()
  })

  it('stores explicit auth context and blocks missing auth roles before enqueue', async () => {
    const profileId = ref<PlayerProfileId | null>(parsePlayerProfileId('profile_ash00000'))
    const capturedAuthContexts: unknown[] = []
    const capturedBodies: Record<string, unknown>[] = []
    const delegate = createTestOutbox()
    const outbox = wrapOutbox(delegate, {
      enqueue: async (input) => {
        capturedAuthContexts.push(input.authContext)
        capturedBodies.push(input.body)
        return delegate.enqueue(input)
      },
    })
    mockTerminalResponse({ ok: true, opId: 'op_authctx01', mapSlug: 'arena-map', previousRevision: 4, revision: 5, patches: [] })
    const playerHarness = createCommandHarness({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: profileId,
      mapRevision: ref(4),
      outbox,
    })
    await playerHarness.actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })

    profileId.value = null
    await playerHarness.actions.turnToken({ placementId: 'token-pikachu', facing: 'north-west' })

    const gmHarness = createCommandHarness({ slug: 'arena-map', authRole: ref<AuthRole>('gm'), mapRevision: ref(4), outbox })
    await gmHarness.actions.deleteToken({ placementId: 'token-pikachu' })

    expect(capturedAuthContexts).toEqual([
      { role: 'player', profileId: 'profile_ash00000' },
      { role: 'player', profileId: null },
      { role: 'gm', profileId: null },
    ])
    expect(capturedBodies[0]).toMatchObject({ profileId: 'profile_ash00000' })
    expect(capturedBodies[1]).not.toHaveProperty('profileId')
    expect(capturedBodies[2]).not.toHaveProperty('profileId')

    apiMocks.postJson.mockReset()
    const missingAuthEnqueue = vi.fn()
    const missingAuthOutbox = wrapOutbox(createTestOutbox(), { enqueue: missingAuthEnqueue })
    const missingAuthHarness = createCommandHarness({
      slug: 'arena-map',
      authRole: ref<AuthRole | null>(null),
      mapRevision: ref(4),
      outbox: missingAuthOutbox,
    })
    await expect(missingAuthHarness.actions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('auth role'),
    })
    expect(missingAuthEnqueue).not.toHaveBeenCalled()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('does not enqueue or send locally invalid resolveMove intents', async () => {
    const enqueue = vi.fn()
    const outbox = wrapOutbox(createTestOutbox(), { enqueue })
    const { actions } = createCommandHarness({ slug: 'arena-map', map: ref(mapFixture()), mapRevision: ref(4), outbox })

    const result = await actions.resolveMove({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: '',
        moveName: 'Thunderbolt',
        selection: { kind: 'self' },
      } as never,
    })

    expect(result).toMatchObject({ dispatched: false, move: null })
    expect(enqueue).not.toHaveBeenCalled()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('posts live-play spawn commands once through explicit opId command dispatch', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    const placement = {
      id: 'token-eevee',
      sheetKind: 'pokemon' as const,
      sheetSlug: 'eevee',
      position: { x: 2, y: 0, z: 2 },
      facing: 'south-east' as const,
      turned: false,
    }
    mockTerminalResponse({
      ok: true,
      opId: 'op_serverspawn',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })
    const result = await actions.spawnToken({ placement })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.spawnToken, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-eevee', field: 'spawn' }],
      payload: { placement },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
  })

  it('posts live-play send-out commands with trainer and spawned token scopes', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    mockTerminalResponse({
      ok: true,
      opId: 'op_serversendout',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement: {
        id: 'token-eevee',
        sheetKind: 'pokemon',
        sheetSlug: 'eevee',
        position: { x: 3, y: 0, z: 2 },
      },
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: profileId,
      mapRevision,
    })
    const result = await actions.sendOutPokemon({
      trainerId: 'trainer-ash',
      pokemonSlug: 'eevee',
      tokenId: 'token-eevee',
      position: { x: 3, y: 0, z: 2 },
      facing: 'south-east',
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.sendOutPokemon, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON,
      scopes: [
        { kind: 'token', placementId: 'trainer-ash', field: 'sendOut' },
        { kind: 'token', placementId: 'token-eevee', field: 'spawn' },
      ],
      payload: {
        trainerId: 'trainer-ash',
        pokemonSlug: 'eevee',
        tokenId: 'token-eevee',
        position: { x: 3, y: 0, z: 2 },
        facing: 'south-east',
      },
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
  })

  it('posts live-play move commands with opId, baseRevision, and the selected player profile id', async () => {
    const map = mapFixture()
    const applyPersistedMap = vi.fn()
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    const mapRevision = ref(4)
    mockTerminalResponse({
      ok: true,
      opId: 'op_servermove01',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement: map.placements[0],
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: profileId,
      mapRevision,
      applyPersistedMap,
    })
    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
      pathLength: 3,
    })

    expect(result.dispatched).toBe(true)
    expect(actions.status.value).toBe('idle')
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.moveToken, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
      payload: {
        placementId: 'token-pikachu',
        position: { x: 2, y: 0, z: 1 },
        pathLength: 3,
      },
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
  })

  it('posts live-play Attack of Opportunity state updates through the command dispatcher', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    mockTerminalResponse({
      ok: true,
      opId: 'op_serveraoo001',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: profileId,
      mapRevision,
    })
    const payload = { action: 'clear-prompt' as const, promptId: 'aoo-1' }
    const result = await actions.updateAttackOfOpportunity(payload)

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.updateAttackOfOpportunity, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
      scopes: [{ kind: 'map', lane: 'metadata' }],
      payload,
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
  })

  it('posts live-play start-of-turn modal updates through the command dispatcher', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    mockTerminalResponse({
      ok: true,
      opId: 'op_serverturn01',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
    })
    const payload = { action: 'dismiss' as const, activeId: 'token-pikachu', round: 2 }
    const result = await actions.updateStartTurnModal(payload)

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.updateStartTurnModal, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL,
      scopes: [{ kind: 'map', lane: 'metadata' }],
      payload,
      clientId: 'ssr',
    }))
  })

  it('posts live-play delete commands through the command dispatcher', async () => {
    const map = { ...mapFixture(), placements: [] }
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    mockTerminalResponse({
      ok: true,
      opId: 'op_serverdelete',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })
    const result = await actions.deleteToken({ placementId: 'token-pikachu' })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.deleteToken, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'delete' }],
      payload: { placementId: 'token-pikachu' },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
  })

  it('posts authoritative throwPokeball commands with placement-derived sheet scopes and adopts the response', async () => {
    const map = {
      ...mapFixture(),
      placements: [
        { id: 'trainer-ash', sheetKind: 'trainer' as const, sheetSlug: 'ash', position: { x: 0, y: 0, z: 0 } },
        ...mapFixture().placements,
      ],
    }
    const mapRevision = ref(4)
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const trainerUpdate = { kind: 'trainer' as const, slug: 'ash', sheet: { slug: 'ash', revision: 3 } }
    const targetUpdate = { kind: 'pokemon' as const, slug: 'bulbasaur', sheet: { slug: 'bulbasaur', revision: 2 } }
    const capture = {
      trainerId: 'trainer-ash',
      targetId: 'target-token',
      targetSlug: 'bulbasaur',
      pokeballName: 'Basic Ball',
      result: { id: 'capture-server-1', hit: true, success: true },
    }
    mockTerminalResponse({
      ok: true,
      opId: 'op_servercapture',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      sheetUpdates: [trainerUpdate, targetUpdate],
      capture,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: profileId,
      map: ref(map),
      mapRevision,
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.throwPokeball({
      trainerPlacementId: 'trainer-ash',
      targetPlacementId: 'target-token',
      pokeballName: 'Basic Ball',
    })

    expect(result.dispatched).toBe(true)
    expect(result.response?.capture).toBe(capture)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.throwPokeball, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
      scopes: [
        { kind: 'token', placementId: 'trainer-ash', field: 'action' },
        { kind: 'token', placementId: 'target-token', field: 'action' },
        { kind: 'map', lane: 'metadata' },
        { kind: 'map', lane: 'placements' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'pokemonRoster' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'bulbasaur', field: 'caughtBall' },
      ],
      payload: {
        trainerPlacementId: 'trainer-ash',
        targetPlacementId: 'target-token',
        pokeballName: 'Basic Ball',
      },
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledTimes(2)
    expect(applySheetUpdate).toHaveBeenNthCalledWith(1, trainerUpdate)
    expect(applySheetUpdate).toHaveBeenNthCalledWith(2, targetUpdate)
  })

  it('omits profileId from throwPokeball requests when no player profile is selected', async () => {
    const map = {
      ...mapFixture(),
      placements: [
        { id: 'trainer-ash', sheetKind: 'trainer' as const, sheetSlug: 'ash', position: { x: 0, y: 0, z: 0 } },
        ...mapFixture().placements,
      ],
    }
    mockTerminalResponse({
      ok: true,
      opId: 'op_servercapturegm',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      map,
      capture: { trainerId: 'trainer-ash', targetId: 'target-token', targetSlug: 'bulbasaur', pokeballName: 'Basic Ball', result: { id: 'capture-server-2' } },
    })

    const actions = useTestLivePlayCommands({ slug: 'arena-map', map: ref(map), mapRevision: ref(4) })
    await actions.throwPokeball({ trainerPlacementId: 'trainer-ash', targetPlacementId: 'target-token', pokeballName: 'Basic Ball' })

    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.throwPokeball, expect.not.objectContaining({
      profileId: expect.anything(),
    }))
  })

  it('posts live-play HP sheet commands to map token command routes and applies returned sheet updates', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const sheetUpdate = {
      kind: 'pokemon' as const,
      slug: 'pikachu',
      sheet: { slug: 'pikachu', combat: { currentHp: 8, injuries: 1 }, revision: 3 },
    }
    mockTerminalResponse({
      ok: true,
      opId: 'op_serverhp001',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement: map.placements[0],
      sheetUpdates: [sheetUpdate],
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      map: ref(map),
      mapRevision,
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.modifyHp({
      placementId: 'token-pikachu',
      currentHp: 8,
      injuries: 1,
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson).not.toHaveBeenCalledWith(SHEET_API_PATHS.save, expect.anything())
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.modifyHp, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      scopes: [
        { kind: 'token', placementId: 'token-pikachu', field: 'hp' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'hp' },
      ],
      payload: {
        placementId: 'token-pikachu',
        currentHp: 8,
        injuries: 1,
      },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledWith(sheetUpdate)
  })

  it('posts live-play Grant XP sheet commands to map token command routes', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applySheetUpdate = vi.fn()
    const sheetUpdate = {
      kind: 'pokemon' as const,
      slug: 'pikachu',
      sheet: { slug: 'pikachu', totalExp: 140, level: 12, revision: 3 },
    }
    mockTerminalResponse({
      ok: true,
      opId: 'op_serverxp001',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      map,
      placement: map.placements[0],
      sheetUpdates: [sheetUpdate],
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      map: ref(map),
      mapRevision,
      applySheetUpdate,
    })
    const result = await actions.grantExperience({
      placementId: 'token-pikachu',
      amount: 100,
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.grantExperience, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
      scopes: [
        { kind: 'token', placementId: 'token-pikachu', field: 'experience' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'experience' },
      ],
      payload: {
        placementId: 'token-pikachu',
        amount: 100,
      },
      clientId: 'ssr',
    }))
    expect(applySheetUpdate).toHaveBeenCalledWith(sheetUpdate)
  })

  it('posts live-play useMove commands with sheet scope and applies authoritative map and sheet results', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const sheetUpdate = {
      kind: 'pokemon' as const,
      slug: 'pikachu',
      sheet: {
        slug: 'pikachu',
        revision: 3,
        moveUsage: { daily: { thunderbolt: { moveName: 'Thunderbolt', uses: 1 } } },
      },
    }
    mockTerminalResponse({
      ok: true,
      opId: 'op_usemoveclient',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement: map.placements[0],
      sheetUpdates: [sheetUpdate],
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      map: ref(map),
      mapRevision,
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.useMove({
      placementId: 'token-pikachu',
      moveName: 'Thunderbolt',
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson).not.toHaveBeenCalledWith(SHEET_API_PATHS.save, expect.anything())
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.useMove, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
      scopes: [
        { kind: 'token', placementId: 'token-pikachu', field: 'moveUsage' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'moveUsage' },
      ],
      payload: {
        placementId: 'token-pikachu',
        moveName: 'Thunderbolt',
      },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledWith(sheetUpdate)
  })

  it('posts live-play initiative commands through the command dispatcher', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    mockTerminalResponse({
      ok: true,
      opId: 'op_initclient1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })
    const result = await actions.setInitiative({ tokenId: 'token-pikachu', initiative: 17 })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.setInitiative, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }],
      payload: { tokenId: 'token-pikachu', initiative: 17 },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)

    await actions.nextInitiative({ orderIds: ['token-pikachu', 'target-token'], activeId: null, round: 1 })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.nextInitiative, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }, { kind: 'map', lane: 'metadata' }],
      payload: { orderIds: ['token-pikachu', 'target-token'], activeId: null, round: 1 },
    }))

    await actions.previousInitiative({ orderIds: ['token-pikachu', 'target-token'], activeId: 'target-token', round: 1 })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.previousInitiative, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }, { kind: 'map', lane: 'metadata' }],
      payload: { orderIds: ['token-pikachu', 'target-token'], activeId: 'target-token', round: 1 },
    }))
  })

  it('does not dispatch a rapid second initiative advance while the first is pending', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    let resolveFirst!: (response: unknown) => void
    apiMocks.postJson.mockImplementationOnce((_request: string, body: unknown) => new Promise((resolve) => {
      resolveFirst = (response) => resolve(alignTerminalResponseToCommand(response, body))
    }))

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })

    const advancePrecondition = { orderIds: ['token-pikachu', 'target-token'], activeId: null, round: 1 }
    const first = actions.nextInitiative(advancePrecondition)
    const second = await actions.nextInitiative(advancePrecondition)

    expect(second).toEqual({
      dispatched: false,
      message: 'A live-play command is already in flight.',
    })
    for (let attempts = 0; attempts < 20 && apiMocks.postJson.mock.calls.length === 0; attempts += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(actions.status.value).toBe('saving')

    resolveFirst({
      ok: true,
      opId: 'op_initclient2',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })
    await expect(first).resolves.toMatchObject({ dispatched: true })
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(actions.status.value).toBe('idle')
  })

  it('posts live-play hazard, terrain, and field-effect commands through the command dispatcher', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    mockTerminalResponse({
      ok: true,
      opId: 'op_mapeffect1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })

    await actions.placeHazard({ hazard: { kind: 'spikes', x: 1, y: 0, z: 2 } })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.placeHazard, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
      scopes: [{ kind: 'map', lane: 'hazards' }],
      payload: { hazard: { kind: 'spikes', x: 1, y: 0, z: 2 } },
      clientId: 'ssr',
    }))

    await actions.buildTerrainVoxel({ voxel: { x: 2, y: 0, z: 2, materialId: 'meadow_grass' } })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.buildTerrainVoxel, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
      scopes: [{ kind: 'map', lane: 'terrain' }],
      payload: { voxel: { x: 2, y: 0, z: 2, materialId: 'meadow_grass' } },
      clientId: 'ssr',
    }))

    await actions.removeTerrainVoxel({ cell: { x: 2, y: 0, z: 2 } })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.removeTerrainVoxel, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
      scopes: [{ kind: 'map', lane: 'terrain' }],
      payload: { cell: { x: 2, y: 0, z: 2 } },
    }))

    await actions.setFieldEffect({ category: 'weather', kind: 'sunny', rounds: 5, weatherMode: 'replace' })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.setFieldEffect, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: { category: 'weather', kind: 'sunny', rounds: 5, weatherMode: 'replace' },
    }))

    await actions.removeFieldEffect({ category: 'weather', kind: 'sunny' })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.removeFieldEffect, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: { category: 'weather', kind: 'sunny' },
    }))

    await actions.tickFieldEffectDurations()
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.tickFieldEffectDurations, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: {},
    }))

    expect(applyPersistedMap).toHaveBeenCalledWith(map)
  })

  it('posts live-play scene commands through the command dispatcher', async () => {
    const map = mapFixture()
    mockTerminalResponse({
      ok: true,
      opId: 'op_setscene1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
    })

    await actions.setScene({ name: 'Moonlit Rooftop' })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.setScene, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
      scopes: [{ kind: 'map', lane: 'scene' }],
      payload: { name: 'Moonlit Rooftop' },
      clientId: 'ssr',
    }))

    await actions.setScene({ name: null })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.setScene, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
      scopes: [{ kind: 'map', lane: 'scene' }],
      payload: { name: null },
    }))
  })

  it('blocks live-play token commands while realtime reconciliation is pending', async () => {
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      livePlayCommandBlocked: ref(true),
      livePlayCommandBlockedMessage: ref('Reconnected. Reloading the authoritative map before live play resumes.'),
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result).toEqual({
      dispatched: false,
      message: 'Reconnected. Reloading the authoritative map before live play resumes.',
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()
    expect(actions.status.value).toBe('error')
    expect(actions.lastError.value).toBe('Reconnected. Reloading the authoritative map before live play resumes.')
  })

  it('blocks newly-created commands with the new-command gate before generating or storing an operation', async () => {
    const delegate = createTestOutbox()
    const enqueue = vi.fn(delegate.enqueue.bind(delegate))
    const outbox = wrapOutbox(delegate, { enqueue })
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      outbox,
      newCommandBlocked: ref(true),
      newCommandBlockedMessage: ref('Resolve pending live-play command first.'),
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result).toEqual({
      dispatched: false,
      message: 'Resolve pending live-play command first.',
    })
    expect('opId' in result).toBe(false)
    expect(enqueue).not.toHaveBeenCalled()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
    await expect(delegate.list()).resolves.toEqual([])
  })

  it('checks the new-command gate before resolveMove builds local intent scopes', async () => {
    const delegate = createTestOutbox()
    const enqueue = vi.fn(delegate.enqueue.bind(delegate))
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      outbox: wrapOutbox(delegate, { enqueue }),
      newCommandBlocked: ref(true),
      newCommandBlockedMessage: ref('Checking pending durable commands.'),
    })

    const result = await actions.resolveMove({
      intent: {} as never,
      candidateScopePlacementIds: ['token-pikachu'],
    })

    expect(result).toEqual({
      dispatched: false,
      message: 'Checking pending durable commands.',
      move: null,
    })
    expect(enqueue).not.toHaveBeenCalled()
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('lets retries ignore the new-command gate while keeping the fundamental command block', async () => {
    const retryOutbox = createTestOutbox()
    const retryEntry = await enqueueStoredCommand(retryOutbox)
    const retryActions = createCommandHarness({
      slug: 'arena-map',
      outbox: retryOutbox,
      newCommandBlocked: ref(true),
      newCommandBlockedMessage: ref('Pending commands block only new envelopes.'),
    }).actions
    mockTerminalResponseOnce({
      ok: true,
      opId: retryEntry.opId,
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
    })

    await expect(retryActions.retryOutboxCommand(retryEntry.opId)).resolves.toMatchObject({
      dispatched: true,
      opId: retryEntry.opId,
    })
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)

    apiMocks.postJson.mockReset()
    const blockedOutbox = createTestOutbox()
    const blockedEntry = await enqueueStoredCommand(blockedOutbox)
    const blockedActions = createCommandHarness({
      slug: 'arena-map',
      outbox: blockedOutbox,
      livePlayCommandBlocked: ref(true),
      livePlayCommandBlockedMessage: ref('Snapshot reconciliation is required.'),
      newCommandBlocked: ref(false),
    }).actions

    await expect(blockedActions.retryOutboxCommand(blockedEntry.opId)).resolves.toMatchObject({
      dispatched: false,
      message: 'Snapshot reconciliation is required.',
      opId: blockedEntry.opId,
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('applies accepted patch-only command responses when the current map revision matches', async () => {
    const map = ref(mapFixture())
    const requestReconciliation = vi.fn()
    const applyPersistedMap = vi.fn()
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      map,
      mapRevision: ref(4),
      applyPersistedMap,
      requestReconciliation,
    })
    mockTerminalResponse({
      ok: true,
      opId: 'op_patchonly1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: 'arena-map',
        revision: 5,
        scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
        payload: {
          placementId: 'token-pikachu',
          position: { x: 3, y: 0, z: 2 },
          facing: 'north-east',
          turned: false,
        },
      }],
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 3, y: 0, z: 2 },
    })

    expect(result.dispatched).toBe(true)
    expect(map.value.revision).toBe(5)
    expect(map.value.placements[0]).toMatchObject({ position: { x: 3, y: 0, z: 2 }, facing: 'north-east' })
    expect(applyPersistedMap).not.toHaveBeenCalled()
    expect(requestReconciliation).not.toHaveBeenCalled()
  })

  it('requests reconciliation when an accepted command returns a reconciliation patch instead of a map', async () => {
    const requestReconciliation = vi.fn()
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation,
    })
    mockTerminalResponse({
      ok: true,
      opId: 'op_reconcile1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED,
        mapSlug: 'arena-map',
        revision: 5,
        scopes: [{ kind: 'map', lane: 'metadata' }],
        payload: { reason: 'patch unavailable' },
      }],
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result.dispatched).toBe(true)
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.moveToken,
      response: expect.objectContaining({ opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE), revision: 5 }),
    })
  })

  it('posts live-play turn commands and surfaces command rejections', async () => {
    const actions = useTestLivePlayCommands({ slug: 'arena-map', mapRevision: ref(4) })
    mockTerminalResponse({
      ok: false,
      opId: 'op_turnreject1',
      mapSlug: 'arena-map',
      reason: 'unauthorized',
      message: 'Token is not linked to selected player profile',
      currentRevision: 4,
    })

    const result = await actions.turnToken({
      placementId: 'token-pikachu',
      facing: 'north-east',
    })

    expect(result).toMatchObject({
      dispatched: false,
      message: 'Token is not linked to selected player profile',
    })
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.turnToken, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'facing' }],
      payload: {
        placementId: 'token-pikachu',
        facing: 'north-east',
      },
      clientId: 'ssr',
    }))
    expect(actions.status.value).toBe('error')
    expect(actions.lastError.value).toBe('Token is not linked to selected player profile')

    actions.clearError()
    expect(actions.status.value).toBe('idle')
    expect(actions.lastError.value).toBeNull()
  })

  it('requests reconciliation and clears local error state after stale live-play rejections reconcile successfully', async () => {
    const requestReconciliation = vi.fn()
    const onCommandStarted = vi.fn()
    const onCommandRejected = vi.fn()
    const onCommandErrorCleared = vi.fn()
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation,
      onCommandStarted,
      onCommandRejected,
      onCommandErrorCleared,
    })
    mockTerminalResponse({
      ok: false,
      opId: 'op_stalemove01',
      mapSlug: 'arena-map',
      reason: 'stale-revision',
      message: 'Map revision 4 is stale; current revision is 5.',
      currentRevision: 5,
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result).toMatchObject({
      dispatched: false,
      message: 'Map revision 4 is stale; current revision is 5.',
    })
    expect(onCommandStarted).toHaveBeenCalledTimes(1)
    expect(onCommandRejected).toHaveBeenCalledWith({
      reason: 'stale-revision',
      message: 'Map revision 4 is stale; current revision is 5.',
      response: expect.objectContaining({ currentRevision: 5 }),
    })
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.moveToken,
      response: expect.objectContaining({ reason: 'stale-revision', currentRevision: 5 }),
    })
    expect(actions.status.value).toBe('idle')
    expect(actions.lastError.value).toBeNull()
    expect(onCommandErrorCleared).toHaveBeenCalledTimes(1)
  })

  it('keeps the stale rejection visible when required reconciliation fails', async () => {
    const requestReconciliation = vi.fn().mockRejectedValue(new Error('Runtime sheet reload failed'))
    const onCommandErrorCleared = vi.fn()
    const onCommandFailed = vi.fn()
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation,
      onCommandErrorCleared,
      onCommandFailed,
    })
    mockTerminalResponse({
      ok: false,
      opId: 'op_stalemove02',
      mapSlug: 'arena-map',
      reason: 'stale-revision',
      message: 'Map revision 4 is stale; current revision is 5.',
      currentRevision: 5,
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result).toMatchObject({
      dispatched: false,
      message: 'Map revision 4 is stale; current revision is 5.',
    })
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.moveToken,
      response: expect.objectContaining({ reason: 'stale-revision', currentRevision: 5 }),
    })
    expect(actions.status.value).toBe('error')
    expect(actions.lastError.value).toBe('Map revision 4 is stale; current revision is 5.')
    expect(onCommandErrorCleared).not.toHaveBeenCalled()
    expect(onCommandFailed).toHaveBeenCalledWith('Runtime sheet reload failed')
  })

  it('keeps live-play controls blocked when stale reconciliation sheet reload fails', async () => {
    const stateMachine = useLivePlayStateMachine({
      mapStatus: ref('idle'),
      realtimeStatus: ref('synced'),
    })
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation: () => stateMachine.reconcile(async () => {
        await Promise.all([
          Promise.resolve(),
          Promise.reject(new Error('Runtime sheet reload failed')),
        ])
      }),
      onCommandStarted: stateMachine.commandStarted,
      onCommandRejected: stateMachine.commandRejected,
      onCommandFailed: stateMachine.commandFailed,
      onCommandErrorCleared: stateMachine.clearCommandError,
    })
    mockTerminalResponse({
      ok: false,
      opId: 'op_staleinit01',
      mapSlug: 'arena-map',
      reason: 'stale-revision',
      message: 'Initiative order is stale; reload turn order.',
      currentRevision: 5,
    })

    await actions.nextInitiative({ orderIds: ['token-pikachu', 'target-token'], activeId: 'token-pikachu', round: 1 })

    expect(actions.status.value).toBe('error')
    expect(actions.lastError.value).toBe('Initiative order is stale; reload turn order.')
    expect(stateMachine.state.value).toBe('error')
    expect(stateMachine.notice.value).toBe('Runtime sheet reload failed')
    expect(stateMachine.commandsAllowed.value).toBe(false)
  })

  it('lets live-play controls resume when stale reconciliation reloads map and sheets successfully', async () => {
    const stateMachine = useLivePlayStateMachine({
      mapStatus: ref('idle'),
      realtimeStatus: ref('synced'),
    })
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation: () => stateMachine.reconcile(async () => {
        await Promise.all([
          Promise.resolve(),
          Promise.resolve(),
        ])
      }),
      onCommandStarted: stateMachine.commandStarted,
      onCommandRejected: stateMachine.commandRejected,
      onCommandFailed: stateMachine.commandFailed,
      onCommandErrorCleared: stateMachine.clearCommandError,
    })
    mockTerminalResponse({
      ok: false,
      opId: 'op_staleinit02',
      mapSlug: 'arena-map',
      reason: 'stale-revision',
      message: 'Initiative order is stale; reload turn order.',
      currentRevision: 5,
    })

    await actions.nextInitiative({ orderIds: ['token-pikachu', 'target-token'], activeId: 'token-pikachu', round: 1 })

    expect(actions.status.value).toBe('idle')
    expect(actions.lastError.value).toBeNull()
    expect(stateMachine.state.value).toBe('ready')
    expect(stateMachine.commandsAllowed.value).toBe(true)
  })

  it('requests reconciliation for stale-base conflicts and reports the rejection to state hooks', async () => {
    const requestReconciliation = vi.fn()
    const onCommandRejected = vi.fn()
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation,
      onCommandRejected,
    })
    mockTerminalResponse({
      ok: false,
      opId: 'op_conflict01',
      mapSlug: 'arena-map',
      reason: 'conflict',
      message: 'Command baseRevision 4 conflicts with accepted operation op_other at revision 5 on token token-pikachu position',
      currentRevision: 5,
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result).toMatchObject({
      dispatched: false,
      message: 'Command baseRevision 4 conflicts with accepted operation op_other at revision 5 on token token-pikachu position',
    })
    expect(onCommandRejected).toHaveBeenCalledWith({
      reason: 'conflict',
      message: 'Command baseRevision 4 conflicts with accepted operation op_other at revision 5 on token token-pikachu position',
      response: expect.objectContaining({ currentRevision: 5 }),
    })
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.moveToken,
      response: expect.objectContaining({ reason: 'conflict', currentRevision: 5 }),
    })
  })

  it('routes GM table action helpers without inventing a player profile id', async () => {
    const map = mapFixture()
    mockTerminalResponse({
      ok: true,
      opId: 'op_gmtableact',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      map: ref(map),
      mapRevision: ref(4),
    })

    await expect(actions.useManeuver({
      placementId: 'token-pikachu',
      maneuverName: 'Trip',
      targetPlacementId: 'target-token',
    })).resolves.toMatchObject({ dispatched: true })
    await expect(actions.useOrder({
      placementId: 'token-pikachu',
      orderName: 'Agility Training',
      targetPlacementId: 'target-token',
    })).resolves.toMatchObject({ dispatched: true })
    await expect(actions.useAbility({
      placementId: 'token-pikachu',
      abilityName: 'Sand Veil',
    })).resolves.toMatchObject({ dispatched: true })

    expect(apiMocks.postJson).toHaveBeenNthCalledWith(1, MAP_API_PATHS.useManeuver, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
      payload: {
        placementId: 'token-pikachu',
        maneuverName: 'Trip',
        targetPlacementId: 'target-token',
      },
    }))
    expect(apiMocks.postJson).toHaveBeenNthCalledWith(2, MAP_API_PATHS.useOrder, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
      payload: {
        placementId: 'token-pikachu',
        orderName: 'Agility Training',
        targetPlacementId: 'target-token',
      },
    }))
    expect(apiMocks.postJson).toHaveBeenNthCalledWith(3, MAP_API_PATHS.useAbility, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      payload: {
        placementId: 'token-pikachu',
        abilityName: 'Sand Veil',
      },
    }))
    for (const [, body] of apiMocks.postJson.mock.calls) {
      expect(body).not.toHaveProperty('profileId')
    }
    expect(apiMocks.postJson.mock.calls.map(([path]) => path)).not.toContain(SHEET_API_PATHS.save)
  })

  it('keeps the selected player profile on player table action helpers', async () => {
    const map = mapFixture()
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    mockTerminalResponse({
      ok: true,
      opId: 'op_playertableact',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: profileId,
      map: ref(map),
      mapRevision: ref(4),
    })

    await actions.useManeuver({ placementId: 'token-pikachu', maneuverName: 'Trip' })
    await actions.useOrder({ placementId: 'token-pikachu', orderName: 'Agility Training' })

    for (const [, body] of apiMocks.postJson.mock.calls) {
      expect(body).toMatchObject({ profileId: 'profile_ash00000' })
    }
  })

  it('routes table action helpers through the shared dispatcher and applies returned sheet updates', async () => {
    const map = mapFixture()
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const sheetUpdate = {
      kind: 'pokemon' as const,
      slug: 'pikachu',
      path: 'data/pokemon/pikachu.json',
      sheet: { slug: 'pikachu', combat: { conditions: ['Burned'] } },
    }
    mockTerminalResponse({
      ok: true,
      opId: 'op_serverability',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      action: { type: 'ability', placementId: 'token-pikachu', name: 'Healer' },
      sheetUpdates: [sheetUpdate],
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: profileId,
      map: ref(map),
      mapRevision: ref(4),
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.useAbility({
      placementId: 'token-pikachu',
      abilityName: 'Healer',
      targetPlacementId: 'target-token',
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.useAbility, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      scopes: [
        { kind: 'token', placementId: 'token-pikachu', field: 'action' },
        { kind: 'map', lane: 'metadata' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'ability' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'bulbasaur', field: 'ability' },
      ],
      payload: {
        placementId: 'token-pikachu',
        abilityName: 'Healer',
        targetPlacementId: 'target-token',
      },
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledWith(sheetUpdate)
  })

  it('posts resolveMove once with a normalized intent, authoritative revision, profile id, and conservative scopes', async () => {
    const map = mapFixture()
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    const move = resolvedMoveFixture()
    mockTerminalResponse({
      ok: true,
      opId: 'op_resolvemove1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.MOVE_STATE,
        mapSlug: 'arena-map',
        revision: 5,
        scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'action' }],
        payload: { command: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE, move },
      }],
      move,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: profileId,
      map: ref(map),
      mapRevision: ref(4),
    })
    const result = await actions.resolveMove({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: ' token-pikachu ',
        moveName: ' Thunderbolt ',
        selection: { kind: 'single-target', targetPlacementId: ' target-token ' },
      },
      candidateScopePlacementIds: ['target-token'],
    })

    expect(result).toMatchObject({ dispatched: true, move })
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.resolveMove, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
      payload: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'token-pikachu',
        moveName: 'Thunderbolt',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      },
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
    const [, body] = apiMocks.postJson.mock.calls[0]
    expect(body.payload).not.toHaveProperty('candidateScopePlacementIds')
    expect(body.scopes).toEqual(expect.arrayContaining([
      { kind: 'token', placementId: 'token-pikachu', field: 'action' },
      { kind: 'token', placementId: 'token-pikachu', field: 'moveUsage' },
      { kind: 'token', placementId: 'token-pikachu', field: 'position' },
      { kind: 'token', placementId: 'target-token', field: 'hp' },
      { kind: 'map', lane: 'metadata' },
      { kind: 'map', lane: 'hazards' },
      { kind: 'map', lane: 'fieldEffects' },
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'moveUsage' },
      { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'bulbasaur', field: 'conditions' },
    ]))
  })

  it('does not invent a profile id for GM resolveMove dispatch', async () => {
    const move = resolvedMoveFixture()
    mockTerminalResponse({
      ok: true,
      opId: 'op_resolvemove2',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      move,
    })

    const actions = useTestLivePlayCommands({ slug: 'arena-map', map: ref(mapFixture()), mapRevision: ref(4) })
    await actions.resolveMove({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'token-pikachu',
        moveName: 'Thunderbolt',
        selection: { kind: 'self' },
      },
    })

    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.resolveMove, expect.not.objectContaining({
      profileId: expect.anything(),
    }))
  })

  it('adopts complete resolveMove map and sheet updates before resolving with the move result', async () => {
    const map = mapFixture()
    const authoritativeMap = { ...map, revision: 5, metadata: { resolved: true } }
    const move = resolvedMoveFixture()
    const callOrder: string[] = []
    const applyPersistedMap = vi.fn(() => { callOrder.push('map') })
    const applySheetUpdate = vi.fn(() => { callOrder.push('sheet') })
    const sheetUpdate = { kind: 'pokemon' as const, slug: 'pikachu', sheet: { slug: 'pikachu', revision: 2 } }
    mockTerminalResponse({
      ok: true,
      opId: 'op_resolvemove3',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.MOVE_STATE,
        mapSlug: 'arena-map',
        revision: 5,
        scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'action' }],
        payload: { command: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE, move },
      }],
      map: authoritativeMap,
      sheetUpdates: [sheetUpdate],
      move,
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      map: ref(map),
      mapRevision: ref(4),
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.resolveMove({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'token-pikachu',
        moveName: 'Thunderbolt',
        selection: { kind: 'single-target', targetPlacementId: 'target-token' },
      },
    })
    callOrder.push('resolved')

    expect(result.move).toEqual(move)
    expect(applyPersistedMap).toHaveBeenCalledTimes(1)
    expect(applySheetUpdate).toHaveBeenCalledTimes(1)
    expect(callOrder).toEqual(['map', 'sheet', 'resolved'])
  })

  it('locally rejects invalid resolveMove intents without creating an operation or HTTP request', async () => {
    const onCommandBlocked = vi.fn()
    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      map: ref(mapFixture()),
      mapRevision: ref(4),
      onCommandBlocked,
    })

    const result = await actions.resolveMove({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: '',
        moveName: 'Thunderbolt',
        selection: { kind: 'self' },
      } as never,
    })

    expect(result).toMatchObject({ dispatched: false, move: null, message: expect.stringContaining('Move intent is invalid') })
    expect(apiMocks.postJson).not.toHaveBeenCalled()
    expect(onCommandBlocked).toHaveBeenCalledWith(expect.stringContaining('Move intent is invalid'))
  })

  it('returns dispatched true with a presentation error and requests reconciliation when resolveMove presentation data is invalid', async () => {
    const requestReconciliation = vi.fn()
    const onCommandFailed = vi.fn()
    mockTerminalResponse({
      ok: true,
      opId: 'op_resolvemove4',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.MOVE_STATE,
        mapSlug: 'arena-map',
        revision: 5,
        scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'action' }],
        payload: { command: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE, move: { invalid: true } },
      }],
    })

    const actions = useTestLivePlayCommands({
      slug: 'arena-map',
      map: ref(mapFixture()),
      mapRevision: ref(4),
      requestReconciliation,
      onCommandFailed,
    })
    const result = await actions.resolveMove({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'token-pikachu',
        moveName: 'Thunderbolt',
        selection: { kind: 'self' },
      },
    })

    expect(result).toMatchObject({ dispatched: true, move: null, presentationError: expect.stringContaining('presentation data') })
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.resolveMove,
      response: expect.objectContaining({ opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE) }),
    })
    expect(onCommandFailed).toHaveBeenCalledWith(expect.stringContaining('presentation data'))
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
  })

  it('refreshes filtered outbox entries for the exact map/auth/profile context without sending or mutating', async () => {
    const outbox = createTestOutbox()
    const profileA = parsePlayerProfileId('profile_ash00000')
    const profileB = parsePlayerProfileId('profile_misty000')
    const currentBody = storedMoveCommandBody({ profileId: profileA })
    const otherMapBody = storedMoveCommandBody({ mapSlug: 'other-map', profileId: profileA })
    const profileBBody = storedMoveCommandBody({ profileId: profileB })

    const currentEntry = await enqueueStoredCommand(outbox, {
      body: currentBody,
      authContext: { role: 'player', profileId: profileA },
      now: 1,
    })
    await enqueueStoredCommand(outbox, {
      body: otherMapBody,
      authContext: { role: 'player', profileId: profileA },
      now: 2,
    })
    const gmEntry = await enqueueStoredCommand(outbox, {
      body: storedMoveCommandBody(),
      authContext: { role: 'gm', profileId: null },
      now: 3,
    })
    const profileBEntry = await enqueueStoredCommand(outbox, {
      body: profileBBody,
      authContext: { role: 'player', profileId: profileB },
      now: 4,
    })
    const unprofiledEntry = await enqueueStoredCommand(outbox, {
      body: storedMoveCommandBody(),
      authContext: { role: 'player', profileId: null },
      now: 5,
    })

    const role = ref<AuthRole>('player')
    const profileId = ref<PlayerProfileId | null>(profileA)
    const { actions } = createCommandHarness({
      slug: 'arena-map',
      authRole: role,
      playerProfileId: profileId,
      outbox,
    })

    await expect(actions.refreshOutboxEntries()).resolves.toEqual([currentEntry])
    expect(actions.outboxEntries.value.map((entry) => entry.opId)).toEqual([currentEntry.opId])
    expect(actions.hasPendingOutboxCommands.value).toBe(true)
    expect(apiMocks.postJson).not.toHaveBeenCalled()
    await expect(outbox.get(currentEntry.opId)).resolves.toMatchObject({ state: 'queued' })

    profileId.value = profileB
    await expect(actions.refreshOutboxEntries()).resolves.toEqual([profileBEntry])
    expect(actions.outboxEntries.value.map((entry) => entry.opId)).toEqual([profileBEntry.opId])

    profileId.value = null
    await expect(actions.refreshOutboxEntries()).resolves.toEqual([unprofiledEntry])
    expect(actions.outboxEntries.value.map((entry) => entry.opId)).toEqual([unprofiledEntry.opId])

    role.value = 'gm'
    await expect(actions.refreshOutboxEntries()).resolves.toEqual([gmEntry])
    expect(actions.outboxEntries.value.map((entry) => entry.opId)).toEqual([gmEntry.opId])

    const list = vi.fn(outbox.list.bind(outbox))
    const missingAuthOutbox = wrapOutbox(outbox, { list })
    const missingAuthActions = useTestLivePlayCommands({
      slug: 'arena-map',
      authRole: ref<AuthRole | null>(null),
      outbox: missingAuthOutbox,
    })
    await expect(missingAuthActions.refreshOutboxEntries()).rejects.toThrow('auth role')
    expect(missingAuthActions.outboxEntries.value).toEqual([])
    expect(missingAuthActions.outboxRecoveryStatus.value).toBe('error')
    expect(list).not.toHaveBeenCalled()
  })

  it('recovers expired sending leases without HTTP and exposes only the matching context', async () => {
    const outbox = createTestOutbox()
    const expired = await enqueueStoredCommand(outbox, { now: 1 })
    const unexpired = await enqueueStoredCommand(outbox, { now: 2 })
    const otherMap = await enqueueStoredCommand(outbox, {
      body: storedMoveCommandBody({ mapSlug: 'other-map' }),
      now: 3,
    })

    await outbox.claimForSend({ opId: expired.opId, leaseOwner: 'expired-owner', now: 10, leaseDurationMs: 1 })
    await outbox.claimForSend({ opId: unexpired.opId, leaseOwner: 'active-owner', now: Date.now(), leaseDurationMs: 60_000 })
    await outbox.claimForSend({ opId: otherMap.opId, leaseOwner: 'other-owner', now: 10, leaseDurationMs: 1 })

    const { actions } = createCommandHarness({ slug: 'arena-map', outbox })
    await expect(actions.recoverInterruptedOutboxCommands()).resolves.toMatchObject([
      { opId: expired.opId, state: 'uncertain' },
      { opId: unexpired.opId, state: 'sending' },
    ])

    expect(apiMocks.postJson).not.toHaveBeenCalled()
    await expect(outbox.get(expired.opId)).resolves.toMatchObject({ state: 'uncertain' })
    await expect(outbox.get(unexpired.opId)).resolves.toMatchObject({ state: 'sending' })
    await expect(outbox.get(otherMap.opId)).resolves.toMatchObject({ state: 'uncertain' })
    expect(actions.outboxEntries.value.map((entry) => entry.opId)).toEqual([expired.opId, unexpired.opId])

    await expect(actions.recoverInterruptedOutboxCommands()).resolves.toMatchObject([
      { opId: expired.opId, state: 'uncertain' },
      { opId: unexpired.opId, state: 'sending' },
    ])
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('retries a stored command with its exact route, body, profile, base revision, scopes, payload, and opId', async () => {
    const delegate = createTestOutbox()
    const profileId = parsePlayerProfileId('profile_ash00000')
    const storedBody = storedMoveCommandBody({
      baseRevision: 37,
      profileId,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
      payload: { placementId: 'token-pikachu', position: { x: 5, y: 0, z: 4 }, pathLength: 9 },
    })
    const entry = await enqueueStoredCommand(delegate, {
      requestPath: MAP_API_PATHS.moveToken,
      body: storedBody,
      authContext: { role: 'player', profileId },
    })
    const enqueue = vi.fn(delegate.enqueue.bind(delegate))
    const outbox = wrapOutbox(delegate, { enqueue })
    const requestReconciliation = vi.fn()
    const { actions } = createCommandHarness({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: ref(profileId),
      outbox,
      requestReconciliation,
    })

    let postedRequest: string | null = null
    let postedBody: unknown = null
    apiMocks.postJson.mockImplementation(async (request: string, body: unknown) => {
      expect(actions.status.value).toBe('saving')
      expect(actions.outboxRecoveryStatus.value).toBe('retrying')
      postedRequest = request
      postedBody = body
      const command = commandRecord(body)
      return { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 37, revision: 38, patches: [] }
    })

    const result = await actions.retryOutboxCommand(entry.opId)

    expect(result).toMatchObject({ dispatched: true, opId: entry.opId })
    expect(postedRequest).toBe(MAP_API_PATHS.moveToken)
    expect(postedBody).toStrictEqual(storedBody)
    expect(enqueue).not.toHaveBeenCalled()
    expect(requestReconciliation).toHaveBeenCalledTimes(1)
    await expect(delegate.get(entry.opId)).resolves.toBeNull()
    expect(actions.outboxEntries.value).toEqual([])
    expect(actions.outboxRecoveryStatus.value).toBe('idle')
  })

  it('does not send retry HTTP for map/auth mismatches, missing entries, unexpired leases, or concurrent retries', async () => {
    const mapMismatchOutbox = createTestOutbox()
    const mapMismatch = await enqueueStoredCommand(mapMismatchOutbox, {
      body: storedMoveCommandBody({ mapSlug: 'other-map' }),
    })
    const mapMismatchActions = createCommandHarness({ slug: 'arena-map', outbox: mapMismatchOutbox }).actions
    await expect(mapMismatchActions.retryOutboxCommand(mapMismatch.opId)).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('belongs to map other-map'),
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()
    await expect(mapMismatchOutbox.get(mapMismatch.opId)).resolves.toMatchObject({ state: 'queued' })

    const authMismatchOutbox = createTestOutbox()
    const authMismatch = await enqueueStoredCommand(authMismatchOutbox, { authContext: { role: 'gm', profileId: null } })
    const authMismatchActions = createCommandHarness({
      slug: 'arena-map',
      authRole: ref<AuthRole>('player'),
      playerProfileId: ref(null),
      outbox: authMismatchOutbox,
    }).actions
    await expect(authMismatchActions.retryOutboxCommand(authMismatch.opId)).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('different auth/profile context'),
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    const missingActions = createCommandHarness({ slug: 'arena-map', outbox: createTestOutbox() }).actions
    await expect(missingActions.retryOutboxCommand(nextStoredOpId('missing'))).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('no longer present'),
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    const leasedOutbox = createTestOutbox()
    const leased = await enqueueStoredCommand(leasedOutbox)
    await leasedOutbox.claimForSend({ opId: leased.opId, leaseOwner: 'other-tab', now: Date.now(), leaseDurationMs: 60_000 })
    const leasedActions = createCommandHarness({ slug: 'arena-map', outbox: leasedOutbox }).actions
    await expect(leasedActions.retryOutboxCommand(leased.opId)).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('already leased'),
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    const delegate = createTestOutbox()
    const claimBlocked = await enqueueStoredCommand(delegate)
    const claimBlockedOutbox = wrapOutbox(delegate, {
      claimForSend: async () => ({ claimed: false as const, reason: 'leased-by-another-owner' as const }),
    })
    const claimBlockedActions = createCommandHarness({ slug: 'arena-map', outbox: claimBlockedOutbox }).actions
    await expect(claimBlockedActions.retryOutboxCommand(claimBlocked.opId)).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('another tab'),
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()

    const concurrentOutbox = createTestOutbox()
    const concurrent = await enqueueStoredCommand(concurrentOutbox)
    const concurrentActions = createCommandHarness({ slug: 'arena-map', outbox: concurrentOutbox }).actions
    let releasePost!: () => void
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      await new Promise<void>((resolve) => { releasePost = resolve })
      const command = commandRecord(body)
      return { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [] }
    })
    const first = concurrentActions.retryOutboxCommand(concurrent.opId)
    const second = concurrentActions.retryOutboxCommand(concurrent.opId)
    await vi.waitFor(() => expect(apiMocks.postJson).toHaveBeenCalledTimes(1))
    releasePost()
    const results = await Promise.all([first, second])
    expect(results.filter((result) => result.dispatched)).toHaveLength(1)
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
  })

  it('removes recovered entries for all terminal retry outcomes and keeps transport or invalid responses uncertain', async () => {
    const terminalCases = [
      {
        name: 'accepted',
        response: (body: Record<string, unknown>) => ({ ok: true, opId: body.opId, mapSlug: body.mapSlug, previousRevision: 4, revision: 5, patches: [] }),
        dispatched: true,
      },
      {
        name: 'rejected',
        response: (body: Record<string, unknown>) => ({ ok: false, opId: body.opId, mapSlug: body.mapSlug, reason: 'conflict', message: 'Conflict', currentRevision: 5 }),
        dispatched: false,
      },
      {
        name: 'duplicate accepted',
        response: (body: Record<string, unknown>) => ({
          ok: true,
          duplicate: true,
          opId: body.opId,
          original: { ok: true, opId: body.opId, mapSlug: body.mapSlug, previousRevision: 4, revision: 5, patches: [] },
        }),
        dispatched: true,
      },
      {
        name: 'duplicate rejected',
        response: (body: Record<string, unknown>) => ({
          ok: true,
          duplicate: true,
          opId: body.opId,
          original: { ok: false, opId: body.opId, mapSlug: body.mapSlug, reason: 'stale-revision', message: 'Stale', currentRevision: 5 },
        }),
        dispatched: false,
      },
    ] as const

    for (const terminalCase of terminalCases) {
      apiMocks.postJson.mockReset()
      const outbox = createTestOutbox()
      const entry = await makeStoredCommandUncertain(outbox, await enqueueStoredCommand(outbox))
      apiMocks.postJson.mockImplementation(async (_request: string, body: unknown) => terminalCase.response(commandRecord(body)))
      const { actions } = createCommandHarness({ slug: 'arena-map', outbox })

      const result = await actions.retryOutboxCommand(entry.opId)

      expect(result.dispatched, terminalCase.name).toBe(terminalCase.dispatched)
      expect(result.opId, terminalCase.name).toBe(entry.opId)
      expect(result.uncertain, terminalCase.name).not.toBe(true)
      await expect(outbox.get(entry.opId), terminalCase.name).resolves.toBeNull()
    }

    const transportOutbox = createTestOutbox()
    const transportEntry = await enqueueStoredCommand(transportOutbox)
    apiMocks.postJson.mockRejectedValueOnce(new Error('Network down'))
    const transportActions = createCommandHarness({ slug: 'arena-map', outbox: transportOutbox }).actions
    await expect(transportActions.retryOutboxCommand(transportEntry.opId)).resolves.toMatchObject({
      dispatched: false,
      uncertain: true,
      opId: transportEntry.opId,
    })
    await expect(transportOutbox.get(transportEntry.opId)).resolves.toMatchObject({
      state: 'uncertain',
      requestPath: transportEntry.requestPath,
      body: transportEntry.body,
    })

    const invalidOutbox = createTestOutbox()
    const invalidEntry = await enqueueStoredCommand(invalidOutbox)
    const applyPersistedMap = vi.fn()
    apiMocks.postJson.mockResolvedValueOnce({ ok: true, opId: invalidEntry.opId, mapSlug: 'other-map', previousRevision: 4, revision: 5, patches: [] })
    const invalidActions = createCommandHarness({ slug: 'arena-map', outbox: invalidOutbox, applyPersistedMap }).actions
    await expect(invalidActions.retryOutboxCommand(invalidEntry.opId)).resolves.toMatchObject({
      dispatched: false,
      uncertain: true,
      opId: invalidEntry.opId,
    })
    await expect(invalidOutbox.get(invalidEntry.opId)).resolves.toMatchObject({ state: 'uncertain' })
    expect(applyPersistedMap).not.toHaveBeenCalled()
  })

  it('adopts accepted recovery responses, reconciles once, and treats reconciliation/adoption failures as local only', async () => {
    const outbox = createTestOutbox()
    const entry = await enqueueStoredCommand(outbox)
    const map = mapFixture()
    const sheetUpdate = { kind: 'pokemon' as const, slug: 'pikachu', sheet: { slug: 'pikachu', revision: 9 } }
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const requestReconciliation = vi.fn()
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      const command = commandRecord(body)
      return {
        ok: true,
        opId: command.opId,
        mapSlug: command.mapSlug,
        previousRevision: 4,
        revision: 5,
        patches: [],
        map,
        sheetUpdates: [sheetUpdate],
      }
    })
    const { actions } = createCommandHarness({
      slug: 'arena-map',
      outbox,
      applyPersistedMap,
      applySheetUpdate,
      requestReconciliation,
    })

    await expect(actions.retryOutboxCommand(entry.opId)).resolves.toMatchObject({ dispatched: true, opId: entry.opId })
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledWith(sheetUpdate)
    expect(requestReconciliation).toHaveBeenCalledTimes(1)
    await expect(outbox.get(entry.opId)).resolves.toBeNull()

    const reconciliationOutbox = createTestOutbox()
    const reconciliationEntry = await enqueueStoredCommand(reconciliationOutbox)
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      const command = commandRecord(body)
      return { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [], map }
    })
    const reconciliationActions = createCommandHarness({
      slug: 'arena-map',
      outbox: reconciliationOutbox,
      requestReconciliation: vi.fn(async () => { throw new Error('reconcile failed') }),
    }).actions
    await expect(reconciliationActions.retryOutboxCommand(reconciliationEntry.opId)).resolves.toMatchObject({
      dispatched: true,
      message: expect.stringContaining('reconcile failed'),
    })
    await expect(reconciliationOutbox.get(reconciliationEntry.opId)).resolves.toBeNull()
    expect(reconciliationActions.outboxRecoveryStatus.value).toBe('idle')

    const adoptionOutbox = createTestOutbox()
    const adoptionEntry = await enqueueStoredCommand(adoptionOutbox)
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      const command = commandRecord(body)
      return { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [], map }
    })
    const adoptionActions = createCommandHarness({
      slug: 'arena-map',
      outbox: adoptionOutbox,
      applyPersistedMap: vi.fn(() => { throw new Error('adoption failed') }),
      requestReconciliation: vi.fn(),
    }).actions
    await expect(adoptionActions.retryOutboxCommand(adoptionEntry.opId)).resolves.toMatchObject({
      dispatched: true,
      message: expect.stringContaining('adoption failed'),
    })
    await expect(adoptionOutbox.get(adoptionEntry.opId)).resolves.toBeNull()
    expect(adoptionActions.outboxRecoveryStatus.value).toBe('error')
  })

  it('does not run route-specific resolve-move or capture presentation when retrying recovered commands', async () => {
    const resolveOutbox = createTestOutbox()
    const resolveBody = storedMoveCommandBody({
      type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'action' }],
      payload: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'token-pikachu',
        moveName: 'Thunderbolt',
        selection: { kind: 'self' },
      },
    })
    const resolveEntry = await enqueueStoredCommand(resolveOutbox, {
      requestPath: MAP_API_PATHS.resolveMove,
      body: resolveBody,
    })
    const move = resolvedMoveFixture()
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      const command = commandRecord(body)
      return { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [], move }
    })
    const resolveActions = createCommandHarness({ slug: 'arena-map', outbox: resolveOutbox }).actions
    const resolveResult = await resolveActions.retryOutboxCommand(resolveEntry.opId)
    expect(resolveResult).toMatchObject({ dispatched: true, response: expect.objectContaining({ move }) })
    expect(resolveResult).not.toHaveProperty('move')
    expect(resolveResult).not.toHaveProperty('presentationError')

    const captureOutbox = createTestOutbox()
    const capture = { trainerId: 'trainer-ash', targetId: 'target-token', targetSlug: 'bulbasaur', pokeballName: 'Basic Ball', result: { id: 'capture-1', success: true } }
    const captureBody = storedMoveCommandBody({
      type: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
      scopes: [
        { kind: 'token', placementId: 'trainer-ash', field: 'action' },
        { kind: 'token', placementId: 'target-token', field: 'action' },
        { kind: 'map', lane: 'metadata' },
        { kind: 'map', lane: 'placements' },
      ],
      payload: { trainerPlacementId: 'trainer-ash', targetPlacementId: 'target-token', pokeballName: 'Basic Ball' },
    })
    const captureEntry = await enqueueStoredCommand(captureOutbox, {
      requestPath: MAP_API_PATHS.throwPokeball,
      body: captureBody,
    })
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      const command = commandRecord(body)
      return { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [], capture }
    })
    const captureActions = createCommandHarness({ slug: 'arena-map', outbox: captureOutbox }).actions
    const captureResult = await captureActions.retryOutboxCommand(captureEntry.opId)
    expect(captureResult).toMatchObject({ dispatched: true, response: expect.objectContaining({ capture }) })
    expect(captureResult).not.toHaveProperty('capture')
  })

  it('keeps exposed outbox state synchronized after immediate enqueue, terminal, uncertainty, and refresh failures', async () => {
    const outbox = createTestOutbox()
    let releasePost!: () => void
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      expect(outboxActions.outboxEntries.value).toHaveLength(1)
      expect(outboxActions.outboxEntries.value[0]).toMatchObject({ state: 'sending' })
      await new Promise<void>((resolve) => { releasePost = resolve })
      const command = commandRecord(body)
      return { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [] }
    })
    const outboxActions = createCommandHarness({ slug: 'arena-map', outbox }).actions
    const terminalPromise = outboxActions.moveToken({ placementId: 'token-pikachu', position: { x: 2, y: 0, z: 1 } })
    await vi.waitFor(() => expect(apiMocks.postJson).toHaveBeenCalledTimes(1))
    expect(outboxActions.outboxEntries.value).toHaveLength(1)
    releasePost()
    await expect(terminalPromise).resolves.toMatchObject({ dispatched: true })
    expect(outboxActions.outboxEntries.value).toEqual([])

    const uncertainOutbox = createTestOutbox()
    apiMocks.postJson.mockRejectedValueOnce(new Error('Network down'))
    const uncertainActions = createCommandHarness({ slug: 'arena-map', outbox: uncertainOutbox }).actions
    const uncertainResult = await uncertainActions.moveToken({ placementId: 'token-pikachu', position: { x: 3, y: 0, z: 1 } })
    expect(uncertainResult).toMatchObject({ dispatched: false, uncertain: true })
    expect(uncertainActions.outboxEntries.value).toMatchObject([{ opId: uncertainResult.opId, state: 'uncertain' }])

    const delegate = createTestOutbox()
    const failingListOutbox = wrapOutbox(delegate, {
      list: async () => { throw new Error('list failed') },
    })
    apiMocks.postJson.mockImplementationOnce(async (_request: string, body: unknown) => {
      const command = commandRecord(body)
      return { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [] }
    })
    const failingListActions = createCommandHarness({ slug: 'arena-map', outbox: failingListOutbox }).actions
    await expect(failingListActions.moveToken({ placementId: 'token-pikachu', position: { x: 4, y: 0, z: 1 } })).resolves.toMatchObject({
      dispatched: true,
      outboxError: expect.stringContaining('list failed'),
    })
    expect(failingListActions.status.value).toBe('idle')
    expect(failingListActions.outboxRecoveryStatus.value).toBe('error')
  })

  it('keeps recovery loading separate from command saving status', async () => {
    let releaseRecovery!: () => void
    const delegate = createTestOutbox()
    const outbox = wrapOutbox(delegate, {
      recoverExpiredLeases: async () => {
        await new Promise<void>((resolve) => { releaseRecovery = resolve })
        return []
      },
    })
    const { actions } = createCommandHarness({ slug: 'arena-map', outbox })

    const recovery = actions.recoverInterruptedOutboxCommands()
    expect(actions.status.value).toBe('idle')
    expect(actions.outboxRecoveryStatus.value).toBe('loading')
    releaseRecovery()
    await expect(recovery).resolves.toEqual([])
    expect(actions.status.value).toBe('idle')
    expect(actions.outboxRecoveryStatus.value).toBe('idle')
    expect(apiMocks.postJson).not.toHaveBeenCalled()
  })

  it('maps resolveMove rejections and transport failures to dispatched false without retrying', async () => {
    const actions = useTestLivePlayCommands({ slug: 'arena-map', map: ref(mapFixture()), mapRevision: ref(4) })
    mockTerminalResponseOnce({
      ok: false,
      opId: 'op_resolvemove5',
      mapSlug: 'arena-map',
      reason: 'conflict',
      message: 'Resolve move conflict',
      currentRevision: 5,
    })

    await expect(actions.resolveMove({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'token-pikachu',
        moveName: 'Thunderbolt',
        selection: { kind: 'self' },
      },
    })).resolves.toMatchObject({ dispatched: false, move: null, message: 'Resolve move conflict' })

    apiMocks.postJson.mockRejectedValueOnce(new Error('Network down'))
    await expect(actions.resolveMove({
      intent: {
        schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
        placementId: 'token-pikachu',
        moveName: 'Thunderbolt',
        selection: { kind: 'self' },
      },
    })).resolves.toMatchObject({
      dispatched: false,
      move: null,
      uncertain: true,
      message: expect.stringContaining('server outcome'),
    })

    expect(apiMocks.postJson).toHaveBeenCalledTimes(2)
  })
})
