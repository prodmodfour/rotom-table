import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLivePlayCommands } from '~/composables/map-editor/useLivePlayCommands'
import { MAP_API_PATHS, SHEET_API_PATHS } from '~/utils/apiRoutes'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_OP_ID_RE,
  LIVE_PLAY_PATCH_TYPES,
} from '#shared/livePlayCommands'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

const apiMocks = vi.hoisted(() => ({
  postJson: vi.fn(),
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    postJson: apiMocks.postJson,
  }),
}))

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 6, y: 2, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-pikachu',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
    },
    {
      id: 'target-token',
      sheetKind: 'pokemon',
      sheetSlug: 'bulbasaur',
      position: { x: 2, y: 0, z: 1 },
      facing: 'north-west',
      turned: false,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
})

describe('useLivePlayCommands', () => {
  beforeEach(() => {
    apiMocks.postJson.mockReset()
  })

  it('keeps live-play command dispatch free of unload fallback helpers', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/composables/map-editor/useLivePlayCommands.ts'), 'utf8')

    expect(source).not.toContain('sendJsonWithUnloadFallback')
    expect(source).not.toContain('sendSetupEditJsonWithUnloadFallback')
    expect(source).not.toContain('sendBeacon')
    expect(source).not.toContain('pagehide')
    expect(source).toContain('bindPendingLivePlayCommandUnloadWarning')
  })

  it('posts live-play spawn commands once through explicit opId command dispatch', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    const placement = {
      id: 'token-eevee',
      sheetKind: 'pokemon' as const,
      sheetSlug: 'eevee',
      position: { x: 2, y: 0, z: 2 },
      facing: 'south-east' as const,
      turned: false,
    }
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_serverspawn',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement,
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })
    const result = await actions.spawnToken({ placement })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.spawnToken, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.SPAWN_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-eevee', field: 'spawn' }],
      payload: { placement },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
  })

  it('posts live-play move commands with opId, baseRevision, and the selected player profile id', async () => {
    const map = mapFixture()
    const applyPersistedMap = vi.fn()
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    const mapRevision = ref(4)
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_servermove01',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement: map.placements[0],
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      playerProfileId: profileId,
      mapRevision,
      applyPersistedMap,
    })
    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
      pathLength: 3,
    })

    expect(result.dispatched).toBe(true)
    expect(actions.status.value).toBe('idle')
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.moveToken, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.MOVE_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
      payload: {
        placementId: 'token-pikachu',
        position: { x: 2, y: 0, z: 1 },
        pathLength: 3,
      },
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
  })

  it('posts live-play delete commands through the command dispatcher', async () => {
    const map = { ...mapFixture(), placements: [] }
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_serverdelete',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })
    const result = await actions.deleteToken({ placementId: 'token-pikachu' })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.deleteToken, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.DELETE_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'delete' }],
      payload: { placementId: 'token-pikachu' },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
  })

  it('posts live-play HP sheet commands to map token command routes and applies returned sheet updates', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const sheetUpdate = {
      kind: 'pokemon' as const,
      slug: 'pikachu',
      sheet: { slug: 'pikachu', combat: { currentHp: 8, injuries: 1 }, revision: 3 },
    }
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_serverhp001',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement: map.placements[0],
      sheetUpdates: [sheetUpdate],
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      map: ref(map),
      mapRevision,
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.modifyHp({
      placementId: 'token-pikachu',
      currentHp: 8,
      injuries: 1,
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson).not.toHaveBeenCalledWith(SHEET_API_PATHS.save, expect.anything())
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.modifyHp, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      scopes: [
        { kind: 'token', placementId: 'token-pikachu', field: 'hp' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'hp' },
      ],
      payload: {
        placementId: 'token-pikachu',
        currentHp: 8,
        injuries: 1,
      },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledWith(sheetUpdate)
  })

  it('posts live-play useMove commands with sheet scope and applies authoritative map and sheet results', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const sheetUpdate = {
      kind: 'pokemon' as const,
      slug: 'pikachu',
      sheet: {
        slug: 'pikachu',
        revision: 3,
        moveUsage: { daily: { thunderbolt: { moveName: 'Thunderbolt', uses: 1 } } },
      },
    }
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_usemoveclient',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement: map.placements[0],
      sheetUpdates: [sheetUpdate],
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      map: ref(map),
      mapRevision,
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.useMove({
      placementId: 'token-pikachu',
      moveName: 'Thunderbolt',
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.postJson).not.toHaveBeenCalledWith(SHEET_API_PATHS.save, expect.anything())
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.useMove, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
      scopes: [
        { kind: 'token', placementId: 'token-pikachu', field: 'moveUsage' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'moveUsage' },
      ],
      payload: {
        placementId: 'token-pikachu',
        moveName: 'Thunderbolt',
      },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledWith(sheetUpdate)
  })

  it('posts live-play initiative commands through the command dispatcher', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_initclient1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })
    const result = await actions.setInitiative({ tokenId: 'token-pikachu', initiative: 17 })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.setInitiative, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }],
      payload: { tokenId: 'token-pikachu', initiative: 17 },
      clientId: 'ssr',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)

    await actions.nextInitiative()
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.nextInitiative, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }],
      payload: {},
    }))
  })

  it('posts live-play hazard, terrain, and field-effect commands through the command dispatcher', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_mapeffect1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })

    await actions.placeHazard({ hazard: { kind: 'spikes', x: 1, y: 0, z: 2 } })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.placeHazard, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
      scopes: [{ kind: 'map', lane: 'hazards' }],
      payload: { hazard: { kind: 'spikes', x: 1, y: 0, z: 2 } },
      clientId: 'ssr',
    }))

    await actions.buildTerrainVoxel({ voxel: { x: 2, y: 0, z: 2, materialId: 'meadow_grass' } })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.buildTerrainVoxel, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
      scopes: [{ kind: 'map', lane: 'terrain' }],
      payload: { voxel: { x: 2, y: 0, z: 2, materialId: 'meadow_grass' } },
      clientId: 'ssr',
    }))

    await actions.removeTerrainVoxel({ cell: { x: 2, y: 0, z: 2 } })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.removeTerrainVoxel, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
      scopes: [{ kind: 'map', lane: 'terrain' }],
      payload: { cell: { x: 2, y: 0, z: 2 } },
    }))

    await actions.setFieldEffect({ category: 'weather', kind: 'sunny', rounds: 5, weatherMode: 'replace' })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.setFieldEffect, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: { category: 'weather', kind: 'sunny', rounds: 5, weatherMode: 'replace' },
    }))

    await actions.removeFieldEffect({ category: 'weather', kind: 'sunny' })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.removeFieldEffect, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: { category: 'weather', kind: 'sunny' },
    }))

    await actions.tickFieldEffectDurations()
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.tickFieldEffectDurations, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: {},
    }))

    expect(applyPersistedMap).toHaveBeenCalledWith(map)
  })

  it('blocks live-play token commands while realtime reconciliation is pending', async () => {
    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      livePlayCommandBlocked: ref(true),
      livePlayCommandBlockedMessage: ref('Reconnected. Reloading the authoritative map before live play resumes.'),
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result).toEqual({
      dispatched: false,
      message: 'Reconnected. Reloading the authoritative map before live play resumes.',
    })
    expect(apiMocks.postJson).not.toHaveBeenCalled()
    expect(actions.status.value).toBe('error')
    expect(actions.lastError.value).toBe('Reconnected. Reloading the authoritative map before live play resumes.')
  })

  it('applies accepted patch-only command responses when the current map revision matches', async () => {
    const map = ref(mapFixture())
    const requestReconciliation = vi.fn()
    const applyPersistedMap = vi.fn()
    const actions = useLivePlayCommands({
      slug: 'arena-map',
      map,
      mapRevision: ref(4),
      applyPersistedMap,
      requestReconciliation,
    })
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_patchonly1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION,
        mapSlug: 'arena-map',
        revision: 5,
        scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'position' }],
        payload: {
          placementId: 'token-pikachu',
          position: { x: 3, y: 0, z: 2 },
          facing: 'north-east',
          turned: false,
        },
      }],
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 3, y: 0, z: 2 },
    })

    expect(result.dispatched).toBe(true)
    expect(map.value.revision).toBe(5)
    expect(map.value.placements[0]).toMatchObject({ position: { x: 3, y: 0, z: 2 }, facing: 'north-east' })
    expect(applyPersistedMap).not.toHaveBeenCalled()
    expect(requestReconciliation).not.toHaveBeenCalled()
  })

  it('requests reconciliation when an accepted command returns a reconciliation patch instead of a map', async () => {
    const requestReconciliation = vi.fn()
    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation,
    })
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_reconcile1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [{
        schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
        type: LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED,
        mapSlug: 'arena-map',
        revision: 5,
        scopes: [{ kind: 'map', lane: 'metadata' }],
        payload: { reason: 'patch unavailable' },
      }],
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result.dispatched).toBe(true)
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.moveToken,
      response: expect.objectContaining({ opId: 'op_reconcile1', revision: 5 }),
    })
  })

  it('posts live-play turn commands and surfaces command rejections', async () => {
    const actions = useLivePlayCommands({ slug: 'arena-map', mapRevision: ref(4) })
    apiMocks.postJson.mockResolvedValue({
      ok: false,
      opId: 'op_turnreject1',
      mapSlug: 'arena-map',
      reason: 'unauthorized',
      message: 'Token is not linked to selected player profile',
      currentRevision: 4,
    })

    const result = await actions.turnToken({
      placementId: 'token-pikachu',
      facing: 'north-east',
    })

    expect(result).toMatchObject({
      dispatched: false,
      message: 'Token is not linked to selected player profile',
    })
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.turnToken, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.TURN_TOKEN,
      scopes: [{ kind: 'token', placementId: 'token-pikachu', field: 'facing' }],
      payload: {
        placementId: 'token-pikachu',
        facing: 'north-east',
      },
      clientId: 'ssr',
    }))
    expect(actions.status.value).toBe('error')
    expect(actions.lastError.value).toBe('Token is not linked to selected player profile')

    actions.clearError()
    expect(actions.status.value).toBe('idle')
    expect(actions.lastError.value).toBeNull()
  })

  it('requests reconciliation and updates state hooks for stale live-play rejections', async () => {
    const requestReconciliation = vi.fn()
    const onCommandStarted = vi.fn()
    const onCommandRejected = vi.fn()
    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation,
      onCommandStarted,
      onCommandRejected,
    })
    apiMocks.postJson.mockResolvedValue({
      ok: false,
      opId: 'op_stalemove01',
      mapSlug: 'arena-map',
      reason: 'stale-revision',
      message: 'Map revision 4 is stale; current revision is 5.',
      currentRevision: 5,
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result).toMatchObject({
      dispatched: false,
      message: 'Map revision 4 is stale; current revision is 5.',
    })
    expect(onCommandStarted).toHaveBeenCalledTimes(1)
    expect(onCommandRejected).toHaveBeenCalledWith({
      reason: 'stale-revision',
      message: 'Map revision 4 is stale; current revision is 5.',
      response: expect.objectContaining({ currentRevision: 5 }),
    })
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.moveToken,
      response: expect.objectContaining({ reason: 'stale-revision', currentRevision: 5 }),
    })
  })

  it('routes table action helpers through the shared dispatcher and applies returned sheet updates', async () => {
    const map = mapFixture()
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const sheetUpdate = {
      kind: 'pokemon' as const,
      slug: 'pikachu',
      path: 'data/pokemon/pikachu.json',
      sheet: { slug: 'pikachu', combat: { conditions: ['Burned'] } },
    }
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_serverability',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      action: { type: 'ability', placementId: 'token-pikachu', name: 'Healer' },
      sheetUpdates: [sheetUpdate],
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      playerProfileId: profileId,
      map: ref(map),
      mapRevision: ref(4),
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.useAbility({
      placementId: 'token-pikachu',
      abilityName: 'Healer',
      targetPlacementId: 'target-token',
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.useAbility, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      scopes: [
        { kind: 'token', placementId: 'token-pikachu', field: 'action' },
        { kind: 'map', lane: 'metadata' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'ability' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'bulbasaur', field: 'ability' },
      ],
      payload: {
        placementId: 'token-pikachu',
        abilityName: 'Healer',
        targetPlacementId: 'target-token',
      },
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledWith(sheetUpdate)
  })
})
