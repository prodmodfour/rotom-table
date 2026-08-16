import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAMPAIGN_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ advance: vi.fn() }))
vi.mock('../../server/useCases/advanceCampaignDayAfterPreflight', () => ({
  advanceCampaignDayAfterPreflightUseCase: mocks.advance,
}))
const route = (await import('../../server/api/campaign/next-day.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const command = () => ({
  schemaVersion: 1,
  operationId: 'campaign-day:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  kind: 'advance-one-day',
  days: 1,
})
const preflightId = `campaign-day-preflight:v1:${'b'.repeat(64)}`
const invoke = (body: unknown, role: 'gm' | 'player' = 'gm') => (route as RouteHandler)({
  method: 'POST',
  path: CAMPAIGN_API_PATHS.nextDay,
  node: { req: { url: CAMPAIGN_API_PATHS.nextDay, headers: {
    cookie: `rotom-role=${role}`,
    'content-type': 'application/json',
  }, body: JSON.stringify(body) } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('campaign next-day route', () => {
  it('forwards one strict durable command and removes private publication details', async () => {
    mocks.advance.mockReturnValue({
      result: {
        ok: true,
        operationId: command().operationId,
        replayed: false,
        realtimeEvents: [{ sequence: 1 }],
        paths: ['data/sheets/pika.json'],
      },
      preflight: { state: 'ready' },
    })
    await expect(invoke({ ...command(), preflightId, clientId: 'gm-client' })).resolves.toEqual({
      ok: true,
      operationId: command().operationId,
      replayed: false,
    })
    expect(mocks.advance).toHaveBeenCalledWith({
      clientId: 'gm-client',
      preflightId,
      command: command(),
    })
  })

  it('rejects missing, decorated, malformed-client, and non-GM requests before mutation', async () => {
    await expect(invoke({ clientId: 'gm-client' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ ...command(), preflightId, wallClockTimestamp: Date.now() })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ ...command(), preflightId, clientId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke(command(), 'player')).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.advance).not.toHaveBeenCalled()
  })
})
