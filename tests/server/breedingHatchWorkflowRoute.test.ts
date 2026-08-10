import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManageBreedingHatchWorkflowError } from '../../server/useCases/manageBreedingHatchWorkflow'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), resolveProfile: vi.fn() }))
vi.mock('../../server/useCases/manageBreedingHatchWorkflow', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/useCases/manageBreedingHatchWorkflow')>()
  return { ...original, manageBreedingHatchWorkflow: mocks.manage }
})
vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>()
  return { ...original, resolvePlayerProfileForPolicy: mocks.resolveProfile }
})
const route = (await import('../../server/api/breeding/hatch.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const body = (profileId: string | null = null) => ({
  schemaVersion: 1, profileId, trainerSheetSlug: 'trainer-owner',
  eggId: 'pokemon-egg:v1:75757575757575757575757575757575', expectedEggRevision: 1,
  intent: 'inspect', selectedOptionId: null, confirmed: false,
})
const invoke = async (role: 'gm' | 'player' | null, request: unknown): Promise<unknown> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (role) headers.cookie = `rotom-role=${role}`
  return (route as RouteHandler)({
    method: 'POST', path: '/api/breeding/hatch',
    node: { req: { url: '/api/breeding/hatch', headers, body: JSON.stringify(request) } },
    context: {},
  } as unknown as H3Event)
}

describe('BR-075 hatch workflow API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.manage.mockReturnValue({ schemaVersion: 1, stage: 'ready' })
    mocks.resolveProfile.mockReturnValue({ schemaVersion: 1, id: 'profile_owner_0075' })
  })

  it('requires authentication and forwards a strict GM selector request', async () => {
    await expect(invoke(null, body())).rejects.toMatchObject({ statusCode: 401 })
    await expect(invoke('gm', body())).resolves.toEqual({ schemaVersion: 1, stage: 'ready' })
    expect(mocks.resolveProfile).not.toHaveBeenCalled()
    expect(mocks.manage).toHaveBeenCalledWith({ role: 'gm', playerProfile: null, request: body() })
  })

  it('resolves the selected player Profile before use-case authorization', async () => {
    const request = body('profile_owner_0075')
    await invoke('player', request)
    expect(mocks.resolveProfile).toHaveBeenCalledWith('profile_owner_0075')
    expect(mocks.manage).toHaveBeenCalledWith({
      role: 'player', playerProfile: { schemaVersion: 1, id: 'profile_owner_0075' }, request,
    })
  })

  it('rejects command payloads, unconfirmed mutation, malformed options, and unknown fields at the boundary', async () => {
    for (const invalid of [
      { ...body(), command: { commandKind: 'begin-hatch' } },
      { ...body(), intent: 'begin', confirmed: false },
      { ...body(), selectedOptionId: 'bulbasaur' },
      { ...body(), expectedEggRevision: -1 },
      undefined,
    ]) {
      await expect(invoke('gm', invalid)).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(mocks.manage).not.toHaveBeenCalled()
  })

  it('maps bounded workflow conflicts without exposing internal evidence', async () => {
    mocks.manage.mockImplementation(() => { throw new ManageBreedingHatchWorkflowError(409, 'Egg changed before the confirmed hatch action') })
    await expect(invoke('gm', body())).rejects.toMatchObject({
      statusCode: 409, statusMessage: 'Egg changed before the confirmed hatch action',
    })
  })
})
