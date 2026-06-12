import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDocumentMapTokenActions } from '~/composables/map-editor/useDocumentMapTokenActions'
import { MAP_API_PATHS } from '~/utils/apiRoutes'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_OP_ID_RE,
} from '#shared/livePlayCommands'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import type { TabletopMap } from '~/types/map'

const apiMocks = vi.hoisted(() => ({
  postJson: vi.fn(),
  sendJsonWithUnloadFallback: vi.fn(),
}))

vi.mock('~/utils/autosaveUnload', () => ({
  sendJsonWithUnloadFallback: apiMocks.sendJsonWithUnloadFallback,
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
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
})

describe('useDocumentMapTokenActions', () => {
  beforeEach(() => {
    apiMocks.postJson.mockReset()
    apiMocks.sendJsonWithUnloadFallback.mockReset()
  })

  it('posts document-backed spawn actions with an unload-safe small payload when requested', async () => {
    const map = mapFixture()
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
      path: 'data/maps/arena-map.json',
      map,
      placement,
    })

    const actions = useDocumentMapTokenActions({
      slug: 'arena-map',
      applyPersistedMap,
    })
    const result = await actions.spawnToken({ placement, unloadFallback: true })

    const expectedBody = {
      slug: 'arena-map',
      clientId: 'ssr',
      placement,
    }
    expect(result.dispatched).toBe(true)
    expect(apiMocks.sendJsonWithUnloadFallback).toHaveBeenCalledWith(
      MAP_API_PATHS.spawnToken,
      JSON.stringify(expectedBody),
    )
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.spawnToken, expectedBody)
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

    const actions = useDocumentMapTokenActions({
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

  it('posts live-play turn commands and surfaces command rejections', async () => {
    const actions = useDocumentMapTokenActions({ slug: 'arena-map', mapRevision: ref(4) })
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

  it('posts document-backed table actions and applies returned sheet updates', async () => {
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
      path: 'data/maps/arena-map.json',
      map,
      action: { type: 'ability', placementId: 'token-pikachu', name: 'Healer' },
      sheetUpdates: [sheetUpdate],
    })

    const actions = useDocumentMapTokenActions({
      slug: 'arena-map',
      playerProfileId: profileId,
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.useAbility({
      placementId: 'token-pikachu',
      abilityName: 'Healer',
      targetPlacementId: 'target-token',
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.useAbility, {
      slug: 'arena-map',
      clientId: 'ssr',
      profileId: 'profile_ash00000',
      placementId: 'token-pikachu',
      abilityName: 'Healer',
      targetPlacementId: 'target-token',
    })
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledWith(sheetUpdate)
  })
})
