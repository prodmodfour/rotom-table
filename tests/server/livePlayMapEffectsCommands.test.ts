import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayMapEffectCommand,
  type PlaceHazardLivePlayCommand,
  type RemoveFieldEffectLivePlayCommand,
  type RemoveHazardLivePlayCommand,
  type SetFieldEffectLivePlayCommand,
  type TickFieldEffectDurationsLivePlayCommand,
} from '#shared/livePlayCommands'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { executeLivePlayMapEffectsCommandUseCase } from '~~/server/useCases/applyLivePlayMapEffectsCommand'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import type { TabletopMap } from '~/types/map'

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

const placeHazardCommand = (
  overrides: Partial<PlaceHazardLivePlayCommand> = {},
): PlaceHazardLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_placehaz01',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
  scopes: [{ kind: 'map', lane: 'hazards' }],
  payload: { hazard: { kind: 'spikes', x: 1, y: 0, z: 2 } },
  ...overrides,
})

const removeHazardCommand = (
  overrides: Partial<RemoveHazardLivePlayCommand> = {},
): RemoveHazardLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_removehaz1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
  scopes: [{ kind: 'map', lane: 'hazards' }],
  payload: { cell: { x: 1, y: 0, z: 2, kind: 'spikes' } },
  ...overrides,
})

const setFieldEffectCommand = (
  overrides: Partial<SetFieldEffectLivePlayCommand> = {},
): SetFieldEffectLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_setfield01',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
  scopes: [{ kind: 'map', lane: 'fieldEffects' }],
  payload: { category: 'weather', kind: 'sunny', rounds: 3 },
  ...overrides,
})

const removeFieldEffectCommand = (
  overrides: Partial<RemoveFieldEffectLivePlayCommand> = {},
): RemoveFieldEffectLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_remfield1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
  scopes: [{ kind: 'map', lane: 'fieldEffects' }],
  payload: { category: 'terrain', kind: 'electric' },
  ...overrides,
})

const tickFieldEffectDurationsCommand = (
  overrides: Partial<TickFieldEffectDurationsLivePlayCommand> = {},
): TickFieldEffectDurationsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_tickfield1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
  scopes: [{ kind: 'map', lane: 'fieldEffects' }],
  payload: {},
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

const execute = (harness: ReturnType<typeof createHarness>, command: LivePlayMapEffectCommand, role: 'gm' | 'player' = 'gm') =>
  executeLivePlayMapEffectsCommandUseCase({
    role,
    command,
    clientId: `${role}-client`,
    expectedType: command.type,
  }, harness.deps)

const acceptedPatches = (response: Awaited<ReturnType<typeof execute>>) => (
  response.result.ok && !('duplicate' in response.result) ? response.result.patches : []
)

describe('live-play hazard and field-effect commands', () => {
  it('places hazards through the authoritative executor and returns previous/current lane patches', async () => {
    const harness = createHarness()

    const response = await execute(harness, placeHazardCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.revision).toBe(5)
    expect(harness.storedMap.hazards).toEqual([{ kind: 'spikes', x: 1, y: 0, z: 2 }])
    expect(response.hazards).toEqual([{ kind: 'spikes', x: 1, y: 0, z: 2 }])
    expect(acceptedPatches(response)).toEqual([
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
        revision: 5,
        scopes: [{ kind: 'map', lane: 'hazards' }],
        payload: {
          command: LIVE_PLAY_COMMAND_TYPES.PLACE_HAZARD,
          cell: { x: 1, y: 0, z: 2 },
          previous: [],
          current: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
          placed: { kind: 'spikes', x: 1, y: 0, z: 2 },
          removed: [],
        },
      }),
    ])
    expect(harness.published).toEqual([
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', opId: 'op_placehaz01', revision: 5 }),
    ])
  })

  it('removes hazards through the authoritative executor', async () => {
    const harness = createHarness(baseMap({ hazards: [{ kind: 'spikes', x: 1, y: 0, z: 2 }] }))

    const response = await execute(harness, removeHazardCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.hazards).toEqual([])
    expect(acceptedPatches(response)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.REMOVE_HAZARD,
        previous: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
        current: [],
        removed: [{ kind: 'spikes', x: 1, y: 0, z: 2 }],
      },
    })
  })

  it('sets field effects through the authoritative executor', async () => {
    const harness = createHarness()

    const response = await execute(harness, setFieldEffectCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.fieldEffects).toEqual({
      weather: [{ kind: 'sunny', rounds: 3 }],
      terrains: [],
      rooms: [],
    })
    expect(response.fieldEffects).toEqual(harness.storedMap.fieldEffects)
    expect(acceptedPatches(response)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
        previous: { weather: [], terrains: [], rooms: [] },
        current: { weather: [{ kind: 'sunny', rounds: 3 }], terrains: [], rooms: [] },
        category: 'weather',
        kind: 'sunny',
      },
    })
  })

  it('removes field effects through the authoritative executor', async () => {
    const harness = createHarness(baseMap({
      fieldEffects: {
        weather: [{ kind: 'sunny', rounds: 3 }],
        terrains: [{ kind: 'electric', rounds: 4, scope: 'field' }],
        rooms: [],
      },
    }))

    const response = await execute(harness, removeFieldEffectCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.fieldEffects).toEqual({
      weather: [{ kind: 'sunny', rounds: 3 }],
      terrains: [],
      rooms: [],
    })
    expect(acceptedPatches(response)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.REMOVE_FIELD_EFFECT,
        category: 'terrain',
        kind: 'electric',
        current: { weather: [{ kind: 'sunny', rounds: 3 }], terrains: [], rooms: [] },
      },
    })
  })

  it('ticks field-effect durations and removes effects that expire', async () => {
    const harness = createHarness(baseMap({
      fieldEffects: {
        weather: [{ kind: 'rainy', rounds: 2 }],
        terrains: [{ kind: 'grassy', rounds: 1, scope: 'field' }],
        rooms: [{ kind: 'wonder', rounds: null }],
      },
    }))

    const response = await execute(harness, tickFieldEffectDurationsCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.fieldEffects).toEqual({
      weather: [{ kind: 'rainy', rounds: 1 }],
      terrains: [],
      rooms: [{ kind: 'wonder', rounds: null }],
    })
    expect(acceptedPatches(response)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.TICK_FIELD_EFFECT_DURATIONS,
        tickAmount: 1,
        current: {
          weather: [{ kind: 'rainy', rounds: 1 }],
          terrains: [],
          rooms: [{ kind: 'wonder', rounds: null }],
        },
      },
    })
  })

  it('rejects player commands as unauthorized', async () => {
    const harness = createHarness()

    const response = await execute(harness, placeHazardCommand({ opId: 'op_playerhaz1' }), 'player')

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'unauthorized',
      currentRevision: 4,
      message: 'Only GMs can manage hazards and field effects',
    })
    expect(harness.writes).toEqual([])
    expect(harness.published).toEqual([])
  })

  it('rejects no-op and invalid cases without writing', async () => {
    const harness = createHarness()

    const noOp = await execute(harness, removeHazardCommand({ opId: 'op_nohazards1' }))
    const invalidHazard = await execute(harness, placeHazardCommand({
      opId: 'op_badhazard1',
      payload: { hazard: { kind: 'spikes', x: 99, y: 0, z: 0 } },
    }))
    const invalidField = await execute(harness, setFieldEffectCommand({
      opId: 'op_badfield01',
      payload: { category: 'weather', kind: 'sunny', rounds: -1 },
    }))

    expect(noOp.result).toMatchObject({ ok: false, reason: 'no-op', currentRevision: 4 })
    expect(invalidHazard.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 4 })
    expect(invalidField.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 4 })
    expect(harness.writes).toEqual([])
  })

  it('rejects stale same-lane conflicts without overwriting accepted state', async () => {
    const harness = createHarness()
    await execute(harness, placeHazardCommand({ opId: 'op_hazfirst1' }))

    const stale = await execute(harness, placeHazardCommand({
      opId: 'op_hazstale1',
      baseRevision: 4,
      payload: { hazard: { kind: 'sticky-web', x: 2, y: 0, z: 2 } },
    }))

    expect(stale.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 5,
    })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.hazards).toEqual([{ kind: 'spikes', x: 1, y: 0, z: 2 }])
  })
})
