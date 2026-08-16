import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  declare: vi.fn(),
  resolveProfile: vi.fn(),
}))
vi.mock('../../server/useCases/loadGroupInventoryItemActions', () => ({
  loadGroupInventoryItemActionsUseCase: mocks.load,
}))
vi.mock('../../server/useCases/declareGroupInventoryItemAction', () => ({
  declareGroupInventoryItemActionUseCase: mocks.declare,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({ resolvePlayerProfileForPolicy: mocks.resolveProfile }))

const loadRoute = (await import('../../server/api/items/group-actions.get')).default
const declareRoute = (await import('../../server/api/items/group-actions/declare.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const event = (input: {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly role?: 'gm' | 'player'
  readonly body?: unknown
}): H3Event => ({
  method: input.method,
  path: input.path,
  node: { req: {
    url: input.path,
    headers: {
      cookie: `rotom-role=${input.role ?? 'gm'}`,
      ...(input.method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    ...(input.method === 'POST' ? { body: JSON.stringify(input.body) } : {}),
  } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('group inventory item action routes', () => {
  it('loads only group, opaque actor, and profile selection inputs', async () => {
    const profile = { id: 'profile_group_item_01' }
    const actorSelectionId = `group-item-actor:v1:${'a'.repeat(32)}`
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.load.mockReturnValue({ schemaVersion: 1, actors: [], offers: [] })
    expect((loadRoute as RouteHandler)(event({
      method: 'GET', role: 'player',
      path: `${ITEM_API_PATHS.groupActions}?groupSlug=main&actorSelectionId=${actorSelectionId}&profileId=profile_group_item_01`,
    }))).toEqual({ schemaVersion: 1, actors: [], offers: [] })
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile, groupSlug: 'main', actorSelectionId,
    })

    expect(() => (loadRoute as RouteHandler)(event({
      method: 'GET', path: `${ITEM_API_PATHS.groupActions}?groupSlug=main&trainerSlug=ash`,
    }))).toThrow(expect.objectContaining({ statusCode: 400 }))
  })

  it('forwards strict declarations while rejecting client-authored row or Trainer identities', async () => {
    const profile = { id: 'profile_group_item_01' }
    const intent = {
      schemaVersion: 1, groupSlug: 'main', groupRevision: 4,
      actorSelectionId: `group-item-actor:v1:${'a'.repeat(32)}`,
      offerId: `sheet-item-offer:v1:${'b'.repeat(32)}`,
      action: 'use',
    }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.declare.mockReturnValue({ schemaVersion: 1, offer: {} })
    await (declareRoute as RouteHandler)(event({
      method: 'POST', role: 'player', path: ITEM_API_PATHS.declareGroupAction,
      body: { intent, profileId: 'profile_group_item_01' },
    }))
    expect(mocks.declare).toHaveBeenCalledWith({ role: 'player', playerProfile: profile, intent })

    await expect((declareRoute as RouteHandler)(event({
      method: 'POST', path: ITEM_API_PATHS.declareGroupAction,
      body: { intent, rowId: 'private-row', trainerSlug: 'ash' },
    }))).rejects.toMatchObject({ statusCode: 400 })
  })
})
