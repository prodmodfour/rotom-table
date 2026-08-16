import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), load: vi.fn(), resolveProfile: vi.fn() }))
vi.mock('../../server/useCases/executeItemExplorationOperation', () => ({
  executeItemExplorationOperationUseCase: mocks.execute,
}))
vi.mock('../../server/useCases/loadItemExploration', () => ({
  loadItemExplorationUseCase: mocks.load,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))

const postRoute = (await import('../../server/api/items/exploration.post')).default
const getRoute = (await import('../../server/api/items/exploration.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const command = {
  schemaVersion: 1,
  operationId: 'item-exploration:v1:11111111111111111111111111111111',
  kind: 'resolve-route-lure-check',
  trainerSlug: 'explorer', trainerRevision: 3, campaignClockRevision: 2,
  activityId: 'item-route-lure:v1:22222222222222222222222222222222',
}
const invokePost = (body: unknown, role: 'gm' | 'player' = 'gm') => (postRoute as RouteHandler)({
  method: 'POST', path: ITEM_API_PATHS.exploration,
  node: { req: { url: ITEM_API_PATHS.exploration, headers: {
    cookie: `rotom-role=${role}`, 'content-type': 'application/json',
  }, body: JSON.stringify(body) } }, context: {},
} as unknown as H3Event)
const invokeGet = (query: string, role: 'gm' | 'player' = 'gm') => (getRoute as RouteHandler)({
  method: 'GET', path: `${ITEM_API_PATHS.exploration}?${query}`,
  node: { req: { url: `${ITEM_API_PATHS.exploration}?${query}`, headers: { cookie: `rotom-role=${role}` } } }, context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('item exploration routes', () => {
  it('forwards principal-bound exact commands and Trainer projection authority', async () => {
    const profile = { id: 'profile_explorer01' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.execute.mockReturnValue({ operationId: command.operationId, status: 'accepted' })
    await expect(invokePost({ command, profileId: profile.id, clientId: 'exploration-client' }, 'player'))
      .resolves.toEqual({ result: { operationId: command.operationId, status: 'accepted' } })
    expect(mocks.execute).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile, command, clientId: 'exploration-client',
    })

    mocks.load.mockReturnValue({ kind: 'trainer', trainerSlug: 'explorer' })
    expect(invokeGet(`trainerSlug=explorer&profileId=${profile.id}`, 'player'))
      .toEqual({ kind: 'trainer', trainerSlug: 'explorer' })
    expect(mocks.load).toHaveBeenCalledWith({
      kind: 'trainer', role: 'player', playerProfile: profile, trainerSlug: 'explorer',
    })
  })

  it('keeps map positioning on the authenticated GM path without player profile authority', () => {
    mocks.load.mockReturnValue({ kind: 'map', mapSlug: 'route-map', repelPositioning: [] })
    expect(invokeGet('mapSlug=route-map', 'gm')).toEqual({ kind: 'map', mapSlug: 'route-map', repelPositioning: [] })
    expect(mocks.load).toHaveBeenCalledWith({ kind: 'map', role: 'gm', mapSlug: 'route-map' })
  })

  it('rejects ambiguous queries, malformed slugs, and unsupported mutation fields before use-case execution', async () => {
    expect(() => invokeGet('trainerSlug=explorer&mapSlug=route-map')).toThrow('exactly one trainerSlug or mapSlug')
    expect(() => invokeGet('')).toThrow('exactly one trainerSlug or mapSlug')
    expect(() => invokeGet('trainerSlug=not%20a%20slug')).toThrow('trainerSlug must match')
    await expect(invokePost({ command, canonicalItemId: 'Bait' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invokePost({ command, profileId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invokePost({ command, clientId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
