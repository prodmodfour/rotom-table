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
  setMapInteractionModeUseCase: vi.fn(),
  executeMapTokenLivePlayCommandUseCase: vi.fn(),
  executeLivePlaySheetCommandUseCase: vi.fn(),
  executeLivePlayTableActionCommandUseCase: vi.fn(),
  executeLivePlayUseMoveCommandUseCase: vi.fn(),
  executeLivePlayInitiativeCommandUseCase: vi.fn(),
  executeLivePlayMapEffectsCommandUseCase: vi.fn(),
  executeLivePlayTerrainCommandUseCase: vi.fn(),
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
vi.mock('../../server/useCases/setMapInteractionMode', () => ({
  setMapInteractionModeUseCase: mocks.setMapInteractionModeUseCase,
  LIVE_PLAY_MODE_REQUIRED_FOR_COMMAND_MESSAGE: 'Map is in Prepare Map mode. Switch to Run Live Play before live-play commands.',
  SETUP_MODE_REQUIRED_FOR_MAP_SAVE_MESSAGE: 'Map is in Run Live Play mode. Switch to Prepare Map before whole-map setup saves.',
}))
vi.mock('../../server/useCases/applyMapTokenAction', () => ({
  executeMapTokenLivePlayCommandUseCase: mocks.executeMapTokenLivePlayCommandUseCase,
}))
vi.mock('../../server/useCases/applyLivePlaySheetCommand', () => ({
  executeLivePlaySheetCommandUseCase: mocks.executeLivePlaySheetCommandUseCase,
}))
vi.mock('../../server/useCases/applyMapTokenTableAction', () => ({
  executeLivePlayTableActionCommandUseCase: mocks.executeLivePlayTableActionCommandUseCase,
}))
vi.mock('../../server/useCases/applyLivePlayUseMoveCommand', () => ({
  executeLivePlayUseMoveCommandUseCase: mocks.executeLivePlayUseMoveCommandUseCase,
}))
vi.mock('../../server/useCases/applyLivePlayInitiativeCommand', () => ({
  executeLivePlayInitiativeCommandUseCase: mocks.executeLivePlayInitiativeCommandUseCase,
}))
vi.mock('../../server/useCases/applyLivePlayMapEffectsCommand', () => ({
  executeLivePlayMapEffectsCommandUseCase: mocks.executeLivePlayMapEffectsCommandUseCase,
}))
vi.mock('../../server/useCases/applyLivePlayTerrainCommand', () => ({
  executeLivePlayTerrainCommandUseCase: mocks.executeLivePlayTerrainCommandUseCase,
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
const interactionModeRoute = (await import('../../server/api/maps/interaction-mode.post')).default
const tokenSpawnRoute = (await import('../../server/api/maps/tokens/spawn.post')).default
const tokenDeleteRoute = (await import('../../server/api/maps/tokens/delete.post')).default
const tokenMoveRoute = (await import('../../server/api/maps/tokens/move.post')).default
const tokenTurnRoute = (await import('../../server/api/maps/tokens/turn.post')).default
const modifyHpRoute = (await import('../../server/api/maps/tokens/modify-hp.post')).default
const modifyCombatStagesRoute = (await import('../../server/api/maps/tokens/modify-combat-stages.post')).default
const modifyConditionsRoute = (await import('../../server/api/maps/tokens/modify-conditions.post')).default
const abilityRoute = (await import('../../server/api/maps/tokens/use-ability.post')).default
const maneuverRoute = (await import('../../server/api/maps/tokens/use-maneuver.post')).default
const orderRoute = (await import('../../server/api/maps/tokens/use-order.post')).default
const useMoveRoute = (await import('../../server/api/maps/use-move.post')).default
const setInitiativeRoute = (await import('../../server/api/maps/initiative/set.post')).default
const nextInitiativeRoute = (await import('../../server/api/maps/initiative/next.post')).default
const previousInitiativeRoute = (await import('../../server/api/maps/initiative/previous.post')).default
const placeHazardRoute = (await import('../../server/api/maps/hazards/place.post')).default
const removeHazardRoute = (await import('../../server/api/maps/hazards/remove.post')).default
const buildTerrainRoute = (await import('../../server/api/maps/terrain/build.post')).default
const removeTerrainRoute = (await import('../../server/api/maps/terrain/remove.post')).default
const setFieldEffectRoute = (await import('../../server/api/maps/field-effects/set.post')).default
const removeFieldEffectRoute = (await import('../../server/api/maps/field-effects/remove.post')).default
const tickFieldEffectDurationsRoute = (await import('../../server/api/maps/field-effects/tick.post')).default

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

const enableProductionWrites = (): void => {
  process.env.NODE_ENV = 'production'
  process.env.ROTOM_ENABLE_HOSTED_WRITES = '1'
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
      { route: interactionModeRoute, body: { slug: 'arena', interactionMode: 'setup-edit' }, mock: mocks.setMapInteractionModeUseCase },
      {
        route: tokenSpawnRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedspawn',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'spawnToken',
          scopes: [{ kind: 'token', placementId: 'token-2', field: 'spawn' }],
          payload: {
            placement: { id: 'token-2', sheetKind: 'pokemon', sheetSlug: 'eevee', position: { x: 1, y: 0, z: 1 } },
          },
        },
        mock: mocks.executeMapTokenLivePlayCommandUseCase,
      },
      {
        route: tokenDeleteRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hosteddel1',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'deleteToken',
          scopes: [{ kind: 'token', placementId: 'token-1', field: 'delete' }],
          payload: { placementId: 'token-1' },
        },
        mock: mocks.executeMapTokenLivePlayCommandUseCase,
      },
      {
        route: setInitiativeRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedinit1',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'setInitiative',
          scopes: [{ kind: 'map', lane: 'initiative' }],
          payload: { tokenId: 'token-1', initiative: 10 },
        },
        mock: mocks.executeLivePlayInitiativeCommandUseCase,
      },
      {
        route: placeHazardRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedhaz1',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'placeHazard',
          scopes: [{ kind: 'map', lane: 'hazards' }],
          payload: { hazard: { kind: 'spikes', x: 1, y: 0, z: 1 } },
        },
        mock: mocks.executeLivePlayMapEffectsCommandUseCase,
      },
      {
        route: removeHazardRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedrhaz',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'removeHazard',
          scopes: [{ kind: 'map', lane: 'hazards' }],
          payload: { cell: { x: 1, y: 0, z: 1 } },
        },
        mock: mocks.executeLivePlayMapEffectsCommandUseCase,
      },
      {
        route: buildTerrainRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedtrn1',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'buildTerrainVoxel',
          scopes: [{ kind: 'map', lane: 'terrain' }],
          payload: { voxel: { x: 1, y: 0, z: 1, materialId: 'meadow_grass' } },
        },
        mock: mocks.executeLivePlayTerrainCommandUseCase,
      },
      {
        route: removeTerrainRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedrtrn',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'removeTerrainVoxel',
          scopes: [{ kind: 'map', lane: 'terrain' }],
          payload: { cell: { x: 1, y: 0, z: 1 } },
        },
        mock: mocks.executeLivePlayTerrainCommandUseCase,
      },
      {
        route: setFieldEffectRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedfld1',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'setFieldEffect',
          scopes: [{ kind: 'map', lane: 'fieldEffects' }],
          payload: { category: 'weather', kind: 'sunny' },
        },
        mock: mocks.executeLivePlayMapEffectsCommandUseCase,
      },
      {
        route: removeFieldEffectRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedrfld',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'removeFieldEffect',
          scopes: [{ kind: 'map', lane: 'fieldEffects' }],
          payload: { category: 'weather', kind: 'sunny' },
        },
        mock: mocks.executeLivePlayMapEffectsCommandUseCase,
      },
      {
        route: tickFieldEffectDurationsRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedtick',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'tickFieldEffectDurations',
          scopes: [{ kind: 'map', lane: 'fieldEffects' }],
          payload: {},
        },
        mock: mocks.executeLivePlayMapEffectsCommandUseCase,
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
        route: modifyHpRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedhp1',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'modifyHp',
          scopes: [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'hp' }],
          payload: { placementId: 'token-1', delta: -5 },
          profileId: 'profile_ash00000',
        },
        mock: mocks.executeLivePlaySheetCommandUseCase,
      },
      {
        route: modifyCombatStagesRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedstage',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'modifyCombatStages',
          scopes: [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'combatStages' }],
          payload: { placementId: 'token-1', stages: { attack: 1 } },
          profileId: 'profile_ash00000',
        },
        mock: mocks.executeLivePlaySheetCommandUseCase,
      },
      {
        route: modifyConditionsRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedcond',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'modifyConditions',
          scopes: [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'conditions' }],
          payload: { placementId: 'token-1', add: ['burned'] },
          profileId: 'profile_ash00000',
        },
        mock: mocks.executeLivePlaySheetCommandUseCase,
      },
      {
        route: abilityRoute,
        body: {
          slug: 'arena',
          placementId: 'token-1',
          abilityName: 'Overgrow',
          profileId: 'profile_ash00000',
        },
        mock: mocks.executeLivePlayTableActionCommandUseCase,
      },
      {
        route: maneuverRoute,
        body: {
          slug: 'arena',
          placementId: 'token-1',
          maneuverName: 'Trip',
          profileId: 'profile_ash00000',
        },
        mock: mocks.executeLivePlayTableActionCommandUseCase,
      },
      {
        route: orderRoute,
        body: {
          slug: 'arena',
          placementId: 'token-1',
          orderName: 'Agility Training',
          profileId: 'profile_ash00000',
        },
        mock: mocks.executeLivePlayTableActionCommandUseCase,
      },
      {
        route: useMoveRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedmove1',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'useMove',
          scopes: [{ kind: 'token', placementId: 'token-1', field: 'moveUsage' }],
          payload: { placementId: 'token-1', moveName: 'Thunderbolt' },
          profileId: 'profile_ash00000',
        },
        mock: mocks.executeLivePlayUseMoveCommandUseCase,
      },
      {
        route: nextInitiativeRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostednext1',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'nextInitiative',
          scopes: [{ kind: 'map', lane: 'initiative' }],
          payload: { orderIds: ['token-1', 'token-2'], activeId: 'token-1', round: 1 },
        },
        mock: mocks.executeLivePlayInitiativeCommandUseCase,
      },
      {
        route: previousInitiativeRoute,
        body: {
          schemaVersion: 1,
          opId: 'op_hostedprev1',
          mapSlug: 'arena',
          baseRevision: 0,
          type: 'previousInitiative',
          scopes: [{ kind: 'map', lane: 'initiative' }],
          payload: { orderIds: ['token-1', 'token-2'], activeId: 'token-1', round: 1 },
        },
        mock: mocks.executeLivePlayInitiativeCommandUseCase,
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

  it('allows representative live-play command routes in production when the exact hosted-write flag is set', async () => {
    enableProductionWrites()

    const map = mapFixture()
    const placement = map.placements[0]!
    const initiativeCommand = {
      schemaVersion: 1,
      opId: 'op_hostedok1',
      mapSlug: 'arena',
      baseRevision: 0,
      type: 'setInitiative',
      scopes: [{ kind: 'map', lane: 'initiative' }],
      payload: { tokenId: 'token-1', initiative: 12 },
      clientId: 'client-gm',
    }
    mocks.executeLivePlayInitiativeCommandUseCase.mockResolvedValueOnce({
      result: {
        ok: true,
        status: 'accepted',
        opId: 'op_hostedok1',
        mapSlug: 'arena',
        previousRevision: 0,
        revision: 1,
        patches: [],
      },
      map,
      initiative: map.initiative,
    })

    await expect(invokeRoute(setInitiativeRoute, {
      role: 'gm',
      body: initiativeCommand,
    })).resolves.toMatchObject({
      ok: true,
      opId: 'op_hostedok1',
      mapSlug: 'arena',
      revision: 1,
      map,
      initiative: map.initiative,
    })
    expect(mocks.executeLivePlayInitiativeCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command: initiativeCommand,
      clientId: 'client-gm',
      expectedType: 'setInitiative',
    })

    const playerProfile = {
      schemaVersion: 1,
      id: 'profile_ash00000',
      displayName: 'Ash',
      linkedCharacters: [],
    }
    const hpCommand = {
      schemaVersion: 1,
      opId: 'op_hostedok2',
      mapSlug: 'arena',
      baseRevision: 1,
      type: 'modifyHp',
      scopes: [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'hp' }],
      payload: { placementId: 'token-1', delta: -5 },
      profileId: 'profile_ash00000',
      clientId: 'client-player',
    }
    const sheetUpdates = [{ kind: 'pokemon', slug: 'pikachu', revision: 2, sheet: { slug: 'pikachu' } }]
    mocks.resolvePlayerProfileForPolicy.mockReturnValueOnce(playerProfile)
    mocks.executeLivePlaySheetCommandUseCase.mockResolvedValueOnce({
      result: {
        ok: true,
        status: 'accepted',
        opId: 'op_hostedok2',
        mapSlug: 'arena',
        previousRevision: 1,
        revision: 2,
        patches: [],
      },
      map,
      placement,
      sheetUpdates,
    })

    await expect(invokeRoute(modifyHpRoute, {
      role: 'player',
      body: hpCommand,
    })).resolves.toMatchObject({
      ok: true,
      opId: 'op_hostedok2',
      mapSlug: 'arena',
      revision: 2,
      map,
      placement,
      sheetUpdates,
    })
    expect(mocks.resolvePlayerProfileForPolicy).toHaveBeenCalledWith('profile_ash00000')
    expect(mocks.executeLivePlaySheetCommandUseCase).toHaveBeenCalledWith({
      role: 'player',
      command: hpCommand,
      clientId: 'client-player',
      playerProfile,
      expectedType: 'modifyHp',
    })
  })
})
