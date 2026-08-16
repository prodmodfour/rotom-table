import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), finish: vi.fn() }))
vi.mock('../../server/useCases/prepareFinishEncounter', () => ({
  prepareFinishEncounter: mocks.prepare,
}))
vi.mock('../../server/useCases/finishEncounter', () => ({
  finishEncounter: mocks.finish,
}))

const prepareRoute = (await import('../../server/api/encounter-settlements/finish/prepare.post')).default
const commitRoute = (await import('../../server/api/encounter-settlements/finish/commit.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const invoke = async (
  route: unknown,
  path: string,
  body: unknown,
  role: 'gm' | 'player' = 'gm',
): Promise<unknown> => await (route as RouteHandler)({
  method: 'POST', path,
  node: { req: {
    url: path,
    headers: { cookie: `rotom-role=${role}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } },
  context: {},
} as unknown as H3Event)

const command = {
  schemaVersion: 1,
  operationId: 'settlement-commit:v1:0000000001000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  settlementId: 'encounter-settlement:riverside-training',
  expectedSettlementRevision: 2,
  planDefinitionSha256: 'a'.repeat(64),
  confirmed: true,
}

afterEach(() => vi.clearAllMocks())

describe('Finish Encounter routes', () => {
  it('forwards one encounter identity and returns only its role-safe view', async () => {
    mocks.prepare.mockReturnValue({ view: { state: 'ready' }, plan: { private: true } })
    await expect(invoke(
      prepareRoute, '/api/encounter-settlements/finish/prepare',
      { encounterId: 'encounter-riverside-training' },
    )).resolves.toEqual({ state: 'ready' })
    expect(mocks.prepare).toHaveBeenCalledWith({ role: 'gm', encounterId: 'encounter-riverside-training' })
  })

  it('forwards exactly one opaque commit command under the GM principal', async () => {
    mocks.finish.mockReturnValue({ state: 'accepted' })
    await expect(invoke(
      commitRoute, '/api/encounter-settlements/finish/commit', { command },
    )).resolves.toEqual({ state: 'accepted' })
    expect(mocks.finish).toHaveBeenCalledWith({ role: 'gm', principalKey: 'role:gm', command })
  })

  it('rejects player access and expanded envelopes before execution', async () => {
    await expect(invoke(
      prepareRoute, '/api/encounter-settlements/finish/prepare',
      { encounterId: 'encounter-riverside-training' }, 'player',
    )).rejects.toMatchObject({ statusCode: 403 })
    await expect(invoke(
      commitRoute, '/api/encounter-settlements/finish/commit',
      { command }, 'player',
    )).rejects.toMatchObject({ statusCode: 403 })
    await expect(invoke(
      prepareRoute, '/api/encounter-settlements/finish/prepare',
      { encounterId: 'encounter-riverside-training', rewardPatch: [] },
    )).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke(
      commitRoute, '/api/encounter-settlements/finish/commit',
      { command, retryAutomatically: true },
    )).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(mocks.finish).not.toHaveBeenCalled()
  })
})
