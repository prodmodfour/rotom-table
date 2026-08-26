import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '../../server/utils/http'

const mocks = vi.hoisted(() => ({ manageNpcGenerationUseCase: vi.fn() }))
vi.mock('../../server/useCases/manageNpcGeneration', () => ({ manageNpcGenerationUseCase: mocks.manageNpcGenerationUseCase }))
const route = (await import('../../server/api/gm-toolkit/npc-generation.post')).default
type Handler = EventHandler<EventHandlerRequest, unknown>
const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES
const restore = (key: 'NODE_ENV' | 'ROTOM_ENABLE_HOSTED_WRITES', value: string | undefined): void => { if (value === undefined) delete process.env[key]; else process.env[key] = value }
const invoke = async (handler: Handler, options: { role?: 'gm' | 'player'; body?: unknown } = {}): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  return handler({ method: 'POST', node: { req: { headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) } } } as unknown as H3Event)
}

describe('GM-only NPC generation route', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { restore('NODE_ENV', originalNodeEnv); restore('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites) })
  it('structurally denies candidate and guided material to players', async () => {
    await expect(invoke(route, { role: 'player', body: {} })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.manageNpcGenerationUseCase).not.toHaveBeenCalled()
  })
  it('requires production liveplay write opt-in even for inert previews', async () => {
    process.env.NODE_ENV = 'production'; delete process.env.ROTOM_ENABLE_HOSTED_WRITES
    await expect(invoke(route, { role: 'gm', body: { mode: 'preview' } })).rejects.toMatchObject({ statusCode: 403, statusMessage: HOSTED_WRITES_DISABLED_MESSAGE })
    expect(mocks.manageNpcGenerationUseCase).not.toHaveBeenCalled()
  })
  it('passes only the exact GM command into native NPC generation', async () => {
    process.env.NODE_ENV = 'development'
    const body = { schemaVersion: 1, mode: 'preview', operationId: 'npc-operation-001' }
    const response = { schemaVersion: 1, operationId: body.operationId, trainer: {}, roster: [] }
    mocks.manageNpcGenerationUseCase.mockReturnValue(response)
    await expect(invoke(route, { role: 'gm', body })).resolves.toBe(response)
    expect(mocks.manageNpcGenerationUseCase).toHaveBeenCalledWith(body)
  })
})
