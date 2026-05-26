import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import { parseOpId, type SessionCommandEnvelope } from '#shared/sessionCommands'
import { parseClientId, parseGmKey, parseSessionId } from '#shared/sessionIdentity'
import { parseSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  DELETE_TOKEN_COMMAND_TYPE,
  SEND_OUT_POKEMON_COMMAND_TYPE,
} from '#shared/sessionTokenCommands'
import {
  MODIFY_HP_COMMAND_TYPE,
  USE_MANEUVER_COMMAND_TYPE,
} from '#shared/sessionTableActionCommands'
import { NEXT_INITIATIVE_COMMAND_TYPE } from '#shared/sessionInitiativeCommands'
import { PLACE_HAZARD_COMMAND_TYPE } from '#shared/sessionHazardCommands'
import { BUILD_TERRAIN_VOXEL_COMMAND_TYPE } from '#shared/sessionTerrainCommands'
import {
  useSessionMapSceneCommands,
  type SessionMapSceneCommandDispatcherLike,
} from '~/composables/map-editor/useSessionMapSceneCommands'
import type { TabletopMap } from '~/types/map'

const SESSION_ID = parseSessionId('session_abcdefghijkl')
const GM_CLIENT_ID = parseClientId('client_gmclient01')
const GM_KEY = parseGmKey('gmkey_abcdefghijklmnopqrstuvwxyz')
const REVISION_1 = parseSessionRevision(1)
const REVISION_2 = parseSessionRevision(2)

const gmIdentity = (): Extract<SessionClientIdentity, { role: 'gm' }> => ({
  schemaVersion: SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  role: 'gm',
  sessionId: SESSION_ID,
  clientId: GM_CLIENT_ID,
  gmKey: GM_KEY,
  rememberedAt: '2026-05-26T12:00:00.000Z',
  lastSeenRevision: REVISION_1,
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena-map',
  name: 'Arena Map',
  dimensions: { x: 8, y: 3, z: 8 },
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
      id: 'token-trainer',
      sheetKind: 'trainer',
      sheetSlug: 'ash',
      position: { x: 2, y: 0, z: 2 },
      facing: 'north-west',
      turned: true,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
})

const createDispatcher = (identity: SessionClientIdentity | null = gmIdentity()) => {
  const commands: SessionCommandEnvelope[] = []
  const dispatcher: SessionMapSceneCommandDispatcherLike = {
    identity: ref(identity),
    socket: {
      lastKnownRevision: ref<SessionRevision | null>(REVISION_2),
    },
    dispatchCommand: vi.fn((command: SessionCommandEnvelope) => {
      commands.push(command)
      return {
        dispatched: true,
        message: { command },
        sendResult: { ok: true, delivery: 'sent', message: { command } },
      } as never
    }),
  }
  return { dispatcher, commands }
}

describe('useSessionMapSceneCommands', () => {
  it('builds sheet/token scene commands with the current session actor and revision', () => {
    const { dispatcher, commands } = createDispatcher()
    const sceneCommands = useSessionMapSceneCommands({
      enabled: ref(true),
      map: ref(mapFixture()),
      mapSlug: 'arena-map',
      session: dispatcher,
      createOpId: () => parseOpId('op_modifyhp01'),
      now: () => '2026-05-26T12:01:00.000Z',
    })

    const result = sceneCommands.dispatchModifyHp({ id: 'token-pikachu', currentHp: 17, injuries: 1 })

    expect(result.dispatched).toBe(true)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({
      schemaVersion: 1,
      type: MODIFY_HP_COMMAND_TYPE,
      sessionId: SESSION_ID,
      actor: { role: 'gm', clientId: GM_CLIENT_ID },
      opId: 'op_modifyhp01',
      baseRevision: REVISION_2,
      payload: { tokenId: 'token-pikachu', currentHp: 17, injuries: 1 },
      metadata: {
        clientIssuedAt: '2026-05-26T12:01:00.000Z',
        attributes: { source: 'map-scene-modify-hp', mapSlug: 'arena-map' },
      },
    })
    expect(commands[0]?.scopes).toEqual([
      {
        lane: 'token',
        field: 'hp',
        mapSlug: 'arena-map',
        resource: {
          kind: 'token',
          tokenId: 'token-pikachu',
          mapSlug: 'arena-map',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
        },
      },
      {
        lane: 'sheet',
        field: 'hp',
        resource: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu' },
      },
    ])
  })

  it('routes token delete, send-out, initiative, hazard, and terrain events as small commands without mutating the map ref', () => {
    const { dispatcher, commands } = createDispatcher()
    const map = mapFixture()
    let opIndex = 0
    const opIds = ['op_delete001', 'op_sendout01', 'op_nextinit1', 'op_hazard001', 'op_terrain01']
    const sceneCommands = useSessionMapSceneCommands({
      enabled: ref(true),
      map: ref(map),
      mapSlug: 'arena-map',
      session: dispatcher,
      createOpId: () => parseOpId(opIds[opIndex++]!),
      createPlacementId: () => 'token-eevee',
      now: () => '2026-05-26T12:02:00.000Z',
    })

    expect(sceneCommands.dispatchDeletePokemon('token-pikachu').dispatched).toBe(true)
    expect(sceneCommands.dispatchSendOutPokemon({
      trainerId: 'token-trainer',
      pokemonSlug: 'eevee',
      position: { x: 3, y: 0, z: 3 },
    }).dispatched).toBe(true)
    expect(sceneCommands.dispatchNextInitiative().dispatched).toBe(true)
    expect(sceneCommands.dispatchPlaceHazard({ kind: 'toxic-spikes', x: 4, y: 0, z: 4, layer: 2 }).dispatched).toBe(true)
    expect(sceneCommands.dispatchPlaceVoxel({ x: 5, y: 0, z: 5, materialId: 'stone', ghost: true }).dispatched).toBe(true)

    expect(commands.map((command) => command.type)).toEqual([
      DELETE_TOKEN_COMMAND_TYPE,
      SEND_OUT_POKEMON_COMMAND_TYPE,
      NEXT_INITIATIVE_COMMAND_TYPE,
      PLACE_HAZARD_COMMAND_TYPE,
      BUILD_TERRAIN_VOXEL_COMMAND_TYPE,
    ])
    expect(commands[1]?.payload).toEqual({
      trainerTokenId: 'token-trainer',
      pokemonSlug: 'eevee',
      tokenId: 'token-eevee',
      position: { x: 3, y: 0, z: 3 },
      facing: 'south-east',
    })
    expect(commands[1]?.scopes).toHaveLength(2)
    expect(commands[2]?.scopes).toEqual([{ lane: 'initiative', field: 'initiative', mapSlug: 'arena-map' }])
    expect(commands[3]?.payload).toEqual({
      mapSlug: 'arena-map',
      hazard: { kind: 'toxic-spikes', x: 4, y: 0, z: 4, layer: 2 },
    })
    expect(commands[4]?.payload).toEqual({
      mapSlug: 'arena-map',
      voxel: { x: 5, y: 0, z: 5, materialId: 'stone', ghost: true },
    })
    expect(map.placements.map((placement) => placement.id)).toEqual(['token-pikachu', 'token-trainer'])
    expect(map.hazards).toEqual([])
    expect(map.voxels).toEqual([])
    expect(map.initiative).toEqual({ activeId: null, round: 1 })
  })

  it('routes targeted action menu selections through session action commands', () => {
    const { dispatcher, commands } = createDispatcher()
    const sceneCommands = useSessionMapSceneCommands({
      enabled: ref(true),
      map: ref(mapFixture()),
      mapSlug: 'arena-map',
      session: dispatcher,
      createOpId: () => parseOpId('op_maneuver1'),
    })

    const result = sceneCommands.dispatchUseManeuver({
      id: 'token-pikachu',
      maneuverName: 'Trip',
      targetTokenId: 'token-trainer',
    })

    expect(result.dispatched).toBe(true)
    expect(commands[0]).toMatchObject({
      type: USE_MANEUVER_COMMAND_TYPE,
      payload: {
        tokenId: 'token-pikachu',
        maneuverName: 'Trip',
        targetTokenId: 'token-trainer',
      },
    })
    expect(commands[0]?.scopes.map((scope) => scope.field)).toEqual(['maneuver', 'maneuver'])
  })

  it('fails closed without mutating or dispatching when session mode or identity is missing', () => {
    const disabled = createDispatcher()
    const disabledSceneCommands = useSessionMapSceneCommands({
      enabled: ref(false),
      map: ref(mapFixture()),
      mapSlug: 'arena-map',
      session: disabled.dispatcher,
    })

    expect(disabledSceneCommands.dispatchDeletePokemon('token-pikachu')).toMatchObject({
      dispatched: false,
      reason: 'not-session-mode',
    })
    expect(disabled.commands).toHaveLength(0)

    const missingIdentity = createDispatcher(null)
    const missingIdentitySceneCommands = useSessionMapSceneCommands({
      enabled: ref(true),
      map: ref(mapFixture()),
      mapSlug: 'arena-map',
      session: missingIdentity.dispatcher,
    })

    expect(missingIdentitySceneCommands.dispatchDeletePokemon('token-pikachu')).toMatchObject({
      dispatched: false,
      reason: 'missing-session-identity',
    })
    expect(missingIdentity.commands).toHaveLength(0)
  })

  it('rejects stale local scene inputs that no longer resolve to authoritative map placements', () => {
    const { dispatcher, commands } = createDispatcher()
    const sceneCommands = useSessionMapSceneCommands({
      enabled: ref(true),
      map: ref(mapFixture()),
      mapSlug: 'arena-map',
      session: dispatcher,
    })

    expect(sceneCommands.dispatchModifyHp({ id: 'missing-token', currentHp: 1 })).toMatchObject({
      dispatched: false,
      reason: 'missing-placement',
    })
    expect(sceneCommands.dispatchUseManeuver({ id: 'token-pikachu', maneuverName: '   ' })).toMatchObject({
      dispatched: false,
      reason: 'missing-action-name',
    })
    expect(commands).toHaveLength(0)
  })
})
