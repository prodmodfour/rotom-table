import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EquipmentOperationCommandV1 } from '#shared/itemAutomation/equipmentOperations'
import { EQUIPMENT_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveProfile: vi.fn(),
  redact: vi.fn((_kind: string, sheet: Record<string, unknown>) => ({ ...sheet, serverPrivate: undefined })),
}))
vi.mock('../../server/useCases/executeEquipmentOperation', () => ({
  executeEquipmentOperation: mocks.execute,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))
vi.mock('../../server/utils/sheetPrivacy', () => ({
  redactSheetRecordForPlayer: mocks.redact,
}))

const equipmentRoute = (await import('../../server/api/equipment/operations.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const command = (): EquipmentOperationCommandV1 => ({
  schemaVersion: 1,
  operationId: `equipment-operation:v1:${'1'.repeat(32)}`,
  commandKind: 'equip',
  actorProfileId: 'profile_fixture',
  source: {
    kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment',
    rowId: 'armor-row', sourceInstanceId: 'item-instance:trainer:ash:equipment:armor-row', expectedRevision: 4,
  },
  destination: {
    kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', slotIds: ['body'],
    expectedSheetRevision: 4, expectedEquipmentRevision: 0,
  },
  replacedInstanceId: null,
  swapReturnDestination: null,
  configuration: null,
})

const invoke = (body: unknown, role: 'gm' | 'player' = 'gm') => (equipmentRoute as RouteHandler)({
  method: 'POST',
  path: EQUIPMENT_API_PATHS.operations,
  node: { req: { url: EQUIPMENT_API_PATHS.operations, headers: {
    cookie: `rotom-role=${role}`,
    'content-type': 'application/json',
  }, body: JSON.stringify(body) } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('equipment operation route', () => {
  it('forwards selected player authority and returns only player-redacted sheet documents', async () => {
    const profile = { id: 'profile_fixture' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.execute.mockReturnValue({
      result: { status: 'accepted' },
      sheets: [{
        kind: 'trainer', slug: 'ash', revision: 5, updatedAt: 100,
        sheet: { slug: 'ash', revision: 5, serverPrivate: { sourceRowId: 'secret' } },
      }],
      groupInventories: [],
    })
    const response = await invoke({ command: command(), profileId: 'profile_fixture', clientId: 'client_fixture' }, 'player') as {
      sheets: Array<{ sheet: Record<string, unknown> }>
    }
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_fixture')
    expect(mocks.execute).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile, command: command(), clientId: 'client_fixture',
    })
    expect(mocks.redact).toHaveBeenCalledWith('trainer', expect.objectContaining({ slug: 'ash' }))
    expect(response.sheets[0]?.sheet.serverPrivate).toBeUndefined()
  })

  it('rejects missing commands, unknown fields, and malformed optional authority before execution', async () => {
    await expect(invoke({ clientId: 'client_fixture' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), canonicalItemId: 'Light Armor' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), profileId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), clientId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
