import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'

const mocks = vi.hoisted(() => ({
  listPendingMoveResponsesUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/listPendingMoveResponses', () => ({
  listPendingMoveResponsesUseCase: mocks.listPendingMoveResponsesUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../server/policies/playerProfilePolicy')>(),
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const route = (await import('../../server/api/maps/move-responses/pending.get')).default
type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const selectedProfile: PlayerProfile = {
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_responder1' as PlayerProfileId,
  displayName: 'Responder' as PlayerProfileDisplayName,
  linkedCharacters: [],
}

const invokeRoute = async (
  handler: RouteHandler,
  options: { readonly role?: 'gm' | 'player'; readonly query?: Record<string, string> } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  const query = new URLSearchParams(options.query ?? {}).toString()
  const path = `/api/maps/move-responses/pending${query ? `?${query}` : ''}`
  return handler({
    method: 'GET',
    path,
    node: { req: { url: path, headers } },
    context: {},
  } as unknown as H3Event)
}

describe('pending move response query route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(selectedProfile)
    mocks.listPendingMoveResponsesUseCase.mockReturnValue({
      schemaVersion: 1,
      mapSlug: 'pending-arena',
      windows: [],
    })
  })

  it('queries option detail in the selected player-profile context', async () => {
    await expect(invokeRoute(route, {
      role: 'player',
      query: { slug: 'pending-arena', profileId: selectedProfile.id },
    })).resolves.toEqual({ schemaVersion: 1, mapSlug: 'pending-arena', windows: [] })

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith(selectedProfile.id)
    expect(mocks.listPendingMoveResponsesUseCase).toHaveBeenCalledWith({
      role: 'player',
      mapSlug: 'pending-arena',
      playerProfile: selectedProfile,
    })
  })

  it('requires authentication and keeps GM queries profile-free', async () => {
    await expect(invokeRoute(route, {
      query: { slug: 'pending-arena' },
    })).rejects.toMatchObject({ statusCode: 401 })

    await expect(invokeRoute(route, {
      role: 'gm',
      query: { slug: 'pending-arena' },
    })).resolves.toMatchObject({ mapSlug: 'pending-arena' })
    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.listPendingMoveResponsesUseCase).toHaveBeenLastCalledWith({
      role: 'gm',
      mapSlug: 'pending-arena',
      playerProfile: null,
    })
  })
})
