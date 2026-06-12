import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UseCaseHttpError } from '~~/server/utils/useCaseErrors'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  executeLivePlayTableActionCommandUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/applyMapTokenTableAction', () => ({
  executeLivePlayTableActionCommandUseCase: mocks.executeLivePlayTableActionCommandUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const abilityRoute = (await import('../../server/api/maps/tokens/use-ability.post')).default
const maneuverRoute = (await import('../../server/api/maps/tokens/use-maneuver.post')).default
const orderRoute = (await import('../../server/api/maps/tokens/use-order.post')).default

type RouteHandler = EventHandler<EventHandlerRequest, unknown>

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 4, y: 2, z: 4 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'sandile', position: { x: 0, y: 0, z: 0 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
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

const abilityCommand = () => ({
  schemaVersion: 1,
  opId: 'op_routeabil',
  mapSlug: 'arena',
  baseRevision: 0,
  type: 'useAbility',
  scopes: [
    { kind: 'token', placementId: 'actor', field: 'action' },
    { kind: 'map', lane: 'metadata' },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'sandile', field: 'ability' },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'target', field: 'ability' },
  ],
  payload: { placementId: 'actor', abilityName: 'Intimidate', targetPlacementId: 'target' },
  clientId: 'client-1',
  profileId: 'profile_ash00000',
})

const orderCommand = () => ({
  schemaVersion: 1,
  opId: 'op_routeordr',
  mapSlug: 'arena',
  baseRevision: 0,
  type: 'useOrder',
  scopes: [
    { kind: 'token', placementId: 'trainer', field: 'action' },
    { kind: 'map', lane: 'metadata' },
  ],
  payload: { placementId: 'trainer', orderName: 'Agility Training' },
  profileId: 'profile_ash00000',
})

describe('map token table action API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves selected player profiles before canonical ability commands', async () => {
    const map = mapFixture()
    const profile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'sandile' }],
    }
    const command = abilityCommand()
    mocks.resolvePlayerProfileForPolicy.mockReturnValue(profile)
    mocks.executeLivePlayTableActionCommandUseCase.mockResolvedValue({
      result: {
        ok: true,
        opId: 'op_routeabil',
        mapSlug: 'arena',
        previousRevision: 0,
        revision: 1,
        patches: [],
      },
      path: 'data/maps/arena.json',
      map,
      action: { type: 'ability', placementId: 'actor', targetPlacementId: 'target', name: 'Intimidate' },
      sheetUpdates: [],
    })

    await expect(invokeRoute(abilityRoute, {
      role: 'player',
      body: command,
    })).resolves.toEqual({
      ok: true,
      opId: 'op_routeabil',
      mapSlug: 'arena',
      previousRevision: 0,
      revision: 1,
      patches: [],
      path: 'data/maps/arena.json',
      map,
      action: { type: 'ability', placementId: 'actor', targetPlacementId: 'target', name: 'Intimidate' },
      sheetUpdates: [],
    })

    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.executeLivePlayTableActionCommandUseCase).toHaveBeenCalledWith({
      role: 'player',
      command,
      clientId: 'client-1',
      playerProfile: profile,
      expectedType: 'useAbility',
    })
  })

  it('keeps GM table action routes independent from player profile selection', async () => {
    const map = mapFixture()
    const command = orderCommand()
    mocks.executeLivePlayTableActionCommandUseCase.mockResolvedValue({
      result: {
        ok: true,
        opId: 'op_routeordr',
        mapSlug: 'arena',
        previousRevision: 0,
        revision: 1,
        patches: [],
      },
      path: 'data/maps/arena.json',
      map,
      action: { type: 'order', placementId: 'trainer', name: 'Agility Training' },
      sheetUpdates: [],
    })

    await expect(invokeRoute(orderRoute, {
      role: 'gm',
      body: command,
    })).resolves.toMatchObject({ ok: true, action: { type: 'order' } })

    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
    expect(mocks.executeLivePlayTableActionCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command,
      clientId: undefined,
      playerProfile: null,
      expectedType: 'useOrder',
    })
  })

  it('maps missing selected profile errors before table actions run', async () => {
    mocks.resolvePlayerProfileForPolicy.mockImplementation(() => {
      throw new UseCaseHttpError(404, 'Player profile profile_missing1 not found')
    })

    await expect(invokeRoute(maneuverRoute, {
      role: 'player',
      body: {
        schemaVersion: 1,
        opId: 'op_routemane',
        mapSlug: 'arena',
        baseRevision: 0,
        type: 'useManeuver',
        scopes: [
          { kind: 'token', placementId: 'actor', field: 'action' },
          { kind: 'map', lane: 'metadata' },
        ],
        payload: { placementId: 'actor', maneuverName: 'Trip' },
        profileId: 'profile_missing1',
      },
    })).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Player profile profile_missing1 not found',
    })
    expect(mocks.executeLivePlayTableActionCommandUseCase).not.toHaveBeenCalled()
  })
})
