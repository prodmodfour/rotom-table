import { describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayPatch,
} from '#shared/livePlayCommands'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'
import type { TabletopMap } from '~/types/map'

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  voxels: [{ x: 0, y: 0, z: 0, materialId: 'meadow_grass' }],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'token-a',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
      initiative: 10,
    },
    {
      id: 'token-b',
      sheetKind: 'trainer',
      sheetSlug: 'brock',
      position: { x: 2, y: 0, z: 2 },
      initiative: 5,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  updatedAt: 100,
  ...overrides,
})

const patchBase = (type: LivePlayPatch['type'], payload: unknown): LivePlayPatch => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  type,
  mapSlug: 'arena',
  revision: 5,
  scopes: [{ kind: 'map', lane: 'metadata' }],
  payload,
})

describe('live-play patch application', () => {
  it('applies token movement patches without replacing unrelated terrain arrays', () => {
    const map = baseMap()
    const originalVoxels = map.voxels

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_POSITION, {
          placementId: 'token-a',
          position: { x: 4, y: 0, z: 3 },
          facing: 'north-east',
          turned: false,
          movementLogEntry: {
            at: 200,
            userId: 'token-a',
            userName: 'Pika',
            from: { x: 1, y: 0, z: 1 },
            to: { x: 4, y: 0, z: 3 },
          },
        }),
        scopes: [{ kind: 'token', placementId: 'token-a', field: 'position' }],
      }],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5, terrainChanged: false })
    expect(map.revision).toBe(5)
    expect(map.placements[0]).toMatchObject({
      id: 'token-a',
      position: { x: 4, y: 0, z: 3 },
      facing: 'north-east',
    })
    expect(map.voxels).toBe(originalVoxels)
    expect(map.metadata?.movementLog).toEqual([
      expect.objectContaining({ userId: 'token-a', to: { x: 4, y: 0, z: 3 } }),
    ])
  })

  it('applies initiative patches and appends initiative log metadata', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE, {
        command: 'nextInitiative',
        previous: {
          activeId: null,
          round: 1,
          entries: [
            { tokenId: 'token-a', initiative: 10 },
            { tokenId: 'token-b', initiative: 5 },
          ],
        },
        current: {
          activeId: 'token-a',
          round: 2,
          entries: [
            { tokenId: 'token-a', initiative: 12 },
            { tokenId: 'token-b', initiative: null },
          ],
        },
        changedTokenIds: ['token-a', 'token-b'],
        logEntry: { at: 300, userId: 'token-a', actionName: 'Initiative' },
      })],
    })

    expect(result.ok).toBe(true)
    expect(map.initiative).toEqual({ activeId: 'token-a', round: 2 })
    expect(map.placements).toEqual([
      expect.objectContaining({ id: 'token-a', initiative: 12 }),
      expect.objectContaining({ id: 'token-b', initiative: null }),
    ])
    expect(map.metadata?.initiativeLog).toEqual([expect.objectContaining({ userId: 'token-a' })])
  })

  it('applies tracked move usage patches and appends move log metadata', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE, {
          placementId: 'token-a',
          moveName: 'Thunderbolt',
          moveKey: 'thunderbolt',
          frequency: 'scene',
          tracking: 'map',
          usage: { uses: 1 },
          moveLogEntry: {
            at: 400,
            userId: 'token-a',
            userName: 'Pika',
            moveName: 'Thunderbolt',
            lines: ['Pika used Thunderbolt.', 'Frequency: Scene'],
          },
        }),
        scopes: [{ kind: 'token', placementId: 'token-a', field: 'moveUsage' }],
      }],
    })

    expect(result.ok).toBe(true)
    expect(map.moveUsage?.byPlacementId['token-a']?.thunderbolt).toMatchObject({
      moveName: 'Thunderbolt',
      frequency: 'scene',
      uses: 1,
    })
    expect(map.metadata?.moveLog).toEqual([
      expect.objectContaining({ userId: 'token-a', moveName: 'Thunderbolt' }),
    ])
  })

  it('appends move log metadata for sheet-tracked move usage patches', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE, {
          placementId: 'token-a',
          moveName: 'Rest',
          moveKey: 'rest',
          frequency: 'daily',
          tracking: 'sheet',
          moveLogEntry: {
            at: 450,
            userId: 'token-a',
            userName: 'Pika',
            moveName: 'Rest',
            lines: ['Pika used Rest.', 'Frequency: Daily'],
          },
        }),
        scopes: [{ kind: 'token', placementId: 'token-a', field: 'moveUsage' }],
      }],
    })

    expect(result.ok).toBe(true)
    expect(map.moveUsage).toBeUndefined()
    expect(map.metadata?.moveLog).toEqual([
      expect.objectContaining({ userId: 'token-a', moveName: 'Rest' }),
    ])
  })

  it('applies terrain patches to one voxel cell', () => {
    const map = baseMap()
    const originalVoxels = map.voxels

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN, {
        command: 'buildTerrainVoxel',
        cell: { x: 1, y: 0, z: 1 },
        previous: null,
        current: { x: 1, y: 0, z: 1, materialId: 'shallow_water' },
      })],
    })

    expect(result).toMatchObject({ ok: true, applied: true, terrainChanged: true })
    expect(map.voxels).toBe(originalVoxels)
    expect(map.voxels).toEqual([
      { x: 0, y: 0, z: 0, materialId: 'meadow_grass' },
      { x: 1, y: 0, z: 1, materialId: 'shallow_water' },
    ])
  })

  it('applies sent-out Pokémon placement patches', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.MAP_PLACEMENTS, {
        command: 'sendOutPokemon',
        trainerId: 'token-b',
        placementId: 'sent-out-eevee',
        previous: null,
        current: {
          id: 'sent-out-eevee',
          sheetKind: 'pokemon',
          sheetSlug: 'eevee',
          position: { x: 3, y: 0, z: 2 },
          facing: 'south-east',
          turned: false,
        },
      })],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map.placements.at(-1)).toMatchObject({
      id: 'sent-out-eevee',
      sheetKind: 'pokemon',
      sheetSlug: 'eevee',
      position: { x: 3, y: 0, z: 2 },
    })
  })

  it('applies active scene patches', () => {
    const map = baseMap()

    const result = applyLivePlayPatchesToMap({
      map,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [{
        ...patchBase(LIVE_PLAY_PATCH_TYPES.MAP_SCENE, {
          command: 'setScene',
          previous: null,
          current: { name: 'Moonlit Rooftop', startedAt: 200 },
        }),
        scopes: [{ kind: 'map', lane: 'scene' }],
      }],
    })

    expect(result).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(map.activeScene).toEqual({ name: 'Moonlit Rooftop', startedAt: 200 })
  })

  it('requests reconciliation for unknown patch types and revision gaps', () => {
    const unknown = applyLivePlayPatchesToMap({
      map: baseMap(),
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [patchBase('unknown.patch' as LivePlayPatch['type'], {})],
    })
    expect(unknown).toMatchObject({ ok: false, reason: 'unknown-patch' })

    const gap = applyLivePlayPatchesToMap({
      map: baseMap(),
      mapSlug: 'arena',
      previousRevision: 3,
      revision: 5,
      patches: [patchBase(LIVE_PLAY_PATCH_TYPES.TOKEN_FACING, { placementId: 'token-a', facing: 'north-west' })],
    })
    expect(gap).toMatchObject({ ok: false, reason: 'revision-gap' })
  })
})
