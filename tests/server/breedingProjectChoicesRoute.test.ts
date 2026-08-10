import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoadBreedingProjectChoicesError } from '../../server/useCases/loadBreedingProjectChoices'

const mocks = vi.hoisted(() => ({
  loadBreedingProjectChoices: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))
vi.mock('../../server/useCases/loadBreedingProjectChoices', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/useCases/loadBreedingProjectChoices')>()
  return { ...original, loadBreedingProjectChoices: mocks.loadBreedingProjectChoices }
})
vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>()
  return { ...original, resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy }
})

const route = (await import('../../server/api/breeding/projects/wizard/choices.post')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>
const body = (profileId: string | null = null) => ({
  schemaVersion: 1,
  draftId: 'breeding-project-draft:v1:11111111111111111111111111111111',
  profileId,
  destinationTrainerSlug: 'trainer-owner',
  breederTrainerSlug: 'trainer-owner',
  parentRefs: [],
  selectedOptionIds: [],
  confirmed: false,
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
    path: '/api/breeding/projects/wizard/choices',
    node: {
      req: {
        url: '/api/breeding/projects/wizard/choices',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
    context: {},
  } as unknown as H3Event)
}

describe('BR-073 Breeding Project choices API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadBreedingProjectChoices.mockReturnValue({ schemaVersion: 1, confirmation: { status: 'ready' } })
  })

  it('requires authentication and forwards only the strict GM request', async () => {
    await expect(invoke({ body: body() })).rejects.toMatchObject({ statusCode: 401 })
    await expect(invoke({ role: 'gm', body: body() })).resolves.toEqual({
      schemaVersion: 1,
      confirmation: { status: 'ready' },
    })
    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.loadBreedingProjectChoices).toHaveBeenCalledWith({
      role: 'gm', playerProfile: null, request: body(),
    })
  })

  it('resolves the exact selected Profile for a player confirmation', async () => {
    const playerProfile = {
      schemaVersion: 1,
      id: 'profile_owner000',
      displayName: 'Owner',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'trainer-owner' }],
    }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(playerProfile)
    const request = { ...body('profile_owner000'), confirmed: true }
    await invoke({ role: 'player', body: request })
    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_owner000')
    expect(mocks.loadBreedingProjectChoices).toHaveBeenCalledWith({
      role: 'player', playerProfile, request,
    })
  })

  it('rejects mechanics claims, unknown fields, duplicates, sparse values, and malformed confirmation', async () => {
    for (const invalid of [
      { ...body(), natureId: 'adamant' },
      { ...body(), selectedOptionIds: [
        'option:v1:11111111111111111111111111111111',
        'option:v1:11111111111111111111111111111111',
      ] },
      { ...body(), parentRefs: Array(1) },
      { ...body(), confirmed: 'yes' },
      undefined,
    ]) {
      await expect(invoke({ role: 'gm', body: invalid })).rejects.toMatchObject({ statusCode: 400 })
    }
    expect(mocks.loadBreedingProjectChoices).not.toHaveBeenCalled()
  })

  it('maps bounded orchestration conflicts without exposing internals', async () => {
    mocks.loadBreedingProjectChoices.mockImplementation(() => {
      throw new LoadBreedingProjectChoicesError(409, 'Current Project choice authority changed')
    })
    await expect(invoke({ role: 'gm', body: body() })).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Current Project choice authority changed',
    })
  })
})
