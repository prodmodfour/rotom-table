import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ load: vi.fn(), handle: vi.fn(), resolveProfile: vi.fn(), enforceRate: vi.fn() }))
vi.mock('../../server/useCases/manageItemBreedingWorkflows', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/useCases/manageItemBreedingWorkflows')>()
  return { ...original, loadItemBreedingWorkflows: mocks.load, handleItemBreedingPost: mocks.handle }
})
vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>()
  return { ...original, resolvePlayerProfileForPolicy: mocks.resolveProfile }
})
vi.mock('../../server/security/breedingWriteRateLimit', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/security/breedingWriteRateLimit')>()
  return { ...original, enforceBreedingWriteRateLimit: mocks.enforceRate }
})
const getRoute = (await import('../../server/api/breeding/items.get')).default
const postRoute = (await import('../../server/api/breeding/items.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const invokeGet = async (role: 'gm' | 'player' | null, query: Record<string, string> = {}): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (role) headers.cookie = `rotom-role=${role}`
  const search = new URLSearchParams(query).toString()
  const path = `/api/breeding/items${search ? `?${search}` : ''}`
  return await (getRoute as RouteHandler)({ method: 'GET', path, node: { req: { url: path, headers } }, context: {} } as unknown as H3Event)
}
const invokePost = async (role: 'gm' | 'player' | null, request: unknown, query: Record<string, string> = {}): Promise<unknown> => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-rotom-client-id': 'client-breeding-test' }
  if (role) headers.cookie = `rotom-role=${role}`
  const search = new URLSearchParams(query).toString()
  const path = `/api/breeding/items${search ? `?${search}` : ''}`
  return await (postRoute as RouteHandler)({ method: 'POST', path, node: { req: { url: path, headers, body: JSON.stringify(request) } }, context: {} } as unknown as H3Event)
}
const operationId = `item-breeding:v1:${'a'.repeat(32)}`
const optionId = (value: string) => `breeding-item-option:v1:${value.repeat(32)}`
const assignment = {
  schemaVersion: 1,
  kind: 'assign-egg-warmer',
  operationId,
  trainerSheetSlug: 'trainer-owner',
  expectedTrainerRevision: 4,
  warmerUnitOptionId: optionId('b'),
  eggOptionIds: [optionId('c')],
}
const preview = {
  schemaVersion: 1,
  action: 'preview-fossil',
  operationId,
  trainerSheetSlug: 'trainer-owner',
  expectedTrainerRevision: 4,
  fossilSourceOptionId: optionId('b'),
  machineOptionId: optionId('c'),
  speciesOptionId: optionId('d'),
}

describe('P8-058 breeding item API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.load.mockReturnValue({ schemaVersion: 1, audience: 'gm' })
    mocks.handle.mockReturnValue({ schemaVersion: 1, status: 'accepted' })
    mocks.resolveProfile.mockReturnValue({ schemaVersion: 1, id: 'profile_owner_1' })
  })

  it('requires authentication and forwards one closed role-projected GET selector', async () => {
    await expect(invokeGet(null, { trainerSheetSlug: 'trainer-owner' })).rejects.toMatchObject({ statusCode: 401 })
    await expect(invokeGet('player', { trainerSheetSlug: 'trainer-owner', profileId: 'profile_owner_1' })).resolves.toEqual({ schemaVersion: 1, audience: 'gm' })
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_owner_1')
    expect(mocks.load).toHaveBeenCalledWith({ authority: { role: 'player', playerProfile: { schemaVersion: 1, id: 'profile_owner_1' } }, trainerSheetSlug: 'trainer-owner' })
    await expect(invokeGet('gm', { trainerSheetSlug: 'trainer-owner', profileId: 'forbidden' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('admits exact mutations through rate limiting but leaves previews mechanically inert', async () => {
    await invokePost('gm', preview)
    expect(mocks.enforceRate).not.toHaveBeenCalled()
    expect(mocks.handle).toHaveBeenLastCalledWith({ authority: { role: 'gm', playerProfile: null, clientId: 'client-breeding-test' }, request: preview })
    await invokePost('gm', assignment)
    expect(mocks.enforceRate).toHaveBeenCalledWith(expect.anything(), { role: 'gm', profileId: null })
    expect(mocks.handle).toHaveBeenLastCalledWith({ authority: { role: 'gm', playerProfile: null, clientId: 'client-breeding-test' }, request: assignment })
  })

  it('resolves player Profile authority and rejects enriched or malformed requests before execution', async () => {
    await invokePost('player', assignment, { profileId: 'profile_owner_1' })
    expect(mocks.enforceRate).toHaveBeenCalledWith(expect.anything(), { role: 'player', profileId: 'profile_owner_1' })
    expect(mocks.handle).toHaveBeenCalledWith({ authority: { role: 'player', playerProfile: { schemaVersion: 1, id: 'profile_owner_1' }, clientId: 'client-breeding-test' }, request: assignment })
    mocks.handle.mockClear()
    for (const invalid of [{ ...assignment, inventoryEntryId: 'private-row' }, { ...preview, expectedTrainerRevision: -1 }, null]) {
      await expect(invokePost('gm', invalid)).rejects.toMatchObject({ statusCode: 400 })
    }
    await expect(invokePost('gm', assignment, { profileId: 'forbidden' })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.handle).not.toHaveBeenCalled()
  })
})
