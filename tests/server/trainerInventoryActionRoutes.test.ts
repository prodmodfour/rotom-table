import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INVENTORY_ACTION_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  loadGroup: vi.fn(),
  execute: vi.fn(),
  executeGroup: vi.fn(),
  resolveProfile: vi.fn(),
}))
vi.mock('../../server/useCases/loadTrainerInventoryActions', () => ({ loadTrainerInventoryActionsUseCase: mocks.load }))
vi.mock('../../server/useCases/loadGroupInventoryActions', () => ({ loadGroupInventoryActionsUseCase: mocks.loadGroup }))
vi.mock('../../server/useCases/executeTrainerInventoryAction', () => ({ executeTrainerInventoryActionUseCase: mocks.execute }))
vi.mock('../../server/useCases/executeGroupInventoryAction', () => ({ executeGroupInventoryActionUseCase: mocks.executeGroup }))
vi.mock('../../server/policies/playerProfilePolicy', () => ({ resolvePlayerProfileForPolicy: mocks.resolveProfile }))

const loadRoute = (await import('../../server/api/inventory/actions.get')).default
const executeRoute = (await import('../../server/api/inventory/actions/execute.post')).default
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

describe('unified inventory action routes', () => {
  it('loads only the controlled Trainer projection for the authenticated principal', () => {
    const profile = { id: 'profile_fixture01' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.load.mockReturnValue({ schemaVersion: 1, generatedAt: 100, offers: [] })
    expect((loadRoute as RouteHandler)(event({
      method: 'GET', role: 'player',
      path: `${INVENTORY_ACTION_API_PATHS.actions}?trainerSlug=ash&profileId=profile_fixture01`,
    }))).toEqual({ schemaVersion: 1, generatedAt: 100, offers: [] })
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_fixture01')
    expect(mocks.load).toHaveBeenCalledWith({ role: 'player', playerProfile: profile, trainerSlug: 'ash' })
  })

  it('loads the group transfer projection from the mutually exclusive group scope', () => {
    mocks.loadGroup.mockReturnValue({ schemaVersion: 1, generatedAt: 101, offers: [] })
    expect((loadRoute as RouteHandler)(event({
      method: 'GET', role: 'gm',
      path: `${INVENTORY_ACTION_API_PATHS.actions}?groupSlug=main`,
    }))).toEqual({ schemaVersion: 1, generatedAt: 101, offers: [] })
    expect(mocks.loadGroup).toHaveBeenCalledWith({ role: 'gm', playerProfile: null, groupSlug: 'main' })
    expect(() => (loadRoute as RouteHandler)(event({
      method: 'GET', path: `${INVENTORY_ACTION_API_PATHS.actions}?trainerSlug=ash&groupSlug=main`,
    }))).toThrow()
  })

  it('forwards only one strict declaration and returns authoritative affected resources', async () => {
    const declaration = {
      schemaVersion: 1,
      operationId: `inventory-action:v1:${'1'.repeat(32)}`,
      offerId: `inventory-action-offer:v1:${'2'.repeat(32)}`,
      action: 'give',
      sourceSelectionId: `inventory-source:v1:${'3'.repeat(32)}`,
      quantity: 1,
      destinationId: `inventory-destination:v1:${'4'.repeat(32)}`,
      confirmationOptionId: null,
      expectedRevisions: [],
    }
    const result = {
      result: {
        schemaVersion: 1, operationId: declaration.operationId, action: 'give', exactReplay: false,
        message: 'Whole item moved.',
      },
      sheets: [{ kind: 'trainer', slug: 'ash', revision: 4, updatedAt: 101, sheet: { slug: 'ash', revision: 4 } }],
      groupInventories: [],
    }
    mocks.execute.mockReturnValue(result)
    const response = await (executeRoute as RouteHandler)(event({
      method: 'POST', path: INVENTORY_ACTION_API_PATHS.execute,
      body: { trainerSlug: 'ash', declaration, clientId: 'inventory-client' },
    }))
    expect(mocks.execute).toHaveBeenCalledWith({
      role: 'gm', playerProfile: null, trainerSlug: 'ash', declaration, clientId: 'inventory-client',
    })
    expect(response).toMatchObject({ result: result.result, sheets: [{ slug: 'ash', revision: 4 }] })

    await expect((executeRoute as RouteHandler)(event({
      method: 'POST', path: INVENTORY_ACTION_API_PATHS.execute,
      body: { trainerSlug: 'ash', declaration, rowId: 'private-row' },
    }))).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('dispatches a group-scoped declaration without accepting both scope identities', async () => {
    const declaration = {
      schemaVersion: 1,
      operationId: `inventory-action:v1:${'5'.repeat(32)}`,
      offerId: `inventory-action-offer:v1:${'6'.repeat(32)}`,
      action: 'transfer',
      sourceSelectionId: `inventory-source:v1:${'7'.repeat(32)}`,
      quantity: 1,
      destinationId: `inventory-destination:v1:${'8'.repeat(32)}`,
      confirmationOptionId: null,
      expectedRevisions: [],
    }
    mocks.executeGroup.mockReturnValue({
      result: { schemaVersion: 1, operationId: declaration.operationId, action: 'transfer', exactReplay: false, message: 'Moved.' },
      sheets: [],
      groupInventories: [],
    })
    await (executeRoute as RouteHandler)(event({
      method: 'POST', path: INVENTORY_ACTION_API_PATHS.execute,
      body: { groupSlug: 'main', declaration },
    }))
    expect(mocks.executeGroup).toHaveBeenCalledWith({
      role: 'gm', playerProfile: null, groupSlug: 'main', declaration, clientId: undefined,
    })
    await expect((executeRoute as RouteHandler)(event({
      method: 'POST', path: INVENTORY_ACTION_API_PATHS.execute,
      body: { groupSlug: 'main', trainerSlug: 'ash', declaration },
    }))).rejects.toMatchObject({ statusCode: 400 })
  })
})
