import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOSTED_WRITES_DISABLED_MESSAGE } from '~~/server/utils/http'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  createMapFolderUseCase: vi.fn(),
  createMapUseCase: vi.fn(),
  deleteMapFolderUseCase: vi.fn(),
  deleteMapUseCase: vi.fn(),
  moveMapFolderUseCase: vi.fn(),
  moveMapUseCase: vi.fn(),
  renameMapUseCase: vi.fn(),
  saveMapUseCase: vi.fn(),
  spawnMapTokenUseCase: vi.fn(),
  executeMapTokenLivePlayCommandUseCase: vi.fn(),
  useMapTokenAbilityUseCase: vi.fn(),
  useMapTokenManeuverUseCase: vi.fn(),
  useMapTokenOrderUseCase: vi.fn(),
  recordMoveUsageUseCase: vi.fn(),
  resolvePlayerProfileForPolicy: vi.fn(),
}))

vi.mock('../../server/useCases/createMapFolder', () => ({
  createMapFolderUseCase: mocks.createMapFolderUseCase,
}))
vi.mock('../../server/useCases/createMap', () => ({
  createMapUseCase: mocks.createMapUseCase,
}))
vi.mock('../../server/useCases/deleteMapFolder', () => ({
  deleteMapFolderUseCase: mocks.deleteMapFolderUseCase,
}))
vi.mock('../../server/useCases/deleteMap', () => ({
  deleteMapUseCase: mocks.deleteMapUseCase,
}))
vi.mock('../../server/useCases/moveMapFolder', () => ({
  moveMapFolderUseCase: mocks.moveMapFolderUseCase,
}))
vi.mock('../../server/useCases/moveMap', () => ({
  moveMapUseCase: mocks.moveMapUseCase,
}))
vi.mock('../../server/useCases/renameMap', () => ({
  renameMapUseCase: mocks.renameMapUseCase,
}))
vi.mock('../../server/useCases/saveMap', () => ({
  saveMapUseCase: mocks.saveMapUseCase,
}))
vi.mock('../../server/useCases/applyMapTokenAction', () => ({
  spawnMapTokenUseCase: mocks.spawnMapTokenUseCase,
  executeMapTokenLivePlayCommandUseCase: mocks.executeMapTokenLivePlayCommandUseCase,
}))
vi.mock('../../server/useCases/applyMapTokenTableAction', () => ({
  useMapTokenAbilityUseCase: mocks.useMapTokenAbilityUseCase,
  useMapTokenManeuverUseCase: mocks.useMapTokenManeuverUseCase,
  useMapTokenOrderUseCase: mocks.useMapTokenOrderUseCase,
}))
vi.mock('../../server/useCases/recordMoveUsage', () => ({
  recordMoveUsageUseCase: mocks.recordMoveUsageUseCase,
}))
vi.mock('../../server/policies/playerProfilePolicy', () => ({
  resolvePlayerProfileForPolicy: mocks.resolvePlayerProfileForPolicy,
}))

const createFolderRoute = (await import('../../server/api/maps/create-folder.post')).default
const createRoute = (await import('../../server/api/maps/create.post')).default
const deleteFolderRoute = (await import('../../server/api/maps/delete-folder.post')).default
const deleteRoute = (await import('../../server/api/maps/delete.post')).default
const moveFolderRoute = (await import('../../server/api/maps/move-folder.post')).default
const moveRoute = (await import('../../server/api/maps/move.post')).default
const renameRoute = (await import('../../server/api/maps/rename.post')).default
const saveRoute = (await import('../../server/api/maps/save.post')).default
const tokenSpawnRoute = (await import('../../server/api/maps/tokens/spawn.post')).default
const tokenMoveRoute = (await import('../../server/api/maps/tokens/move.post')).default
const tokenTurnRoute = (await import('../../server/api/maps/tokens/turn.post')).default
const abilityRoute = (await import('../../server/api/maps/tokens/use-ability.post')).default
const maneuverRoute = (await import('../../server/api/maps/tokens/use-maneuver.post')).default
const orderRoute = (await import('../../server/api/maps/tokens/use-order.post')).default
const useMoveRoute = (await import('../../server/api/maps/use-move.post')).default

type MapRouteHandler = EventHandler<EventHandlerRequest, unknown>

const originalNodeEnv = process.env.NODE_ENV
const originalHostedWrites = process.env.ROTOM_ENABLE_HOSTED_WRITES

const restoreEnvValue = (key: 'NODE_ENV' | 'ROTOM_ENABLE_HOSTED_WRITES', value: string | undefined): void => {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

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
    { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 0, y: 0, z: 0 } },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
})

const invokeRoute = async (
  handler: MapRouteHandler,
  options: { role: 'gm' | 'player'; body: unknown },
): Promise<unknown> => {
  const headers: Record<string, string> = {
    cookie: `rotom-role=${options.role}`,
    'content-type': 'application/json',
  }

  return handler({
    method: 'POST',
    node: {
      req: {
        headers,
        body: JSON.stringify(options.body),
      },
    },
  } as unknown as H3Event)
}

const disableProductionWrites = (): void => {
  process.env.NODE_ENV = 'production'
  delete process.env.ROTOM_ENABLE_HOSTED_WRITES
}

describe('map hosted-write API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    restoreEnvValue('NODE_ENV', originalNodeEnv)
    restoreEnvValue('ROTOM_ENABLE_HOSTED_WRITES', originalHostedWrites)
  })

  it('requires the hosted-write opt-in before GM map library writes in production', async () => {
    disableProductionWrites()

    const routeCases = [
      { route: createFolderRoute, body: { folder: 'dungeon' }, mock: mocks.createMapFolderUseCase },
      { route: createRoute, body: { name: 'Arena' }, mock: mocks.createMapUseCase },
      { route: deleteFolderRoute, body: { folder: 'dungeon' }, mock: mocks.deleteMapFolderUseCase },
      { route: deleteRoute, body: { slug: 'arena' }, mock: mocks.deleteMapUseCase },
      { route: moveFolderRoute, body: { from: 'old', to: 'new' }, mock: mocks.moveMapFolderUseCase },
      { route: moveRoute, body: { slug: 'arena', folder: 'dungeon' }, mock: mocks.moveMapUseCase },
      { route: renameRoute, body: { slug: 'arena', name: 'Arena Revised' }, mock: mocks.renameMapUseCase },
      { route: saveRoute, body: { slug: 'arena', map: mapFixture() }, mock: mocks.saveMapUseCase },
      {
        route: tokenSpawnRoute,
        body: {
          slug: 'arena',
          placement: { id: 'token-2', sheetKind: 'pokemon', sheetSlug: 'eevee', position: { x: 1, y: 0, z: 1 } },
        },
        mock: mocks.spawnMapTokenUseCase,
      },
    ]

    for (const routeCase of routeCases) {
      await expect(invokeRoute(routeCase.route, {
        role: 'gm',
        body: routeCase.body,
      })).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
      })
      expect(routeCase.mock).not.toHaveBeenCalled()
    }
  })

  it('requires the hosted-write opt-in before player map/token writes in production', async () => {
    disableProductionWrites()

    const routeCases = [
      {
        route: saveRoute,
        body: { slug: 'arena', map: mapFixture(), profileId: 'profile_ash00000' },
        mock: mocks.saveMapUseCase,
      },
      {
        route: tokenMoveRoute,
        body: {
          slug: 'arena',
          placementId: 'token-1',
          position: { x: 1, y: 0, z: 1 },
          profileId: 'profile_ash00000',
        },
        mock: mocks.executeMapTokenLivePlayCommandUseCase,
      },
      {
        route: tokenTurnRoute,
        body: {
          slug: 'arena',
          placementId: 'token-1',
          facing: 'north-east',
          profileId: 'profile_ash00000',
        },
        mock: mocks.executeMapTokenLivePlayCommandUseCase,
      },
      {
        route: abilityRoute,
        body: {
          slug: 'arena',
          placementId: 'token-1',
          abilityName: 'Overgrow',
          profileId: 'profile_ash00000',
        },
        mock: mocks.useMapTokenAbilityUseCase,
      },
      {
        route: maneuverRoute,
        body: {
          slug: 'arena',
          placementId: 'token-1',
          maneuverName: 'Trip',
          profileId: 'profile_ash00000',
        },
        mock: mocks.useMapTokenManeuverUseCase,
      },
      {
        route: orderRoute,
        body: {
          slug: 'arena',
          placementId: 'token-1',
          orderName: 'Agility Training',
          profileId: 'profile_ash00000',
        },
        mock: mocks.useMapTokenOrderUseCase,
      },
      {
        route: useMoveRoute,
        body: {
          slug: 'arena',
          placementId: 'token-1',
          moveName: 'Thunderbolt',
          profileId: 'profile_ash00000',
        },
        mock: mocks.recordMoveUsageUseCase,
      },
    ]

    for (const routeCase of routeCases) {
      await expect(invokeRoute(routeCase.route, {
        role: 'player',
        body: routeCase.body,
      })).rejects.toMatchObject({
        statusCode: 403,
        statusMessage: HOSTED_WRITES_DISABLED_MESSAGE,
      })
      expect(routeCase.mock).not.toHaveBeenCalled()
    }
    expect(mocks.resolvePlayerProfileForPolicy).not.toHaveBeenCalled()
  })
})
