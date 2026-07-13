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
  parsePendingMoveResolution,
} from '#shared/moveAutomation/pendingResolution'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
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
import { parsePendingMoveResponseCommand } from '~~/server/livePlay/moveResponseCommandParser'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
  type ResumePendingMoveResolutionDependencies,
} from '~~/server/useCases/resumePendingMoveResolution'
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
  readonly withSecondWindow?: boolean
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
      + (options.invalidDeclarationPhase ? 4 : 0)
      + (options.withSecondWindow ? 8 : 0),
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
        operations: [
          choiceOperation,
          ...(options.withSecondWindow ? [{
            id: 'scratch.choose-follow-up',
            kind: 'choice-request',
            source: { kind: 'move', id: 'move.scratch' },
            recipients: { kind: 'actor' },
            phase: choicePhase,
            reasonCode: 'move.scratch.choose-follow-up',
            payload: {
              requestId: 'scratch.follow-up-window',
              promptKey: 'move.scratch.choose-follow-up',
              options: [{
                id: 'follow-up.finish',
                labelKey: 'move.scratch.follow-up-finish',
              }],
              allowPass: true,
            },
          }] : []),
        ],
      }] : []),
      {
        phase: 'usage',
        operations: [{
          id: 'scratch.usage',
          kind: 'usage',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'actor' },
          phase: 'usage',
          reasonCode: 'move.scratch.frequency-use',
          payload: {
            action: 'spend',
            resourceId: 'scratch.frequency-use',
            amount: 1,
          },
        }],
      },
      {
        phase: 'cleanup',
        operations: [{
          id: 'scratch.completed',
          kind: 'log',
          source: { kind: 'move', id: 'move.scratch' },
          recipients: { kind: 'none' },
          phase: 'cleanup',
          reasonCode: 'move.scratch.completed',
          payload: { messageKey: 'move.scratch.completed', arguments: [] },
        }],
      },
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
  readonly inventories: ReturnType<typeof createSqliteGroupInventoryRepository>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
}

const createHarness = (): Harness => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const inventories = createSqliteGroupInventoryRepository(database)
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
  return { database, maps, sheets, inventories, ops, pending, commandExecutor }
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
    readonly withSecondWindow?: boolean
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
      withSecondWindow: options.withSecondWindow,
    }),
  })),
  random: options.random ?? (() => { throw new Error('the pending canary must not draw randomness') }),
  now: () => 1_000,
})

const responseCommand = (input: {
  readonly resolutionId: string
  readonly baseRevision: number
  readonly opId?: string
  readonly windowId?: string
  readonly optionId?: string
}) => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId ?? 'op_pendinganswer01',
  mapSlug: 'pending-arena',
  baseRevision: input.baseRevision,
  type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  payload: {
    resolutionId: input.resolutionId,
    windowId: input.windowId ?? 'scratch.style-window',
    optionId: input.optionId ?? 'style.power',
  },
}) as MoveResponseCommand

const executeResponse = (input: {
  readonly harness: Harness
  readonly command: MoveResponseCommand
  readonly withDeclarationCost?: boolean
  readonly withDeferredEffects?: boolean
  readonly withSecondWindow?: boolean
  readonly now?: number
  readonly random?: LivePlayResolveMoveCommandDependencies['random']
  readonly pendingResolutionRepository?: ResumePendingMoveResolutionDependencies['pendingResolutionRepository']
}) => {
  const parsed = parsePendingMoveResponseCommand(input.command, {
    pendingResolutionRepository: input.harness.pending,
  })
  return resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: {
      chosenBy: { kind: 'gm', id: null },
      source: 'gm-authority',
    },
    clientId: 'response-client',
  }, {
    database: input.harness.database,
    mapRepository: input.harness.maps,
    sheetRepository: input.harness.sheets,
    pendingResolutionRepository: input.pendingResolutionRepository ?? input.harness.pending,
    opRepository: input.harness.ops,
    runtimeRegistry: pendingRegistry({
      withDeclarationCost: input.withDeclarationCost ?? false,
      withDeferredEffects: input.withDeferredEffects,
      withSecondWindow: input.withSecondWindow,
    }),
    random: input.random ?? (() => 0),
    now: () => input.now ?? 2_000,
    publishPersistedRealtimeEvent: vi.fn(),
  })
}

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

  it('resumes one durable response, commits the final plan, and replays the terminal op exactly', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_resumecomplete01')
    const pendingResponse = await executePending(harness, declaration, {
      withDeclarationCost: true,
    })
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return

    const command = responseCommand({
      resolutionId: pendingResponse.result.pendingResolution.resolutionId,
      baseRevision: 5,
      opId: 'op_resumefinal001',
    })
    expect((harness.sheets.getByRef('pokemon', 'actor')!.sheet.combat as { currentHp: number }).currentHp).toBe(35)
    const completed = executeResponse({
      harness,
      command,
      withDeclarationCost: true,
    })

    expect(completed.result).toMatchObject({
      ok: true,
      opId: command.opId,
      previousRevision: 5,
      revision: 6,
      patches: [{ type: 'move.state' }],
    })
    expect(completed.move).toMatchObject({
      canonicalMoveName: 'Ember',
      actorPlacementId: 'actor-token',
    })
    expect(JSON.stringify(completed)).not.toContain('style.power')
    expect(harness.maps.getBySlug('pending-arena')).toMatchObject({
      revision: 6,
      encounterState: { pendingResolutionSummaries: [] },
    })
    expect((harness.sheets.getByRef('pokemon', 'actor')!.sheet.combat as { currentHp: number }).currentHp).toBe(35)
    const terminal = harness.pending.getById(
      pendingResponse.result.pendingResolution.resolutionId,
    )
    expect(terminal).toMatchObject({
      status: 'committed',
      terminalOpId: command.opId,
      resolution: {
        status: 'committed',
        outstandingWindows: [],
        chosenOptions: [{
          windowId: 'scratch.style-window',
          responseOpId: command.opId,
          optionId: 'style.power',
          chosenBy: { kind: 'gm', id: null },
        }],
      },
    })
    expect(terminal?.resolution.trace.events).toContainEqual(expect.objectContaining({
      kind: 'choice',
      requestId: 'scratch.style-window',
      outcome: 'selected',
      optionId: 'style.power',
    }))
    expect(harness.ops.getOpRecord('pending-arena', command.opId)?.result).toEqual(
      completed.result,
    )

    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(completed.result)
    expect(harness.maps.getBySlug('pending-arena')?.revision).toBe(6)
    expect(harness.pending.getById(terminal!.resolutionId)?.revision).toBe(1)
  })

  it('reuses the durable roll prefix without drawing fresh randomness on resume', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_resumerolls001')
    const pendingResponse = await executePending(harness, declaration, {
      withDeferredEffects: true,
      random: () => 0.25,
    })
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    const storedBefore = harness.pending.getById(
      pendingResponse.result.pendingResolution.resolutionId,
    )!
    expect(storedBefore.resolution.rollLedger).toHaveLength(1)
    const freshRandom = vi.fn(() => {
      throw new Error('resume must not reroll the durable damage prefix')
    })

    const completed = executeResponse({
      harness,
      command: responseCommand({
        resolutionId: storedBefore.resolutionId,
        baseRevision: 5,
        opId: 'op_resumerollfinal',
      }),
      withDeferredEffects: true,
      random: freshRandom,
    })

    expect(completed.result).toMatchObject({ ok: true, revision: 6 })
    expect(freshRandom).not.toHaveBeenCalled()
    const storedAfter = harness.pending.getById(storedBefore.resolutionId)!
    expect(storedAfter.resolution.rollLedger).toEqual(storedBefore.resolution.rollLedger)
    expect((harness.sheets.getByRef('pokemon', 'target')!.sheet.combat as { currentHp: number }).currentHp).toBeLessThan(80)
    expect(completed.move?.transaction.conditionUpdates).toContainEqual({
      id: 'target-token',
      conditions: ['Burned'],
    })
  })

  it('resumes an authorized pass as a traced null option', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_resumepassdecl')
    const pendingResponse = await executePending(harness, declaration)
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    const command: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_resumepass0001',
      mapSlug: 'pending-arena',
      baseRevision: 5,
      type: MOVE_RESPONSE_COMMAND_TYPES.PASS,
      payload: {
        resolutionId: pendingResponse.result.pendingResolution.resolutionId,
        windowId: 'scratch.style-window',
      },
    }

    const completed = executeResponse({ harness, command })

    expect(completed.result).toMatchObject({ ok: true, revision: 6 })
    const terminal = harness.pending.getById(
      pendingResponse.result.pendingResolution.resolutionId,
    )!
    expect(terminal.resolution.chosenOptions[0]?.optionId).toBeNull()
    expect(terminal.resolution.trace.events).toContainEqual(expect.objectContaining({
      kind: 'choice',
      requestId: 'scratch.style-window',
      outcome: 'passed',
      optionId: null,
    }))
  })

  it('records one response and atomically opens the next durable window', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_resumenext0001')
    const pendingResponse = await executePending(harness, declaration, {
      withSecondWindow: true,
    })
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    const resolutionId = pendingResponse.result.pendingResolution.resolutionId

    const first = executeResponse({
      harness,
      command: responseCommand({
        resolutionId,
        baseRevision: 5,
        opId: 'op_resumefirst001',
      }),
      withSecondWindow: true,
    })
    expect(first.result).toMatchObject({
      ok: true,
      previousRevision: 5,
      revision: 6,
      patches: [],
    })
    expect(harness.pending.getById(resolutionId)).toMatchObject({
      status: 'pending',
      revision: 1,
      resolution: {
        outstandingWindows: [{ windowId: 'scratch.follow-up-window' }],
        chosenOptions: [{ windowId: 'scratch.style-window' }],
        publicSummary: { outstandingWindowCount: 1, status: 'pending' },
      },
    })

    const second = executeResponse({
      harness,
      command: responseCommand({
        resolutionId,
        baseRevision: 6,
        opId: 'op_resumesecond01',
        windowId: 'scratch.follow-up-window',
        optionId: 'follow-up.finish',
      }),
      withSecondWindow: true,
      now: 3_000,
    })
    expect(second.result).toMatchObject({ ok: true, revision: 7 })
    expect(harness.pending.getById(resolutionId)).toMatchObject({
      status: 'committed',
      revision: 2,
      resolution: { chosenOptions: [{}, {}] },
    })
  })

  it('rolls back final map, sheets, op result, and pending status on persistence failure', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_resumerollback1')
    const pendingResponse = await executePending(harness, declaration)
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    const beforeMap = deepCloneJson(harness.maps.getBySlug('pending-arena'))
    const beforeSheets = deepCloneJson(harness.sheets.list())
    const beforePending = deepCloneJson(harness.pending.getById(
      pendingResponse.result.pendingResolution.resolutionId,
    ))
    const command = responseCommand({
      resolutionId: pendingResponse.result.pendingResolution.resolutionId,
      baseRevision: 5,
      opId: 'op_resumerollback2',
    })

    expect(() => executeResponse({
      harness,
      command,
      pendingResolutionRepository: {
        getById: id => harness.pending.getById(id),
        update: (update) => {
          harness.pending.update(update)
          throw new Error('injected pending update failure')
        },
      },
    })).toThrow('injected pending update failure')

    expect(harness.maps.getBySlug('pending-arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.pending.getById(beforePending!.resolutionId)).toEqual(beforePending)
    expect(harness.ops.getOpRecord('pending-arena', command.opId)).toBeNull()
  })

  it('terminally conflicts a stale full read set without applying deferred effects', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_resumestale001')
    const pendingResponse = await executePending(harness, declaration, {
      withDeferredEffects: true,
      random: () => 0,
    })
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    const target = harness.sheets.getByRef('pokemon', 'target')!
    harness.sheets.save({
      kind: 'pokemon',
      slug: target.slug,
      document: target.sheet,
      revision: 3,
      updatedAt: 1_500,
    })
    const beforeTargetHp = harness.sheets.getByRef('pokemon', 'target')!.sheet.combat

    const conflicted = executeResponse({
      harness,
      command: responseCommand({
        resolutionId: pendingResponse.result.pendingResolution.resolutionId,
        baseRevision: 5,
        opId: 'op_resumeconflict1',
      }),
      withDeferredEffects: true,
    })
    expect(conflicted.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 6,
    })
    expect(harness.pending.getById(
      pendingResponse.result.pendingResolution.resolutionId,
    )).toMatchObject({
      status: 'conflicted',
      terminalOpId: 'op_resumeconflict1',
    })
    expect(harness.sheets.getByRef('pokemon', 'target')!.sheet.combat).toEqual(beforeTargetHp)
    expect(harness.maps.getBySlug('pending-arena')).toMatchObject({
      revision: 6,
      encounterState: { pendingResolutionSummaries: [] },
    })
  })

  it('terminally conflicts when a consulted group inventory revision becomes stale', async () => {
    const harness = createHarness()
    const inventory = harness.inventories.getOrCreate({ slug: 'main', now: 900 })
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_resumegroup001')
    const pendingResponse = await executePending(harness, declaration)
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    const stored = harness.pending.getById(
      pendingResponse.result.pendingResolution.resolutionId,
    )!
    harness.pending.update({
      resolution: parsePendingMoveResolution({
        ...stored.resolution,
        readSet: [
          ...stored.resolution.readSet,
          { kind: 'group-inventory', slug: inventory.slug, revision: inventory.revision },
        ],
        updatedAt: 1_100,
        publicSummary: {
          ...stored.resolution.publicSummary,
          updatedAt: 1_100,
        },
      }),
      expectedRevision: stored.revision,
    })
    harness.inventories.save({
      slug: inventory.slug,
      document: inventory.document,
      revision: inventory.revision + 1,
      updatedAt: 1_500,
    })

    const conflicted = executeResponse({
      harness,
      command: responseCommand({
        resolutionId: stored.resolutionId,
        baseRevision: 5,
        opId: 'op_resumegroup002',
      }),
    })

    expect(conflicted.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(harness.pending.getById(stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: 'op_resumegroup002',
    })
    expect(harness.maps.getBySlug('pending-arena')).toMatchObject({
      revision: 6,
      encounterState: { pendingResolutionSummaries: [] },
    })
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
