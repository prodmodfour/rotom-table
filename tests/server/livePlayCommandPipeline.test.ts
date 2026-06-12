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
})
