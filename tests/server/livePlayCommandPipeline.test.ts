import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandEnvelope,
  type LivePlayMapScope,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import {
  createAuthoritativeLivePlayCommandExecutor,
  type ExecuteAuthoritativeLivePlayCommandOptions,
} from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import type { AppendRealtimeEventInput } from '~~/server/storage/realtimeEventRepository'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

interface TestMap {
  readonly slug: string
  readonly revision: number
  readonly log: readonly string[]
}

interface TestPayload {
  readonly label: string
}

const mapScope = (lane: LivePlayMapScope['lane'] = 'metadata'): LivePlayMapScope => ({
  kind: 'map',
  lane,
})

const createCommand = (
  mapSlug: string,
  opId: string,
  baseRevision: number,
  label: string,
): LivePlayCommandEnvelope<typeof LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE, TestPayload, LivePlayMapScope> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug,
  baseRevision,
  type: LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
  scopes: [mapScope('initiative')],
  payload: { label },
})

const createPatch = (
  command: LivePlayCommandEnvelope<typeof LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE, TestPayload, LivePlayMapScope>,
  revision: number,
): LivePlayPatch<typeof LIVE_PLAY_PATCH_TYPES.MAP_METADATA, TestPayload, LivePlayMapScope> => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
  mapSlug: command.mapSlug,
  revision,
  scopes: command.scopes,
  payload: command.payload,
})

const supplementalRealtimeInput = (id: string): AppendRealtimeEventInput => ({
  event: { channel: 'sheets', type: 'updated', data: { id } },
  access: { kind: 'gm-only' },
  dedupeKey: `supplemental:${id}`,
})

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

const timeout = <T>(milliseconds: number, value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), milliseconds))

const createHarness = (initialMaps: readonly TestMap[]) => {
  const maps = new Map(initialMaps.map((map) => [map.slug, { ...map, log: [...map.log] }]))
  const opStore = createInMemoryLivePlayOpStore()
  const queue = createInProcessMapWriteQueue()
  const executor = createAuthoritativeLivePlayCommandExecutor({ opStore, queue })
  const published: string[] = []

  const execute = (
    command: ReturnType<typeof createCommand>,
    overrides: Partial<ExecuteAuthoritativeLivePlayCommandOptions<typeof command, TestMap, undefined, undefined>> = {},
  ) => executor.execute<typeof command, TestMap, undefined, undefined>({
    command,
    readMap: ({ command: currentCommand }) => {
      const map = maps.get(currentCommand.mapSlug)
      if (!map) throw new Error(`Map ${currentCommand.mapSlug} not found`)
      return { ...map, log: [...map.log] }
    },
    apply: ({ command: currentCommand, map, currentRevision }) => {
      const revision = currentRevision + 1
      return {
        status: 'accepted',
        nextMap: {
          ...map,
          revision,
          log: [...map.log, currentCommand.payload.label],
        },
        patches: [createPatch(currentCommand, revision)],
      }
    },
    persist: ({ nextMap }) => {
      maps.set(nextMap.slug, { ...nextMap, log: [...nextMap.log] })
    },
    publish: ({ result }) => {
      published.push(`${result.mapSlug}@${result.revision}`)
    },
    ...overrides,
  })

  return { maps, opStore, queue, executor, execute, published }
}

describe('authoritative live-play command pipeline', () => {
  it('serializes concurrent commands for the same map in deterministic revision order', async () => {
    const firstPersistStarted = deferred()
    const releaseFirstPersist = deferred()
    const harness = createHarness([{ slug: 'arena', revision: 0, log: [] }])
    const firstCommand = createCommand('arena', 'op_samemap0001', 0, 'first')
    const secondCommand = createCommand('arena', 'op_samemap0002', 1, 'second')
    const persist = vi.fn(async (context: { readonly nextMap: TestMap }) => {
      if (context.nextMap.log.includes('first')) {
        firstPersistStarted.resolve()
        await releaseFirstPersist.promise
      }
      harness.maps.set(context.nextMap.slug, {
        ...context.nextMap,
        log: [...context.nextMap.log],
      })
    })

    const first = harness.execute(firstCommand, { persist })
    await firstPersistStarted.promise
    const second = harness.execute(secondCommand, { persist })
    await Promise.resolve()
    releaseFirstPersist.resolve()

    const results = await Promise.all([first, second])

    expect(results).toMatchObject([
      { ok: true, mapSlug: 'arena', previousRevision: 0, revision: 1 },
      { ok: true, mapSlug: 'arena', previousRevision: 1, revision: 2 },
    ])
    expect(harness.maps.get('arena')).toEqual({
      slug: 'arena',
      revision: 2,
      log: ['first', 'second'],
    })
    expect(harness.published).toEqual(['arena@1', 'arena@2'])
    expect(harness.opStore.recordCount).toBe(2)
    expect(harness.queue.pendingMapCount).toBe(0)
  })

  it('lets commands for different maps complete while another map is waiting in the queue', async () => {
    const alphaPersistStarted = deferred()
    const releaseAlphaPersist = deferred()
    const harness = createHarness([
      { slug: 'alpha', revision: 0, log: [] },
      { slug: 'beta', revision: 0, log: [] },
    ])
    const alphaCommand = createCommand('alpha', 'op_diffmap0001', 0, 'alpha move')
    const betaCommand = createCommand('beta', 'op_diffmap0002', 0, 'beta move')
    const persist = vi.fn(async (context: { readonly nextMap: TestMap }) => {
      if (context.nextMap.slug === 'alpha') {
        alphaPersistStarted.resolve()
        await releaseAlphaPersist.promise
      }
      harness.maps.set(context.nextMap.slug, {
        ...context.nextMap,
        log: [...context.nextMap.log],
      })
    })

    const alpha = harness.execute(alphaCommand, { persist })
    await alphaPersistStarted.promise
    const beta = harness.execute(betaCommand, { persist })

    const betaRace = await Promise.race([
      beta.then((result) => ({ kind: 'result' as const, result })),
      timeout(50, { kind: 'timeout' as const }),
    ])

    expect(betaRace.kind).toBe('result')
    if (betaRace.kind === 'result') {
      expect(betaRace.result).toMatchObject({ ok: true, mapSlug: 'beta', revision: 1 })
    }
    expect(harness.maps.get('beta')).toEqual({
      slug: 'beta',
      revision: 1,
      log: ['beta move'],
    })

    releaseAlphaPersist.resolve()
    await expect(alpha).resolves.toMatchObject({ ok: true, mapSlug: 'alpha', revision: 1 })
    expect(harness.maps.get('alpha')).toEqual({
      slug: 'alpha',
      revision: 1,
      log: ['alpha move'],
    })
  })

  it('rejects new commands before queueing when shared map mode is Prepare Map', async () => {
    const opStore = createInMemoryLivePlayOpStore()
    const queue = createInProcessMapWriteQueue()
    const executor = createAuthoritativeLivePlayCommandExecutor({
      opStore,
      queue,
      readMapInteractionMode: () => 'setup-edit',
    })
    const command = createCommand('arena', 'op_prepare001', 0, 'blocked')
    const readMap = vi.fn()

    const result = await executor.execute<typeof command, TestMap, undefined, undefined>({
      command,
      readMap,
      apply: () => {
        throw new Error('should not apply')
      },
      persist: () => {
        throw new Error('should not persist')
      },
    })

    expect(result).toEqual({
      ok: false,
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: 'conflict',
      message: 'Map is in Prepare Map mode. Switch to Run Live Play before live-play commands.',
    })
    expect(readMap).not.toHaveBeenCalled()
    expect(opStore.recordCount).toBe(0)
    expect(queue.pendingMapCount).toBe(0)
  })

  it('returns a structured rejection without saving or publishing success when persistence fails', async () => {
    const harness = createHarness([{ slug: 'arena', revision: 0, log: [] }])
    const command = createCommand('arena', 'op_persist001', 0, 'first')
    const publish = vi.fn()

    const result = await harness.execute(command, {
      persist: () => {
        throw new Error('disk full')
      },
      publish,
    })

    expect(result).toEqual({
      ok: false,
      opId: command.opId,
      mapSlug: command.mapSlug,
      reason: 'persistence-failed',
      message: 'Could not persist live-play command: disk full',
      currentRevision: 0,
    })
    expect(harness.maps.get('arena')).toEqual({ slug: 'arena', revision: 0, log: [] })
    expect(harness.opStore.getOpRecord(command.mapSlug, command.opId)).toBeNull()
    expect(publish).not.toHaveBeenCalled()
  })

  it('records an accepted realtime event once on the first saveOpResult call', async () => {
    const maps = new Map<string, TestMap>([['arena', { slug: 'arena', revision: 0, log: [] }]])
    const opStore = createInMemoryLivePlayOpStore()
    const recorded: unknown[] = []
    const published: unknown[] = []
    const hooks = acceptedRealtimeTestHooks(published)
    const recordAcceptedRealtimeEvent = vi.fn((context: Parameters<typeof hooks.recordAcceptedRealtimeEvent>[0]) => {
      const event = hooks.recordAcceptedRealtimeEvent(context)
      recorded.push(event)
      return event
    })
    const executor = createAuthoritativeLivePlayCommandExecutor({
      opStore,
      queue: createInProcessMapWriteQueue(),
      recordAcceptedRealtimeEvent,
      publishAcceptedRealtimeEvent: hooks.publishAcceptedRealtimeEvent,
    })
    const command = createCommand('arena', 'op_durable001', 0, 'first')

    const result = await executor.execute<typeof command, TestMap, { readonly clientId: string }, { readonly clientId: string }>({
      command,
      actor: { clientId: 'client-1' },
      readMap: ({ command: currentCommand }) => maps.get(currentCommand.mapSlug)!,
      apply: ({ command: currentCommand, map, currentRevision }) => ({
        status: 'accepted',
        nextMap: { ...map, revision: currentRevision + 1, log: [...map.log, currentCommand.payload.label] },
        patches: [createPatch(currentCommand, currentRevision + 1)],
      }),
      persist: () => {
        throw new Error('commit required')
      },
      commit: ({ nextMap, saveOpResult }) => {
        maps.set(nextMap.slug, nextMap)
        const first = saveOpResult()
        const second = saveOpResult()
        expect(second).toEqual(first)
      },
    })

    expect(result).toMatchObject({ ok: true, revision: 1 })
    expect(recordAcceptedRealtimeEvent).toHaveBeenCalledTimes(1)
    expect(recorded).toHaveLength(1)
    expect(published).toHaveLength(1)
    expect(published[0]).toBe((recorded[0] as { readonly event: unknown }).event)
    expect(opStore.recordCount).toBe(1)
  })

  it('records supplemental durable realtime events before the accepted event and publishes them in sequence order', async () => {
    const maps = new Map<string, TestMap>([['arena', { slug: 'arena', revision: 0, log: [] }]])
    const opStore = createInMemoryLivePlayOpStore()
    const published: unknown[] = []
    const hooks = acceptedRealtimeTestHooks(published)
    const executor = createAuthoritativeLivePlayCommandExecutor({
      opStore,
      queue: createInProcessMapWriteQueue(),
      recordRealtimeEvents: hooks.recordRealtimeEvents,
      recordAcceptedRealtimeEvent: hooks.recordAcceptedRealtimeEvent,
      publishPersistedRealtimeEvent: hooks.publishPersistedRealtimeEvent,
    })
    const command = createCommand('arena', 'op_supplemental1', 0, 'first')
    const supplementalEvents: unknown[] = []

    const result = await executor.execute<typeof command, TestMap, undefined, undefined>({
      command,
      readMap: ({ command: currentCommand }) => maps.get(currentCommand.mapSlug)!,
      apply: ({ command: currentCommand, map, currentRevision }) => ({
        status: 'accepted',
        nextMap: { ...map, revision: currentRevision + 1, log: [...map.log, currentCommand.payload.label] },
        patches: [createPatch(currentCommand, currentRevision + 1)],
      }),
      persist: () => {
        throw new Error('commit required')
      },
      commit: ({ nextMap, recordRealtimeEvents, saveOpResult }) => {
        maps.set(nextMap.slug, nextMap)
        expect(recordRealtimeEvents([])).toEqual([])
        supplementalEvents.push(...recordRealtimeEvents([supplementalRealtimeInput('sheet-1')]))
        const first = saveOpResult()
        const second = saveOpResult()
        expect(second).toEqual(first)
      },
    })

    expect(result).toMatchObject({ ok: true, revision: 1 })
    expect(supplementalEvents).toHaveLength(1)
    expect(published).toHaveLength(2)
    expect(published).toEqual([
      expect.objectContaining({ sequence: 1, channel: 'sheets', type: 'updated' }),
      expect.objectContaining({ sequence: 2, channel: 'map:arena', type: 'live-play-command-accepted' }),
    ])
    expect(opStore.recordCount).toBe(1)
  })

  it('rejects supplemental durable realtime recording after saveOpResult', async () => {
    const maps = new Map<string, TestMap>([['arena', { slug: 'arena', revision: 0, log: [] }]])
    const hooks = acceptedRealtimeTestHooks([])
    const executor = createAuthoritativeLivePlayCommandExecutor({
      opStore: createInMemoryLivePlayOpStore(),
      queue: createInProcessMapWriteQueue(),
      recordRealtimeEvents: hooks.recordRealtimeEvents,
      recordAcceptedRealtimeEvent: hooks.recordAcceptedRealtimeEvent,
    })
    const command = createCommand('arena', 'op_suppafter1', 0, 'first')

    const result = await executor.execute<typeof command, TestMap, undefined, undefined>({
      command,
      readMap: ({ command: currentCommand }) => maps.get(currentCommand.mapSlug)!,
      apply: ({ command: currentCommand, map, currentRevision }) => ({
        status: 'accepted',
        nextMap: { ...map, revision: currentRevision + 1, log: [...map.log, currentCommand.payload.label] },
        patches: [createPatch(currentCommand, currentRevision + 1)],
      }),
      persist: () => {
        throw new Error('commit required')
      },
      commit: ({ saveOpResult, recordRealtimeEvents }) => {
        saveOpResult()
        recordRealtimeEvents([supplementalRealtimeInput('late')])
      },
    })

    expect(result).toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(result).toMatchObject({ message: expect.stringContaining('before saveOpResult') })
  })

  it('fails clearly when supplemental durable realtime storage is not configured', async () => {
    const maps = new Map<string, TestMap>([['arena', { slug: 'arena', revision: 0, log: [] }]])
    const executor = createAuthoritativeLivePlayCommandExecutor({
      opStore: createInMemoryLivePlayOpStore(),
      queue: createInProcessMapWriteQueue(),
    })
    const command = createCommand('arena', 'op_suppmissing1', 0, 'first')

    const result = await executor.execute<typeof command, TestMap, undefined, undefined>({
      command,
      readMap: ({ command: currentCommand }) => maps.get(currentCommand.mapSlug)!,
      apply: ({ command: currentCommand, map, currentRevision }) => ({
        status: 'accepted',
        nextMap: { ...map, revision: currentRevision + 1, log: [...map.log, currentCommand.payload.label] },
        patches: [createPatch(currentCommand, currentRevision + 1)],
      }),
      persist: () => {
        throw new Error('commit required')
      },
      commit: ({ recordRealtimeEvents }) => {
        recordRealtimeEvents([supplementalRealtimeInput('missing')])
      },
    })

    expect(result).toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(result).toMatchObject({ message: expect.stringContaining('durable live-play realtime event recording is not configured') })
  })

  it('fails accepted commits when durable realtime recording fails', async () => {
    const maps = new Map<string, TestMap>([['arena', { slug: 'arena', revision: 0, log: [] }]])
    const opStore = createInMemoryLivePlayOpStore()
    const recordAcceptedRealtimeEvent = vi.fn(() => {
      throw new Error('event log unavailable')
    })
    const executor = createAuthoritativeLivePlayCommandExecutor({
      opStore,
      queue: createInProcessMapWriteQueue(),
      recordAcceptedRealtimeEvent,
    })
    const command = createCommand('arena', 'op_durablefail1', 0, 'first')

    const result = await executor.execute<typeof command, TestMap, undefined, undefined>({
      command,
      readMap: ({ command: currentCommand }) => maps.get(currentCommand.mapSlug)!,
      apply: ({ command: currentCommand, map, currentRevision }) => ({
        status: 'accepted',
        nextMap: { ...map, revision: currentRevision + 1, log: [...map.log, currentCommand.payload.label] },
        patches: [createPatch(currentCommand, currentRevision + 1)],
      }),
      persist: () => {
        throw new Error('commit required')
      },
      commit: ({ saveOpResult }) => {
        saveOpResult()
      },
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'persistence-failed',
      message: expect.stringContaining('event log unavailable'),
    })
    expect(recordAcceptedRealtimeEvent).toHaveBeenCalledTimes(1)
  })

  it('rejects the legacy non-commit persistence path before persisting when durable recording is configured', async () => {
    const harness = createHarness([{ slug: 'arena', revision: 0, log: [] }])
    const recordAcceptedRealtimeEvent = vi.fn()
    const executor = createAuthoritativeLivePlayCommandExecutor({
      opStore: harness.opStore,
      queue: harness.queue,
      recordAcceptedRealtimeEvent,
    })
    const command = createCommand('arena', 'op_nocommit001', 0, 'first')
    const persist = vi.fn()

    const result = await executor.execute<typeof command, TestMap, undefined, undefined>({
      command,
      readMap: ({ command: currentCommand }) => harness.maps.get(currentCommand.mapSlug)!,
      apply: ({ command: currentCommand, map, currentRevision }) => ({
        status: 'accepted',
        nextMap: { ...map, revision: currentRevision + 1, log: [...map.log, currentCommand.payload.label] },
        patches: [createPatch(currentCommand, currentRevision + 1)],
      }),
      persist,
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'persistence-failed',
      message: expect.stringContaining('accepted-result commit hook'),
    })
    expect(persist).not.toHaveBeenCalled()
    expect(recordAcceptedRealtimeEvent).not.toHaveBeenCalled()
    expect(harness.opStore.getOpRecord(command.mapSlug, command.opId)).toBeNull()
  })

  it('does not record accepted realtime events for rejected or duplicate commands', async () => {
    const maps = new Map<string, TestMap>([['arena', { slug: 'arena', revision: 0, log: [] }]])
    const opStore = createInMemoryLivePlayOpStore()
    const published: unknown[] = []
    const hooks = acceptedRealtimeTestHooks(published)
    const recordAcceptedRealtimeEvent = vi.fn(hooks.recordAcceptedRealtimeEvent)
    const executor = createAuthoritativeLivePlayCommandExecutor({
      opStore,
      queue: createInProcessMapWriteQueue(),
      recordAcceptedRealtimeEvent,
      publishAcceptedRealtimeEvent: hooks.publishAcceptedRealtimeEvent,
    })
    const rejectedCommand = createCommand('arena', 'op_rejected001', 0, 'bad')

    const rejected = await executor.execute<typeof rejectedCommand, TestMap, undefined, undefined>({
      command: rejectedCommand,
      readMap: ({ command: currentCommand }) => maps.get(currentCommand.mapSlug)!,
      apply: () => ({ status: 'rejected', reason: 'invalid', message: 'nope' }),
      persist: () => {
        throw new Error('should not persist accepted state')
      },
    })
    expect(rejected).toMatchObject({ ok: false, reason: 'invalid' })
    expect(recordAcceptedRealtimeEvent).not.toHaveBeenCalled()

    const acceptedCommand = createCommand('arena', 'op_duplicate001', 0, 'first')
    const executeAccepted = () => executor.execute<typeof acceptedCommand, TestMap, undefined, undefined>({
      command: acceptedCommand,
      readMap: ({ command: currentCommand }) => maps.get(currentCommand.mapSlug)!,
      apply: ({ command: currentCommand, map, currentRevision }) => ({
        status: 'accepted',
        nextMap: { ...map, revision: currentRevision + 1, log: [...map.log, currentCommand.payload.label] },
        patches: [createPatch(currentCommand, currentRevision + 1)],
      }),
      persist: () => {
        throw new Error('commit required')
      },
      commit: ({ nextMap, saveOpResult }) => {
        maps.set(nextMap.slug, nextMap)
        saveOpResult()
      },
    })

    const first = await executeAccepted()
    const second = await executeAccepted()
    expect(second).toEqual(first)
    expect(recordAcceptedRealtimeEvent).toHaveBeenCalledTimes(1)
    expect(published).toHaveLength(1)
  })

  it('keeps accepted results when after-commit publication fails and continues accepted-event publication', async () => {
    const maps = new Map<string, TestMap>([['arena', { slug: 'arena', revision: 0, log: [] }]])
    const opStore = createInMemoryLivePlayOpStore()
    const published: unknown[] = []
    const reports: unknown[] = []
    const hooks = acceptedRealtimeTestHooks(published)
    const executor = createAuthoritativeLivePlayCommandExecutor({
      opStore,
      queue: createInProcessMapWriteQueue(),
      recordAcceptedRealtimeEvent: hooks.recordAcceptedRealtimeEvent,
      publishAcceptedRealtimeEvent: hooks.publishAcceptedRealtimeEvent,
      reportAfterCommitPublicationFailure: (context) => reports.push(context),
    })
    const command = createCommand('arena', 'op_publishfail1', 0, 'first')

    const result = await executor.execute<typeof command, TestMap, undefined, undefined>({
      command,
      readMap: ({ command: currentCommand }) => maps.get(currentCommand.mapSlug)!,
      apply: ({ command: currentCommand, map, currentRevision }) => ({
        status: 'accepted',
        nextMap: { ...map, revision: currentRevision + 1, log: [...map.log, currentCommand.payload.label] },
        patches: [createPatch(currentCommand, currentRevision + 1)],
      }),
      persist: () => {
        throw new Error('commit required')
      },
      commit: ({ nextMap, saveOpResult }) => {
        maps.set(nextMap.slug, nextMap)
        saveOpResult()
      },
      publish: () => {
        throw new Error('sheet publish failed')
      },
    })

    expect(result).toMatchObject({ ok: true, revision: 1 })
    expect(published).toHaveLength(1)
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ phase: 'use-case' })
  })
})
