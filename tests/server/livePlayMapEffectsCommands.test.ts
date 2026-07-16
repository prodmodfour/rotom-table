import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createClearFieldEffectsCommandScopes,
  createClearHazardsCommandScopes,
  createEditHazardsCommandScopes,
  type ClearFieldEffectsLivePlayCommand,
  type ClearFieldEffectsPayload,
  type ClearHazardsLivePlayCommand,
  type ClearHazardsPayload,
  type EditHazardsLivePlayCommand,
  type EditHazardsPayload,
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

const clearHazardsCommand = (
  payload: ClearHazardsPayload = { mode: 'all' },
  overrides: Partial<ClearHazardsLivePlayCommand> = {},
): ClearHazardsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_clearhaz1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
  scopes: createClearHazardsCommandScopes(payload),
  payload,
  ...overrides,
})

const editHazardsCommand = (
  payload: EditHazardsPayload = { operations: [{ action: 'upsert', hazard: { kind: 'spikes', x: 1, y: 0, z: 2 } }] },
  overrides: Partial<EditHazardsLivePlayCommand> = {},
): EditHazardsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_edithaz01',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
  scopes: createEditHazardsCommandScopes(payload),
  payload,
  ...overrides,
})

const clearFieldEffectsCommand = (
  payload: ClearFieldEffectsPayload = { category: 'all' },
  overrides: Partial<ClearFieldEffectsLivePlayCommand> = {},
): ClearFieldEffectsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_clearfld1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
  scopes: createClearFieldEffectsCommandScopes(payload),
  payload,
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

type SupportedLivePlayMapEffectsCommand = LivePlayMapEffectCommand

const execute = (harness: ReturnType<typeof createHarness>, command: SupportedLivePlayMapEffectsCommand, role: 'gm' | 'player' = 'gm') =>
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

  it('clears all hazards through one authoritative batch result and reuses it on retry', async () => {
    const initialHazards = [
      { kind: 'spikes' as const, x: 1, y: 0, z: 2 },
      { kind: 'fire' as const, x: 2, y: 0, z: 2, owner: 'GM' },
      { kind: 'toxic-spikes' as const, x: 3, y: 0, z: 2, layer: 2 },
    ]
    const harness = createHarness(baseMap({ hazards: initialHazards }))
    const command = clearHazardsCommand({ mode: 'all' })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.hazards).toEqual([])
    expect(response.hazards).toEqual([])
    expect(acceptedPatches(response)).toEqual([
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
        revision: 5,
        scopes: [{ kind: 'map', lane: 'hazards' }],
        payload: {
          command: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
          mode: 'all',
          previous: initialHazards,
          current: [],
          removed: initialHazards,
        },
      }),
    ])
    expect(harness.published).toHaveLength(1)

    const retry = await execute(harness, command)

    expect(retry.result).toEqual(response.result)
    expect(harness.writes).toHaveLength(1)
    expect(harness.published).toHaveLength(1)
  })

  it('clears explicit hazard cells and optional kind without touching unrelated hazards', async () => {
    const harness = createHarness(baseMap({
      hazards: [
        { kind: 'spikes', x: 1, y: 0, z: 2 },
        { kind: 'fire', x: 1, y: 0, z: 2 },
        { kind: 'fire', x: 2, y: 0, z: 2 },
        { kind: 'sticky-web', x: 3, y: 0, z: 2 },
      ],
    }))
    const payload = {
      mode: 'cells',
      cells: [{ x: 1, y: 0, z: 2 }, { x: 3, y: 0, z: 2 }],
      kind: 'fire',
    } as const satisfies ClearHazardsPayload

    const response = await execute(harness, clearHazardsCommand(payload, { opId: 'op_clearcell' }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.hazards).toEqual([
      { kind: 'spikes', x: 1, y: 0, z: 2 },
      { kind: 'fire', x: 2, y: 0, z: 2 },
      { kind: 'sticky-web', x: 3, y: 0, z: 2 },
    ])
    expect(acceptedPatches(response)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.CLEAR_HAZARDS,
        mode: 'cells',
        kind: 'fire',
        cells: [{ x: 1, y: 0, z: 2 }, { x: 3, y: 0, z: 2 }],
        current: [
          { kind: 'spikes', x: 1, y: 0, z: 2 },
          { kind: 'fire', x: 2, y: 0, z: 2 },
          { kind: 'sticky-web', x: 3, y: 0, z: 2 },
        ],
        removed: [{ kind: 'fire', x: 1, y: 0, z: 2 }],
      },
    })
  })

  it('edits hazard cells through one authoritative batch result and reuses it on retry', async () => {
    const initialHazards = [
      { kind: 'fire' as const, x: 3, y: 0, z: 4 },
      { kind: 'sticky-web' as const, x: 5, y: 0, z: 1 },
    ]
    const payload = {
      operations: [
        { action: 'upsert', hazard: { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2, owner: 'north' } },
        { action: 'remove', cell: { x: 3, y: 0, z: 4, kind: 'fire' } },
        { action: 'upsert', hazard: { kind: 'stealth-rock', x: 1, y: 0, z: 2 } },
      ],
    } as const satisfies EditHazardsPayload
    const harness = createHarness(baseMap({ hazards: initialHazards }))
    const command = editHazardsCommand(payload)

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.hazards).toEqual([
      { kind: 'sticky-web', x: 5, y: 0, z: 1 },
      { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2, owner: 'north' },
      { kind: 'stealth-rock', x: 1, y: 0, z: 2 },
    ])
    expect(response.hazards).toEqual(harness.storedMap.hazards)
    expect(acceptedPatches(response)).toEqual([
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.MAP_HAZARDS,
        revision: 5,
        scopes: [{ kind: 'map', lane: 'hazards' }],
        payload: {
          command: LIVE_PLAY_COMMAND_TYPES.EDIT_HAZARDS,
          changes: [
            {
              cell: { x: 1, y: 0, z: 2 },
              previous: [],
              current: [
                { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2, owner: 'north' },
                { kind: 'stealth-rock', x: 1, y: 0, z: 2 },
              ],
              placed: [
                { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2, owner: 'north' },
                { kind: 'stealth-rock', x: 1, y: 0, z: 2 },
              ],
            },
            {
              cell: { x: 3, y: 0, z: 4 },
              previous: [{ kind: 'fire', x: 3, y: 0, z: 4 }],
              current: [],
              removed: [{ kind: 'fire', x: 3, y: 0, z: 4 }],
            },
          ],
          previous: initialHazards,
          current: [
            { kind: 'sticky-web', x: 5, y: 0, z: 1 },
            { kind: 'toxic-spikes', x: 1, y: 0, z: 2, layer: 2, owner: 'north' },
            { kind: 'stealth-rock', x: 1, y: 0, z: 2 },
          ],
        },
      }),
    ])
    expect(harness.published).toHaveLength(1)

    const retry = await execute(harness, command)

    expect(retry.result).toEqual(response.result)
    expect(harness.writes).toHaveLength(1)
    expect(harness.published).toHaveLength(1)
  })

  it('rejects invalid editHazards cells without partially writing valid cells', async () => {
    const initialHazards = [{ kind: 'sticky-web' as const, x: 5, y: 0, z: 1 }]
    const harness = createHarness(baseMap({ hazards: initialHazards }))
    const response = await execute(harness, editHazardsCommand({
      operations: [
        { action: 'upsert', hazard: { kind: 'spikes', x: 1, y: 0, z: 2 } },
        { action: 'upsert', hazard: { kind: 'fire', x: 99, y: 0, z: 2 } },
      ],
    }, { opId: 'op_badedithz' }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      currentRevision: 4,
      message: 'Hazards cannot be edited at 99,0,2; the cell is outside map arena.',
    })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.hazards).toEqual(initialHazards)
  })

  it('clears all field effects through one authoritative batch result and reuses it on retry', async () => {
    const initialFieldEffects = {
      weather: [{ kind: 'sunny' as const, rounds: 3 }],
      terrains: [{ kind: 'electric' as const, rounds: 4, scope: 'field' as const }],
      rooms: [{ kind: 'trick' as const, rounds: 2, startsNextRound: true }],
    }
    const harness = createHarness(baseMap({ fieldEffects: initialFieldEffects }))
    const command = clearFieldEffectsCommand({ category: 'all' })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.fieldEffects).toEqual({ weather: [], terrains: [], rooms: [] })
    expect(response.fieldEffects).toEqual({ weather: [], terrains: [], rooms: [] })
    expect(acceptedPatches(response)).toEqual([
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
        revision: 5,
        scopes: [{ kind: 'map', lane: 'fieldEffects' }],
        payload: expect.objectContaining({
          command: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
          category: 'all',
          previous: initialFieldEffects,
          current: { weather: [], terrains: [], rooms: [] },
          currentEncounterState: expect.objectContaining({ zones: [] }),
          fieldTransitions: expect.arrayContaining([
            expect.objectContaining({ kind: 'removed' }),
          ]),
        }),
      }),
    ])
    expect(harness.published).toHaveLength(1)

    const retry = await execute(harness, command)

    expect(retry.result).toEqual(response.result)
    expect(harness.writes).toHaveLength(1)
    expect(harness.published).toHaveLength(1)
  })

  it('clears one field-effect category and explicit kinds without touching unrelated effects', async () => {
    const harness = createHarness(baseMap({
      fieldEffects: {
        weather: [{ kind: 'sunny', rounds: 3 }, { kind: 'rainy', rounds: 2 }],
        terrains: [{ kind: 'electric', rounds: 4, scope: 'field' }, { kind: 'grassy', rounds: 1, scope: 'field' }],
        rooms: [{ kind: 'magic', rounds: 5 }],
      },
    }))

    const categoryResponse = await execute(harness, clearFieldEffectsCommand(
      { category: 'weather' },
      { opId: 'op_clearwthr' },
    ))
    expect(categoryResponse.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.fieldEffects).toEqual({
      weather: [],
      terrains: [{ kind: 'electric', rounds: 4, scope: 'field' }, { kind: 'grassy', rounds: 1, scope: 'field' }],
      rooms: [{ kind: 'magic', rounds: 5 }],
    })
    expect(acceptedPatches(categoryResponse)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
        category: 'weather',
        current: {
          weather: [],
          terrains: [{ kind: 'electric', rounds: 4, scope: 'field' }, { kind: 'grassy', rounds: 1, scope: 'field' }],
          rooms: [{ kind: 'magic', rounds: 5 }],
        },
      },
    })

    const explicitResponse = await execute(harness, clearFieldEffectsCommand(
      { category: 'terrain', kinds: ['electric'] },
      { opId: 'op_cleartrnk', baseRevision: 5 },
    ))
    expect(explicitResponse.result).toMatchObject({ ok: true, previousRevision: 5, revision: 6 })
    expect(harness.storedMap.fieldEffects).toEqual({
      weather: [],
      terrains: [{ kind: 'grassy', rounds: 1, scope: 'field' }],
      rooms: [{ kind: 'magic', rounds: 5 }],
    })
    expect(acceptedPatches(explicitResponse)[0]).toMatchObject({
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.CLEAR_FIELD_EFFECTS,
        category: 'terrain',
        kinds: ['electric'],
        current: {
          weather: [],
          terrains: [{ kind: 'grassy', rounds: 1, scope: 'field' }],
          rooms: [{ kind: 'magic', rounds: 5 }],
        },
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
    expect(harness.storedMap.encounterState?.zones).toEqual([
      expect.objectContaining({
        kind: 'weather',
        source: {
          kind: 'operation',
          operationId: expect.stringMatching(/^field\.command\./),
          moveId: null,
          placementId: null,
        },
        sideId: null,
        duration: { kind: 'rounds', boundary: 'end', remaining: 3 },
        fieldPolicy: {
          priority: 0,
          replacementGroup: 'field.weather',
          suppression: { sources: [] },
        },
        payload: { weatherId: 'sunny' },
      }),
    ])
    expect(acceptedPatches(response)[0]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_FIELD_EFFECTS,
      scopes: [{ kind: 'map', lane: 'fieldEffects' }],
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.SET_FIELD_EFFECT,
        previous: { weather: [], terrains: [], rooms: [] },
        current: { weather: [{ kind: 'sunny', rounds: 3 }], terrains: [], rooms: [] },
        category: 'weather',
        kind: 'sunny',
        fieldTransitions: [expect.objectContaining({ kind: 'added', reasonCode: 'field-added' })],
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
        durationCorrection: 'gm-correction',
        current: {
          weather: [{ kind: 'rainy', rounds: 1 }],
          terrains: [],
          rooms: [{ kind: 'wonder', rounds: null }],
        },
        fieldTransitions: expect.arrayContaining([
          expect.objectContaining({
            kind: 'duration-decremented',
            reasonCode: 'field-gm-duration-correction',
          }),
          expect.objectContaining({ kind: 'expired' }),
        ]),
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
    const clearNoOp = await execute(harness, clearHazardsCommand({ mode: 'all' }, { opId: 'op_nohazclear' }))
    const invalidClear = await execute(harness, clearHazardsCommand(
      { mode: 'cells', cells: [{ x: 99, y: 0, z: 0 }] },
      { opId: 'op_badclear1' },
    ))
    const fieldClearNoOp = await execute(harness, clearFieldEffectsCommand({ category: 'all' }, { opId: 'op_nofldclr1' }))
    const invalidFieldClear = await execute(harness, clearFieldEffectsCommand(
      { category: 'weather', kinds: ['electric'] } as unknown as ClearFieldEffectsPayload,
      { opId: 'op_badfldclr' },
    ))

    expect(noOp.result).toMatchObject({ ok: false, reason: 'no-op', currentRevision: 4 })
    expect(invalidHazard.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 4 })
    expect(invalidField.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 4 })
    expect(clearNoOp.result).toMatchObject({ ok: false, reason: 'no-op', currentRevision: 4 })
    expect(invalidClear.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 4 })
    expect(fieldClearNoOp.result).toMatchObject({ ok: false, reason: 'no-op', currentRevision: 4 })
    expect(invalidFieldClear.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 4 })
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
    const staleClear = await execute(harness, clearHazardsCommand({ mode: 'all' }, {
      opId: 'op_clearstale',
      baseRevision: 4,
    }))

    expect(stale.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 5,
    })
    expect(staleClear.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 5,
    })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.hazards).toEqual([{ kind: 'spikes', x: 1, y: 0, z: 2 }])
  })

  it('rejects stale field-effect clear conflicts without partially clearing effects', async () => {
    const harness = createHarness(baseMap({
      fieldEffects: {
        weather: [{ kind: 'sunny', rounds: 3 }],
        terrains: [{ kind: 'electric', rounds: 4, scope: 'field' }],
        rooms: [],
      },
    }))
    await execute(harness, setFieldEffectCommand({
      opId: 'op_fldfirst1',
      payload: { category: 'weather', kind: 'rainy', rounds: 2 },
    }))

    const staleClear = await execute(harness, clearFieldEffectsCommand({ category: 'all' }, {
      opId: 'op_fldstale1',
      baseRevision: 4,
    }))

    expect(staleClear.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 5,
    })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.fieldEffects).toEqual({
      weather: [{ kind: 'rainy', rounds: 2 }],
      terrains: [{ kind: 'electric', rounds: 4, scope: 'field' }],
      rooms: [],
    })
  })
})
