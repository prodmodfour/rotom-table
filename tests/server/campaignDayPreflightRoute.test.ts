import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CAMPAIGN_API_PATHS } from '../../src/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }))
vi.mock('../../server/useCases/prepareCampaignDay', () => ({
  prepareCampaignDayUseCase: mocks.prepare,
}))
const route = (await import('../../server/api/campaign/next-day/preflight.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const command = {
  schemaVersion: 1,
  operationId: 'campaign-day:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  kind: 'advance-one-day',
  days: 1,
} as const
const invoke = (body: unknown, role: 'gm' | 'player' = 'gm') => (route as RouteHandler)({
  method: 'POST',
  path: CAMPAIGN_API_PATHS.nextDayPreflight,
  node: { req: { url: CAMPAIGN_API_PATHS.nextDayPreflight, headers: {
    cookie: `rotom-role=${role}`,
    'content-type': 'application/json',
  }, body: JSON.stringify(body) } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('campaign-day preflight route', () => {
  it('forwards exactly one GM command to the read-only preflight use case', async () => {
    const projection = { schemaVersion: 1, state: 'ready' }
    mocks.prepare.mockReturnValue(projection)
    await expect(invoke(command)).resolves.toBe(projection)
    expect(mocks.prepare).toHaveBeenCalledWith({ command })
  })

  it('rejects missing, decorated, client-authored preflight, and non-GM requests', async () => {
    await expect(invoke({ operationId: command.operationId })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ ...command, preflightId: `campaign-day-preflight:v1:${'b'.repeat(64)}` })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke(command, 'player')).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
})
