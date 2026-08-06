import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ThrowPokeballLivePlayCommand,
} from '#shared/livePlayCommands'

const mocks = vi.hoisted(() => ({
  executeThrowPokeballCommandUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/applyThrowPokeballCommand', () => ({
  executeThrowPokeballCommandUseCase: mocks.executeThrowPokeballCommandUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const route = (await import('../../server/api/maps/tokens/throw-pokeball.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const command = (): ThrowPokeballLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routecapture',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
  scopes: [
    { kind: 'token', placementId: 'trainer-1', field: 'action' },
    { kind: 'token', placementId: 'target-1', field: 'action' },
    { kind: 'map', lane: 'metadata' },
    { kind: 'map', lane: 'placements' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
    { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'pokemonRoster' },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pidgey', field: 'caughtBall' },
  ],
  payload: {
    trainerPlacementId: 'trainer-1',
    targetPlacementId: 'target-1',
    pokeballName: 'Basic Ball',
  },
})

const invokeRoute = async (
  handler: RouteHandler,
  options: { role?: 'gm' | 'player'; body?: unknown; method?: string } = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {}
  if (options.role) headers.cookie = `rotom-role=${options.role}`
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return handler({
    method: options.method ?? 'POST',
    node: {
      req: {
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
    },
  } as unknown as H3Event)
}

describe('throw-pokeball API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes GM throwPokeball commands through the authoritative command use case without a profile', async () => {
    const body = { ...command(), clientId: 'gm-client' }
    const capture = { trainerId: 'trainer-1', targetId: 'target-1', targetSlug: 'pidgey', pokeballName: 'Basic Ball', result: { id: 'capture-route' } }
    const sheetUpdates = [{ kind: 'trainer', slug: 'ash', sheet: { slug: 'ash', revision: 5 } }]
    mocks.executeThrowPokeballCommandUseCase.mockResolvedValue({
      result: { ok: true, opId: body.opId, mapSlug: body.mapSlug, previousRevision: 4, revision: 5, patches: [] },
      path: 'data/maps/arena.json',
      map: { slug: 'arena', revision: 5 },
      sheetUpdates,
      capture,
    })

    await expect(invokeRoute(route, { role: 'gm', body })).resolves.toEqual({
      ok: true,
      opId: body.opId,
      mapSlug: body.mapSlug,
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena.json',
      map: { slug: 'arena', revision: 5 },
      sheetUpdates,
      capture,
    })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.executeThrowPokeballCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command: body,
      clientId: 'gm-client',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
    }, {
      settleCaptureSpeciesAcquisitions: expect.any(Function),
    })
  })

  it('resolves player profiles for player throwPokeball commands', async () => {
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'trainer', sheetSlug: 'ash' }],
    }
    const body = { ...command(), clientId: 'player-client', profileId: 'profile_ash00000' }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
    mocks.executeThrowPokeballCommandUseCase.mockResolvedValue({
      result: { ok: false, opId: body.opId, mapSlug: body.mapSlug, reason: 'conflict', message: 'No ball' },
    })

    await expect(invokeRoute(route, { role: 'player', body })).resolves.toEqual({
      ok: false,
      opId: body.opId,
      mapSlug: body.mapSlug,
      reason: 'conflict',
      message: 'No ball',
    })

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.executeThrowPokeballCommandUseCase).toHaveBeenCalledWith({
      role: 'player',
      command: body,
      clientId: 'player-client',
      playerProfile: profile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
    }, {
      settleCaptureSpeciesAcquisitions: expect.any(Function),
    })
  })
})
