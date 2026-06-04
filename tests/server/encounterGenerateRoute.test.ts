import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '~~/server/utils/http'

const mocks = vi.hoisted(() => ({
  generateEncountersUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/generateEncounters', () => ({
  generateEncountersUseCase: mocks.generateEncountersUseCase,
}))

const generateRoute = (await import('../../server/api/encounters/generate.post')).default

type EncounterGenerateRouteHandler = EventHandler<EventHandlerRequest, unknown>

const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES

const restoreEnvValue = (key: 'NODE_ENV' | 'ROTOM_ENABLE_HOSTED_WRITES', value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const invokeRoute = async (
  handler: EncounterGenerateRouteHandler,
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

describe('encounter generation API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreEnvValue('NODE_ENV', originalNodeEnv)
    restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
  })

  it('requires the hosted-write opt-in for persistent production generation', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES

    await expect(invokeRoute(generateRoute, {
      role: 'gm',
      body: { region: 'kanto', table: 'forest', count: 2 },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
    })
    expect(mocks.generateEncountersUseCase).not.toHaveBeenCalled()
  })

  it('keeps production preview generation available without persistent hosted writes', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES
    const response = { ok: true, preview: true, files: [] }
    mocks.generateEncountersUseCase.mockResolvedValue(response)

    await expect(invokeRoute(generateRoute, {
      role: 'gm',
      body: { region: 'kanto', table: 'forest', count: 2, preview: true },
    })).resolves.toBe(response)
    expect(mocks.generateEncountersUseCase).toHaveBeenCalledWith({
      region: 'kanto',
      table: 'forest',
      count: 2,
      preview: true,
    })
  })
})
