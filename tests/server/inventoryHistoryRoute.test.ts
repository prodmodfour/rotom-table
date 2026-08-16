import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INVENTORY_ACTION_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ load: vi.fn(), resolveProfile: vi.fn() }))
vi.mock('../../server/useCases/loadInventoryHistory', () => ({ loadInventoryHistoryUseCase: mocks.load }))
vi.mock('../../server/policies/playerProfilePolicy', () => ({ resolvePlayerProfileForPolicy: mocks.resolveProfile }))

const route = (await import('../../server/api/inventory/history.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const event = (path: string, role: 'gm' | 'player' = 'gm'): H3Event => ({
  method: 'GET',
  path,
  node: { req: { url: path, headers: { cookie: `rotom-role=${role}` } } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('inventory history route', () => {
  it('binds player Trainer history to the selected Profile and bounded query', () => {
    const profile = { id: 'profile_fixture01' }
    const response = { schemaVersion: 1, generatedAt: 100, scope: { kind: 'trainer', label: 'Ash inventory' }, facts: [], truncated: false }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.load.mockReturnValue(response)
    expect((route as RouteHandler)(event(
      `${INVENTORY_ACTION_API_PATHS.history}?trainerSlug=ash&profileId=profile_fixture01&limit=12`,
      'player',
    ))).toEqual(response)
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_fixture01')
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile,
      trainerSlug: 'ash', groupSlug: undefined, limit: '12',
    })
  })

  it('loads shared history for a GM without resolving a player Profile', () => {
    mocks.load.mockReturnValue({ schemaVersion: 1, scope: { kind: 'group' }, facts: [] })
    ;(route as RouteHandler)(event(`${INVENTORY_ACTION_API_PATHS.history}?groupSlug=main`))
    expect(mocks.resolveProfile).not.toHaveBeenCalled()
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'gm', playerProfile: null,
      trainerSlug: undefined, groupSlug: 'main', limit: undefined,
    })
  })

  it('rejects query expansion before any source projection is loaded', () => {
    expect(() => (route as RouteHandler)(event(
      `${INVENTORY_ACTION_API_PATHS.history}?trainerSlug=ash&operationId=private`,
    ))).toThrow()
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
