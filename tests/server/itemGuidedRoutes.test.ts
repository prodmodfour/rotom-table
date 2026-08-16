import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), load: vi.fn(), profile: vi.fn() }))
vi.mock('../../server/useCases/manageItemGuidedAdjudication', () => ({
  manageItemGuidedAdjudicationUseCase: mocks.manage,
  loadItemGuidedAdjudicationUseCase: mocks.load,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({ resolvePlayerProfileForPolicy: mocks.profile }))

const postRoute = (await import('../../server/api/items/guided.post')).default
const getRoute = (await import('../../server/api/items/guided.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const command = {
  schemaVersion: 1, operationId: 'item-guided-operation:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  action: 'cancel', requestId: 'item-guided:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', expectedRevision: 0,
}
const invokePost = (body: unknown, role: 'gm' | 'player' = 'gm') => (postRoute as RouteHandler)({
  method: 'POST', path: ITEM_API_PATHS.guided,
  node: { req: { url: ITEM_API_PATHS.guided, headers: {
    cookie: `rotom-role=${role}`, 'content-type': 'application/json',
  }, body: JSON.stringify(body) } }, context: {},
} as unknown as H3Event)
const invokeGet = (query: string, role: 'gm' | 'player' = 'gm') => (getRoute as RouteHandler)({
  method: 'GET', path: `${ITEM_API_PATHS.guided}?${query}`,
  node: { req: { url: `${ITEM_API_PATHS.guided}?${query}`, headers: { cookie: `rotom-role=${role}` } } }, context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('guided item routes', () => {
  it('forwards exact player commands and one controlled owner projection', async () => {
    const profile = { id: 'profile_mira0001' }
    mocks.profile.mockReturnValue(profile)
    mocks.manage.mockReturnValue({ result: { operationId: command.operationId }, sheets: [] })
    await expect(invokePost({ command, profileId: profile.id, clientId: 'guided-client' }, 'player'))
      .resolves.toEqual({ result: { operationId: command.operationId }, sheets: [] })
    expect(mocks.manage).toHaveBeenCalledWith({ role: 'player', playerProfile: profile, command, clientId: 'guided-client' })

    mocks.load.mockReturnValue({ schemaVersion: 1, requests: [], reBreatherOffers: [] })
    expect(invokeGet(`ownerKind=trainer&ownerSlug=mira&profileId=${profile.id}`, 'player'))
      .toEqual({ schemaVersion: 1, requests: [], reBreatherOffers: [] })
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile, ownerKind: 'trainer', ownerSlug: 'mira',
    })
  })

  it('loads the authenticated GM queue without client-supplied authority', () => {
    mocks.load.mockReturnValue({ schemaVersion: 1, requests: [], reBreatherOffers: [] })
    expect(invokeGet('', 'gm')).toEqual({ schemaVersion: 1, requests: [], reBreatherOffers: [] })
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'gm', playerProfile: null, ownerKind: undefined, ownerSlug: undefined,
    })
  })

  it('rejects incomplete owners and unknown mutation fields before use-case execution', async () => {
    expect(() => invokeGet('', 'player')).toThrow('requires one controlled owner')
    expect(() => invokeGet('ownerKind=trainer', 'gm')).toThrow('must be provided together')
    expect(() => invokeGet('ownerKind=group&ownerSlug=mira', 'gm')).toThrow('must be trainer or pokemon')
    await expect(invokePost({ command, loyaltyDelta: -4 })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invokePost({ command, profileId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.manage).not.toHaveBeenCalled()
  })
})
