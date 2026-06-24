import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION } from '#shared/livePlayMoveResolution'

const mocks = vi.hoisted(() => ({
  executeLivePlayResolveMoveCommandUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/applyResolveMoveCommand', () => ({
  executeLivePlayResolveMoveCommandUseCase: mocks.executeLivePlayResolveMoveCommandUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const route = (await import('../../server/api/maps/tokens/resolve-move.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const command = (): ResolveMoveLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routeresolve1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  scopes: [
    { kind: 'token', placementId: 'actor-token', field: 'action' },
    { kind: 'map', lane: 'metadata' },
    { kind: 'token', placementId: 'actor-token', field: 'moveUsage' },
  ],
  payload: {
    schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
    placementId: 'actor-token',
    moveName: 'Tackle',
    selection: { kind: 'self' },
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

describe('resolve-move API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('flattens accepted resolveMove responses for GMs without resolving a profile', async () => {
    const body = { ...command(), clientId: 'gm-client' }
    const move = { schemaVersion: 1, actorPlacementId: 'actor-token' }
    const sheetUpdates = [{ kind: 'pokemon', slug: 'pikachu', sheet: { slug: 'pikachu', revision: 3 } }]
    mocks.executeLivePlayResolveMoveCommandUseCase.mockResolvedValue({
      result: {
        ok: true,
        opId: body.opId,
        mapSlug: body.mapSlug,
        previousRevision: 4,
        revision: 5,
        patches: [{ schemaVersion: 1, type: LIVE_PLAY_PATCH_TYPES.MOVE_STATE, mapSlug: body.mapSlug, revision: 5, scopes: [], payload: { command: 'resolveMove', move } }],
      },
      path: 'data/maps/arena.json',
      map: { slug: 'arena', revision: 5 },
      sheetUpdates,
      move,
    })

    await expect(invokeRoute(route, { role: 'gm', body })).resolves.toEqual({
      ok: true,
      opId: body.opId,
      mapSlug: body.mapSlug,
      previousRevision: 4,
      revision: 5,
      patches: [{ schemaVersion: 1, type: LIVE_PLAY_PATCH_TYPES.MOVE_STATE, mapSlug: body.mapSlug, revision: 5, scopes: [], payload: { command: 'resolveMove', move } }],
      path: 'data/maps/arena.json',
      map: { slug: 'arena', revision: 5 },
      sheetUpdates,
      move,
    })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.executeLivePlayResolveMoveCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command: body,
      clientId: 'gm-client',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    })
  })

  it('resolves selected player profiles before executing player resolveMove commands', async () => {
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    }
    const body = { ...command(), clientId: 'player-client', profileId: 'profile_ash00000' }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
    mocks.executeLivePlayResolveMoveCommandUseCase.mockResolvedValue({
      result: { ok: false, opId: body.opId, mapSlug: body.mapSlug, reason: 'stale-revision', message: 'Refresh', currentRevision: 5 },
    })

    await expect(invokeRoute(route, { role: 'player', body })).resolves.toEqual({
      ok: false,
      opId: body.opId,
      mapSlug: body.mapSlug,
      reason: 'stale-revision',
      message: 'Refresh',
      currentRevision: 5,
    })

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.executeLivePlayResolveMoveCommandUseCase).toHaveBeenCalledWith({
      role: 'player',
      command: body,
      clientId: 'player-client',
      playerProfile: profile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    })
  })
})
