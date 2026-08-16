import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  status: vi.fn(),
  resolveProfile: vi.fn(),
}))
vi.mock('../../server/useCases/loadEncounterSettlement', () => ({
  loadEncounterSettlement: mocks.load,
}))
vi.mock('../../server/useCases/getEncounterSettlementOperationStatus', () => ({
  getEncounterSettlementOperationStatus: mocks.status,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))

const loadRoute = (await import('../../server/api/encounter-settlements/[settlementId].get')).default
const statusRoute = (await import('../../server/api/encounter-settlements/operations/status.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const invokeLoad = async (
  query: Record<string, unknown>,
  role: 'gm' | 'player' = 'gm',
): Promise<unknown> => {
  const serialized = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()
  const path = `/api/encounter-settlements/settlement-route-a${serialized ? `?${serialized}` : ''}`
  return await (loadRoute as RouteHandler)({
    method: 'GET',
    path,
    node: { req: { url: path, headers: { cookie: `rotom-role=${role}` } } },
    context: { params: { settlementId: 'settlement-route-a' } },
  } as unknown as H3Event)
}

const invokeStatus = async (
  body: unknown,
  role: 'gm' | 'player' = 'gm',
): Promise<unknown> => await (statusRoute as RouteHandler)({
  method: 'POST',
  path: '/api/encounter-settlements/operations/status',
  node: { req: {
    url: '/api/encounter-settlements/operations/status',
    headers: { cookie: `rotom-role=${role}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  } },
  context: {},
} as unknown as H3Event)

const command = {
  schemaVersion: 1,
  operationId: 'settlement-operation:route-a',
  settlementId: 'encounter-settlement:route-a',
  expectedSettlementRevision: 1,
  planDefinitionSha256: 'a'.repeat(64),
  confirmed: true,
}

afterEach(() => vi.clearAllMocks())

describe('encounter settlement load and recovery routes', () => {
  it('forwards only bounded load authority and resolves a player profile server-side', async () => {
    const profile = { id: 'profile_route' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.load.mockReturnValue({ freshness: 'current' })

    await expect(invokeLoad({ profileId: 'profile_route', expectedRevision: 2, historyLimit: 10 }, 'player'))
      .resolves.toEqual({ freshness: 'current' })
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'player',
      playerProfile: profile,
      settlementId: 'settlement-route-a',
      expectedRevision: '2',
      historyLimit: '10',
    })
  })

  it('rejects expanded load queries and recovery envelopes before use-case execution', async () => {
    await expect(invokeLoad({ privateEvidence: 'requested' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invokeStatus({ command, retryAutomatically: true })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invokeStatus({})).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.status).not.toHaveBeenCalled()
  })

  it('passes one exact GM recovery command with server-owned principal authority', async () => {
    mocks.status.mockReturnValue({ status: 'unknown', retry: 'explicit-only' })
    await expect(invokeStatus({ command })).resolves.toEqual({ status: 'unknown', retry: 'explicit-only' })
    expect(mocks.status).toHaveBeenCalledWith({
      role: 'gm',
      principalKey: 'role:gm',
      command,
    })
  })
})
