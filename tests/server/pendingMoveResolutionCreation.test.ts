import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import {
  isPendingMoveDeclarationResult,
} from '#shared/moveAutomation/pendingResolution'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import {
  createSqliteSheetRepository,
  SheetRevisionConflictError,
} from '~~/server/storage/sheetRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import {
  isAuthoritativePendingMoveStatePlan,
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { validateMoveSpec } from '~~/server/domain/moveAutomation/validateSpec'
import {
  REGISTERED_MOVE_HANDLER_REGISTRY,
} from '~~/server/domain/moveAutomation/handlers/registry'
import type {
  MoveAutomationRuntimeRegistry,
  MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandDependencies,
} from '~~/server/useCases/applyResolveMoveCommand'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'

const openDatabases: RotomDatabase[] = []

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const placement = (
  id: string,
  sheetSlug: string,
  position: { x: number; y: number; z: number },
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position,
})

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2,
  slug: 'pending-arena',
  name: 'Pending Arena',
  folder: '',
  revision: 4,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
    placement('target-token', 'target', { x: 1, y: 0, z: 0 }),
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  activeScene: { name: 'Scene A', startedAt: 100 },
  metadata: { note: 'unchanged' },
  createdAt: 1,
  updatedAt: 100,
})

const sheetFixture = (
  slug: string,
  options: { readonly actor?: boolean } = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: options.actor ? 'Pikachu' : 'Snorlax',
  level: 20,
  movelist: options.actor ? [{ name: 'Ember' }] : [],
  combat: { currentHp: options.actor ? 40 : 80 },
  revision: 2,
})

interface PendingSpecOptions {
  readonly withDeclarationCost: boolean
  readonly withDeferredEffects?: boolean
  readonly invalidDeclarationPhase?: boolean
}

const pendingScratchSpec = (options: PendingSpecOptions) => {
  const declarationPhase = options.invalidDeclarationPhase ? 'declare' : 'pay'
  const choicePhase = options.withDeferredEffects ? 'after-damage' : 'hit'
  const choiceOperation = {
    id: 'scratch.choose-style',
    kind: 'choice-request',
    source: { kind: 'move', id: 'move.scratch' },
    recipients: { kind: 'actor' },
    phase: choicePhase,
    reasonCode: 'move.scratch.choose-style',
    payload: {
      requestId: 'scratch.style-window',
      promptKey: 'move.scratch.choose-style',
      options: [
        { id: 'style.power', labelKey: 'move.scratch.style-power' },
        { id: 'style.control', labelKey: 'move.scratch.style-control' },
      ],
      allowPass: true,
    },
  }
  return {
    schemaVersion: 2,
    canonicalId: 'Ember',
    version: 101
      + (options.withDeclarationCost ? 1 : 0)
      + (options.withDeferredEffects ? 2 : 0)
      + (options.invalidDeclarationPhase ? 4 : 0),
    targeting: {
      kind: 'single-target',
      minTargets: 1,
      maxTargets: 1,
      selector: { kind: 'selected-targets' },
    },
    preconditions: [],
    costs: [],
    phases: [
      ...(options.withDeclarationCost ? [{
        phase: declarationPhase,
        operations: [{
          id: 'scratch.declaration-cost',
          kind: 'direct-hp',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'actor' },
          phase: declarationPhase,
          reasonCode: 'move.scratch.declaration-cost',
          payload: {
            mode: 'lose',
            pool: 'hit-points',
            calculation: { kind: 'fixed', value: 5 },
            copySource: null,
            bounds: { minimum: null, maximum: null },
            rounding: 'floor',
            applyTypeImmunity: false,
            cost: {
              kind: 'cost',
              timing: 'declaration',
              minimumRemaining: 1,
              damageOperationId: null,
            },
            injury: { hitPointMarkers: 'ignore', massiveDamage: 'never' },
          },
        }],
      }] : []),
      ...(options.withDeferredEffects ? [{
        phase: 'damage',
        operations: [{
          id: 'scratch.deferred-damage',
          kind: 'damage',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'attacked-targets' },
          phase: 'damage',
          reasonCode: 'move.scratch.deferred-damage',
          payload: {
            damageClass: 'special',
            damageBase: 4,
            moveType: 'fire',
            accuracyRollId: null,
            criticalRollId: null,
          },
        }],
      }, {
        phase: 'after-damage',
        operations: [{
          id: 'scratch.deferred-condition',
          kind: 'condition',
          source: { kind: 'operation', id: 'scratch.deferred-damage' },
          recipients: { kind: 'attacked-targets' },
          phase: 'after-damage',
          reasonCode: 'move.scratch.deferred-condition',
          payload: {
            action: 'apply',
            conditionId: 'burned',
            conditionSource: null,
            filter: null,
            randomChoice: null,
            duration: null,
            saveTiming: 'canonical',
            stackPolicy: { kind: 'refresh', maxStacks: null },
          },
        }, choiceOperation],
      }] : []),
      ...(!options.withDeferredEffects ? [{
        phase: choicePhase,
        operations: [choiceOperation],
      }] : []),
    ],
    registeredHandlerId: null,
    presentation: {
      displayName: 'Ember',
      vfxKey: null,
      tags: ['pending-test'],
    },
  }
}

const pendingRegistry = (options: PendingSpecOptions): MoveAutomationRuntimeRegistry => {
  const definition = validateMoveSpec(pendingScratchSpec(options))
  const runtime: MoveSpecV2Runtime = Object.freeze({
    canonicalId: 'Ember',
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: 'tests/server/pendingMoveResolutionCreation.test.ts',
    definition,
  })
  return Object.freeze({
    size: 1,
    handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (canonicalId: string) => canonicalId === 'Ember' ? runtime : null,
    entries: () => Object.freeze([runtime]),
  })
}

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
}

const createHarness = (): Harness => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 1_000 })
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const modes = createSqliteMapInteractionModeRepository(database)
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
  })

  const map = mapFixture()
  maps.save({ slug: map.slug, document: map, revision: 4, updatedAt: 100 })
  for (const sheet of [sheetFixture('actor', { actor: true }), sheetFixture('target')]) {
    sheets.save({
      kind: 'pokemon',
      slug: sheet.slug,
      document: sheet as unknown as Record<string, unknown>,
      revision: 2,
      updatedAt: 50,
    })
  }
  return { database, maps, sheets, ops, pending, commandExecutor }
}

const moveIntent = (): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName: 'Ember',
  selection: { kind: 'single-target', targetPlacementId: 'target-token' },
})

const commandFor = (
  map: TabletopMap,
  opId = 'op_pendingdeclare01',
  intent: ResolveMoveIntent = moveIntent(),
): ResolveMoveLivePlayCommand => {
  const scopes = buildResolveMoveScopes({
    map,
    intent,
    candidateScopePlacementIds: ['target-token'],
  })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: map.slug,
    baseRevision: map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload: intent,
  }
}

const executePending = (
  harness: Harness,
  command: ResolveMoveLivePlayCommand,
  options: {
    readonly withDeclarationCost?: boolean
    readonly withDeferredEffects?: boolean
    readonly invalidDeclarationPhase?: boolean
    readonly planner?: LivePlayResolveMoveCommandDependencies['planner']
    readonly mapRepository?: LivePlayResolveMoveCommandDependencies['mapRepository']
    readonly sheetRepository?: LivePlayResolveMoveCommandDependencies['sheetRepository']
    readonly pendingResolutionRepository?: LivePlayResolveMoveCommandDependencies['pendingResolutionRepository']
    readonly random?: LivePlayResolveMoveCommandDependencies['random']
  } = {},
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  command,
  clientId: 'pending-client',
  playerProfile: null,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: options.mapRepository ?? harness.maps,
  sheetRepository: options.sheetRepository ?? harness.sheets,
  pendingResolutionRepository: options.pendingResolutionRepository ?? harness.pending,
  commandExecutor: harness.commandExecutor,
  planner: options.planner ?? (input => planAuthoritativeMoveStateExecution({
    ...input,
    runtimeRegistry: pendingRegistry({
      withDeclarationCost: options.withDeclarationCost ?? false,
      withDeferredEffects: options.withDeferredEffects,
      invalidDeclarationPhase: options.invalidDeclarationPhase,
    }),
  })),
  random: options.random ?? (() => { throw new Error('the pending canary must not draw randomness') }),
  now: () => 1_000,
})

describe('pending move resolution creation', () => {
  it('atomically stores a privacy-safe suspension without a terminal op or open transaction', async () => {
    const harness = createHarness()
    const beforeMap = deepCloneJson(harness.maps.getBySlug('pending-arena'))
    const beforeSheets = deepCloneJson(harness.sheets.list())
    const command = commandFor(beforeMap!)

    const response = await executePending(harness, command)

    expect(isPendingMoveDeclarationResult(response.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(response.result)) return
    expect(response.result).toMatchObject({
      ok: true,
      pending: true,
      opId: command.opId,
      mapSlug: 'pending-arena',
      previousRevision: 4,
      revision: 5,
      patches: [],
      pendingResolution: {
        actorPlacementId: 'actor-token',
        canonicalMoveId: 'Ember',
        phase: 'hit',
        status: 'pending',
        outstandingWindowCount: 1,
      },
    })

    const stored = harness.pending.getByOrigin('pending-arena', command.opId)
    expect(stored).not.toBeNull()
    expect(stored?.resolution).toMatchObject({
      resolutionId: response.result.pendingResolution.resolutionId,
      originMapSlug: 'pending-arena',
      originOpId: command.opId,
      actorPlacementId: 'actor-token',
      canonicalMoveId: 'Ember',
      status: 'pending',
      readSet: [
        { kind: 'map', slug: 'pending-arena', revision: 5 },
        { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 2 },
        { kind: 'sheet', sheetKind: 'pokemon', slug: 'target', revision: 2 },
      ],
      outstandingWindows: [{
        windowId: 'scratch.style-window',
        operationId: 'scratch.choose-style',
        kind: 'choice',
        ownership: [{ kind: 'actor', id: null }],
        options: [
          { id: 'style.power', labelKey: 'move.scratch.style-power' },
          { id: 'style.control', labelKey: 'move.scratch.style-control' },
        ],
        allowPass: true,
      }],
    })
    expect(stored?.resolution.trace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'operation',
        operationId: 'scratch.choose-style',
        outcome: 'pending',
      }),
      expect.objectContaining({
        kind: 'choice',
        requestId: 'scratch.style-window',
        outcome: 'requested',
      }),
    ]))
    expect(stored?.resolution.rollLedger).toEqual([])

    const committedMap = harness.maps.getBySlug('pending-arena')!
    expect(committedMap.revision).toBe(5)
    expect(committedMap.metadata).toEqual(beforeMap?.metadata)
    expect(committedMap.moveUsage).toEqual(beforeMap?.moveUsage)
    expect(committedMap.encounterState?.turnResources).toEqual({})
    expect(committedMap.encounterState?.pendingResolutionSummaries).toEqual([
      response.result.pendingResolution,
    ])
    expect(response.map).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.ops.getOpRecord('pending-arena', command.opId)).toBeNull()
    expect(harness.database.connection.isTransaction).toBe(false)
  })

  it('keeps ordinary damage and conditions deferred when it publishes the pending summary', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('pending-arena')!
    const command = commandFor(map, 'op_pendingdeferred1')
    const beforeSheets = deepCloneJson(harness.sheets.list())
    const random = vi.fn(() => 0.5)

    const response = await executePending(harness, command, {
      withDeferredEffects: true,
      random,
    })

    expect(response.result).toMatchObject({ ok: true, pending: true })
    if (!isPendingMoveDeclarationResult(response.result)) return
    expect(response.result.pendingResolution.phase).toBe('after-damage')
    expect(random).toHaveBeenCalled()
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.pending.getByOrigin('pending-arena', command.opId)?.resolution)
      .toMatchObject({
        rollLedger: [expect.objectContaining({ reason: expect.any(String) })],
        trace: {
          events: expect.arrayContaining([
            expect.objectContaining({
              kind: 'operation',
              operationId: 'scratch.deferred-damage',
            }),
            expect.objectContaining({
              kind: 'operation',
              operationId: 'scratch.deferred-condition',
            }),
          ]),
        },
      })
    expect(response.map?.metadata).toEqual(map.metadata)
    expect(response.map?.moveUsage).toEqual(map.moveUsage)
  })

  it('commits an explicit pay-phase declaration HP cost once with the pending record', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('pending-arena')!
    const command = commandFor(map, 'op_pendingcost001')

    const random = vi.fn(() => 0.5)
    const first = await executePending(harness, command, {
      withDeclarationCost: true,
      withDeferredEffects: true,
      random,
    })
    expect(first.result).toMatchObject({ ok: true, pending: true })
    expect(harness.sheets.getByRef('pokemon', 'actor')).toMatchObject({
      revision: 3,
      sheet: { combat: { currentHp: 35 }, revision: 3 },
    })
    expect(first.sheetUpdates).toEqual([
      expect.objectContaining({
        kind: 'pokemon',
        slug: 'actor',
        sheet: expect.objectContaining({ combat: { currentHp: 35 }, revision: 3 }),
      }),
    ])
    expect(harness.pending.getByOrigin('pending-arena', command.opId)?.resolution.readSet)
      .toEqual([
        { kind: 'map', slug: 'pending-arena', revision: 5 },
        { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 3 },
        { kind: 'sheet', sheetKind: 'pokemon', slug: 'target', revision: 2 },
      ])

    const mapAfterFirst = deepCloneJson(harness.maps.getBySlug('pending-arena'))
    const sheetAfterFirst = deepCloneJson(harness.sheets.getByRef('pokemon', 'actor'))
    const targetAfterFirst = deepCloneJson(harness.sheets.getByRef('pokemon', 'target'))
    const storedAfterFirst = deepCloneJson(harness.pending.getByOrigin('pending-arena', command.opId))
    const randomDrawsAfterFirst = random.mock.calls.length
    expect(randomDrawsAfterFirst).toBeGreaterThan(0)
    const duplicate = await executePending(harness, command, {
      withDeclarationCost: true,
      withDeferredEffects: true,
      planner: () => { throw new Error('duplicate declaration must not replan') },
      random: () => { throw new Error('duplicate declaration must not reroll') },
    })

    expect(duplicate.result).toEqual(first.result)
    expect(harness.maps.getBySlug('pending-arena')).toEqual(mapAfterFirst)
    expect(harness.sheets.getByRef('pokemon', 'actor')).toEqual(sheetAfterFirst)
    expect(harness.sheets.getByRef('pokemon', 'target')).toEqual(targetAfterFirst)
    expect(harness.pending.getByOrigin('pending-arena', command.opId)).toEqual(storedAfterFirst)
    expect(random).toHaveBeenCalledTimes(randomDrawsAfterFirst)
    expect(harness.ops.getOpRecord('pending-arena', command.opId)).toBeNull()
  })

  it('requires conflict scopes for every approved declaration-cost write', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('pending-arena')!
    const scopedCommand = commandFor(map, 'op_pendingscope001')
    const command: ResolveMoveLivePlayCommand = {
      ...scopedCommand,
      scopes: scopedCommand.scopes.filter(scope => !(
        scope.kind === 'sheet'
        && scope.sheetKind === 'pokemon'
        && scope.sheetSlug === 'actor'
        && scope.field === 'hp'
      )),
    }
    const beforeMap = deepCloneJson(map)
    const beforeSheets = deepCloneJson(harness.sheets.list())

    const response = await executePending(harness, command, {
      withDeclarationCost: true,
    })

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('sheet:pokemon:actor:hp'),
    })
    expect(harness.maps.getBySlug('pending-arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.pending.getByOrigin('pending-arena', command.opId)).toBeNull()
  })

  it('rolls back declaration state when the full consulted sheet read set conflicts', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('pending-arena')!
    const command = commandFor(map, 'op_pendingreadconf1')
    const beforeMap = deepCloneJson(map)
    const beforeSheets = deepCloneJson(harness.sheets.list())
    const assertedReads = vi.fn(() => {
      throw new SheetRevisionConflictError([{
        kind: 'pokemon',
        slug: 'target',
        expectedRevision: 2,
        currentRevision: 3,
      }])
    })

    const response = await executePending(harness, command, {
      withDeclarationCost: true,
      sheetRepository: {
        getByRef: (kind, slug) => harness.sheets.getByRef(kind, slug),
        assertRevisions: assertedReads,
        applyLivePlayUpdate: input => harness.sheets.applyLivePlayUpdate(input),
      },
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(assertedReads).toHaveBeenCalledWith([
      { kind: 'pokemon', slug: 'actor', revision: 2 },
      { kind: 'pokemon', slug: 'target', revision: 2 },
    ])
    expect(harness.maps.getBySlug('pending-arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.pending.getByOrigin('pending-arena', command.opId)).toBeNull()
    expect(harness.database.connection.isTransaction).toBe(false)
  })

  it('returns a clean conflict and no mutation when the map CAS becomes stale', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('pending-arena')!
    const command = commandFor(map, 'op_pendingmapconf01')
    const beforeMap = deepCloneJson(map)
    const beforeSheets = deepCloneJson(harness.sheets.list())

    const response = await executePending(harness, command, {
      withDeclarationCost: true,
      mapRepository: {
        getBySlug: slug => harness.maps.getBySlug(slug),
        applyLivePlayUpdate: () => 'stale',
      },
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(harness.maps.getBySlug('pending-arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.pending.getByOrigin('pending-arena', command.opId)).toBeNull()
  })

  it('rejects a planner envelope that adds an unapproved pre-window map change', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('pending-arena')!
    const command = commandFor(map, 'op_pendinginvalid1')
    const beforeMap = deepCloneJson(map)
    const beforeSheets = deepCloneJson(harness.sheets.list())

    const response = await executePending(harness, command, {
      withDeclarationCost: true,
      planner: (input) => {
        const plan = planAuthoritativeMoveStateExecution({
          ...input,
          runtimeRegistry: pendingRegistry({ withDeclarationCost: true }),
        })
        if (!isAuthoritativePendingMoveStatePlan(plan)) {
          throw new Error('test canary must suspend')
        }
        return {
          ...plan,
          nextMap: {
            ...plan.nextMap,
            metadata: { injectedDeferredState: true },
          },
        }
      },
    })

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('outside the approved pre-window plan'),
    })
    expect(harness.maps.getBySlug('pending-arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.pending.getByOrigin('pending-arena', command.opId)).toBeNull()
  })

  it('rejects an implicitly phased declaration cost without opening a window', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('pending-arena')!
    const command = commandFor(map, 'op_pendingbadphase1')
    const beforeMap = deepCloneJson(map)
    const beforeSheets = deepCloneJson(harness.sheets.list())

    const response = await executePending(harness, command, {
      withDeclarationCost: true,
      invalidDeclarationPhase: true,
    })

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('must use the reviewed pay phase'),
    })
    expect(harness.maps.getBySlug('pending-arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.pending.getByOrigin('pending-arena', command.opId)).toBeNull()
  })

  it('rejects changed command material for a pending opId without replacing either authority record', async () => {
    const harness = createHarness()
    const originalMap = harness.maps.getBySlug('pending-arena')!
    const command = commandFor(originalMap)
    const first = await executePending(harness, command)
    expect(isPendingMoveDeclarationResult(first.result)).toBe(true)
    const mapAfterFirst = deepCloneJson(harness.maps.getBySlug('pending-arena'))
    const pendingAfterFirst = deepCloneJson(harness.pending.getByOrigin('pending-arena', command.opId))

    const changedIntent: ResolveMoveIntent = {
      ...moveIntent(),
      targetBranchId: 'different-material',
    }
    const collision = await executePending(
      harness,
      commandFor(originalMap, command.opId, changedIntent),
    )

    expect(collision.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(harness.maps.getBySlug('pending-arena')).toEqual(mapAfterFirst)
    expect(harness.pending.getByOrigin('pending-arena', command.opId)).toEqual(pendingAfterFirst)
    expect(harness.ops.getOpRecord('pending-arena', command.opId)).toBeNull()
  })

  it('rolls back map and declaration costs when pending-record persistence fails', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('pending-arena')!
    const command = commandFor(map, 'op_pendingrollback1')
    const beforeMap = deepCloneJson(map)
    const beforeSheets = deepCloneJson(harness.sheets.list())

    const response = await executePending(harness, command, {
      withDeclarationCost: true,
      pendingResolutionRepository: {
        getByOrigin: (mapSlug, opId) => harness.pending.getByOrigin(mapSlug, opId),
        create: (input) => {
          harness.pending.create(input)
          throw new Error('injected pending store failure after insert')
        },
      },
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(harness.maps.getBySlug('pending-arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.pending.getByOrigin('pending-arena', command.opId)).toBeNull()
    expect(harness.ops.getOpRecord('pending-arena', command.opId)).toBeNull()
  })
})
