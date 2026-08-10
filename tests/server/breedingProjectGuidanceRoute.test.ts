import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadBreedingProjectGuidanceError } from '../../server/useCases/loadBreedingProjectGuidance'

const mocks = vi.hoisted(() => ({
  loadBreedingProjectGuidance: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))
vi.mock('../../server/useCases/loadBreedingProjectGuidance', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/useCases/loadBreedingProjectGuidance')>()
  return { ...original, loadBreedingProjectGuidance: mocks.loadBreedingProjectGuidance }
})
vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>()
  return { ...original, resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy }
})

const route = (await import('../../server/api/breeding/projects/wizard/guidance.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const body = (profileId: string | null = null) => ({
  schemaVersion: 1,
  profileId,
  destinationTrainerSlug: 'trainer-owner',
  breederTrainerSlug: 'trainer-owner',
  parentRefs: [],
})
const invoke = async (options: {
  readonly role?: 'gm' | 'player'
  readonly body?: unknown
} = {}): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  return (route as RouteHandler)({
    method: 'POST',
    path: '/api/breeding/projects/wizard/guidance',
    node: {
      req: {
        url: '/api/breeding/projects/wizard/guidance',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
    context: {},
  } as unknown as H3Event)
}

describe('BR-072 Breeding Project guidance API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadBreedingProjectGuidance.mockReturnValue({ schemaVersion: 1, audience: 'gm' })
  })

  it('requires authentication and forwards closed GM selectors without a Profile', async () => {
    await expect(invoke({ body: body() })).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Login required',
    })
    await expect(invoke({ role: 'gm', body: body() })).resolves.toEqual({
      schemaVersion: 1,
      audience: 'gm',
    })
    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.loadBreedingProjectGuidance).toHaveBeenCalledWith({
      role: 'gm',
      playerProfile: null,
      request: body(),
    })
  })

  it('resolves the exact selected Profile for owner projections', async () => {
    const playerProfile = {
      schemaVersion: 1,
      id: 'profile_owner000',
      displayName: 'Owner',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
    }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(playerProfile)
    await invoke({ role: 'player', body: body('profile_owner000') })
    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_owner000')
    expect(mocks.loadBreedingProjectGuidance).toHaveBeenCalledWith({
      role: 'player',
      playerProfile,
      request: body('profile_owner000'),
    })
  })

  it('rejects malformed, enriched, missing, and sparse JSON before orchestration', async () => {
    await expect(invoke({ role: 'gm', body: { ...body(), providerId: 'private' } }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ role: 'gm', body: { ...body(), parentRefs: Array(1) } }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ role: 'gm' })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.loadBreedingProjectGuidance).not.toHaveBeenCalled()
  })

  it('maps bounded guidance failures without leaking exception details', async () => {
    mocks.loadBreedingProjectGuidance.mockImplementation(() => {
      throw new LoadBreedingProjectGuidanceError(409, 'Current guidance authority changed')
    })
    await expect(invoke({ role: 'gm', body: body() })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Current guidance authority changed',
    })
  })
})
