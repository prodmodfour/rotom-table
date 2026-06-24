import { describe, expect, it, vi } from 'vitest'
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb'
import { isAuthRole } from '#shared/auth'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
} from '#shared/livePlayCommands'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import {
  LIVE_PLAY_COMMAND_OUTBOX_DB_VERSION,
  LIVE_PLAY_COMMAND_OUTBOX_MAX_BODY_BYTES,
  LIVE_PLAY_COMMAND_OUTBOX_RECOVERY_ERROR,
  LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME,
  createLivePlayCommandOutbox,
  createLivePlayCommandOutboxFingerprint,
  type LivePlayCommandOutbox,
  type LivePlayCommandOutboxAuthContext,
} from '~/utils/livePlayCommandOutbox'

interface Harness {
  readonly databaseName: string
  readonly indexedDBFactory: IDBFactory
  readonly outbox: LivePlayCommandOutbox
}

let databaseSequence = 0

const gmAuth = { role: 'gm', profileId: null } as const satisfies LivePlayCommandOutboxAuthContext
const playerAuth = { role: 'player', profileId: null } as const satisfies LivePlayCommandOutboxAuthContext
const ashProfileId = parsePlayerProfileId('profile_ash00000')
const mistyProfileId = parsePlayerProfileId('profile_misty000')
const playerAshAuth = {
  role: 'player',
  profileId: ashProfileId,
} as const satisfies LivePlayCommandOutboxAuthContext
const playerMistyAuth = {
  role: 'player',
  profileId: mistyProfileId,
} as const satisfies LivePlayCommandOutboxAuthContext

const createHarness = (options: { readonly maxEntries?: number } = {}): Harness => {
  databaseSequence += 1
  const indexedDBFactory = new FakeIDBFactory() as unknown as IDBFactory
  const databaseName = `rotom-outbox-test-${databaseSequence}`
  const outbox = createLivePlayCommandOutbox({
    databaseName,
    indexedDBFactory,
    maxEntries: options.maxEntries,
  })
  return { databaseName, indexedDBFactory, outbox }
}

const buildBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_outbox0001',
  mapSlug: 'arena-map',
  baseRevision: 7,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [
    {
      kind: 'token',
      placementId: 'placement-001',
      field: 'position',
    },
  ],
  payload: {
    placementId: 'placement-001',
    position: { x: 4, y: 5, z: 0 },
  },
  clientId: 'client-001',
  ...overrides,
})

const enqueue = (
  outbox: LivePlayCommandOutbox,
  body: Record<string, unknown>,
  authContext: LivePlayCommandOutboxAuthContext = gmAuth,
  requestPath = '/api/maps/tokens/move',
  now = 100,
) => outbox.enqueue({ requestPath, body, authContext, now })

const openRawDatabase = (
  indexedDBFactory: IDBFactory,
  databaseName: string,
): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDBFactory.open(databaseName, LIVE_PLAY_COMMAND_OUTBOX_DB_VERSION)
  request.onerror = () => reject(request.error)
  request.onsuccess = () => resolve(request.result)
})

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onabort = () => reject(transaction.error)
  transaction.onerror = () => {
    // The abort handler reports the failure.
  }
})

const requestResult = <TResult>(request: IDBRequest<TResult>): Promise<TResult> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const putRawRecord = async (harness: Harness, record: Record<string, unknown>): Promise<void> => {
  await harness.outbox.inspect()
  const database = await openRawDatabase(harness.indexedDBFactory, harness.databaseName)
  const transaction = database.transaction(LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME, 'readwrite')
  transaction.objectStore(LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME).put(record)
  await transactionDone(transaction)
  database.close()
}

const getRawRecord = async (harness: Harness, opId: string): Promise<unknown> => {
  const database = await openRawDatabase(harness.indexedDBFactory, harness.databaseName)
  const transaction = database.transaction(LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME, 'readonly')
  const raw = await requestResult(transaction.objectStore(LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME).get(opId))
  await transactionDone(transaction)
  database.close()
  return raw
}

const createWrongKeyPathDatabase = async (harness: Harness): Promise<void> => {
  const request = harness.indexedDBFactory.open(
    harness.databaseName,
    LIVE_PLAY_COMMAND_OUTBOX_DB_VERSION,
  )
  request.onupgradeneeded = () => {
    request.result.createObjectStore(LIVE_PLAY_COMMAND_OUTBOX_STORE_NAME, {
      keyPath: 'wrongKey',
    })
  }
  await requestResult(request)
  request.result.close()
}

describe('live-play command outbox contracts', () => {
  it('persists an enqueued entry across outbox instances', async () => {
    const harness = createHarness()
    const body = buildBody()

    await enqueue(harness.outbox, body)
    const secondOutbox = createLivePlayCommandOutbox({
      databaseName: harness.databaseName,
      indexedDBFactory: harness.indexedDBFactory,
    })

    await expect(secondOutbox.get('op_outbox0001')).resolves.toMatchObject({
      opId: 'op_outbox0001',
      mapSlug: 'arena-map',
      commandType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      state: 'queued',
      attemptCount: 0,
    })
  })

  it('stores the exact JSON command body and detaches it from caller mutation', async () => {
    const { outbox } = createHarness()
    const body = buildBody({
      payload: {
        placementId: 'placement-001',
        position: { x: 4, y: 5, z: 0 },
        path: [{ x: 1, y: 2, z: 0 }],
      },
    })

    const entry = await enqueue(outbox, body)
    expect(JSON.parse(JSON.stringify(entry.body))).toEqual(JSON.parse(JSON.stringify(body)))

    ;(body.payload as { path: unknown[] }).path.push({ x: 9, y: 9, z: 0 })
    const stored = await outbox.get('op_outbox0001')
    expect(stored?.body).toEqual(entry.body)
    expect((stored?.body.payload as { path: unknown[] }).path).toHaveLength(1)
  })

  it('returns detached entries that cannot mutate stored data', async () => {
    const { outbox } = createHarness()
    const entry = await enqueue(outbox, buildBody())

    ;(entry.body.payload as { position: { x: number } }).position.x = 99
    ;(entry.authContext as { role: unknown }).role = 'player'

    const stored = await outbox.get('op_outbox0001')
    expect((stored?.body.payload as { position: { x: number } }).position.x).toBe(4)
    expect(stored?.authContext).toEqual(gmAuth)
  })

  it('re-enqueues the exact same command idempotently without resetting timestamps or attempts', async () => {
    const { outbox } = createHarness()
    const body = buildBody()
    const first = await enqueue(outbox, body, gmAuth, '/api/maps/tokens/move', 100)
    const claim = await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-a',
      now: 110,
      leaseDurationMs: 1_000,
    })
    expect(claim.claimed).toBe(true)

    const repeated = await enqueue(outbox, body, gmAuth, '/api/maps/tokens/move', 999)
    expect(repeated.createdAt).toBe(first.createdAt)
    expect(repeated.updatedAt).toBe(110)
    expect(repeated.attemptCount).toBe(1)
    expect(repeated.state).toBe('sending')
  })

  it('uses a deterministic fingerprint while preserving the originally stored body', async () => {
    const { outbox } = createHarness()
    const body = buildBody({ opId: 'op_outbox0002' })
    const reorderedBody = {
      clientId: body.clientId,
      payload: body.payload,
      scopes: body.scopes,
      type: body.type,
      baseRevision: body.baseRevision,
      mapSlug: body.mapSlug,
      opId: body.opId,
      schemaVersion: body.schemaVersion,
    }

    expect(createLivePlayCommandOutboxFingerprint({
      requestPath: '/api/maps/tokens/move',
      body,
      authContext: gmAuth,
    })).toBe(createLivePlayCommandOutboxFingerprint({
      requestPath: '/api/maps/tokens/move',
      body: reorderedBody,
      authContext: gmAuth,
    }))
    expect(createLivePlayCommandOutboxFingerprint({
      requestPath: '/api/maps/tokens/move-again',
      body,
      authContext: gmAuth,
    })).not.toBe(createLivePlayCommandOutboxFingerprint({
      requestPath: '/api/maps/tokens/move',
      body,
      authContext: gmAuth,
    }))
    expect(createLivePlayCommandOutboxFingerprint({
      requestPath: '/api/maps/tokens/move',
      body,
      authContext: playerAuth,
    })).not.toBe(createLivePlayCommandOutboxFingerprint({
      requestPath: '/api/maps/tokens/move',
      body,
      authContext: gmAuth,
    }))

    const first = await enqueue(outbox, body)
    const repeated = await enqueue(outbox, reorderedBody)
    expect(repeated.body).toEqual(first.body)
  })

  it('rejects reused opIds when the body, request path, or auth context changes', async () => {
    const { outbox } = createHarness()
    await enqueue(outbox, buildBody())

    await expect(enqueue(outbox, buildBody({ payload: { changed: true } }))).rejects.toMatchObject({
      code: 'live-play-command-outbox-idempotency-conflict',
    })
    await expect(enqueue(outbox, buildBody(), gmAuth, '/api/maps/tokens/turn')).rejects.toMatchObject({
      code: 'live-play-command-outbox-idempotency-conflict',
    })
    await expect(enqueue(outbox, buildBody(), playerAuth)).rejects.toMatchObject({
      code: 'live-play-command-outbox-idempotency-conflict',
    })
  })

  it('rejects invalid envelopes, non-API paths, cross-origin paths, non-JSON bodies, and oversized bodies before storage', async () => {
    const { outbox } = createHarness()

    await expect(enqueue(outbox, buildBody({ opId: 'bad' }))).rejects.toMatchObject({
      code: 'live-play-command-outbox-validation-error',
    })
    await expect(enqueue(outbox, buildBody({ opId: 'op_outbox0002' }), gmAuth, '/maps/tokens/move')).rejects.toMatchObject({
      code: 'live-play-command-outbox-validation-error',
    })
    await expect(enqueue(outbox, buildBody({ opId: 'op_outbox0003' }), gmAuth, 'https://example.com/api/maps/tokens/move')).rejects.toMatchObject({
      code: 'live-play-command-outbox-validation-error',
    })
    await expect(enqueue(outbox, buildBody({ opId: 'op_outbox0004' }), gmAuth, '/api/maps/tokens/move?x=1')).rejects.toMatchObject({
      code: 'live-play-command-outbox-validation-error',
    })
    await expect(enqueue(outbox, buildBody({ opId: 'op_outbox0005', payload: undefined }))).rejects.toMatchObject({
      code: 'live-play-command-outbox-validation-error',
    })
    const circularBody = buildBody({ opId: 'op_outbox0007' })
    ;(circularBody.payload as Record<string, unknown>).self = circularBody.payload
    await expect(enqueue(outbox, circularBody)).rejects.toMatchObject({
      code: 'live-play-command-outbox-validation-error',
    })
    await expect(enqueue(outbox, buildBody({
      opId: 'op_outbox0006',
      payload: { text: 'x'.repeat(LIVE_PLAY_COMMAND_OUTBOX_MAX_BODY_BYTES) },
    }))).rejects.toMatchObject({
      code: 'live-play-command-outbox-validation-error',
    })
    await expect(outbox.list()).resolves.toHaveLength(0)
  })

  it('rejects capacity overflow without evicting existing entries', async () => {
    const { outbox } = createHarness({ maxEntries: 2 })
    await enqueue(outbox, buildBody({ opId: 'op_outbox0001' }))
    await enqueue(outbox, buildBody({ opId: 'op_outbox0002' }))

    await expect(enqueue(outbox, buildBody({ opId: 'op_outbox0003' }))).rejects.toMatchObject({
      code: 'live-play-command-outbox-capacity-exceeded',
    })

    await expect(outbox.list()).resolves.toHaveLength(2)
    await expect(outbox.get('op_outbox0001')).resolves.not.toBeNull()
    await expect(outbox.get('op_outbox0002')).resolves.not.toBeNull()
  })

  it('lists entries with deterministic order and exact map/auth filters', async () => {
    const { outbox } = createHarness()
    await enqueue(outbox, buildBody({ opId: 'op_order003', mapSlug: 'arena-map' }), gmAuth, '/api/maps/tokens/move', 200)
    await enqueue(outbox, buildBody({ opId: 'op_order001', mapSlug: 'arena-map' }), playerAuth, '/api/maps/tokens/move', 100)
    await enqueue(outbox, buildBody({ opId: 'op_order002', mapSlug: 'cave-map' }), playerAshAuth, '/api/maps/tokens/move', 100)
    await enqueue(outbox, buildBody({ opId: 'op_order004', mapSlug: 'arena-map' }), playerMistyAuth, '/api/maps/tokens/move', 300)

    await expect(outbox.list()).resolves.toMatchObject([
      { opId: 'op_order001' },
      { opId: 'op_order002' },
      { opId: 'op_order003' },
      { opId: 'op_order004' },
    ])
    await expect(outbox.list({ mapSlug: 'arena-map' })).resolves.toMatchObject([
      { opId: 'op_order001' },
      { opId: 'op_order003' },
      { opId: 'op_order004' },
    ])
    await expect(outbox.list({ authContext: gmAuth })).resolves.toMatchObject([
      { opId: 'op_order003' },
    ])
    await expect(outbox.list({ authContext: playerAuth })).resolves.toMatchObject([
      { opId: 'op_order001' },
    ])
    await expect(outbox.list({ authContext: playerAshAuth })).resolves.toMatchObject([
      { opId: 'op_order002' },
    ])
    await expect(outbox.list({ authContext: playerMistyAuth })).resolves.toMatchObject([
      { opId: 'op_order004' },
    ])
    expect(isAuthRole((await outbox.list({ authContext: playerAshAuth }))[0]?.authContext.role)).toBe(true)
  })
})

describe('live-play command outbox state machine', () => {
  it('claims queued entries and increments attempts exactly once per successful claim', async () => {
    const { outbox } = createHarness()
    await enqueue(outbox, buildBody())

    const claimed = await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-a',
      now: 120,
      leaseDurationMs: 1_000,
    })
    expect(claimed).toMatchObject({
      claimed: true,
      entry: {
        state: 'sending',
        attemptCount: 1,
        lastAttemptAt: 120,
        leaseOwner: 'owner-a',
        leaseExpiresAt: 1_120,
      },
    })

    const secondClaim = await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-b',
      now: 130,
      leaseDurationMs: 1_000,
    })
    expect(secondClaim).toEqual({ claimed: false, reason: 'leased-by-another-owner' })
    await expect(outbox.get('op_outbox0001')).resolves.toMatchObject({ attemptCount: 1 })
  })

  it('allows only one winner across concurrent claimers', async () => {
    const harness = createHarness()
    await enqueue(harness.outbox, buildBody())
    const otherOutbox = createLivePlayCommandOutbox({
      databaseName: harness.databaseName,
      indexedDBFactory: harness.indexedDBFactory,
    })

    const results = await Promise.all([
      harness.outbox.claimForSend({
        opId: 'op_outbox0001',
        leaseOwner: 'owner-a',
        now: 120,
        leaseDurationMs: 1_000,
      }),
      otherOutbox.claimForSend({
        opId: 'op_outbox0001',
        leaseOwner: 'owner-b',
        now: 120,
        leaseDurationMs: 1_000,
      }),
    ])

    expect(results.filter((result) => result.claimed)).toHaveLength(1)
    expect(results.filter((result) => !result.claimed)).toHaveLength(1)
    await expect(harness.outbox.get('op_outbox0001')).resolves.toMatchObject({ attemptCount: 1 })
  })

  it('claims uncertain entries and clears the previous error', async () => {
    const { outbox } = createHarness()
    await enqueue(outbox, buildBody())
    await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-a',
      now: 100,
      leaseDurationMs: 1_000,
    })
    await outbox.markUncertain({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-a',
      error: 'network failed',
      now: 110,
    })

    const claimed = await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-b',
      now: 120,
      leaseDurationMs: 1_000,
    })

    expect(claimed).toMatchObject({
      claimed: true,
      entry: { state: 'sending', attemptCount: 2, leaseOwner: 'owner-b' },
    })
    if (claimed.claimed) expect(claimed.entry.lastError).toBeUndefined()
  })

  it('reclaims expired leases without changing immutable command data', async () => {
    const { outbox } = createHarness()
    const body = buildBody()
    await enqueue(outbox, body)
    await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-a',
      now: 100,
      leaseDurationMs: 10,
    })

    const reclaimed = await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-b',
      now: 111,
      leaseDurationMs: 1_000,
    })

    expect(reclaimed).toMatchObject({
      claimed: true,
      entry: {
        state: 'sending',
        leaseOwner: 'owner-b',
        attemptCount: 2,
      },
    })
    if (reclaimed.claimed) expect(reclaimed.entry.body).toEqual(body)
  })

  it('lets the current owner mark a send uncertain while stale owners cannot overwrite newer leases', async () => {
    const { outbox } = createHarness()
    const body = buildBody()
    await enqueue(outbox, body)
    await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-a',
      now: 100,
      leaseDurationMs: 10,
    })
    await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-b',
      now: 111,
      leaseDurationMs: 1_000,
    })

    const staleResult = await outbox.markUncertain({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-a',
      error: 'network ended',
      now: 120,
    })
    expect(staleResult).toMatchObject({ state: 'sending', leaseOwner: 'owner-b' })

    const uncertain = await outbox.markUncertain({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-b',
      error: '  network ended without response  ',
      now: 130,
    })
    expect(uncertain).toMatchObject({
      state: 'uncertain',
      attemptCount: 2,
      lastError: 'network ended without response',
    })
    expect(uncertain?.leaseOwner).toBeUndefined()
    expect(uncertain?.leaseExpiresAt).toBeUndefined()
    expect(uncertain?.body).toEqual(body)
  })

  it('deletes entries on terminal acknowledgement and stale uncertain transitions do not recreate them', async () => {
    const { outbox } = createHarness()
    await enqueue(outbox, buildBody())
    await outbox.claimForSend({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-a',
      now: 100,
      leaseDurationMs: 1_000,
    })

    await expect(outbox.acknowledgeTerminal('op_outbox0001')).resolves.toMatchObject({
      opId: 'op_outbox0001',
    })
    await expect(outbox.acknowledgeTerminal('op_outbox0001')).resolves.toBeNull()
    await expect(outbox.markUncertain({
      opId: 'op_outbox0001',
      leaseOwner: 'owner-a',
      error: 'late failure',
      now: 110,
    })).resolves.toBeNull()
    await expect(outbox.get('op_outbox0001')).resolves.toBeNull()
  })

  it('recovers expired sends to uncertain while preserving unexpired sends', async () => {
    const { outbox } = createHarness()
    await enqueue(outbox, buildBody({ opId: 'op_expired001' }))
    await enqueue(outbox, buildBody({ opId: 'op_active0001' }))
    await outbox.claimForSend({
      opId: 'op_expired001',
      leaseOwner: 'owner-a',
      now: 100,
      leaseDurationMs: 10,
    })
    await outbox.claimForSend({
      opId: 'op_active0001',
      leaseOwner: 'owner-b',
      now: 100,
      leaseDurationMs: 1_000,
    })

    const recovered = await outbox.recoverExpiredLeases(111)
    expect(recovered).toMatchObject([
      {
        opId: 'op_expired001',
        state: 'uncertain',
        attemptCount: 1,
        lastError: LIVE_PLAY_COMMAND_OUTBOX_RECOVERY_ERROR,
      },
    ])
    const recoveredEntry = await outbox.get('op_expired001')
    expect(recoveredEntry).toMatchObject({ state: 'uncertain' })
    expect(recoveredEntry?.leaseOwner).toBeUndefined()
    expect(recoveredEntry?.leaseExpiresAt).toBeUndefined()
    await expect(outbox.get('op_active0001')).resolves.toMatchObject({
      state: 'sending',
      leaseOwner: 'owner-b',
    })
  })

  it('explicitly discards entries without treating that as terminal proof', async () => {
    const { outbox } = createHarness()
    await enqueue(outbox, buildBody())

    await expect(outbox.discard('op_outbox0001')).resolves.toMatchObject({ opId: 'op_outbox0001' })
    await expect(outbox.discard('op_outbox0001')).resolves.toBeNull()
    await expect(outbox.hasPending()).resolves.toBe(false)
  })
})

describe('live-play command outbox IndexedDB adapter', () => {
  it('reports malformed records without returning them as commands', async () => {
    const harness = createHarness()
    await putRawRecord(harness, {
      schemaVersion: 1,
      opId: 'op_corrupt01',
      requestPath: '/not-api',
    })

    const inspection = await harness.outbox.inspect()
    expect(inspection.entries).toHaveLength(0)
    expect(inspection.corruptRecords).toMatchObject([
      {
        kind: 'malformed',
        opId: 'op_corrupt01',
      },
    ])
    await expect(harness.outbox.list()).resolves.toHaveLength(0)
    await expect(harness.outbox.get('op_corrupt01')).resolves.toBeNull()
  })

  it('reports unknown future schema versions and preserves them untouched', async () => {
    const harness = createHarness()
    await putRawRecord(harness, {
      schemaVersion: 2,
      opId: 'op_future001',
      futureField: true,
    })

    const inspection = await harness.outbox.inspect()
    expect(inspection.entries).toHaveLength(0)
    expect(inspection.corruptRecords).toMatchObject([
      {
        kind: 'unsupported-schema-version',
        opId: 'op_future001',
        schemaVersion: 2,
      },
    ])
    await expect(harness.outbox.list()).resolves.toHaveLength(0)
    await expect(getRawRecord(harness, 'op_future001')).resolves.toMatchObject({
      schemaVersion: 2,
      futureField: true,
    })
  })

  it('surfaces IndexedDB open failures as outbox-unavailable errors', async () => {
    const failingFactory = {
      open: () => {
        const request = {
          error: new DOMException('open denied', 'UnknownError'),
          onerror: null,
        } as unknown as IDBOpenDBRequest
        queueMicrotask(() => request.onerror?.call(request, new Event('error')))
        return request
      },
    } as unknown as IDBFactory
    const outbox = createLivePlayCommandOutbox({
      databaseName: 'rotom-failing-open',
      indexedDBFactory: failingFactory,
    })

    await expect(enqueue(outbox, buildBody())).rejects.toMatchObject({
      code: 'live-play-command-outbox-unavailable',
    })
  })

  it('surfaces IndexedDB write failures as outbox-unavailable errors', async () => {
    const harness = createHarness()
    await createWrongKeyPathDatabase(harness)

    await expect(enqueue(harness.outbox, buildBody())).rejects.toMatchObject({
      code: 'live-play-command-outbox-unavailable',
    })
  })

  it('does not touch browser globals during SSR import or construction', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new Error('indexedDB global was touched')
      },
    })

    try {
      vi.resetModules()
      const module = await import('~/utils/livePlayCommandOutbox')
      const outbox = module.createLivePlayCommandOutbox({ databaseName: 'ssr-only' })
      expect(() => module.createLivePlayCommandOutbox({ databaseName: 'ssr-only-construct' })).not.toThrow()
      await expect(outbox.enqueue({
        requestPath: '/api/maps/tokens/move',
        body: buildBody({ opId: 'op_ssr000001' }),
        authContext: gmAuth,
        now: 100,
      })).rejects.toMatchObject({ code: 'live-play-command-outbox-unavailable' })
    } finally {
      if (descriptor === undefined) {
        delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
      } else {
        Object.defineProperty(globalThis, 'indexedDB', descriptor)
      }
    }
  })
})
