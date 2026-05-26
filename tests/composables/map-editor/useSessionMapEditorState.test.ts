import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { parseSessionId } from '#shared/sessionIdentity'
import { parseMapRevision, parseSessionRevision } from '#shared/sessionRevisions'
import { createAuthoritativeSessionMapState, createAuthoritativeSessionState } from '#shared/sessionState'
import { SESSION_MESSAGE_SCHEMA_VERSION, type SessionServerMessage } from '#shared/sessionMessages'
import {
  useSessionMapEditorState,
  type SessionMapEditorSocket,
} from '~/composables/map-editor/useSessionMapEditorState'
import type { TabletopMap } from '~/types/map'

const SESSION_ID = parseSessionId('session_abcdefghijkl')
const REVISION_1 = parseSessionRevision(1)
const REVISION_2 = parseSessionRevision(2)
const MAP_REVISION_1 = parseMapRevision(1)

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
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
  ...overrides,
})

const serverMessage = (message: SessionServerMessage): SessionServerMessage => message

const patchMessage = (
  eventType: string,
  payload: Record<string, unknown>,
  revision = REVISION_1,
): SessionServerMessage => serverMessage({
  schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
  type: 'patch',
  direction: 'server',
  sessionId: SESSION_ID,
  event: {
    eventType,
    revision,
    scopes: [],
    payload,
  },
} as SessionServerMessage)

describe('useSessionMapEditorState', () => {
  it('keeps local editable map mode and session-authoritative map mode separate', async () => {
    const localMap = ref(mapFixture())
    const enabled = ref(false)
    const state = useSessionMapEditorState({ enabled, localMap, mapSlug: 'arena-map' })

    expect(state.map.value).toBe(localMap.value)
    localMap.value.placements[0]!.position = { x: 2, y: 0, z: 1 }
    expect(state.map.value?.placements[0]?.position).toEqual({ x: 2, y: 0, z: 1 })

    enabled.value = true
    await nextTick()

    expect(state.map.value).not.toBe(localMap.value)
    expect(state.sessionMap.value).toEqual(localMap.value)
    state.map.value!.placements[0]!.position = { x: 4, y: 0, z: 4 }

    expect(state.sessionMap.value?.placements[0]?.position).toEqual({ x: 4, y: 0, z: 4 })
    expect(localMap.value.placements[0]?.position).toEqual({ x: 2, y: 0, z: 1 })
    expect(state.source.value).toBe('local-seed')

    enabled.value = false
    await nextTick()

    expect(state.map.value).toBe(localMap.value)
    expect(state.map.value?.placements[0]?.position).toEqual({ x: 2, y: 0, z: 1 })
  })

  it('adopts visible authoritative snapshot map documents without mutating the local editable map', async () => {
    const localMap = ref(mapFixture({ name: 'Local copy' }))
    const enabled = ref(true)
    const state = useSessionMapEditorState({ enabled, localMap, mapSlug: 'arena-map' })
    await nextTick()

    const authoritativeMap = mapFixture({
      name: 'Authoritative arena',
      placements: [
        {
          id: 'token-pikachu',
          sheetKind: 'pokemon',
          sheetSlug: 'pikachu',
          position: { x: 5, y: 0, z: 5 },
          facing: 'north-west',
          turned: true,
        },
      ],
    })
    const snapshot = createAuthoritativeSessionState({
      sessionId: SESSION_ID,
      revision: REVISION_2,
      selectedMapSlug: 'arena-map',
      maps: [createAuthoritativeSessionMapState({
        mapSlug: 'arena-map',
        revision: MAP_REVISION_1,
        document: authoritativeMap,
      })],
      createdAt: '2026-05-26T12:00:00.000Z',
    })

    const applied = state.applySessionSnapshot(serverMessage({
      schemaVersion: SESSION_MESSAGE_SCHEMA_VERSION,
      type: 'snapshot',
      direction: 'server',
      sessionId: SESSION_ID,
      reason: 'reconnect',
      currentRevision: REVISION_2,
      snapshot,
      replayAvailable: false,
    } as SessionServerMessage) as Extract<SessionServerMessage, { readonly type: 'snapshot' }>)

    expect(applied).toBe(true)
    expect(state.map.value).toEqual(authoritativeMap)
    expect(state.map.value).not.toBe(authoritativeMap)
    expect(state.source.value).toBe('snapshot')
    expect(state.sessionRevision.value).toBe(REVISION_2)
    expect(state.mapRevision.value).toBe(MAP_REVISION_1)
    expect(localMap.value.name).toBe('Local copy')
    expect(localMap.value.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
  })

  it('applies authoritative token, terrain, hazard, and initiative patches to the session map only', async () => {
    const localMap = ref(mapFixture({
      voxels: [{ x: 0, y: 0, z: 0, materialId: 'grass' }],
      hazards: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
    }))
    const enabled = ref(true)
    const state = useSessionMapEditorState({ enabled, localMap, mapSlug: 'arena-map' })
    await nextTick()

    state.handleServerMessage(patchMessage('tokenMoved', {
      tokenId: 'token-pikachu',
      mapSlug: 'arena-map',
      from: { x: 1, y: 0, z: 1 },
      to: { x: 3, y: 0, z: 1 },
    }))
    state.handleServerMessage(patchMessage('tokenTurned', {
      tokenId: 'token-pikachu',
      mapSlug: 'arena-map',
      from: 'south-east',
      to: 'north-west',
      turned: true,
    }))
    state.handleServerMessage(patchMessage('terrainVoxelsUpdated', {
      mapSlug: 'arena-map',
      command: 'buildTerrainVoxel',
      cell: { x: 2, y: 0, z: 2 },
      previous: null,
      current: { x: 2, y: 0, z: 2, materialId: 'stone' },
    }))
    state.handleServerMessage(patchMessage('hazardsUpdated', {
      mapSlug: 'arena-map',
      command: 'placeHazard',
      cell: { x: 1, y: 0, z: 2 },
      previous: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
      current: [{ kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2 }],
      removed: [],
    }))
    state.handleServerMessage(patchMessage('initiativeUpdated', {
      mapSlug: 'arena-map',
      command: 'setInitiative',
      previous: { activeId: null, round: 1, entries: [{ tokenId: 'token-pikachu', initiative: null }] },
      current: { activeId: 'token-pikachu', round: 2, entries: [{ tokenId: 'token-pikachu', initiative: 12 }] },
      changedTokenIds: ['token-pikachu'],
    }, REVISION_2))

    expect(state.map.value?.placements[0]).toMatchObject({
      position: { x: 3, y: 0, z: 1 },
      facing: 'north-west',
      turned: true,
      initiative: 12,
    })
    expect(state.map.value?.voxels).toContainEqual({ x: 2, y: 0, z: 2, materialId: 'stone' })
    expect(state.map.value?.hazards).toEqual([{ kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2 }])
    expect(state.map.value?.initiative).toEqual({ activeId: 'token-pikachu', round: 2 })
    expect(state.lastAppliedPatch.value).toEqual({
      eventType: 'initiativeUpdated',
      revision: REVISION_2,
      mapSlug: 'arena-map',
    })
    expect(state.source.value).toBe('patch')

    expect(localMap.value.placements[0]).toMatchObject({
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
    })
    expect(localMap.value.placements[0]).not.toHaveProperty('initiative')
    expect(localMap.value.voxels).toEqual([{ x: 0, y: 0, z: 0, materialId: 'grass' }])
    expect(localMap.value.hazards).toEqual([{ kind: 'spikes', x: 1, y: 0, z: 2 }])
  })

  it('ignores patches for other maps and can subscribe to an existing session socket', async () => {
    const localMap = ref(mapFixture())
    const enabled = ref(true)
    const handlers: Array<(message: SessionServerMessage, raw?: string) => void> = []
    const socket: SessionMapEditorSocket = {
      addMessageHandler: vi.fn((handler) => {
        handlers.push(handler)
        return () => {
          const index = handlers.indexOf(handler)
          if (index >= 0) handlers.splice(index, 1)
        }
      }),
    }
    const state = useSessionMapEditorState({ enabled, localMap, mapSlug: 'arena-map', socket })
    await nextTick()

    expect(socket.addMessageHandler).toHaveBeenCalledTimes(1)
    handlers[0]?.(patchMessage('tokenMoved', {
      tokenId: 'token-pikachu',
      mapSlug: 'other-map',
      to: { x: 5, y: 0, z: 5 },
    }))

    expect(state.map.value?.placements[0]?.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(state.lastIgnoredMessage.value).toContain('other-map')
  })
})
