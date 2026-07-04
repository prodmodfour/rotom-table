import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type EditHazardsLivePlayCommand,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_BATCH_MAX_HAZARD_CELLS } from '#shared/livePlayBatchCommands'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  executeLivePlayMapEffectsCommandUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/applyLivePlayMapEffectsCommand', () => ({
  executeLivePlayMapEffectsCommandUseCase: mocks.executeLivePlayMapEffectsCommandUseCase,
}))

const editHazardsRoute = (await import('../../server/api/maps/hazards/edit.post')).default

type EditHazardsRouteHandler = EventHandler<EventHandlerRequest, unknown>

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

const editHazardsCommand = (
  overrides: Partial<EditHazardsLivePlayCommand> = {},
): EditHazardsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routeedhz1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
  scopes: [{ kind: 'map', lane: 'hazards', cell: { x: 1, y: 0, z: 2 } }],
  payload: {
    operations: [{ action: 'upsert', hazard: { kind: 'spikes', x: 1, y: 0, z: 2 } }],
  },
  ...overrides,
})

const invokeRoute = async (
  handler: EditHazardsRouteHandler,
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

describe('edit hazards API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes GM editHazards commands through the live-play map-effects executor', async () => {
    const map = mapFixture()
    const command = { ...editHazardsCommand(), clientId: 'gm-client' }
    mocks.executeLivePlayMapEffectsCommandUseCase.mockResolvedValue({
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
      hazards: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
    })

    await expect(invokeRoute(editHazardsRoute, {
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
      hazards: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
    })

    expect(mocks.executeLivePlayMapEffectsCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command,
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
    })
  })

  it('returns terminal rejections for invalid or oversized editHazards payloads', async () => {
    const oversizedCommand = editHazardsCommand({
      opId: 'op_routeedhz2',
      scopes: [{ kind: 'map', lane: 'hazards' }],
      payload: {
        operations: Array.from({ length: LIVE_PLAY_BATCH_MAX_HAZARD_CELLS + 1 }, (_, x) => ({
          action: 'upsert' as const,
          hazard: { kind: 'spikes' as const, x, y: 0, z: 0 },
        })),
      },
    })
    mocks.executeLivePlayMapEffectsCommandUseCase.mockResolvedValue({
      result: {
        ok: false,
        opId: oversizedCommand.opId,
        mapSlug: oversizedCommand.mapSlug,
        reason: 'invalid',
        message: 'editHazards payload is invalid: payload.operations must contain at most 128 hazard cell operations.',
        currentRevision: 4,
      },
    })

    await expect(invokeRoute(editHazardsRoute, {
      role: 'gm',
      body: oversizedCommand,
    })).resolves.toEqual({
      ok: false,
      opId: oversizedCommand.opId,
      mapSlug: oversizedCommand.mapSlug,
      reason: 'invalid',
      message: 'editHazards payload is invalid: payload.operations must contain at most 128 hazard cell operations.',
      currentRevision: 4,
    })

    expect(mocks.executeLivePlayMapEffectsCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command: oversizedCommand,
      clientId: undefined,
      expectedType: LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
    })
  })
})
