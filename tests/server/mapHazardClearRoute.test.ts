import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ClearHazardsLivePlayCommand,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_BATCH_MAX_HAZARD_CELLS } from '#shared/livePlayBatchCommands'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  executeLivePlayMapEffectsCommandUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/applyLivePlayMapEffectsCommand', () => ({
  executeLivePlayMapEffectsCommandUseCase: mocks.executeLivePlayMapEffectsCommandUseCase,
}))

const clearHazardsRoute = (await import('../../server/api/maps/hazards/clear.post')).default

type ClearHazardsRouteHandler = EventHandler<EventHandlerRequest, unknown>

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

const clearHazardsCommand = (
  overrides: Partial<ClearHazardsLivePlayCommand> = {},
): ClearHazardsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routeclear1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
  scopes: [{ kind: 'map', lane: 'hazards' }],
  payload: { mode: 'all' },
  ...overrides,
})

const invokeRoute = async (
  handler: ClearHazardsRouteHandler,
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

describe('clear hazards API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes GM clearHazards commands through the live-play map-effects executor', async () => {
    const map = mapFixture()
    const command = { ...clearHazardsCommand(), clientId: 'gm-client' }
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
      hazards: [],
    })

    await expect(invokeRoute(clearHazardsRoute, {
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
      hazards: [],
    })

    expect(mocks.executeLivePlayMapEffectsCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command,
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
    })
  })

  it('returns terminal rejections for invalid or oversized clearHazards payloads', async () => {
    const oversizedCommand = clearHazardsCommand({
      opId: 'op_routeclear2',
      scopes: [{ kind: 'map', lane: 'hazards' }],
      payload: {
        mode: 'cells',
        cells: Array.from({ length: LIVE_PLAY_BATCH_MAX_HAZARD_CELLS + 1 }, (_, x) => ({ x, y: 0, z: 0 })),
      },
    })
    mocks.executeLivePlayMapEffectsCommandUseCase.mockResolvedValue({
      result: {
        ok: false,
        opId: oversizedCommand.opId,
        mapSlug: oversizedCommand.mapSlug,
        reason: 'invalid',
        message: 'clearHazards payload is invalid: payload.cells must contain at most 128 hazard cells.',
        currentRevision: 4,
      },
    })

    await expect(invokeRoute(clearHazardsRoute, {
      role: 'gm',
      body: oversizedCommand,
    })).resolves.toEqual({
      ok: false,
      opId: oversizedCommand.opId,
      mapSlug: oversizedCommand.mapSlug,
      reason: 'invalid',
      message: 'clearHazards payload is invalid: payload.cells must contain at most 128 hazard cells.',
      currentRevision: 4,
    })

    expect(mocks.executeLivePlayMapEffectsCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command: oversizedCommand,
      clientId: undefined,
      expectedType: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
    })
  })
})
