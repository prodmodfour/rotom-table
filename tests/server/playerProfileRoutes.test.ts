import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UseCaseHttpError } from '~~/server/utils/useCaseErrors'

const mocks = vi.hoisted(() => ({
  listPlayerProfilesUseCase: vi.fn(),
  createPlayerProfileUseCase: vi.fn(),
  updatePlayerProfileUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/listPlayerProfiles', () => ({
  listPlayerProfilesUseCase: mocks.listPlayerProfilesUseCase,
}))
vi.mock('../../server/useCases/createPlayerProfile', () => ({
  createPlayerProfileUseCase: mocks.createPlayerProfileUseCase,
}))
vi.mock('../../server/useCases/updatePlayerProfile', () => ({
  updatePlayerProfileUseCase: mocks.updatePlayerProfileUseCase,
}))

const listRoute = (await import('../../server/api/player-profiles/list.get')).default
const createRoute = (await import('../../server/api/player-profiles/create.post')).default
const updateRoute = (await import('../../server/api/player-profiles/update.post')).default

type ProfileRouteHandler = EventHandler<EventHandlerRequest, unknown>

const invokeRoute = async (
  handler: ProfileRouteHandler,
  options: { role?: 'gm' | 'player'; body?: unknown; method?: string } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return handler({
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    node: {
      req: {
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
  } as unknown as H3Event)
}

describe('player profile API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists profiles for authenticated profile picker requests', async () => {
    mocks.listPlayerProfilesUseCase.mockReturnValue({ profiles: [] })

    await expect(invokeRoute(listRoute, { role: 'player' })).resolves.toEqual({ profiles: [] })
    expect(mocks.listPlayerProfilesUseCase).toHaveBeenCalledWith({ role: 'player' })

    await expect(invokeRoute(listRoute)).rejects.toMatchObject({
      statusCode: 401,
      statusMessage: 'Login required',
    })
  })

  it('creates profiles for authenticated players from request bodies', async () => {
    const response = { profile: { id: 'profile_may00000', displayName: 'May' } }
    mocks.createPlayerProfileUseCase.mockReturnValue(response)

    await expect(invokeRoute(createRoute, {
      role: 'player',
      body: { displayName: 'May' },
    })).resolves.toBe(response)
    expect(mocks.createPlayerProfileUseCase).toHaveBeenCalledWith({
      displayName: 'May',
      role: 'player',
    })
  })

  it('maps profile use-case errors to API errors', async () => {
    mocks.createPlayerProfileUseCase.mockImplementation(() => {
      throw new UseCaseHttpError(400, 'displayName is required')
    })

    await expect(invokeRoute(createRoute, {
      role: 'player',
      body: { displayName: '   ' },
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'displayName is required',
    })
  })

  it('updates profiles only through GM-authorized requests', async () => {
    const response = { profile: { id: 'profile_may00000', displayName: 'May' } }
    mocks.updatePlayerProfileUseCase.mockReturnValue(response)

    await expect(invokeRoute(updateRoute, {
      role: 'gm',
      body: {
        profileId: 'profile_may00000',
        linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'blaziken' }],
      },
    })).resolves.toBe(response)
    expect(mocks.updatePlayerProfileUseCase).toHaveBeenCalledWith({
      profileId: 'profile_may00000',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'blaziken' }],
      role: 'gm',
    })

    mocks.updatePlayerProfileUseCase.mockClear()
    await expect(invokeRoute(updateRoute, {
      role: 'player',
      body: { profileId: 'profile_may00000', displayName: 'May' },
    })).rejects.toMatchObject({
      statusCode: 403,
      statusMessage: 'GM login required',
    })
    expect(mocks.updatePlayerProfileUseCase).not.toHaveBeenCalled()
  })
})
