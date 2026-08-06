import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadBreedingProjectWizardError } from '../../server/useCases/loadBreedingProjectWizard'

const mocks = vi.hoisted(() => ({
  loadBreedingProjectWizard: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))
vi.mock('../../server/useCases/loadBreedingProjectWizard', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/useCases/loadBreedingProjectWizard')>()
  return { ...original, loadBreedingProjectWizard: mocks.loadBreedingProjectWizard }
})
vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>()
  return { ...original, resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy }
})

const route = (await import('../../server/api/breeding/projects/wizard.post')).default
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
    path: '/api/breeding/projects/wizard',
    node: {
      req: {
        url: '/api/breeding/projects/wizard',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
    context: {},
  } as unknown as H3Event)
}

describe('Breeding Project wizard API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadBreedingProjectWizard.mockReturnValue({ schemaVersion: 1, audience: 'gm' })
  })

  it('requires authentication and forwards a closed GM request without a Profile', async () => {
    await expect(invoke({ body: body() })).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Login required',
    })
    await expect(invoke({ role: 'gm', body: body() })).resolves.toEqual({
      schemaVersion: 1,
      audience: 'gm',
    })
    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.loadBreedingProjectWizard).toHaveBeenCalledWith({
      role: 'gm',
      playerProfile: null,
      request: body(),
    })
  })

  it('resolves the exact selected Profile for player requests', async () => {
    const profile = {
      schemaVersion: 1,
      id: 'profile_owner000',
      displayName: 'Owner',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
    }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
    mocks.loadBreedingProjectWizard.mockReturnValue({ schemaVersion: 1, audience: 'owner' })
    await expect(invoke({ role: 'player', body: body('profile_owner000') })).resolves.toEqual({
      schemaVersion: 1,
      audience: 'owner',
    })
    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_owner000')
    expect(mocks.loadBreedingProjectWizard).toHaveBeenCalledWith({
      role: 'player',
      playerProfile: profile,
      request: body('profile_owner000'),
    })
  })

  it('rejects malformed, enriched, and accessor-equivalent JSON before orchestration', async () => {
    await expect(invoke({ role: 'gm', body: { ...body(), aggregateId: 'private' } }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ role: 'gm', body: { ...body(), parentRefs: Array(1) } }))
      .rejects.toMatchObject({ statusCode: 400 })
    await expect(invoke({ role: 'gm' })).rejects.toMatchObject({ statusCode: 400 })
    expect(mocks.loadBreedingProjectWizard).not.toHaveBeenCalled()
  })

  it('maps bounded wizard use-case failures to HTTP responses', async () => {
    mocks.loadBreedingProjectWizard.mockImplementation(() => {
      throw new LoadBreedingProjectWizardError(409, 'Breeding parent selection is stale or unavailable')
    })
    await expect(invoke({ role: 'gm', body: body() })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Breeding parent selection is stale or unavailable',
    })
  })
})
