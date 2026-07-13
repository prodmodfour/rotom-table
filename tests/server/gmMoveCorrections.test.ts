import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  createLivePlayAcceptedResult,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import {
  GM_MOVE_CORRECTION_COMMAND_TYPE,
  MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
  parseLivePlayMoveCorrectionPatchPayload,
} from '#shared/moveAutomation/correctionCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { deepCloneJson } from '~/utils/serialization'
import { createAcceptedMoveCompensationResult } from '~~/server/domain/moveAutomation/planAcceptedMoveCompensation'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
} from '~~/server/domain/moveAutomation/plan'
import { createLivePlayCommandHash } from '~~/server/livePlay/opResult'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  applyGmMoveCorrectionUseCase,
  type ApplyGmMoveCorrectionDependencies,
} from '~~/server/useCases/applyGmMoveCorrection'

const originOperationId = 'op_originalmove01'
const correctionOperationId = 'op_correctmove001'
const openDatabases: RotomDatabase[] = []

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const pokemonSheet = (
  revision: number,
  attackStage: number,
): CharacterSheet => ({
  slug: 'actor',
  nickname: 'Actor',
  species: 'Pikachu',
  level: 20,
  revision,
  stats: { atk: { stage: attackStage } },
  combatStages: { acc: 0 },
  combat: { currentHp: 40, injuries: 0, conditions: [] },
  movelist: [{ name: 'Swords Dance' }],
})

const mapDocument = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  folder: '',
  revision: 8,
  dimensions: { x: 6, y: 2, z: 6 },
  playerVisible: true,
  voxels: [],
  hazards: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [{
    id: 'actor-token',
    sheetKind: 'pokemon',
    sheetSlug: 'actor',
    position: { x: 0, y: 0, z: 0 },
  }],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: { moveLog: [{ moveName: 'Swords Dance' }] },
  updatedAt: 800,
})

const originCommand = (): ResolveMoveLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: originOperationId,
  mapSlug: 'arena',
  baseRevision: 7,
  type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
  scopes: [
    { kind: 'map', lane: 'hazards' },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor', field: 'combatStages' },
  ],
  payload: {
    schemaVersion: 1,
    placementId: 'actor-token',
    moveName: 'Swords Dance',
    selection: { kind: 'self' },
  },
})

const correctionCommand = (operationIds: readonly string[]) => ({
  schemaVersion: MOVE_CORRECTION_COMMAND_SCHEMA_VERSION,
  opId: correctionOperationId,
  mapSlug: 'arena',
  baseRevision: 8,
  type: GM_MOVE_CORRECTION_COMMAND_TYPE,
  payload: { originOperationId, operationIds },
})

const sourceStatePlan = () => createMoveStateChangePlan([
  {
    kind: 'map-hazards',
    scope: { kind: 'map', mapSlug: 'arena' },
    expectedRevision: 7,
    sourceOperationId: 'swords-dance.test-hazard',
    reasonCode: 'test-hazard-applied',
    previous: [],
    current: [{ kind: 'spikes' as const, x: 1, y: 0, z: 1 }],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  },
  {
    kind: 'sheet-state',
    scope: { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'actor' },
    expectedRevision: 4,
    sourceOperationId: 'swords-dance.attack-stage',
    reasonCode: 'combat-stage-changed',
    previous: pokemonSheet(4, 0),
    current: pokemonSheet(5, 2),
    changedFields: ['combatStages'],
    compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  },
])

const seed = () => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const modes = createSqliteMapInteractionModeRepository(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 900 })
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_000 })
  const map = mapDocument()
  const sheet = pokemonSheet(5, 2)
  maps.save({ slug: map.slug, document: map, revision: 8, updatedAt: 800 })
  modes.set({
    slug: map.slug,
    interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY,
    updatedAt: 800,
  })
  sheets.save({
    kind: 'pokemon',
    slug: 'actor',
    document: sheet as unknown as Record<string, unknown>,
    revision: 5,
    updatedAt: 500,
  })
  const command = originCommand()
  const result = createLivePlayAcceptedResult({
    opId: command.opId,
    mapSlug: command.mapSlug,
    previousRevision: 7,
    revision: 8,
    patches: [],
  })
  ops.saveCommandResult({
    mapSlug: command.mapSlug,
    opId: command.opId,
    commandHash: createLivePlayCommandHash(command),
    command,
    result,
    moveCompensation: createAcceptedMoveCompensationResult({
      mapSlug: command.mapSlug,
      originOperationId: command.opId,
      plan: sourceStatePlan(),
    }),
  })
  const source = ops.getStoredOpRecord('arena', originOperationId)!
  const operationIds = source.moveCompensation!.operations
    .filter(operation => operation.availability === 'available')
    .map(operation => operation.operationId)
  return { database, maps, modes, sheets, ops, realtime, source, operationIds }
}

const execute = (
  harness: ReturnType<typeof seed>,
  command = correctionCommand(harness.operationIds),
  overrides: ApplyGmMoveCorrectionDependencies = {},
) => applyGmMoveCorrectionUseCase({ role: 'gm', command, clientId: 'gm-client' }, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  opRepository: harness.ops,
  realtimeEventRepository: harness.realtime,
  publishPersistedRealtimeEvent: vi.fn(),
  now: () => 1_000,
  ...overrides,
})

describe('atomic GM move corrections', () => {
  it('applies selected map and sheet inverses atomically with durable ancestry and realtime audit', () => {
    const harness = seed()
    const sourceBefore = deepCloneJson(harness.source)
    const response = execute(harness)

    expect(response.result).toMatchObject({
      ok: true,
      opId: correctionOperationId,
      mapSlug: 'arena',
      previousRevision: 8,
      revision: 9,
    })
    expect(response.map).toMatchObject({ revision: 9, hazards: [], updatedAt: 1_000 })
    expect(response.sheetUpdates?.[0]).toMatchObject({
      kind: 'pokemon',
      slug: 'actor',
      sheet: { revision: 6, stats: { atk: { stage: 0 } } },
    })
    expect(harness.maps.getBySlug('arena')).toMatchObject({ revision: 9, hazards: [] })
    expect(harness.sheets.getByRef('pokemon', 'actor')).toMatchObject({
      revision: 6,
      sheet: { stats: { atk: { stage: 0 } } },
    })

    if (!response.result.ok || 'duplicate' in response.result) throw new Error('expected accepted correction')
    expect(response.result.patches).toHaveLength(1)
    expect(response.result.patches[0]?.type).toBe(LIVE_PLAY_PATCH_TYPES.MOVE_CORRECTION)
    const parsedPatch = parseLivePlayMoveCorrectionPatchPayload(response.result.patches[0]?.payload)
    expect(parsedPatch.valid).toBe(true)
    if (parsedPatch.valid) {
      expect(parsedPatch.payload).toMatchObject({
        originOperationId,
        correctionOperationId,
        operationIds: harness.operationIds,
        resources: [
          { kind: 'map', expectedRevision: 8, revision: 9 },
          { kind: 'sheet', expectedRevision: 5, revision: 6 },
        ],
      })
    }

    const stored = harness.ops.getStoredOpRecord('arena', correctionOperationId)
    expect(stored).toMatchObject({
      correctionOriginOperationId: originOperationId,
      command: correctionCommand(harness.operationIds),
      result: response.result,
    })
    expect(stored?.moveCompensation).toBeUndefined()
    expect(JSON.stringify(response.result)).not.toContain('expectedCurrent')
    expect(JSON.stringify(response.result)).not.toContain('"restore"')
    expect(JSON.stringify(response.result)).not.toContain('Actor')
    expect(harness.ops.listMoveCorrectionRecords('arena', originOperationId)).toHaveLength(1)
    expect(harness.ops.getStoredOpRecord('arena', originOperationId)).toEqual(sourceBefore)

    const events = harness.realtime.readAfter({ afterSequence: 0 }).events
    expect(events).toHaveLength(3)
    expect(events.at(-1)?.event).toMatchObject({
      type: 'live-play-command-accepted',
      opId: correctionOperationId,
      patches: [{
        type: LIVE_PLAY_PATCH_TYPES.MOVE_CORRECTION,
        payload: { originOperationId, correctionOperationId },
      }],
    })

    harness.maps.clearOperationHistory('arena')
    expect(harness.ops.getStoredOpRecord('arena', originOperationId)).toBeNull()
    expect(harness.ops.getStoredOpRecord('arena', correctionOperationId)).toBeNull()
  })

  it('replays a duplicate correction opId without reloading the source, applying, or publishing twice', () => {
    const harness = seed()
    const publish = vi.fn()
    const first = execute(harness, correctionCommand(harness.operationIds), {
      publishPersistedRealtimeEvent: publish,
    })
    const eventCount = harness.realtime.cursorState().latestSequence
    expect(publish).toHaveBeenCalledTimes(3)

    const replayOps = {
      getStoredOpRecord: (mapSlug: string, opId: string) => {
        if (opId === originOperationId) throw new Error('duplicate replay reloaded its source')
        return harness.ops.getStoredOpRecord(mapSlug, opId)
      },
      saveCommandResult: harness.ops.saveCommandResult,
    }
    const second = execute(harness, correctionCommand(harness.operationIds), {
      opRepository: replayOps,
      publishPersistedRealtimeEvent: publish,
    })

    expect(second.result).toEqual(first.result)
    expect(harness.maps.getBySlug('arena')?.revision).toBe(9)
    expect(harness.sheets.getByRef('pokemon', 'actor')?.revision).toBe(6)
    expect(harness.realtime.cursorState().latestSequence).toBe(eventCount)
    expect(publish).toHaveBeenCalledTimes(3)
    expect(harness.ops.listMoveCorrectionRecords('arena', originOperationId)).toHaveLength(1)
  })

  it('rejects a correction opId reused with different command material before loading another source', () => {
    const harness = seed()
    execute(harness)
    const changedCommand = {
      ...correctionCommand(harness.operationIds),
      payload: {
        originOperationId: 'op_otherorigin001',
        operationIds: harness.operationIds,
      },
    }

    expect(() => execute(harness, changedCommand)).toThrow(expect.objectContaining({
      statusCode: 409,
    }))
    expect(harness.maps.getBySlug('arena')?.revision).toBe(9)
    expect(harness.sheets.getByRef('pokemon', 'actor')?.revision).toBe(6)
    expect(harness.ops.getStoredOpRecord('arena', correctionOperationId)?.command)
      .toEqual(correctionCommand(harness.operationIds))
    expect(harness.realtime.cursorState().latestSequence).toBe(3)
  })

  it('returns a clean conflict without overwriting a later affected-resource revision', () => {
    const harness = seed()
    const later = pokemonSheet(6, 4)
    harness.sheets.save({
      kind: 'pokemon',
      slug: 'actor',
      document: later as unknown as Record<string, unknown>,
      revision: 6,
      updatedAt: 950,
    })

    const response = execute(harness)

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict', currentRevision: 8 })
    expect(harness.maps.getBySlug('arena')).toMatchObject({
      revision: 8,
      hazards: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
    })
    expect(harness.sheets.getByRef('pokemon', 'actor')).toMatchObject({
      revision: 6,
      sheet: { stats: { atk: { stage: 4 } } },
    })
    expect(harness.realtime.cursorState().latestSequence).toBe(0)
    expect(harness.ops.getStoredOpRecord('arena', correctionOperationId)).toMatchObject({
      correctionOriginOperationId: originOperationId,
      result: { ok: false, reason: 'conflict' },
    })
  })

  it('rolls back map, sheet, operation, and realtime writes when a repository fails', () => {
    const harness = seed()
    const command = correctionCommand(harness.operationIds)

    expect(() => applyGmMoveCorrectionUseCase({ role: 'gm', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: {
        getByRef: (kind, slug) => harness.sheets.getByRef(kind, slug),
        applyLivePlayUpdate: () => { throw new Error('injected sheet repository failure') },
      },
      opRepository: harness.ops,
      realtimeEventRepository: harness.realtime,
      publishPersistedRealtimeEvent: vi.fn(),
      now: () => 1_000,
    })).toThrow('injected sheet repository failure')

    expect(harness.maps.getBySlug('arena')).toMatchObject({
      revision: 8,
      hazards: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
    })
    expect(harness.sheets.getByRef('pokemon', 'actor')).toMatchObject({
      revision: 5,
      sheet: { stats: { atk: { stage: 2 } } },
    })
    expect(harness.ops.getStoredOpRecord('arena', correctionOperationId)).toBeNull()
    expect(harness.realtime.cursorState().latestSequence).toBe(0)
  })

  it('rolls back map, sheet, operation, and publication when realtime audit storage fails', () => {
    const harness = seed()
    const publish = vi.fn()

    expect(() => execute(harness, correctionCommand(harness.operationIds), {
      realtimeEventRepository: {
        appendMany: () => { throw new Error('injected realtime repository failure') },
      },
      publishPersistedRealtimeEvent: publish,
    })).toThrow('injected realtime repository failure')

    expect(harness.maps.getBySlug('arena')).toMatchObject({
      revision: 8,
      hazards: [{ kind: 'spikes', x: 1, y: 0, z: 1 }],
    })
    expect(harness.sheets.getByRef('pokemon', 'actor')).toMatchObject({
      revision: 5,
      sheet: { stats: { atk: { stage: 2 } } },
    })
    expect(harness.ops.getStoredOpRecord('arena', correctionOperationId)).toBeNull()
    expect(harness.realtime.cursorState().latestSequence).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  it('fails closed when an expected current value drifts without a revision change', () => {
    const harness = seed()
    const drifted = pokemonSheet(5, 4)
    harness.sheets.save({
      kind: 'pokemon',
      slug: 'actor',
      document: drifted as unknown as Record<string, unknown>,
      revision: 5,
      updatedAt: 950,
    })

    const response = execute(harness)

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(harness.maps.getBySlug('arena')).toMatchObject({ revision: 8, hazards: [{ kind: 'spikes' }] })
    expect(harness.sheets.getByRef('pokemon', 'actor')).toMatchObject({
      revision: 5,
      sheet: { stats: { atk: { stage: 4 } } },
    })
    expect(harness.realtime.cursorState().latestSequence).toBe(0)
  })

  it('fails closed outside Run Live Play mode', () => {
    const harness = seed()
    harness.modes.set({
      slug: 'arena',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      updatedAt: 900,
    })

    expect(() => execute(harness)).toThrow(expect.objectContaining({ statusCode: 409 }))
    expect(harness.maps.getBySlug('arena')).toMatchObject({ revision: 8, hazards: [{ kind: 'spikes' }] })
    expect(harness.sheets.getByRef('pokemon', 'actor')).toMatchObject({ revision: 5 })
    expect(harness.ops.getStoredOpRecord('arena', correctionOperationId)).toBeNull()
    expect(harness.realtime.cursorState().latestSequence).toBe(0)
  })

  it('enforces GM authorization before reading correction metadata', () => {
    const harness = seed()
    expect(() => applyGmMoveCorrectionUseCase({
      role: 'player',
      command: correctionCommand(harness.operationIds),
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      opRepository: harness.ops,
      realtimeEventRepository: harness.realtime,
    })).toThrow(expect.objectContaining({ statusCode: 403 }))
    expect(harness.ops.listMoveCorrectionRecords('arena', originOperationId)).toHaveLength(0)
  })
})
