import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManageBreedingConsentWorkflowError } from '../../server/useCases/manageBreedingConsentWorkflow'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), resolveProfile: vi.fn(), enforceRate: vi.fn() }))
vi.mock('../../server/useCases/manageBreedingConsentWorkflow', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/useCases/manageBreedingConsentWorkflow')>()
  return { ...original, manageBreedingConsentWorkflow: mocks.manage }
})
vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>()
  return { ...original, resolvePlayerProfileForPolicy: mocks.resolveProfile }
})
vi.mock('../../server/security/breedingWriteRateLimit', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/security/breedingWriteRateLimit')>()
  return { ...original, enforceBreedingWriteRateLimit: mocks.enforceRate }
})
const route = (await import('../../server/api/breeding/consent.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const body = (profileId: string | null = null) => ({
  schemaVersion: 1,
  profileId,
  trainerSheetSlug: 'trainer-owner',
  intent: 'view',
  projectId: null,
  expectedProjectRevision: null,
  parentSheetSlug: null,
  consentId: null,
  eggId: null,
  expectedEggRevision: null,
  destinationTrainerSlug: null,
  transferConsentId: null,
  confirmed: false,
})
const invoke = async (role: 'gm' | 'player' | null, request: unknown): Promise<unknown> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (role) headers.cookie = `rotom-role=${role}`
  return (route as RouteHandler)({
    method: 'POST', path: '/api/breeding/consent',
    node: { req: { url: '/api/breeding/consent', headers, body: JSON.stringify(request) } },
    context: {},
  } as unknown as H3Event)
}

describe('BR-077 private consent workflow API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.manage.mockReturnValue({ schemaVersion: 1, audience: 'player' })
    mocks.resolveProfile.mockReturnValue({ schemaVersion: 1, id: 'profile_owner_0077' })
  })

  it('requires authentication and forwards one strict GM view selector', async () => {
    await expect(invoke(null, body())).rejects.toMatchObject({ statusCode: 401 })
    await expect(invoke('gm', body())).resolves.toEqual({ schemaVersion: 1, audience: 'player' })
    expect(mocks.resolveProfile).not.toHaveBeenCalled()
    expect(mocks.manage).toHaveBeenCalledWith({ role: 'gm', playerProfile: null, request: body() })
    expect(mocks.enforceRate).not.toHaveBeenCalled()
  })

  it('admits a strict confirmed mutation through the GM write-rate boundary', async () => {
    const request = {
      ...body(),
      intent: 'grant-project-consent',
      projectId: `breeding-project:v1:${'7'.repeat(32)}`,
      expectedProjectRevision: 1,
      parentSheetSlug: 'pokemon-parent',
      confirmed: true,
    }
    await invoke('gm', request)
    expect(mocks.enforceRate).toHaveBeenCalledWith(expect.anything(), { role: 'gm', profileId: null })
    expect(mocks.manage).toHaveBeenCalledWith({ role: 'gm', playerProfile: null, request })
  })

  it('resolves the selected Profile before player authorization', async () => {
    const request = body('profile_owner_0077')
    await invoke('player', request)
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_owner_0077')
    expect(mocks.manage).toHaveBeenCalledWith({
      role: 'player', playerProfile: { schemaVersion: 1, id: 'profile_owner_0077' }, request,
    })
  })

  it('rejects enriched, contradictory, unconfirmed, and malformed mutation requests', async () => {
    for (const invalid of [
      { ...body(), command: { commandKind: 'grant-breeding-consent' } },
      { ...body(), intent: 'grant-project-consent', confirmed: false },
      { ...body(), intent: 'offer-egg-transfer', destinationTrainerSlug: 'trainer-other', confirmed: true },
      { ...body(), intent: 'accept-egg-transfer', transferConsentId: 'source-consent', expectedEggRevision: 0, confirmed: true },
      { ...body(), expectedProjectRevision: -1 },
      undefined,
    ]) await expect(invoke('gm', invalid)).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.manage).not.toHaveBeenCalled()
  })

  it('maps bounded workflow conflicts without exposing authority evidence', async () => {
    mocks.manage.mockImplementation(() => {
      throw new ManageBreedingConsentWorkflowError(409, 'Project consent request is stale')
    })
    await expect(invoke('player', body('profile_owner_0077'))).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Project consent request is stale',
    })
  })
})
