import type { EventHandler, EventHandlerRequest, H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ClearFieldEffectsLivePlayCommand,
} from '#shared/livePlayCommands'
import { LIVE_PLAY_BATCH_MAX_FIELD_EFFECT_OPERATIONS } from '#shared/livePlayBatchCommands'
import type { TabletopMap } from '~/types/map'

const mocks = vi.hoisted(() => ({
  executeLivePlayMapEffectsCommandUseCase: vi.fn(),
}))

vi.mock('../../server/useCases/applyLivePlayMapEffectsCommand', () => ({
  executeLivePlayMapEffectsCommandUseCase: mocks.executeLivePlayMapEffectsCommandUseCase,
}))

const clearFieldEffectsRoute = (await import('../../server/api/maps/field-effects/clear.post')).default

type ClearFieldEffectsRouteHandler = EventHandler<EventHandlerRequest, unknown>

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

const clearFieldEffectsCommand = (
  overrides: Partial<ClearFieldEffectsLivePlayCommand> = {},
): ClearFieldEffectsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_routefldcl',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
  scopes: [{ kind: 'map', lane: 'fieldEffects' }],
  payload: { category: 'all' },
  ...overrides,
})

const invokeRoute = async (
  handler: ClearFieldEffectsRouteHandler,
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

describe('clear field effects API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes GM clearFieldEffects commands through the live-play map-effects executor', async () => {
    const map = mapFixture()
    const command = { ...clearFieldEffectsCommand(), clientId: 'gm-client' }
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
      fieldEffects: { weather: [], terrains: [], rooms: [] },
    })

    await expect(invokeRoute(clearFieldEffectsRoute, {
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
      fieldEffects: { weather: [], terrains: [], rooms: [] },
    })

    expect(mocks.executeLivePlayMapEffectsCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command,
      clientId: 'gm-client',
      expectedType: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
    })
  })

  it('returns terminal rejections for invalid or oversized clearFieldEffects payloads', async () => {
    const oversizedCommand = clearFieldEffectsCommand({
      opId: 'op_routefldov',
      payload: {
        category: 'weather',
        kinds: Array.from({ length: LIVE_PLAY_BATCH_MAX_FIELD_EFFECT_OPERATIONS + 1 }, () => 'sunny' as const),
      },
    })
    mocks.executeLivePlayMapEffectsCommandUseCase.mockResolvedValue({
      result: {
        ok: false,
        opId: oversizedCommand.opId,
        mapSlug: oversizedCommand.mapSlug,
        reason: 'invalid',
        message: 'clearFieldEffects payload is invalid: payload.kinds must contain at most 16 weather effect kinds.',
        currentRevision: 4,
      },
    })

    await expect(invokeRoute(clearFieldEffectsRoute, {
      role: 'gm',
      body: oversizedCommand,
    })).resolves.toEqual({
      ok: false,
      opId: oversizedCommand.opId,
      mapSlug: oversizedCommand.mapSlug,
      reason: 'invalid',
      message: 'clearFieldEffects payload is invalid: payload.kinds must contain at most 16 weather effect kinds.',
      currentRevision: 4,
    })

    expect(mocks.executeLivePlayMapEffectsCommandUseCase).toHaveBeenCalledWith({
      role: 'gm',
      command: oversizedCommand,
      clientId: undefined,
      expectedType: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
    })
  })
})
