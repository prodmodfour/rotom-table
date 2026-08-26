import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '../../server/utils/http'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), publish: vi.fn() }))
vi.mock('../../server/useCases/manageSessionPreparation', () => ({ manageSessionPreparationUseCase: mocks.manage }))
vi.mock('../../server/utils/gmToolkitRealtime', () => ({ publishGmCampaignToolkitInvalidation: mocks.publish }))
const route = (await import('../../server/api/gm-toolkit/session-preparations/mutate.post')).default
type Handler = EventHandler<EventHandlerRequest, unknown>
const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES
const restore = (key: 'NODE_ENV' | 'ROTOM_ENABLE_HOSTED_WRITES', value: string | undefined): void => { if (value === undefined) delete process.env[key]; else process.env[key] = value }
const invoke = async (handler: Handler, options: { role?: 'gm' | 'player'; body?: unknown } = {}): Promise<unknown> => {
  const headers: Record<string, string> = {}; if (options.role) headers.cookie = `rotom-role=${options.role}`; if (options.body !== undefined) headers['content-type'] = 'application/json'
  return handler({ method: 'POST', node: { req: { headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) } } } as unknown as H3Event)
}

describe('GM session preparation mutation route', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => { restore('NODE_ENV', originalNodeEnv); restore('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites) })
  it('denies all private preparation commands to players', async () => {
    await expect(invoke(route, { role: 'player', body: {} })).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.manage).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled()
  })
  it('requires production liveplay write opt-in', async () => {
    process.env.NODE_ENV = 'production'; delete process.env.ROTOM_ENABLE_HOSTED_WRITES
    await expect(invoke(route, { role: 'gm', body: {} })).rejects.toMatchObject({ statusCode: 403, statusMessage: HOSTED_WRITES_DISABLED_MESSAGE })
  })
  it('publishes only identity and revision after a new commit and nothing on exact retry', async () => {
    process.env.NODE_ENV = 'development'
    const body = { schemaVersion: 1, kind: 'create', operationId: 'session-op-001' }
    const response = { schemaVersion: 1, operationId: body.operationId, exactRetry: false, preparation: { preparationId: 'session-preparation:v1:forest', revision: 2, gmNotes: 'never publish' } }
    mocks.manage.mockReturnValue(response)
    await expect(invoke(route, { role: 'gm', body })).resolves.toBe(response)
    expect(mocks.publish).toHaveBeenCalledWith({ schemaVersion: 1, domain: 'session-preparation', documentId: 'session-preparation:v1:forest', revision: 2 }, body.operationId)
    expect(JSON.stringify(mocks.publish.mock.calls)).not.toContain('never publish')
    mocks.publish.mockClear(); mocks.manage.mockReturnValue({ ...response, exactRetry: true })
    await invoke(route, { role: 'gm', body })
    expect(mocks.publish).not.toHaveBeenCalled()
  })
})
