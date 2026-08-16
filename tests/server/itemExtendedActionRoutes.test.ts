import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { activeEquipmentState } from '../fixtures/equipment'

const mocks = vi.hoisted(() => ({
  manage: vi.fn(),
  load: vi.fn(),
  resolveProfile: vi.fn(),
}))
vi.mock('../../server/useCases/manageItemExtendedAction', () => ({
  manageItemExtendedActionUseCase: mocks.manage,
  loadItemExtendedActionsUseCase: mocks.load,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))

const postRoute = (await import('../../server/api/items/extended-actions.post')).default
const getRoute = (await import('../../server/api/items/extended-actions.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const command = {
  schemaVersion: 1,
  kind: 'complete',
  operationId: 'item-activity-operation:v1:00000000000000000000000000000002',
  activityId: 'item-activity:v1:00000000000000000000000000000001',
  expectedRevision: 0,
}
const invokePost = (body: unknown, role: 'gm' | 'player' = 'gm') => (postRoute as RouteHandler)({
  method: 'POST',
  path: ITEM_API_PATHS.extendedActions,
  node: { req: { url: ITEM_API_PATHS.extendedActions, headers: {
    cookie: `rotom-role=${role}`,
    'content-type': 'application/json',
  }, body: JSON.stringify(body) } },
  context: {},
} as unknown as H3Event)
const invokeGet = (query: string, role: 'gm' | 'player' = 'gm') => (getRoute as RouteHandler)({
  method: 'GET',
  path: `${ITEM_API_PATHS.extendedActions}?${query}`,
  node: { req: { url: `${ITEM_API_PATHS.extendedActions}?${query}`, headers: {
    cookie: `rotom-role=${role}`,
  } } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('item Extended Action routes', () => {
  it('forwards strict command and query authority to the server use cases', async () => {
    const profile = { id: 'profile_medic01' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.manage.mockReturnValue({ result: { status: 'in-progress' }, activity: {}, sheets: [] })
    await expect(invokePost({ command, profileId: 'profile_medic01', clientId: 'client_fixture' }, 'player'))
      .resolves.toMatchObject({ result: { status: 'in-progress' } })
    expect(mocks.manage).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile, command, clientId: 'client_fixture',
    })

    mocks.load.mockReturnValue([{ activityId: command.activityId }])
    expect(invokeGet('trainerSlug=medic&profileId=profile_medic01', 'player'))
      .toEqual([{ activityId: command.activityId }])
    expect(mocks.load).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile, trainerSlug: 'medic',
    })
  })

  it('redacts accepted sheet equipment authority while preserving safe activity evidence', async () => {
    mocks.resolveProfile.mockReturnValue({ id: 'profile_medic01' })
    const sheet = {
      slug: 'volt', nickname: 'Volt', species: 'Pikachu', level: 5,
      equipmentState: activeEquipmentState({
        ownerKind: 'pokemon', ownerSlug: 'volt', slotId: 'held', canonicalItemId: 'Quick Claw',
      }),
    }
    mocks.manage.mockReturnValue({
      result: { status: 'completed' },
      activity: { activityId: command.activityId, status: 'completed', item: { label: 'First Aid Kit' } },
      sheets: [{ kind: 'pokemon', slug: 'volt', revision: 3, updatedAt: 100, sheet }],
    })
    const response = await invokePost({ command, profileId: 'profile_medic01' }, 'player') as any
    expect(response.activity).toEqual({
      activityId: command.activityId, status: 'completed', item: { label: 'First Aid Kit' },
    })
    expect(response.sheets[0].sheet.equipmentState).toBeUndefined()
    expect(response.sheets[0].sheet.equipmentProjection.instances[0]).toMatchObject({
      canonicalItemId: 'Quick Claw', activity: { status: 'active' },
    })
    expect(JSON.stringify(response)).not.toContain('equipped-item:v1:')
  })

  it('rejects unknown command envelope fields and malformed query slugs', async () => {
    await expect(invokePost({ command, canonicalItemId: 'First Aid Kit' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invokePost({ command, profileId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    expect(() => invokeGet('trainerSlug=not%20a%20slug')).toThrow('trainerSlug must match')
    expect(mocks.manage).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
