import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import { activeEquipmentState } from '../fixtures/equipment'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveProfile: vi.fn(),
}))
vi.mock('../../server/useCases/executeItemOperation', () => ({
  executeItemOperationUseCase: mocks.execute,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))

const itemUseRoute = (await import('../../server/api/items/use.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const command = (): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: 'op_item_route_0001',
  context: 'encounter',
  offerId: 'offer:item:potion',
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row',
  actorParticipantId: 'ash-placement',
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: ['pikachu-placement'],
  choices: [{ choiceId: 'target', optionIds: ['pikachu-placement'] }],
  readSet: [
    { kind: 'map', id: 'arena', revision: 4 },
    { kind: 'encounter', id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
  ],
})

const invoke = (body: unknown, role: 'gm' | 'player' = 'gm') => (itemUseRoute as RouteHandler)({
  method: 'POST',
  path: ITEM_API_PATHS.use,
  node: { req: { url: ITEM_API_PATHS.use, headers: {
    cookie: `rotom-role=${role}`,
    'content-type': 'application/json',
  }, body: JSON.stringify(body) } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('general item use route', () => {
  it('forwards the strict command envelope and player authority to the use case', async () => {
    const profile = { id: 'profile_fixture' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.execute.mockReturnValue({ result: { status: 'accepted' }, sheets: [] })
    await expect(invoke({ command: command(), profileId: 'profile_fixture', clientId: 'client_fixture' }, 'player'))
      .resolves.toMatchObject({ result: { status: 'accepted' } })
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_fixture')
    expect(mocks.execute).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile, command: command(), clientId: 'client_fixture',
    })
  })

  it('projects accepted sheets and serialized group inventory safely for players', async () => {
    const sheet = {
      slug: 'pikachu', nickname: 'Pika', species: 'Pikachu', level: 5,
      equipmentState: activeEquipmentState({
        ownerKind: 'pokemon', ownerSlug: 'pikachu', slotId: 'held', canonicalItemId: 'Quick Claw',
      }),
    }
    mocks.resolveProfile.mockReturnValue({ id: 'profile_fixture' })
    mocks.execute.mockReturnValue({
      result: { status: 'accepted' },
      sheets: [{ kind: 'pokemon', slug: 'pikachu', revision: 2, updatedAt: 10, sheet }],
      groupInventory: {
        slug: 'party', revision: 3, updatedAt: 10,
        inventory: { equipment: [{
          id: 'whole-claw', name: 'Quick Claw', qty: 1,
          serializedEquipment: { instanceId: 'equipped-item:v1:11111111111111111111111111111111' },
        }] },
      },
    })
    const response = await invoke({ command: command(), profileId: 'profile_fixture' }, 'player') as any

    expect(response.sheets[0].sheet.equipmentState).toBeUndefined()
    expect(response.sheets[0].sheet.equipmentProjection.instances[0]).toMatchObject({
      instanceId: 'equipment-projection:v1:0',
      canonicalItemId: 'Quick Claw', activity: { status: 'active' },
    })
    expect(response.sheets[0].sheet.equipmentContributionProjection.values[0]).toMatchObject({
      metricId: 'initiative:all', base: 9, final: 19,
      sources: [{ sourceLabel: 'Quick Claw', value: 10, applied: 10 }],
    })
    expect(response.groupInventory.inventory.equipment[0].serializedEquipment).toBeUndefined()
    expect(JSON.stringify(response)).not.toContain('equipped-item:v1:')
    expect(JSON.stringify(response)).not.toContain('canonicalRecordSha256')
  })

  it('rejects missing commands, unknown request fields, and malformed optional authority fields', async () => {
    await expect(invoke({ clientId: 'client_fixture' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), canonicalItemId: 'Potion' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), profileId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
