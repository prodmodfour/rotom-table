import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  declare: vi.fn(),
  resolveProfile: vi.fn(),
}))
vi.mock('../../server/useCases/loadSheetItemActions', () => ({ loadSheetItemActionsUseCase: mocks.load }))
vi.mock('../../server/useCases/declareSheetItemAction', () => ({ declareSheetItemActionUseCase: mocks.declare }))
vi.mock('../../server/policies/playerProfilePolicy', () => ({ resolvePlayerProfileForPolicy: mocks.resolveProfile }))

const loadRoute = (await import('../../server/api/items/sheet-actions.get')).default
const declareRoute = (await import('../../server/api/items/sheet-actions/declare.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const event = (input: { readonly method: 'GET' | 'POST', readonly path: string, readonly role?: 'gm' | 'player', readonly body?: unknown }): H3Event => ({
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

describe('sheet item action routes', () => {
  it('loads a role-authorized Trainer projection without exposing declaration input', async () => {
    const profile = { id: 'profile_fixture01' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.load.mockReturnValue({ schemaVersion: 1, offers: [] })
    expect((loadRoute as RouteHandler)(event({
      method: 'GET', role: 'player', path: `${ITEM_API_PATHS.sheetActions}?trainerSlug=ash&profileId=profile_fixture01`,
    }))).toEqual({ schemaVersion: 1, offers: [] })
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_fixture01')
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile, trainerSlug: 'ash',
    })
  })

  it('forwards only a strict declaration intent and selected player profile', async () => {
    const profile = { id: 'profile_fixture01' }
    const intent = {
      schemaVersion: 1, trainerSlug: 'ash', trainerRevision: 3,
      offerId: 'offer:sheet-item:potion', action: 'use',
    }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.declare.mockReturnValue({ offerId: intent.offerId, itemCommand: {} })
    await (declareRoute as RouteHandler)(event({
      method: 'POST', role: 'player', path: ITEM_API_PATHS.declareSheetAction,
      body: { intent, profileId: 'profile_fixture01' },
    }))
    expect(mocks.declare).toHaveBeenCalledWith({ role: 'player', playerProfile: profile, intent })

    await expect((declareRoute as RouteHandler)(event({
      method: 'POST', path: ITEM_API_PATHS.declareSheetAction,
      body: { intent, rowId: 'private-row' },
    }))).rejects.toMatchObject({ statusCode: 400 })
  })
})
