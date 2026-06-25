import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '~~/server/utils/http'

const mocks = vi.hoisted(() => ({
  spawnGeneratedEncountersUseCase: vi.fn(),
  publishUseCaseRealtimeEvents: vi.fn(),
}))

vi.mock('../../server/useCases/spawnGeneratedEncounters', () => ({
  spawnGeneratedEncountersUseCase: mocks.spawnGeneratedEncountersUseCase,
}))

vi.mock('../../server/utils/useCaseHttp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/utils/useCaseHttp')>()
  return {
    ...actual,
    publishUseCaseRealtimeEvents: mocks.publishUseCaseRealtimeEvents,
  }
})

const spawnRoute = (await import('../../server/api/encounters/spawn.post')).default

type EncounterSpawnRouteHandler = EventHandler<EventHandlerRequest, unknown>

const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES

const restoreEnvValue = (key: 'NODE_ENV' | 'ROTOM_ENABLE_HOSTED_WRITES', value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const invokeRoute = async (
  handler: EncounterSpawnRouteHandler,
  options: { role?: 'gm' | 'player'; body?: unknown } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return handler({
    method: 'POST',
    node: {
      req: {
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
  } as unknown as H3Event)
}

describe('encounter spawn API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreEnvValue('NODE_ENV', originalNodeEnv)
    restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
  })

  it('requires hosted writes in production', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES

    await expect(invokeRoute(spawnRoute, {
      role: 'gm',
      body: { region: 'kanto', table: 'forest', count: 2, mapSlug: 'map' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
    })
    expect(mocks.spawnGeneratedEncountersUseCase).not.toHaveBeenCalled()
  })

  it('publishes realtime events but omits them from the response', async () => {
    process.env.NODE_ENV = 'development'
    const events = [{ channel: 'maps', type: 'updated', data: {} }]
    mocks.spawnGeneratedEncountersUseCase.mockResolvedValue({
      ok: true,
      dir: '/repo/data/sheets/wild/forest_1',
      relDir: 'data/sheets/wild/forest_1',
      rolled: [],
      files: [],
      failures: 0,
      preview: false,
      beforeCount: 0,
      count: 0,
      spawn: { mapSlug: 'map', mapName: 'Map', spawned: 0, failures: 0, placements: [] },
      events,
    })

    const response = await invokeRoute(spawnRoute, {
      role: 'gm',
      body: { region: 'kanto', table: 'forest', count: 2, mapSlug: 'map' },
    })

    expect(mocks.publishUseCaseRealtimeEvents).toHaveBeenCalledWith([
      {
        event: events[0],
        access: { kind: 'map-access', mapSlug: 'map' },
      },
    ])
    expect(response).not.toHaveProperty('events')
    expect(response).toMatchObject({ ok: true, spawn: { mapSlug: 'map' } })
  })
})
