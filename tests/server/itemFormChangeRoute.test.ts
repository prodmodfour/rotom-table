import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ITEM_API_PATHS } from '~/utils/apiRoutes'
import type { ExecuteItemFormChangeCommandV1 } from '#shared/itemAutomation/formChanges'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), resolveProfile: vi.fn() }))
vi.mock('../../server/useCases/executeItemFormChange', () => ({
  executeItemFormChangeUseCase: mocks.execute,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolveProfile,
}))

const route = (await import('../../server/api/items/form-changes.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const command = (): ExecuteItemFormChangeCommandV1 => ({
  schemaVersion: 1,
  operationId: 'item-form-change-operation-route',
  offerId: 'offer:mega',
  mapSlug: 'arena',
  baseRevision: 4,
  actorPlacementId: 'trainer-token',
  targetPlacementId: 'pokemon-token',
  abilityOptionId: null,
  readSet: [
    { kind: 'map', sheetKind: null, id: 'arena', revision: 4 },
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pokemon', revision: 2 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'trainer', revision: 3 },
  ],
})
const invoke = (body: unknown, role: 'gm' | 'player' = 'gm') => (route as RouteHandler)({
  method: 'POST',
  path: ITEM_API_PATHS.formChanges,
  node: { req: { url: ITEM_API_PATHS.formChanges, headers: {
    cookie: `rotom-role=${role}`,
    'content-type': 'application/json',
  }, body: JSON.stringify(body) } },
  context: {},
} as unknown as H3Event)

afterEach(() => vi.clearAllMocks())

describe('item form-change route', () => {
  it('forwards only the strict command and resolved player authority and returns a public result', async () => {
    const profile = { id: 'profile_mega' }
    mocks.resolveProfile.mockReturnValue(profile)
    mocks.execute.mockReturnValue({
      schemaVersion: 1, operationId: command().operationId, mapSlug: 'arena', mapRevision: 5,
      actorPlacementId: 'trainer-token', targetPlacementId: 'pokemon-token',
      formName: 'Mega Charizard X', abilityName: 'Tough Claws', durationLabel: 'Scene',
      status: 'accepted', exactReplay: false, message: 'Charizard became Mega Charizard X for this Scene.',
    })
    const response = await invoke({
      command: command(), profileId: 'profile_mega', clientId: 'client_mega',
    }, 'player')
    expect(response).toMatchObject({ result: {
      status: 'accepted', formName: 'Mega Charizard X', exactReplay: false,
    } })
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_mega')
    expect(mocks.execute).toHaveBeenCalledWith({ role: 'player', playerProfile: profile, command: command() })
    expect(JSON.stringify(response)).not.toContain('instanceId')
    expect(JSON.stringify(response)).not.toContain('Sha256')
  })

  it('rejects missing commands, unknown fields, and malformed optional envelope fields', async () => {
    await expect(invoke({ profileId: 'profile_mega' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), sourceInstanceId: 'private' })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), profileId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ command: command(), clientId: 42 })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
