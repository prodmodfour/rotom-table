import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLivePlayCommands } from '~/composables/map-editor/useLivePlayCommands'
import { useLivePlayStateMachine } from '~/composables/map-editor/useLivePlayStateMachine'
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

  it('posts live-play send-out commands with trainer and spawned token scopes', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_serversendout',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      placement: {
        id: 'token-eevee',
        sheetKind: 'pokemon',
        sheetSlug: 'eevee',
        position: { x: 3, y: 0, z: 2 },
      },
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      playerProfileId: profileId,
      mapRevision,
    })
    const result = await actions.sendOutPokemon({
      trainerId: 'trainer-ash',
      pokemonSlug: 'eevee',
      tokenId: 'token-eevee',
      position: { x: 3, y: 0, z: 2 },
      facing: 'south-east',
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.sendOutPokemon, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.SEND_OUT_POKEMON,
      scopes: [
        { kind: 'token', placementId: 'trainer-ash', field: 'sendOut' },
        { kind: 'token', placementId: 'token-eevee', field: 'spawn' },
      ],
      payload: {
        trainerId: 'trainer-ash',
        pokemonSlug: 'eevee',
        tokenId: 'token-eevee',
        position: { x: 3, y: 0, z: 2 },
        facing: 'south-east',
      },
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
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

  it('posts live-play Attack of Opportunity state updates through the command dispatcher', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_serveraoo001',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      playerProfileId: profileId,
      mapRevision,
    })
    const payload = { action: 'clear-prompt' as const, promptId: 'aoo-1' }
    const result = await actions.updateAttackOfOpportunity(payload)

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.updateAttackOfOpportunity, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.UPDATE_ATTACK_OF_OPPORTUNITY,
      scopes: [{ kind: 'map', lane: 'metadata' }],
      payload,
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
  })

  it('posts live-play start-of-turn modal updates through the command dispatcher', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_serverturn01',
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
    })
    const payload = { action: 'dismiss' as const, activeId: 'token-pikachu', round: 2 }
    const result = await actions.updateStartTurnModal(payload)

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.updateStartTurnModal, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.UPDATE_START_TURN_MODAL,
      scopes: [{ kind: 'map', lane: 'metadata' }],
      payload,
      clientId: 'ssr',
    }))
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

  it('posts authoritative throwPokeball commands with placement-derived sheet scopes and adopts the response', async () => {
    const map = {
      ...mapFixture(),
      placements: [
        { id: 'trainer-ash', sheetKind: 'trainer' as const, sheetSlug: 'ash', position: { x: 0, y: 0, z: 0 } },
        ...mapFixture().placements,
      ],
    }
    const mapRevision = ref(4)
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    const applyPersistedMap = vi.fn()
    const applySheetUpdate = vi.fn()
    const trainerUpdate = { kind: 'trainer' as const, slug: 'ash', sheet: { slug: 'ash', revision: 3 } }
    const targetUpdate = { kind: 'pokemon' as const, slug: 'bulbasaur', sheet: { slug: 'bulbasaur', revision: 2 } }
    const capture = {
      trainerId: 'trainer-ash',
      targetId: 'target-token',
      targetSlug: 'bulbasaur',
      pokeballName: 'Basic Ball',
      result: { id: 'capture-server-1', hit: true, success: true },
    }
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_servercapture',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
      sheetUpdates: [trainerUpdate, targetUpdate],
      capture,
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      playerProfileId: profileId,
      map: ref(map),
      mapRevision,
      applyPersistedMap,
      applySheetUpdate,
    })
    const result = await actions.throwPokeball({
      trainerPlacementId: 'trainer-ash',
      targetPlacementId: 'target-token',
      pokeballName: 'Basic Ball',
    })

    expect(result.dispatched).toBe(true)
    expect(result.response?.capture).toBe(capture)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.throwPokeball, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.THROW_POKEBALL,
      scopes: [
        { kind: 'token', placementId: 'trainer-ash', field: 'action' },
        { kind: 'token', placementId: 'target-token', field: 'action' },
        { kind: 'map', lane: 'metadata' },
        { kind: 'map', lane: 'placements' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'inventory' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'ash', field: 'pokemonRoster' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'bulbasaur', field: 'caughtBall' },
      ],
      payload: {
        trainerPlacementId: 'trainer-ash',
        targetPlacementId: 'target-token',
        pokeballName: 'Basic Ball',
      },
      clientId: 'ssr',
      profileId: 'profile_ash00000',
    }))
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(applySheetUpdate).toHaveBeenCalledTimes(2)
    expect(applySheetUpdate).toHaveBeenNthCalledWith(1, trainerUpdate)
    expect(applySheetUpdate).toHaveBeenNthCalledWith(2, targetUpdate)
  })

  it('omits profileId from throwPokeball requests when no player profile is selected', async () => {
    const map = {
      ...mapFixture(),
      placements: [
        { id: 'trainer-ash', sheetKind: 'trainer' as const, sheetSlug: 'ash', position: { x: 0, y: 0, z: 0 } },
        ...mapFixture().placements,
      ],
    }
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_servercapturegm',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      map,
      capture: { trainerId: 'trainer-ash', targetId: 'target-token', targetSlug: 'bulbasaur', pokeballName: 'Basic Ball', result: { id: 'capture-server-2' } },
    })

    const actions = useLivePlayCommands({ slug: 'arena-map', map: ref(map), mapRevision: ref(4) })
    await actions.throwPokeball({ trainerPlacementId: 'trainer-ash', targetPlacementId: 'target-token', pokeballName: 'Basic Ball' })

    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.throwPokeball, expect.not.objectContaining({
      profileId: expect.anything(),
    }))
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

  it('posts live-play Grant XP sheet commands to map token command routes', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applySheetUpdate = vi.fn()
    const sheetUpdate = {
      kind: 'pokemon' as const,
      slug: 'pikachu',
      sheet: { slug: 'pikachu', totalExp: 140, level: 12, revision: 3 },
    }
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_serverxp001',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      map,
      placement: map.placements[0],
      sheetUpdates: [sheetUpdate],
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      map: ref(map),
      mapRevision,
      applySheetUpdate,
    })
    const result = await actions.grantExperience({
      placementId: 'token-pikachu',
      amount: 100,
    })

    expect(result.dispatched).toBe(true)
    expect(apiMocks.postJson).toHaveBeenCalledWith(MAP_API_PATHS.grantExperience, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
      scopes: [
        { kind: 'token', placementId: 'token-pikachu', field: 'experience' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'experience' },
      ],
      payload: {
        placementId: 'token-pikachu',
        amount: 100,
      },
      clientId: 'ssr',
    }))
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

    await actions.nextInitiative({ orderIds: ['token-pikachu', 'target-token'], activeId: null, round: 1 })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.nextInitiative, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      scopes: [{ kind: 'map', lane: 'initiative' }],
      payload: { orderIds: ['token-pikachu', 'target-token'], activeId: null, round: 1 },
    }))
  })

  it('does not dispatch a rapid second initiative advance while the first is pending', async () => {
    const map = mapFixture()
    const mapRevision = ref(4)
    const applyPersistedMap = vi.fn()
    let resolveFirst!: (response: unknown) => void
    apiMocks.postJson.mockReturnValueOnce(new Promise((resolve) => {
      resolveFirst = resolve
    }))

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision,
      applyPersistedMap,
    })

    const advancePrecondition = { orderIds: ['token-pikachu', 'target-token'], activeId: null, round: 1 }
    const first = actions.nextInitiative(advancePrecondition)
    const second = await actions.nextInitiative(advancePrecondition)

    expect(second).toEqual({
      dispatched: false,
      message: 'A live-play command is already in flight.',
    })
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(actions.status.value).toBe('saving')

    resolveFirst({
      ok: true,
      opId: 'op_initclient2',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })
    await expect(first).resolves.toMatchObject({ dispatched: true })
    expect(apiMocks.postJson).toHaveBeenCalledTimes(1)
    expect(applyPersistedMap).toHaveBeenCalledWith(map)
    expect(actions.status.value).toBe('idle')
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

  it('posts live-play scene commands through the command dispatcher', async () => {
    const map = mapFixture()
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_setscene1',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena-map.json',
      map,
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
    })

    await actions.setScene({ name: 'Moonlit Rooftop' })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.setScene, expect.objectContaining({
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: expect.stringMatching(LIVE_PLAY_OP_ID_RE),
      mapSlug: 'arena-map',
      baseRevision: 4,
      type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
      scopes: [{ kind: 'map', lane: 'scene' }],
      payload: { name: 'Moonlit Rooftop' },
      clientId: 'ssr',
    }))

    await actions.setScene({ name: null })
    expect(apiMocks.postJson).toHaveBeenLastCalledWith(MAP_API_PATHS.setScene, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
      scopes: [{ kind: 'map', lane: 'scene' }],
      payload: { name: null },
    }))
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

  it('requests reconciliation and clears local error state after stale live-play rejections reconcile successfully', async () => {
    const requestReconciliation = vi.fn()
    const onCommandStarted = vi.fn()
    const onCommandRejected = vi.fn()
    const onCommandErrorCleared = vi.fn()
    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation,
      onCommandStarted,
      onCommandRejected,
      onCommandErrorCleared,
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
    expect(actions.status.value).toBe('idle')
    expect(actions.lastError.value).toBeNull()
    expect(onCommandErrorCleared).toHaveBeenCalledTimes(1)
  })

  it('keeps the stale rejection visible when required reconciliation fails', async () => {
    const requestReconciliation = vi.fn().mockRejectedValue(new Error('Runtime sheet reload failed'))
    const onCommandErrorCleared = vi.fn()
    const onCommandFailed = vi.fn()
    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation,
      onCommandErrorCleared,
      onCommandFailed,
    })
    apiMocks.postJson.mockResolvedValue({
      ok: false,
      opId: 'op_stalemove02',
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
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.moveToken,
      response: expect.objectContaining({ reason: 'stale-revision', currentRevision: 5 }),
    })
    expect(actions.status.value).toBe('error')
    expect(actions.lastError.value).toBe('Map revision 4 is stale; current revision is 5.')
    expect(onCommandErrorCleared).not.toHaveBeenCalled()
    expect(onCommandFailed).toHaveBeenCalledWith('Runtime sheet reload failed')
  })

  it('keeps live-play controls blocked when stale reconciliation sheet reload fails', async () => {
    const stateMachine = useLivePlayStateMachine({
      mapStatus: ref('idle'),
      realtimeStatus: ref('synced'),
    })
    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation: () => stateMachine.reconcile(async () => {
        await Promise.all([
          Promise.resolve(),
          Promise.reject(new Error('Runtime sheet reload failed')),
        ])
      }),
      onCommandStarted: stateMachine.commandStarted,
      onCommandRejected: stateMachine.commandRejected,
      onCommandFailed: stateMachine.commandFailed,
      onCommandErrorCleared: stateMachine.clearCommandError,
    })
    apiMocks.postJson.mockResolvedValue({
      ok: false,
      opId: 'op_staleinit01',
      mapSlug: 'arena-map',
      reason: 'stale-revision',
      message: 'Initiative order is stale; reload turn order.',
      currentRevision: 5,
    })

    await actions.nextInitiative({ orderIds: ['token-pikachu', 'target-token'], activeId: 'token-pikachu', round: 1 })

    expect(actions.status.value).toBe('error')
    expect(actions.lastError.value).toBe('Initiative order is stale; reload turn order.')
    expect(stateMachine.state.value).toBe('error')
    expect(stateMachine.notice.value).toBe('Runtime sheet reload failed')
    expect(stateMachine.commandsAllowed.value).toBe(false)
  })

  it('lets live-play controls resume when stale reconciliation reloads map and sheets successfully', async () => {
    const stateMachine = useLivePlayStateMachine({
      mapStatus: ref('idle'),
      realtimeStatus: ref('synced'),
    })
    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation: () => stateMachine.reconcile(async () => {
        await Promise.all([
          Promise.resolve(),
          Promise.resolve(),
        ])
      }),
      onCommandStarted: stateMachine.commandStarted,
      onCommandRejected: stateMachine.commandRejected,
      onCommandFailed: stateMachine.commandFailed,
      onCommandErrorCleared: stateMachine.clearCommandError,
    })
    apiMocks.postJson.mockResolvedValue({
      ok: false,
      opId: 'op_staleinit02',
      mapSlug: 'arena-map',
      reason: 'stale-revision',
      message: 'Initiative order is stale; reload turn order.',
      currentRevision: 5,
    })

    await actions.nextInitiative({ orderIds: ['token-pikachu', 'target-token'], activeId: 'token-pikachu', round: 1 })

    expect(actions.status.value).toBe('idle')
    expect(actions.lastError.value).toBeNull()
    expect(stateMachine.state.value).toBe('ready')
    expect(stateMachine.commandsAllowed.value).toBe(true)
  })

  it('requests reconciliation for stale-base conflicts and reports the rejection to state hooks', async () => {
    const requestReconciliation = vi.fn()
    const onCommandRejected = vi.fn()
    const actions = useLivePlayCommands({
      slug: 'arena-map',
      mapRevision: ref(4),
      requestReconciliation,
      onCommandRejected,
    })
    apiMocks.postJson.mockResolvedValue({
      ok: false,
      opId: 'op_conflict01',
      mapSlug: 'arena-map',
      reason: 'conflict',
      message: 'Command baseRevision 4 conflicts with accepted operation op_other at revision 5 on token token-pikachu position',
      currentRevision: 5,
    })

    const result = await actions.moveToken({
      placementId: 'token-pikachu',
      position: { x: 2, y: 0, z: 1 },
    })

    expect(result).toMatchObject({
      dispatched: false,
      message: 'Command baseRevision 4 conflicts with accepted operation op_other at revision 5 on token token-pikachu position',
    })
    expect(onCommandRejected).toHaveBeenCalledWith({
      reason: 'conflict',
      message: 'Command baseRevision 4 conflicts with accepted operation op_other at revision 5 on token token-pikachu position',
      response: expect.objectContaining({ currentRevision: 5 }),
    })
    expect(requestReconciliation).toHaveBeenCalledWith({
      request: MAP_API_PATHS.moveToken,
      response: expect.objectContaining({ reason: 'conflict', currentRevision: 5 }),
    })
  })

  it('routes GM table action helpers without inventing a player profile id', async () => {
    const map = mapFixture()
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_gmtableact',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      map: ref(map),
      mapRevision: ref(4),
    })

    await expect(actions.useManeuver({
      placementId: 'token-pikachu',
      maneuverName: 'Trip',
      targetPlacementId: 'target-token',
    })).resolves.toMatchObject({ dispatched: true })
    await expect(actions.useOrder({
      placementId: 'token-pikachu',
      orderName: 'Agility Training',
      targetPlacementId: 'target-token',
    })).resolves.toMatchObject({ dispatched: true })
    await expect(actions.useAbility({
      placementId: 'token-pikachu',
      abilityName: 'Sand Veil',
    })).resolves.toMatchObject({ dispatched: true })

    expect(apiMocks.postJson).toHaveBeenNthCalledWith(1, MAP_API_PATHS.useManeuver, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
      payload: {
        placementId: 'token-pikachu',
        maneuverName: 'Trip',
        targetPlacementId: 'target-token',
      },
    }))
    expect(apiMocks.postJson).toHaveBeenNthCalledWith(2, MAP_API_PATHS.useOrder, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
      payload: {
        placementId: 'token-pikachu',
        orderName: 'Agility Training',
        targetPlacementId: 'target-token',
      },
    }))
    expect(apiMocks.postJson).toHaveBeenNthCalledWith(3, MAP_API_PATHS.useAbility, expect.objectContaining({
      type: LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      payload: {
        placementId: 'token-pikachu',
        abilityName: 'Sand Veil',
      },
    }))
    for (const [, body] of apiMocks.postJson.mock.calls) {
      expect(body).not.toHaveProperty('profileId')
    }
    expect(apiMocks.postJson.mock.calls.map(([path]) => path)).not.toContain(SHEET_API_PATHS.save)
  })

  it('keeps the selected player profile on player table action helpers', async () => {
    const map = mapFixture()
    const profileId = ref(parsePlayerProfileId('profile_ash00000'))
    apiMocks.postJson.mockResolvedValue({
      ok: true,
      opId: 'op_playertableact',
      mapSlug: 'arena-map',
      previousRevision: 4,
      revision: 5,
      patches: [],
    })

    const actions = useLivePlayCommands({
      slug: 'arena-map',
      playerProfileId: profileId,
      map: ref(map),
      mapRevision: ref(4),
    })

    await actions.useManeuver({ placementId: 'token-pikachu', maneuverName: 'Trip' })
    await actions.useOrder({ placementId: 'token-pikachu', orderName: 'Agility Training' })

    for (const [, body] of apiMocks.postJson.mock.calls) {
      expect(body).toMatchObject({ profileId: 'profile_ash00000' })
    }
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
