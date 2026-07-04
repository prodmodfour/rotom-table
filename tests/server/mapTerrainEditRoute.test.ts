import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type EditTerrainVoxelsLivePlayCommand,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS } from '#shared/livePlayBatchCommands'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  executeLivePlayTerrainCommandUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/applyLivePlayTerrainCommand', () => ({
  executeLivePlayTerrainCommandUseCase: mocks.executeLivePlayTerrainCommandUseCase,
}))

const editTerrainRoute = (await import('../../server/api/maps/terrain/edit.post')).default

type EditTerrainRouteHandler = EventHandler<EventHandlerRequest, unknown>

const mapFixture = (): TabletopMap => ({
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
})

const editTerrainCommand = (
  overrides: Partial<EditTerrainVoxelsLivePlayCommand> = {},
): EditTerrainVoxelsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routeetvn1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
  scopes: [{ kind: 'map', lane: 'terrain', cell: { x: 1, y: 0, z: 2 } }],
  payload: {
    operations: [{ action: 'upsert', voxel: { x: 1, y: 0, z: 2, materialId: 'meadow_grass' } }],
  },
  ...overrides,
})

const invokeRoute = async (
  handler: EditTerrainRouteHandler,
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

describe('edit terrain voxels API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes GM editTerrainVoxels commands through the live-play terrain executor', async () => {
    const map = mapFixture()
    const command = { ...editTerrainCommand(), clientId: 'gm-client' }
    mocks.executeLivePlayTerrainCommandUseCase.mockResolvedValue({
      result: {
        ok: true,
        opId: command.opId,
        mapSlug: command.mapSlug,
        previousRevision: 4,
        revision: 5,
        patches: [],
      },
      path: 'data/maps/arena.json',
      map,
      voxels: [{ x: 1, y: 0, z: 2, materialId: 'meadow_grass' }],
    })

    await expect(invokeRoute(editTerrainRoute, {
      role: 'gm',
      body: command,
    })).resolves.toEqual({
      ok: true,
      opId: command.opId,
      mapSlug: command.mapSlug,
      previousRevision: 4,
      revision: 5,
      patches: [],
      path: 'data/maps/arena.json',
      map,
      voxels: [{ x: 1, y: 0, z: 2, materialId: 'meadow_grass' }],
    })

    expect(mocks.executeLivePlayTerrainCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command,
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
    })
  })

  it('returns terminal rejections for invalid or oversized editTerrainVoxels payloads', async () => {
    const oversizedCommand = editTerrainCommand({
      opId: 'op_routeetvno',
      scopes: [{ kind: 'map', lane: 'terrain' }],
      payload: {
        operations: Array.from({ length: LIVE_PLAY_BATCH_MAX_TERRAIN_VOXELS + 1 }, (_, x) => ({
          action: 'upsert' as const,
          voxel: { x, y: 0, z: 0, materialId: 'meadow_grass' },
        })),
      },
    })
    mocks.executeLivePlayTerrainCommandUseCase.mockResolvedValue({
      result: {
        ok: false,
        opId: oversizedCommand.opId,
        mapSlug: oversizedCommand.mapSlug,
        reason: 'invalid',
        message: 'editTerrainVoxels payload is invalid: payload.operations must contain at most 256 terrain voxel operations.',
        currentRevision: 4,
      },
    })

    await expect(invokeRoute(editTerrainRoute, {
      role: 'gm',
      body: oversizedCommand,
    })).resolves.toEqual({
      ok: false,
      opId: oversizedCommand.opId,
      mapSlug: oversizedCommand.mapSlug,
      reason: 'invalid',
      message: 'editTerrainVoxels payload is invalid: payload.operations must contain at most 256 terrain voxel operations.',
      currentRevision: 4,
    })

    expect(mocks.executeLivePlayTerrainCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command: oversizedCommand,
      clientId: undefined,
      expectedType: LIVE_PLAY_COMMAND_TYPES.EDIT_TERRAIN_VOXELS,
    })
  })
})
