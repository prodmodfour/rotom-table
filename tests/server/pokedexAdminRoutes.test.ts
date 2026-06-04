import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '~~/server/utils/http'

const mocks = vi.hoisted(() => ({
  restorePokedexEntryFromBooksUseCase: vi.fn(),
  updatePokedexEntryUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/restorePokedexEntryFromBooks', () => ({
  restorePokedexEntryFromBooksUseCase: mocks.restorePokedexEntryFromBooksUseCase,
}))
vi.mock('../../server/useCases/updatePokedexEntry', () => ({
  updatePokedexEntryUseCase: mocks.updatePokedexEntryUseCase,
}))

const restoreRoute = (await import('../../server/api/pokedex/restore-from-books.post')).default
const updateRoute = (await import('../../server/api/pokedex/update.post')).default

type PokedexAdminRouteHandler = EventHandler<EventHandlerRequest, unknown>

const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES

const restoreEnvValue = (key: 'NODE_ENV' | 'ROTOM_ENABLE_HOSTED_WRITES', value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const invokeRoute = async (
  handler: PokedexAdminRouteHandler,
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

describe('Pokédex admin API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreEnvValue('NODE_ENV', originalNodeEnv)
    restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
  })

  it('requires the hosted-write opt-in before production Pokédex writes', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES

    await expect(invokeRoute(updateRoute, {
      role: 'gm',
      body: { slug: 'pikachu', entry: { species: 'Pikachu' } },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
    })
    expect(mocks.updatePokedexEntryUseCase).not.toHaveBeenCalled()

    await expect(invokeRoute(restoreRoute, {
      role: 'gm',
      body: { slug: 'pikachu' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
    })
    expect(mocks.restorePokedexEntryFromBooksUseCase).not.toHaveBeenCalled()
  })
})
