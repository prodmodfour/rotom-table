import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ItemOperationRecoveryCommandV1 } from '#shared/itemAutomation/recovery'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'

const mocks = vi.hoisted(() => ({ recover: vi.fn(), resolveProfile: vi.fn() }))
vi.mock('../../server/useCases/recoverItemOperation', () => ({
  recoverItemOperationUseCase: mocks.recover,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))

const route = (await import('../../server/api/items/recover.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const command = (): ItemOperationRecoveryCommandV1 => ({
  schemaVersion: 1, operationId: 'op_item_pending_0001', action: 'abandon',
  reason: 'The private decision is no longer needed.',
})
const invoke = (body: unknown, role: 'gm' | 'player' = 'gm') => (route as RouteHandler)({
  method: 'POST', path: ITEM_API_PATHS.recover,
  node: { req: { url: ITEM_API_PATHS.recover, headers: {
    cookie: `rotom-role=${role}`, 'content-type': 'application/json',
  }, body: JSON.stringify(body) } }, context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('item recovery route', () => {
  it('forwards only recovery intent and role authority', async () => {
    const profile = { id: 'profile_fixture' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.recover.mockReturnValue({ result: { status: 'abandoned' }, sheets: [] })
    await expect(invoke({ command: command(), profileId: 'profile_fixture', clientId: 'client_fixture' }, 'player'))
      .resolves.toMatchObject({ result: { status: 'abandoned' } })
    expect(mocks.recover).toHaveBeenCalledWith({
      role: 'player', playerProfile: profile, command: command(), clientId: 'client_fixture',
    })
  })

  it('rejects missing commands, mechanics fields, and malformed profile authority before the use case', async () => {
    await expect(invoke({ profileId: 'profile_fixture' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), restoredQuantity: 1 })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), profileId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.recover).not.toHaveBeenCalled()
  })
})
