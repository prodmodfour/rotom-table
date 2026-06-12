import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type DeleteTokenLivePlayCommand,
  type MoveTokenLivePlayCommand,
  type SpawnTokenLivePlayCommand,
  type TurnTokenLivePlayCommand,
} from '#shared/livePlayCommands'
import { UseCaseHttpError } from '~~/server/utils/useCaseErrors'
import { subscribeRealtime } from '~~/server/utils/realtime'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  executeMapTokenLivePlayCommandUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/applyMapTokenAction', () => ({
  executeMapTokenLivePlayCommandUseCase: mocks.executeMapTokenLivePlayCommandUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const spawnRoute = (await import('../../server/api/maps/tokens/spawn.post')).default
const deleteRoute = (await import('../../server/api/maps/tokens/delete.post')).default
const moveRoute = (await import('../../server/api/maps/tokens/move.post')).default
const turnRoute = (await import('../../server/api/maps/tokens/turn.post')).default

type MapTokenActionRouteHandler = EventHandler<EventHandlerRequest, unknown>

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 4, y: 2, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 0, y: 0, z: 0 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const moveCommand = (): MoveTokenLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routemove001',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'token-1', field: 'position' }],
  payload: { placementId: 'token-1', position: { x: 2, y: 0, z: 1 }, pathLength: 3 },
})

const turnCommand = (): TurnTokenLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routeturn001',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
  scopes: [{ kind: 'token', placementId: 'token-1', field: 'facing' }],
  payload: { placementId: 'token-1', facing: 'north-east' },
})

const spawnCommand = (): SpawnTokenLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routespawn01',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
  scopes: [{ kind: 'token', placementId: 'token-eevee', field: 'spawn' }],
  payload: {
    placement: {
      id: 'token-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 2, y: 0, z: 2 },
      facing: 'south-east',
      turned: false,
    },
  },
})

const deleteCommand = (): DeleteTokenLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routedelete',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
  scopes: [{ kind: 'token', placementId: 'token-1', field: 'delete' }],
  payload: { placementId: 'token-1' },
})

const invokeRoute = async (
  handler: MapTokenActionRouteHandler,
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

describe('map token action API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes GM token spawns through the live-play command executor', async () => {
    const map = mapFixture()
    const command = { ...spawnCommand(), clientId: 'gm-client' }
    const placement = command.payload.placement
    mocks.executeMapTokenLivePlayCommandUseCase.mockResolvedValue({
      result: { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [] },
      path: 'data/maps/arena.json',
      map,
      placement,
    })

    await expect(invokeRoute(spawnRoute, {
      role: 'gm',
      body: command,
    })).resolves.toEqual({
      ok: true,
      opId: command.opId,
      mapSlug: command.mapSlug,
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena.json',
      map,
      placement,
    })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.executeMapTokenLivePlayCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command,
      clientId: 'gm-client',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
    })
  })

  it('resolves selected player profiles before live-play token move commands', async () => {
    const map = mapFixture()
    const placement = map.placements[0]!
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    }
    const command = { ...moveCommand(), clientId: 'client-1', profileId: 'profile_ash00000' }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
    mocks.executeMapTokenLivePlayCommandUseCase.mockResolvedValue({
      result: { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [] },
      path: 'data/maps/arena.json',
      map,
      placement,
    })

    await expect(invokeRoute(moveRoute, {
      role: 'player',
      body: command,
    })).resolves.toEqual({
      ok: true,
      opId: command.opId,
      mapSlug: command.mapSlug,
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena.json',
      map,
      placement,
    })

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.executeMapTokenLivePlayCommandUseCase).toHaveBeenCalledWith({
      role: 'player',
      command,
      clientId: 'client-1',
      playerProfile: profile,
      expectedType: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
    })
  })

  it('returns live-play command rejections without publishing legacy route events', async () => {
    const command = { ...moveCommand(), opId: 'op_routereject1', profileId: 'profile_ash00000' }
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }],
    }
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
    mocks.executeMapTokenLivePlayCommandUseCase.mockResolvedValue({
      result: {
        ok: false,
        opId: command.opId,
        mapSlug: command.mapSlug,
        reason: 'stale-revision',
        message: 'Command baseRevision 3 does not match current map revision 4',
        currentRevision: 4,
      },
    })

    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((event) => received.push(event))
    try {
      await expect(invokeRoute(moveRoute, { role: 'player', body: command })).resolves.toEqual({
        ok: false,
        opId: command.opId,
        mapSlug: command.mapSlug,
        reason: 'stale-revision',
        message: 'Command baseRevision 3 does not match current map revision 4',
        currentRevision: 4,
      })
    } finally {
      unsubscribe()
    }

    expect(received).toEqual([])
  })

  it('keeps GM live-play token turns independent from player profile selection', async () => {
    const map = mapFixture()
    const placement = { ...map.placements[0]!, facing: 'north-east' as const, turned: false }
    const command = { ...turnCommand(), clientId: 'gm-client', profileId: 'profile_ash00000' }
    mocks.executeMapTokenLivePlayCommandUseCase.mockResolvedValue({
      result: { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [] },
      path: 'data/maps/arena.json',
      map,
      placement,
    })

    await expect(invokeRoute(turnRoute, {
      role: 'gm',
      body: command,
    })).resolves.toMatchObject({ ok: true, revision: 5, map, placement })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.executeMapTokenLivePlayCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command,
      clientId: 'gm-client',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
    })
  })

  it('routes GM token deletes through the live-play command executor', async () => {
    const map = { ...mapFixture(), placements: [] }
    const placement = mapFixture().placements[0]!
    const command = { ...deleteCommand(), clientId: 'gm-client' }
    mocks.executeMapTokenLivePlayCommandUseCase.mockResolvedValue({
      result: { ok: true, opId: command.opId, mapSlug: command.mapSlug, previousRevision: 4, revision: 5, patches: [] },
      path: 'data/maps/arena.json',
      map,
      placement,
    })

    await expect(invokeRoute(deleteRoute, {
      role: 'gm',
      body: command,
    })).resolves.toMatchObject({ ok: true, revision: 5, map, placement })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.executeMapTokenLivePlayCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command,
      clientId: 'gm-client',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
    })
  })

  it('maps missing selected profile errors before token commands run', async () => {
    mocks.resolvePlayerProfileForPolicy.mockImplementation(() => {
      throw new UseCaseHttpError(404, 'Player profile profile_missing1 not found')
    })

    await expect(invokeRoute(turnRoute, {
      role: 'player',
      body: {
        ...turnCommand(),
        profileId: 'profile_missing1',
      },
    })).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Player profile profile_missing1 not found',
    })
    expect(mocks.executeMapTokenLivePlayCommandUseCase).not.toHaveBeenCalled()
  })
})
