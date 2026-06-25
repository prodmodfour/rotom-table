import { effectScope, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES, type MapInteractionMode } from '#shared/mapInteractionMode'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES } from '#shared/livePlayCommands'
import { useLivePlayCommandRecoveryGate } from '~/composables/map-editor/useLivePlayCommandRecoveryGate'
import type {
  LivePlayCommandDispatchResult,
  LivePlayCommandOutboxRecoveryStatus,
  LivePlayCommandStatus,
  LivePlayOperationStatusCheckResult,
} from '~/composables/map-editor/useLivePlayCommands'
import {
  LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION,
  type LivePlayCommandOutboxEntry,
} from '~/utils/livePlayCommandOutbox'

const flushMicrotasks = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

const deferred = <TValue>() => {
  let resolve!: (value: TValue | PromiseLike<TValue>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<TValue>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const createEventTarget = () => {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  return {
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      const set = listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
      set.add(listener)
      listeners.set(type, set)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(listener)
    }),
    dispatch(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === 'function') listener(new Event(type))
        else listener.handleEvent(new Event(type))
      }
    },
    listenerCount(type: string): number {
      return listeners.get(type)?.size ?? 0
    },
  }
}

const createVisibilityDocument = () => {
  const target = createEventTarget()
  return {
    ...target,
    hidden: false,
  }
}

let entrySequence = 0
const createEntry = (
  overrides: Partial<LivePlayCommandOutboxEntry> = {},
): LivePlayCommandOutboxEntry => {
  entrySequence += 1
  const opId = overrides.opId ?? `op_recovery${entrySequence.toString(36).padStart(8, '0')}`
  return {
    schemaVersion: LIVE_PLAY_COMMAND_OUTBOX_SCHEMA_VERSION,
    opId,
    mapSlug: 'arena-map',
    commandType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    requestPath: '/api/maps/token/move',
    body: {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId,
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
      payload: { placementId: 'token-pikachu', position: { x: 1, y: 0, z: 1 } },
      clientId: 'test-client',
    },
    authContext: { role: 'gm', profileId: null },
    fingerprint: `fingerprint-${opId}`,
    state: 'queued',
    createdAt: 1,
    updatedAt: 1,
    attemptCount: 0,
    ...overrides,
  }
}

interface HarnessOptions {
  readonly isClient?: boolean
  readonly contextKey?: Ref<string | null>
  readonly enabled?: Ref<boolean>
  readonly interactionMode?: Ref<MapInteractionMode>
  readonly commandStatus?: Ref<LivePlayCommandStatus>
  readonly entries?: Ref<readonly LivePlayCommandOutboxEntry[]>
  readonly recoveryStatus?: Ref<LivePlayCommandOutboxRecoveryStatus>
  readonly recoveryError?: Ref<string | null>
  readonly recoverInterrupted?: () => Promise<readonly LivePlayCommandOutboxEntry[]>
  readonly refresh?: () => Promise<readonly LivePlayCommandOutboxEntry[]>
  readonly retry?: (opId: string) => Promise<LivePlayCommandDispatchResult>
  readonly checkStatus?: (opId: string) => Promise<LivePlayOperationStatusCheckResult>
  readonly now?: () => number
  readonly document?: ReturnType<typeof createVisibilityDocument>
  readonly window?: ReturnType<typeof createEventTarget>
}

const createHarness = (options: HarnessOptions = {}) => {
  const contextKey = options.contextKey ?? ref<string | null>('arena-map:gm')
  const enabled = options.enabled ?? ref(true)
  const interactionMode = options.interactionMode ?? ref<MapInteractionMode>(MAP_INTERACTION_MODES.LIVE_PLAY)
  const commandStatus = options.commandStatus ?? ref<LivePlayCommandStatus>('idle')
  const entries = options.entries ?? ref<readonly LivePlayCommandOutboxEntry[]>([])
  const recoveryStatus = options.recoveryStatus ?? ref<LivePlayCommandOutboxRecoveryStatus>('idle')
  const recoveryError = options.recoveryError ?? ref<string | null>(null)
  const recoverInterrupted = vi.fn(options.recoverInterrupted ?? (async () => entries.value))
  const refresh = vi.fn(options.refresh ?? (async () => entries.value))
  const retry = vi.fn(options.retry ?? (async (opId: string) => ({ dispatched: true, opId })))
  const checkStatus = vi.fn(options.checkStatus ?? (async (opId: string) => ({
    status: 'unknown' as const,
    opId,
    message: 'The server has no terminal record for this operation yet.',
  })))
  const document = options.document ?? createVisibilityDocument()
  const window = options.window ?? createEventTarget()
  const scope = effectScope()
  const gate = scope.run(() => useLivePlayCommandRecoveryGate({
    contextKey,
    enabled,
    interactionMode,
    commandStatus,
    entries,
    recoveryStatus,
    recoveryError,
    recoverInterrupted,
    refresh,
    retry,
    checkStatus,
    clock: options.now ? { now: options.now, timers: globalThis } : { timers: globalThis },
    browser: {
      isClient: options.isClient ?? true,
      document,
      window,
    },
  }))

  if (!gate) throw new Error('Failed to create recovery gate harness')

  return {
    scope,
    gate,
    contextKey,
    enabled,
    interactionMode,
    commandStatus,
    entries,
    recoveryStatus,
    recoveryError,
    recoverInterrupted,
    refresh,
    retry,
    checkStatus,
    document,
    window,
  }
}

describe('useLivePlayCommandRecoveryGate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs client startup recovery once without retrying or sending commands', async () => {
    const { gate, recoverInterrupted, retry } = createHarness()

    await vi.waitFor(() => expect(recoverInterrupted).toHaveBeenCalledTimes(1))
    expect(gate.readyForCurrentContext.value).toBe(true)
    expect(gate.blocksNewLiveCommands.value).toBe(false)
    expect(retry).not.toHaveBeenCalled()
  })

  it('does not start recovery on the server', async () => {
    const { gate, recoverInterrupted, document, window } = createHarness({ isClient: false })

    await flushMicrotasks()
    expect(recoverInterrupted).not.toHaveBeenCalled()
    expect(gate.readyForCurrentContext.value).toBe(false)
    expect(gate.panelVisible.value).toBe(false)
    expect(document.addEventListener).not.toHaveBeenCalled()
    expect(window.addEventListener).not.toHaveBeenCalled()
  })

  it('marks only the exact current context ready and ignores delayed prior contexts', async () => {
    const contextKey = ref<string | null>('arena-map:player:profile-a')
    const pending = new Map<string, ReturnType<typeof deferred<readonly LivePlayCommandOutboxEntry[]>>>()
    const recoverInterrupted = vi.fn(() => {
      const key = contextKey.value
      if (!key) throw new Error('missing key')
      const request = deferred<readonly LivePlayCommandOutboxEntry[]>()
      pending.set(key, request)
      return request.promise
    })
    const { gate } = createHarness({ contextKey, recoverInterrupted })

    await vi.waitFor(() => expect(recoverInterrupted).toHaveBeenCalledTimes(1))
    expect(gate.readyForCurrentContext.value).toBe(false)

    contextKey.value = 'arena-map:player:profile-b'
    expect(gate.readyForCurrentContext.value).toBe(false)
    await vi.waitFor(() => expect(recoverInterrupted).toHaveBeenCalledTimes(2))

    pending.get('arena-map:player:profile-a')?.resolve([])
    await flushMicrotasks()
    expect(gate.readyForCurrentContext.value).toBe(false)

    pending.get('arena-map:player:profile-b')?.resolve([])
    await flushMicrotasks()
    expect(gate.readyForCurrentContext.value).toBe(true)
  })

  it('keeps GM, unprofiled player, and profiled player contexts distinct', async () => {
    const contextKey = ref<string | null>('arena-map:gm')
    const calledContexts: string[] = []
    const { gate, recoverInterrupted } = createHarness({
      contextKey,
      recoverInterrupted: async () => {
        calledContexts.push(contextKey.value ?? 'none')
        return []
      },
    })

    await vi.waitFor(() => expect(recoverInterrupted).toHaveBeenCalledTimes(1))
    expect(gate.readyForCurrentContext.value).toBe(true)

    contextKey.value = 'arena-map:player:none'
    expect(gate.readyForCurrentContext.value).toBe(false)
    await vi.waitFor(() => expect(recoverInterrupted).toHaveBeenCalledTimes(2))

    contextKey.value = 'arena-map:player:profile-id'
    expect(gate.readyForCurrentContext.value).toBe(false)
    await vi.waitFor(() => expect(recoverInterrupted).toHaveBeenCalledTimes(3))

    expect(calledContexts).toEqual([
      'arena-map:gm',
      'arena-map:player:none',
      'arena-map:player:profile-id',
    ])
  })

  it('blocks new Run Live Play commands during inspection, pending entries, recovery failure, and retry', async () => {
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([])
    const recoveryStatus = ref<LivePlayCommandOutboxRecoveryStatus>('idle')
    const recoveryError = ref<string | null>(null)
    const startup = deferred<readonly LivePlayCommandOutboxEntry[]>()
    const retryPending = deferred<LivePlayCommandDispatchResult>()
    const { gate } = createHarness({
      entries,
      recoveryStatus,
      recoveryError,
      recoverInterrupted: () => startup.promise,
      retry: () => retryPending.promise,
    })

    expect(gate.blocksNewLiveCommands.value).toBe(true)
    expect(gate.blockMessage.value).toContain('Checking')

    startup.resolve([])
    await flushMicrotasks()
    expect(gate.blocksNewLiveCommands.value).toBe(false)

    recoveryStatus.value = 'synchronizing'
    expect(gate.blocksNewLiveCommands.value).toBe(true)
    expect(gate.blockMessage.value).toContain('Synchronizing accepted command')

    recoveryStatus.value = 'idle'
    entries.value = [createEntry({ state: 'queued' })]
    await flushMicrotasks()
    expect(gate.blocksNewLiveCommands.value).toBe(true)
    expect(gate.blockMessage.value).toContain('pending live-play command')

    entries.value = [createEntry({ state: 'uncertain' })]
    expect(gate.blocksNewLiveCommands.value).toBe(true)

    entries.value = [createEntry({ state: 'sending', leaseOwner: 'other-tab', leaseExpiresAt: Date.now() + 30_000 })]
    expect(gate.blocksNewLiveCommands.value).toBe(true)

    entries.value = []
    recoveryStatus.value = 'error'
    recoveryError.value = 'IndexedDB failed'
    expect(gate.blocksNewLiveCommands.value).toBe(true)
    expect(gate.blockMessage.value).toBe('IndexedDB failed')

    recoveryStatus.value = 'idle'
    recoveryError.value = null
    const retryPromise = gate.retryEntry('op_recoveryretry')
    expect(gate.blocksNewLiveCommands.value).toBe(true)
    expect(gate.blockMessage.value).toContain('Retrying')

    retryPending.resolve({ dispatched: true, opId: 'op_recoveryretry' })
    await retryPromise
    expect(gate.blocksNewLiveCommands.value).toBe(false)
  })

  it('does not block Prepare Map local actions with pending live commands', async () => {
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([createEntry({ state: 'uncertain' })])
    const { gate } = createHarness({
      interactionMode: ref<MapInteractionMode>(MAP_INTERACTION_MODES.SETUP_EDIT),
      entries,
    })

    await vi.waitFor(() => expect(gate.readyForCurrentContext.value).toBe(true))
    expect(gate.blocksNewLiveCommands.value).toBe(false)
    expect(gate.blockMessage.value).toBeNull()
    expect(gate.panelVisible.value).toBe(true)
  })

  it('coalesces visibility and focus refreshes', async () => {
    const pending = deferred<readonly LivePlayCommandOutboxEntry[]>()
    const { recoverInterrupted, document, window } = createHarness({
      recoverInterrupted: () => pending.promise,
    })

    await vi.waitFor(() => expect(recoverInterrupted).toHaveBeenCalledTimes(1))
    document.dispatch('visibilitychange')
    window.dispatch('focus')
    await flushMicrotasks()
    expect(recoverInterrupted).toHaveBeenCalledTimes(1)

    pending.resolve([])
    await flushMicrotasks()
    window.dispatch('focus')
    await vi.waitFor(() => expect(recoverInterrupted).toHaveBeenCalledTimes(2))
  })

  it('recovers at the earliest sending lease expiry without retrying', async () => {
    vi.useFakeTimers()
    let now = 1_000
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([
      createEntry({ state: 'sending', leaseOwner: 'tab-a', leaseExpiresAt: 1_500 }),
      createEntry({ state: 'sending', leaseOwner: 'tab-b', leaseExpiresAt: 2_000 }),
    ])
    const { recoverInterrupted, retry } = createHarness({
      entries,
      now: () => now,
      recoverInterrupted: async () => {
        if (now >= 1_500) {
          entries.value = entries.value.map((entry) => ({
            ...entry,
            state: 'uncertain' as const,
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
          }))
        }
        return entries.value
      },
    })

    await flushMicrotasks()
    expect(recoverInterrupted).toHaveBeenCalledTimes(1)
    now = 1_499
    await vi.advanceTimersByTimeAsync(499)
    expect(recoverInterrupted).toHaveBeenCalledTimes(1)

    now = 1_500
    await vi.advanceTimersByTimeAsync(1)
    expect(recoverInterrupted).toHaveBeenCalledTimes(2)
    expect(retry).not.toHaveBeenCalled()
  })

  it('cancels lease timers and browser listeners on context change and unmount', async () => {
    vi.useFakeTimers()
    let now = 1_000
    const contextKey = ref<string | null>('arena-map:gm')
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([
      createEntry({ state: 'sending', leaseOwner: 'tab-a', leaseExpiresAt: 1_500 }),
    ])
    const harness = createHarness({ contextKey, entries, now: () => now })

    await flushMicrotasks()
    expect(harness.recoverInterrupted).toHaveBeenCalledTimes(1)
    expect(harness.document.listenerCount('visibilitychange')).toBe(1)
    expect(harness.window.listenerCount('focus')).toBe(1)

    contextKey.value = 'arena-map:player:none'
    entries.value = []
    await flushMicrotasks()
    expect(harness.recoverInterrupted).toHaveBeenCalledTimes(2)
    now = 1_500
    await vi.advanceTimersByTimeAsync(500)
    expect(harness.recoverInterrupted).toHaveBeenCalledTimes(2)

    harness.scope.stop()
    expect(harness.document.listenerCount('visibilitychange')).toBe(0)
    expect(harness.window.listenerCount('focus')).toBe(0)
    harness.window.dispatch('focus')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(harness.recoverInterrupted).toHaveBeenCalledTimes(2)
  })

  it('hides the panel for an ordinary immediate send but shows it if the send becomes uncertain', async () => {
    const commandStatus = ref<LivePlayCommandStatus>('idle')
    const recoveryStatus = ref<LivePlayCommandOutboxRecoveryStatus>('idle')
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([])
    const { gate } = createHarness({ commandStatus, recoveryStatus, entries })

    await vi.waitFor(() => expect(gate.readyForCurrentContext.value).toBe(true))
    commandStatus.value = 'saving'
    entries.value = [createEntry({ state: 'sending', leaseOwner: 'this-tab', leaseExpiresAt: Date.now() + 30_000 })]
    await flushMicrotasks()
    expect(gate.panelVisible.value).toBe(false)

    commandStatus.value = 'error'
    entries.value = [createEntry({ state: 'uncertain', lastError: 'Outcome unknown' })]
    await flushMicrotasks()
    expect(gate.panelVisible.value).toBe(true)
  })

  it('updates blocking and panel visibility for accepted, rejected, uncertain, and leased retry outcomes', async () => {
    type RetryOutcome = 'accepted' | 'rejected' | 'uncertain' | 'leased'
    let outcome: RetryOutcome = 'accepted'
    const opId = 'op_retryoutcome1'
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([createEntry({ state: 'queued', opId })])
    const retry = vi.fn(async (): Promise<LivePlayCommandDispatchResult> => {
      switch (outcome) {
        case 'accepted':
          entries.value = []
          return { dispatched: true, opId }
        case 'rejected':
          entries.value = []
          return { dispatched: false, opId, message: 'Command rejected' }
        case 'uncertain':
          entries.value = [createEntry({ state: 'uncertain', opId, lastError: 'Outcome is still unknown' })]
          return { dispatched: false, opId, uncertain: true, message: 'Outcome is still unknown' }
        case 'leased':
          entries.value = [createEntry({ state: 'sending', opId, leaseOwner: 'other-tab', leaseExpiresAt: Date.now() + 30_000 })]
          return { dispatched: false, opId, message: 'Live-play operation is being sent by another tab.' }
        default:
          return { dispatched: false, opId }
      }
    })
    const { gate } = createHarness({ entries, retry })
    await vi.waitFor(() => expect(gate.readyForCurrentContext.value).toBe(true))

    expect(gate.blocksNewLiveCommands.value).toBe(true)
    await gate.retryEntry(opId)
    expect(entries.value).toEqual([])
    expect(gate.blocksNewLiveCommands.value).toBe(false)
    expect(gate.panelVisible.value).toBe(false)

    outcome = 'rejected'
    entries.value = [createEntry({ state: 'queued', opId })]
    await gate.retryEntry(opId)
    expect(entries.value).toEqual([])
    expect(gate.blocksNewLiveCommands.value).toBe(false)

    outcome = 'uncertain'
    entries.value = [createEntry({ state: 'uncertain', opId })]
    await gate.retryEntry(opId)
    expect(entries.value).toMatchObject([{ state: 'uncertain', opId, lastError: 'Outcome is still unknown' }])
    expect(gate.blocksNewLiveCommands.value).toBe(true)
    expect(gate.panelVisible.value).toBe(true)

    outcome = 'leased'
    entries.value = [createEntry({ state: 'queued', opId })]
    await gate.retryEntry(opId)
    expect(entries.value).toMatchObject([{ state: 'sending', opId, leaseOwner: 'other-tab' }])
    expect(gate.blocksNewLiveCommands.value).toBe(true)
    expect(gate.panelVisible.value).toBe(true)
    expect(retry).toHaveBeenCalledTimes(4)
  })

  it('coalesces repeated retry clicks for the same operation', async () => {
    const retryDeferred = deferred<LivePlayCommandDispatchResult>()
    const retry = vi.fn(() => retryDeferred.promise)
    const { gate } = createHarness({ retry })
    await vi.waitFor(() => expect(gate.readyForCurrentContext.value).toBe(true))

    const first = gate.retryEntry('op_retry0001')
    const second = gate.retryEntry('op_retry0001')
    expect(retry).toHaveBeenCalledTimes(1)
    expect(gate.retryingOpId.value).toBe('op_retry0001')

    retryDeferred.resolve({ dispatched: true, opId: 'op_retry0001' })
    await expect(first).resolves.toMatchObject({ dispatched: true, opId: 'op_retry0001' })
    await expect(second).resolves.toMatchObject({ dispatched: true, opId: 'op_retry0001' })
    expect(gate.retryingOpId.value).toBeNull()
  })

  it('coalesces repeated status checks and blocks conflicting retry, check, and refresh work', async () => {
    const firstEntry = createEntry({ opId: 'op_checksame01' })
    const secondEntry = createEntry({ opId: 'op_checkother1' })
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([firstEntry, secondEntry])
    const statusDeferred = deferred<LivePlayOperationStatusCheckResult>()
    const checkStatus = vi.fn(() => statusDeferred.promise)
    const { gate, checkStatus: checkStatusMock, recoverInterrupted, retry } = createHarness({ entries, checkStatus })
    await vi.waitFor(() => expect(gate.readyForCurrentContext.value).toBe(true))

    const first = gate.checkEntry(firstEntry.opId)
    const repeated = gate.checkEntry(firstEntry.opId)
    const blockedOther = gate.checkEntry(secondEntry.opId)
    const blockedRetry = gate.retryEntry(firstEntry.opId)
    const refresh = gate.refreshRecovery()

    expect(first).toBe(repeated)
    expect(gate.checkingOpId.value).toBe(firstEntry.opId)
    expect(checkStatusMock).toHaveBeenCalledTimes(1)
    await expect(blockedOther).resolves.toMatchObject({
      status: 'error',
      opId: secondEntry.opId,
      message: expect.stringContaining('already being checked'),
    })
    await expect(blockedRetry).resolves.toMatchObject({
      dispatched: false,
      message: expect.stringContaining('status check'),
    })
    expect(retry).not.toHaveBeenCalled()
    expect(recoverInterrupted).toHaveBeenCalledTimes(1)

    statusDeferred.resolve({
      status: 'unknown',
      opId: firstEntry.opId,
      message: 'The server has no terminal record for this operation yet.',
    })
    await expect(first).resolves.toMatchObject({ status: 'unknown', opId: firstEntry.opId })
    await refresh
    expect(checkStatusMock).toHaveBeenCalledTimes(1)
    expect(recoverInterrupted).toHaveBeenCalledTimes(1)
    expect(gate.checkingOpId.value).toBeNull()
    expect(gate.statusResultByOpId.value[firstEntry.opId]).toMatchObject({ status: 'unknown' })
  })

  it('blocks status checks while retry is active', async () => {
    const entry = createEntry({ opId: 'op_retryblockscheck' })
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([entry])
    const retryDeferred = deferred<LivePlayCommandDispatchResult>()
    const retry = vi.fn(() => retryDeferred.promise)
    const { gate, checkStatus } = createHarness({ entries, retry })
    await vi.waitFor(() => expect(gate.readyForCurrentContext.value).toBe(true))

    const retryPromise = gate.retryEntry(entry.opId)
    const check = gate.checkEntry(entry.opId)

    await expect(check).resolves.toMatchObject({
      status: 'error',
      message: expect.stringContaining('retry is already active'),
    })
    expect(checkStatus).not.toHaveBeenCalled()
    retryDeferred.resolve({ dispatched: false, opId: entry.opId, message: 'still pending' })
    await retryPromise
  })

  it('records unknown and error status inspections without removing entries or blocking retry', async () => {
    const entry = createEntry({ opId: 'op_unknownstatus1', state: 'uncertain', attemptCount: 3 })
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([entry])
    let result: LivePlayOperationStatusCheckResult = {
      status: 'unknown',
      opId: entry.opId,
      message: 'The server has no terminal record for this operation yet.',
    }
    const checkStatus = vi.fn(async () => result)
    const retry = vi.fn(async (opId: string) => ({ dispatched: false, opId, message: 'retry attempted' }))
    const { gate } = createHarness({ entries, checkStatus, retry })
    await vi.waitFor(() => expect(gate.readyForCurrentContext.value).toBe(true))

    await expect(gate.checkEntry(entry.opId)).resolves.toMatchObject({ status: 'unknown' })
    expect(entries.value).toEqual([entry])
    expect(entries.value[0]?.attemptCount).toBe(3)
    expect(gate.blocksNewLiveCommands.value).toBe(true)
    expect(gate.statusResultByOpId.value[entry.opId]).toMatchObject({
      status: 'unknown',
      message: expect.stringContaining('no terminal record'),
    })

    result = { status: 'error', opId: entry.opId, message: 'Status endpoint failed' }
    await expect(gate.checkEntry(entry.opId)).resolves.toMatchObject({ status: 'error' })
    expect(gate.statusResultByOpId.value[entry.opId]).toMatchObject({
      status: 'error',
      message: 'Status endpoint failed',
    })

    await gate.retryEntry(entry.opId)
    expect(retry).toHaveBeenCalledWith(entry.opId)
    expect(gate.statusResultByOpId.value[entry.opId]).toBeUndefined()
  })

  it('clears transient status inspections for terminal results, entry removal, context changes, and unmount', async () => {
    const contextKey = ref<string | null>('arena-map:gm')
    const entry = createEntry({ opId: 'op_lifecycle001' })
    const entries = ref<readonly LivePlayCommandOutboxEntry[]>([entry])
    let result: LivePlayOperationStatusCheckResult = {
      status: 'unknown',
      opId: entry.opId,
      message: 'No terminal record yet.',
    }
    const checkStatus = vi.fn(async () => {
      if (result.status === 'accepted' || result.status === 'rejected') entries.value = []
      return result
    })
    const harness = createHarness({ contextKey, entries, checkStatus })
    const { gate } = harness
    await vi.waitFor(() => expect(gate.readyForCurrentContext.value).toBe(true))

    await gate.checkEntry(entry.opId)
    expect(gate.statusResultByOpId.value[entry.opId]).toBeDefined()

    entries.value = []
    await flushMicrotasks()
    expect(gate.statusResultByOpId.value[entry.opId]).toBeUndefined()

    entries.value = [entry]
    await gate.checkEntry(entry.opId)
    contextKey.value = 'arena-map:player:none'
    await flushMicrotasks()
    expect(gate.statusResultByOpId.value).toEqual({})

    entries.value = [entry]
    await vi.waitFor(() => expect(gate.readyForCurrentContext.value).toBe(true))
    await gate.checkEntry(entry.opId)
    result = {
      status: 'accepted',
      opId: entry.opId,
      response: { ok: true, opId: entry.opId, mapSlug: entry.mapSlug, previousRevision: 4, revision: 5, patches: [] },
    }
    await expect(gate.checkEntry(entry.opId)).resolves.toMatchObject({ status: 'accepted' })
    expect(entries.value).toEqual([])
    expect(gate.statusResultByOpId.value[entry.opId]).toBeUndefined()

    entries.value = [entry]
    result = {
      status: 'rejected',
      opId: entry.opId,
      response: { ok: false, opId: entry.opId, mapSlug: entry.mapSlug, reason: 'conflict', message: 'Conflict', currentRevision: 5 },
    }
    await expect(gate.checkEntry(entry.opId)).resolves.toMatchObject({ status: 'rejected' })
    expect(entries.value).toEqual([])
    expect(gate.statusResultByOpId.value[entry.opId]).toBeUndefined()

    entries.value = [entry]
    const pending = deferred<LivePlayOperationStatusCheckResult>()
    const unmountHarness = createHarness({ entries, checkStatus: () => pending.promise })
    await vi.waitFor(() => expect(unmountHarness.gate.readyForCurrentContext.value).toBe(true))
    const pendingCheck = unmountHarness.gate.checkEntry(entry.opId)
    expect(unmountHarness.gate.checkingOpId.value).toBe(entry.opId)
    unmountHarness.scope.stop()
    expect(unmountHarness.gate.checkingOpId.value).toBeNull()
    expect(unmountHarness.gate.statusResultByOpId.value).toEqual({})
    pending.resolve({ status: 'unknown', opId: entry.opId, message: 'Late result' })
    await pendingCheck
    expect(unmountHarness.gate.statusResultByOpId.value).toEqual({})
  })
})
