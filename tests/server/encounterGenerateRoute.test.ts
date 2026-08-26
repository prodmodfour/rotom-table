import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '~~/server/utils/http'

const mocks = vi.hoisted(() => ({ manageWildGenerationUseCase: vi.fn() }))
vi.mock('../../server/useCases/manageWildGeneration', () => ({
  manageWildGenerationUseCase: mocks.manageWildGenerationUseCase,
}))
const generateRoute = (await import('../../server/api/encounters/generate.post')).default

type Handler = EventHandler<EventHandlerRequest, unknown>
const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES
const restore = (key: 'NODE_ENV' | 'ROTOM_ENABLE_HOSTED_WRITES', value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}
const invoke = async (handler: Handler, options: { role?: 'gm' | 'player'; body?: unknown } = {}): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  return handler({ method: 'POST', node: { req: { headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) } } } as unknown as H3Event)
}

describe('journaled encounter generation API route', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { restore('NODE_ENV', originalNodeEnv); restore('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites) })

  it('requires GM authority and never invokes generation for a player', async () => {
    await expect(invoke(generateRoute, { role: 'player', body: {} })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.manageWildGenerationUseCase).not.toHaveBeenCalled()
  })

  it('requires the production liveplay write opt-in for preview and commit commands', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.ROTOM_ENABLE_HOSTED_WRITES
    await expect(invoke(generateRoute, { role: 'gm', body: { mode: 'preview' } })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
    })
    expect(mocks.manageWildGenerationUseCase).not.toHaveBeenCalled()
  })

  it('passes the exact body to native journaled generation and returns its role-safe projection', async () => {
    process.env.NODE_ENV = 'development'
    const body = { schemaVersion: 1, mode: 'preview', operationId: 'wild-operation-001' }
    const response = { schemaVersion: 1, operationId: body.operationId, candidates: [] }
    mocks.manageWildGenerationUseCase.mockReturnValue(response)
    await expect(invoke(generateRoute, { role: 'gm', body })).resolves.toBe(response)
    expect(mocks.manageWildGenerationUseCase).toHaveBeenCalledWith(body)
  })
})
