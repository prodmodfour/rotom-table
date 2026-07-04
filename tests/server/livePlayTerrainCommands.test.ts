import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type BuildTerrainVoxelLivePlayCommand,
  type RemoveTerrainVoxelLivePlayCommand,
} from '#shared/livePlayCommands'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { LIVE_PLAY_TERRAIN_RENDER_INVALIDATION_REASONS } from '~~/server/livePlay/terrainDomain'
import { executeLivePlayTerrainCommandUseCase } from '~~/server/useCases/applyLivePlayTerrainCommand'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import type { MapVoxelV2, TabletopMap } from '~/types/map'

const baseCell = { x: 1, y: 0, z: 2 }

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {},
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const buildTerrainCommand = (
  overrides: Partial<BuildTerrainVoxelLivePlayCommand> = {},
): BuildTerrainVoxelLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_buildterrain1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
  scopes: [{ kind: 'map', lane: 'terrain' }],
  payload: {
    voxel: {
      ...baseCell,
      materialId: 'shallow_water',
      ghost: true,
      blocksMovement: false,
      tags: ['pool'],
    },
  },
  ...overrides,
})

const removeTerrainCommand = (
  overrides: Partial<RemoveTerrainVoxelLivePlayCommand> = {},
): RemoveTerrainVoxelLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_remterrain1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
  scopes: [{ kind: 'map', lane: 'terrain' }],
  payload: { cell: baseCell },
  ...overrides,
})

const createHarness = (initialMap: TabletopMap = baseMap()) => {
  let storedMap = initialMap
  const writes: TabletopMap[] = []
  const published: unknown[] = []
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore: createInMemoryLivePlayOpStore(),
    queue: createInProcessMapWriteQueue(),
    ...acceptedRealtimeTestHooks(published),
  })
  const mapRepository = {
    getBySlug: vi.fn((slug: string) => (slug === 'arena' ? storedMap : null)),
    applyLivePlayUpdate: vi.fn((input: { slug: string; expectedRevision: number; nextMap: TabletopMap }) => {
      if (input.slug !== 'arena' || input.expectedRevision !== storedMap.revision) return 'stale' as const
      storedMap = {
        ...input.nextMap,
        revision: input.expectedRevision + 1,
      }
      writes.push(storedMap)
      return 'applied' as const
    }),
  }
  const deps = {
    commandExecutor: executor,
    mapRepository,
    database: { withTransaction: <T>(work: () => T) => work() },
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => 2_000),
  }

  return {
    deps,
    writes,
    published,
    get storedMap() {
      return storedMap
    },
  }
}

type SingleLivePlayTerrainCommand = BuildTerrainVoxelLivePlayCommand | RemoveTerrainVoxelLivePlayCommand

const execute = (harness: ReturnType<typeof createHarness>, command: SingleLivePlayTerrainCommand, role: 'gm' | 'player' = 'gm') =>
  executeLivePlayTerrainCommandUseCase({
    role,
    command,
    clientId: `${role}-client`,
    expectedType: command.type,
  }, harness.deps)

const acceptedPatches = (response: Awaited<ReturnType<typeof execute>>) => (
  response.result.ok && !('duplicate' in response.result) ? response.result.patches : []
)

describe('live-play terrain commands', () => {
  it('builds terrain through the authoritative executor and returns renderer invalidation metadata', async () => {
    const harness = createHarness()

    const response = await execute(harness, buildTerrainCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.revision).toBe(5)
    expect(harness.storedMap.voxels).toHaveLength(1)
    expect(harness.storedMap.voxels[0]).toMatchObject({
      ...baseCell,
      materialId: 'shallow_water',
      ghost: true,
      blocksMovement: false,
      tags: ['pool'],
    })
    expect(response.voxels?.[0]).toMatchObject({ ...baseCell, materialId: 'shallow_water' })
    expect(acceptedPatches(response)).toEqual([
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN,
        revision: 5,
        scopes: [{ kind: 'map', lane: 'terrain' }],
        payload: {
          command: LIVE_PLAY_COMMAND_TYPES.BUILD_TERRAIN_VOXEL,
          cell: baseCell,
          previous: null,
          current: expect.objectContaining({ ...baseCell, materialId: 'shallow_water' }),
          built: expect.objectContaining({ ...baseCell, materialId: 'shallow_water' }),
          rendererInvalidation: LIVE_PLAY_TERRAIN_RENDER_INVALIDATION_REASONS,
        },
      }),
    ])
    expect(harness.published).toEqual([
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', opId: 'op_buildterrain1', revision: 5 }),
    ])
  })

  it('removes terrain through the authoritative executor', async () => {
    const existing: MapVoxelV2 = { ...baseCell, materialId: 'meadow_grass', color: '#33aa44' }
    const harness = createHarness(baseMap({ voxels: [existing] }))

    const response = await execute(harness, removeTerrainCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.voxels).toEqual([])
    expect(acceptedPatches(response)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_TERRAIN,
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.REMOVE_TERRAIN_VOXEL,
        previous: existing,
        current: null,
        removed: existing,
        rendererInvalidation: LIVE_PLAY_TERRAIN_RENDER_INVALIDATION_REASONS,
      },
    })
  })

  it('rejects player commands, occupied cells, invalid materials, and no-op requests without writing', async () => {
    const existing: MapVoxelV2 = { ...baseCell, materialId: 'meadow_grass' }
    const harness = createHarness(baseMap({
      voxels: [existing],
      placements: [
        { id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pikachu', position: { x: 2, y: 0, z: 2 } },
      ],
    }))

    const playerResult = await execute(harness, buildTerrainCommand({ opId: 'op_playerterr1' }), 'player')
    expect(playerResult.result).toMatchObject({
      ok: false,
      reason: 'unauthorized',
      currentRevision: 4,
      message: 'Only GMs can edit terrain voxels',
    })

    const occupied = await execute(harness, buildTerrainCommand({
      opId: 'op_occterrain1',
      payload: { voxel: { x: 2, y: 0, z: 2, materialId: 'meadow_grass' } },
    }))
    expect(occupied.result).toMatchObject({ ok: false, reason: 'conflict', currentRevision: 4 })
    expect(occupied.result.ok ? '' : occupied.result.message).toContain('a token occupies that cell')

    const invalidMaterial = await execute(harness, buildTerrainCommand({
      opId: 'op_badterrain1',
      payload: { voxel: { x: 3, y: 0, z: 2, materialId: 'reinforced_glass' } },
    }))
    expect(invalidMaterial.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 4 })
    expect(invalidMaterial.result.ok ? '' : invalidMaterial.result.message).toContain('not available to the terrain builder palette')

    const noOp = await execute(harness, buildTerrainCommand({
      opId: 'op_noopterrain1',
      payload: { voxel: existing },
    }))
    expect(noOp.result).toMatchObject({ ok: false, reason: 'no-op', currentRevision: 4 })

    expect(harness.writes).toEqual([])
    expect(harness.published).toEqual([])
  })

  it('rejects stale same-cell terrain conflicts without overwriting accepted state', async () => {
    const harness = createHarness()
    const first = await execute(harness, buildTerrainCommand({ opId: 'op_terrainfirst' }))
    expect(first.result).toMatchObject({ ok: true, revision: 5 })

    const stale = await execute(harness, removeTerrainCommand({
      opId: 'op_staleterrain',
      baseRevision: 4,
    }))

    expect(stale.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 5,
    })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.voxels).toHaveLength(1)
    expect(harness.storedMap.voxels[0]).toMatchObject({ ...baseCell, materialId: 'shallow_water' })
  })
})
