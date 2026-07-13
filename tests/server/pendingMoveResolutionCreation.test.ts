import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
  type SetSceneLivePlayCommand,
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
  type GmCancelMoveResolutionCommand,
  type GmForceResolveMoveResolutionCommand,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import {
  createSqliteSheetRepository,
  SheetRevisionConflictError,
} from '~~/server/storage/sheetRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
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
import {
  parsePendingMoveResponseCommand,
  type ParsedMoveResponseCommand,
} from '~~/server/livePlay/moveResponseCommandParser'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
  type ResumePendingMoveResolutionDependencies,
  type ResumePendingMoveResolutionInput,
} from '~~/server/useCases/resumePendingMoveResolution'
import {
  abandonPendingMoveResolutionUseCase,
  cancelPendingMoveResolutionUseCase,
} from '~~/server/useCases/terminatePendingMoveResolution'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import { authorizePendingMoveResponseWindow } from '~~/server/useCases/pendingMoveResponseAccess'
import { executeLivePlaySceneCommandUseCase } from '~~/server/useCases/applyLivePlaySceneCommand'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const openDatabases: RotomDatabase[] = []
const tempDirectories: string[] = []

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
  while (tempDirectories.length > 0) {
    rmSync(tempDirectories.pop()!, { recursive: true, force: true })
  }
})

const closeTrackedDatabase = (database: RotomDatabase): void => {
  database.close()
  const index = openDatabases.indexOf(database)
  if (index >= 0) openDatabases.splice(index, 1)
}

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
  readonly allowPass?: boolean
  readonly canonicalMoveId?: string
}

const pendingScratchSpec = (options: PendingSpecOptions) => {
  const canonicalMoveId = options.canonicalMoveId ?? 'Ember'
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
      allowPass: options.allowPass ?? true,
    },
  }
  return {
    schemaVersion: 2,
    canonicalId: canonicalMoveId,
    version: 101
      + (options.withDeclarationCost ? 1 : 0)
      + (options.withDeferredEffects ? 2 : 0)
      + (options.invalidDeclarationPhase ? 4 : 0)
      + (options.withSecondWindow ? 8 : 0)
      + (options.allowPass === false ? 16 : 0),
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
      displayName: canonicalMoveId,
      vfxKey: null,
      tags: ['pending-test'],
    },
  }
}

const pendingRegistry = (options: PendingSpecOptions): MoveAutomationRuntimeRegistry => {
  const definition = validateMoveSpec(pendingScratchSpec(options))
  const canonicalMoveId = definition.spec.canonicalId
  const runtime: MoveSpecV2Runtime = Object.freeze({
    canonicalId: canonicalMoveId,
    kind: 'movespec-v2',
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    sourceModule: 'tests/server/pendingMoveResolutionCreation.test.ts',
    definition,
  })
  return Object.freeze({
    size: 1,
    handlerRegistry: REGISTERED_MOVE_HANDLER_REGISTRY,
    resolve: (candidateId: string) => candidateId === canonicalMoveId ? runtime : null,
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
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
}

const createHarness = (options: {
  readonly path?: string
  readonly seed?: boolean
} = {}): Harness => {
  const database = openRotomDatabase({ path: options.path ?? ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const inventories = createSqliteGroupInventoryRepository(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 1_000 })
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 1_000 })
  const modes = createSqliteMapInteractionModeRepository(database)
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks([]),
  })

  if (options.seed ?? true) {
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
  }
  return { database, maps, sheets, inventories, ops, pending, realtime, commandExecutor }
}

const moveIntent = (moveName = 'Ember'): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  placementId: 'actor-token',
  moveName,
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
    readonly allowPass?: boolean
    readonly canonicalMoveId?: string
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
      allowPass: options.allowPass,
      canonicalMoveId: options.canonicalMoveId,
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
  readonly profileId?: PlayerProfileId
}) => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId ?? 'op_pendinganswer01',
  mapSlug: 'pending-arena',
  baseRevision: input.baseRevision,
  ...(input.profileId ? { profileId: input.profileId } : {}),
  type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  payload: {
    resolutionId: input.resolutionId,
    windowId: input.windowId ?? 'scratch.style-window',
    optionId: input.optionId ?? 'style.power',
  },
}) as MoveResponseCommand

const cancelCommand = (input: {
  readonly resolutionId: string
  readonly baseRevision: number
  readonly opId?: string
}): GmCancelMoveResolutionCommand => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId ?? 'op_pendingcancel01',
  mapSlug: 'pending-arena',
  baseRevision: input.baseRevision,
  type: MOVE_RESPONSE_COMMAND_TYPES.GM_CANCEL,
  payload: { resolutionId: input.resolutionId },
})

const forcePassCommand = (input: {
  readonly resolutionId: string
  readonly baseRevision: number
  readonly opId?: string
}): GmForceResolveMoveResolutionCommand => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId ?? 'op_pendingforce001',
  mapSlug: 'pending-arena',
  baseRevision: input.baseRevision,
  type: MOVE_RESPONSE_COMMAND_TYPES.GM_FORCE_RESOLVE,
  payload: {
    resolutionId: input.resolutionId,
    windowId: 'scratch.style-window',
  },
})

interface ResponseExecutionOptions {
  readonly harness: Harness
  readonly withDeclarationCost?: boolean
  readonly withDeferredEffects?: boolean
  readonly withSecondWindow?: boolean
  readonly allowPass?: boolean
  readonly canonicalMoveId?: string
  readonly now?: number
  readonly random?: ResumePendingMoveResolutionDependencies['random']
  readonly pendingResolutionRepository?: ResumePendingMoveResolutionDependencies['pendingResolutionRepository']
  readonly publishPersistedRealtimeEvent?: ResumePendingMoveResolutionDependencies['publishPersistedRealtimeEvent']
}

const gmResponseAuthorization: ResumePendingMoveResolutionInput['authorization'] = {
  chosenBy: { kind: 'gm', id: null },
  source: 'gm-authority',
}

const executeParsedResponse = (input: ResponseExecutionOptions & {
  readonly parsed: ParsedMoveResponseCommand
  readonly role?: ResumePendingMoveResolutionInput['role']
  readonly playerProfile?: PlayerProfile | null
  readonly authorization?: ResumePendingMoveResolutionInput['authorization']
}) => resumePendingMoveResolutionUseCase({
  ...input.parsed,
  role: input.role ?? 'gm',
  playerProfile: input.playerProfile ?? null,
  authorization: input.authorization ?? gmResponseAuthorization,
  clientId: 'response-client',
}, {
  database: input.harness.database,
  mapRepository: input.harness.maps,
  sheetRepository: input.harness.sheets,
  pendingResolutionRepository: input.pendingResolutionRepository ?? input.harness.pending,
  opRepository: input.harness.ops,
  realtimeEventRepository: input.harness.realtime,
  runtimeRegistry: pendingRegistry({
    withDeclarationCost: input.withDeclarationCost ?? false,
    withDeferredEffects: input.withDeferredEffects,
    withSecondWindow: input.withSecondWindow,
    allowPass: input.allowPass,
    canonicalMoveId: input.canonicalMoveId,
  }),
  random: input.random ?? (() => 0),
  now: () => input.now ?? 2_000,
  publishPersistedRealtimeEvent: input.publishPersistedRealtimeEvent ?? vi.fn(),
})

const executeResponse = (input: ResponseExecutionOptions & {
  readonly command: MoveResponseCommand
}) => executeParsedResponse({
  ...input,
  parsed: parsePendingMoveResponseCommand(input.command, {
    pendingResolutionRepository: input.harness.pending,
  }),
})

const executeParsedTermination = (input: {
  readonly harness: Harness
  readonly parsed: ParsedMoveResponseCommand
  readonly abandon?: boolean
  readonly now?: number
}) => {
  const terminate = input.abandon
    ? abandonPendingMoveResolutionUseCase
    : cancelPendingMoveResolutionUseCase
  return terminate({
    ...input.parsed,
    role: 'gm',
    authorization: gmResponseAuthorization,
    clientId: 'termination-client',
  }, {
    database: input.harness.database,
    mapRepository: input.harness.maps,
    sheetRepository: input.harness.sheets,
    pendingResolutionRepository: input.harness.pending,
    opRepository: input.harness.ops,
    realtimeEventRepository: input.harness.realtime,
    now: () => input.now ?? 2_000,
    publishPersistedRealtimeEvent: vi.fn(),
  })
}

const executeTermination = (input: {
  readonly harness: Harness
  readonly command: MoveResponseCommand
  readonly abandon?: boolean
  readonly now?: number
}) => executeParsedTermination({
  ...input,
  parsed: parsePendingMoveResponseCommand(input.command, {
    pendingResolutionRepository: input.harness.pending,
  }),
})

describe('pending move resolution creation', () => {
  it('persists accepted-move ability follow-ups and applies one authorized response exactly once', async () => {
    const harness = createHarness()
    const actor = harness.sheets.getByRef('pokemon', 'actor')!
    const target = harness.sheets.getByRef('pokemon', 'target')!
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: 'actor',
      expectedRevision: actor.revision,
      nextSheet: {
        ...actor.sheet,
        gender: 'Male',
        abilities: [{ name: 'Celebrate' }],
      },
    })).toBe('applied')
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: 'target',
      expectedRevision: target.revision,
      nextSheet: {
        ...target.sheet,
        gender: 'Female',
        movelist: [{ name: 'Spite' }],
        abilities: [{ name: 'Cute Charm' }],
      },
    })).toBe('applied')

    const map = harness.maps.getBySlug('pending-arena')!
    const command = commandFor(map, 'op_abilitydeclare1')
    const accepted = await executeLivePlayResolveMoveCommandUseCase({
      role: 'gm',
      command,
      clientId: 'ability-client',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
      commandExecutor: harness.commandExecutor,
      random: () => 0.95,
      now: () => 1_000,
    })

    expect(accepted.result).toMatchObject({ ok: true, revision: 5 })
    expect(isPendingMoveDeclarationResult(accepted.result)).toBe(false)
    expect(harness.ops.getOpRecord('pending-arena', command.opId)).not.toBeNull()
    const summary = accepted.map?.encounterState?.pendingResolutionSummaries[0]
    const stored = summary ? harness.pending.getById(summary.resolutionId) : null
    expect(stored?.originOpId).toMatch(/^op_followup_/)
    expect(stored?.originOpId).not.toBe(command.opId)
    expect(stored?.resolution).toMatchObject({
      continuationKind: 'ability-follow-ups',
      status: 'pending',
      outstandingWindows: expect.arrayContaining([
        expect.objectContaining({
          reasonCode: 'ability.celebrate.follow-up',
          ownership: [{ kind: 'actor', id: null }],
        }),
        expect.objectContaining({
          reasonCode: 'ability.cute-charm.follow-up',
          ownership: [{ kind: 'placement', id: 'target-token' }],
        }),
        expect.objectContaining({
          reasonCode: 'move.spite.follow-up',
          ownership: [{ kind: 'placement', id: 'target-token' }],
        }),
      ]),
    })
    expect(accepted.map?.encounterState?.pendingResolutionSummaries).toEqual([
      stored?.resolution.publicSummary,
    ])
    const refreshedWindows = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: 'pending-arena',
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    expect(refreshedWindows.windows).toEqual([
      expect.objectContaining({
        window: expect.objectContaining({
          reasonCode: 'ability.celebrate.follow-up',
          options: [{ id: 'ability.celebrate.apply', labelKey: 'ability.celebrate.use-celebrate' }],
        }),
      }),
    ])

    const celebrateWindow = stored!.resolution.outstandingWindows[0]!
    const passCelebrate: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_abilitypass001',
      mapSlug: 'pending-arena',
      baseRevision: 5,
      type: MOVE_RESPONSE_COMMAND_TYPES.PASS,
      payload: {
        resolutionId: stored!.resolutionId,
        windowId: celebrateWindow.windowId,
      },
    }
    expect(executeResponse({ harness, command: passCelebrate, now: 1_500 }).result)
      .toMatchObject({ ok: true, previousRevision: 5, revision: 6 })

    const afterPass = harness.pending.getById(stored!.resolutionId)!
    const cuteCharmWindow = afterPass.resolution.outstandingWindows[0]!
    expect(cuteCharmWindow.reasonCode).toBe('ability.cute-charm.follow-up')
    const reaction: MoveResponseCommand = {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: 'op_abilityanswer01',
      mapSlug: 'pending-arena',
      baseRevision: 6,
      type: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      payload: {
        resolutionId: stored!.resolutionId,
        windowId: cuteCharmWindow.windowId,
        optionId: cuteCharmWindow.options[0]!.id,
      },
    }
    const response = executeResponse({ harness, command: reaction, now: 2_000 })
    expect(response.result).toMatchObject({ ok: true, previousRevision: 6, revision: 7 })
    expect(harness.sheets.getByRef('pokemon', 'actor')?.sheet).toMatchObject({
      combat: { conditions: ['Infatuation: target'] },
    })
    const afterResponse = harness.pending.getById(stored!.resolutionId)!
    expect(afterResponse.status).toBe('pending')
    expect(afterResponse.resolution.chosenOptions).toEqual([
      expect.objectContaining({
        windowId: celebrateWindow.windowId,
        optionId: null,
      }),
      expect.objectContaining({
        windowId: cuteCharmWindow.windowId,
        optionId: cuteCharmWindow.options[0]!.id,
      }),
    ])
    expect(afterResponse.resolution.outstandingWindows).toHaveLength(1)

    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command: reaction }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(response.result)
    expect(harness.maps.getBySlug('pending-arena')?.revision).toBe(7)
    expect(harness.sheets.getByRef('pokemon', 'actor')?.revision).toBe(4)
  })

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
    const storedDeclaration = harness.pending.getByOrigin('pending-arena', command.opId)
    expect(storedDeclaration?.resolution.readSet).toEqual([
      { kind: 'map', slug: 'pending-arena', revision: 5 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'actor', revision: 3 },
      { kind: 'sheet', sheetKind: 'pokemon', slug: 'target', revision: 2 },
    ])
    expect(storedDeclaration?.declarationPlan?.changes).toContainEqual(expect.objectContaining({
      kind: 'sheet-state',
      expectedRevision: 2,
      sourceOperationId: 'scratch.declaration-cost',
      changedFields: ['hp'],
      previous: expect.objectContaining({ combat: { currentHp: 40 } }),
      current: expect.objectContaining({ combat: { currentHp: 35 }, revision: 3 }),
    }))

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

  it('lets an authorized GM force-pass a reviewed non-passable window exactly once', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_forcepassdeclare')
    const pendingResponse = await executePending(harness, declaration, {
      allowPass: false,
    })
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    const command = forcePassCommand({
      resolutionId: pendingResponse.result.pendingResolution.resolutionId,
      baseRevision: 5,
    })

    const completed = executeResponse({
      harness,
      command,
      allowPass: false,
    })

    expect(completed.result).toMatchObject({ ok: true, revision: 6 })
    expect(harness.pending.getById(command.payload.resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: command.opId,
      resolution: {
        chosenOptions: [{
          optionId: null,
          chosenBy: { kind: 'gm', id: null },
        }],
      },
    })
    expect(harness.ops.getStoredOpRecord('pending-arena', command.opId)?.command)
      .toMatchObject({ type: 'gm-force-resolve' })
  })

  it('cancels a pending resolution with an audited terminal and typed declaration-cost inverse', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_canceldeclare01')
    const pendingResponse = await executePending(harness, declaration, {
      withDeclarationCost: true,
    })
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    expect((harness.sheets.getByRef('pokemon', 'actor')!.sheet.combat as { currentHp: number }).currentHp)
      .toBe(35)
    const command = cancelCommand({
      resolutionId: pendingResponse.result.pendingResolution.resolutionId,
      baseRevision: 5,
    })

    const cancelled = executeTermination({ harness, command })

    expect(cancelled.result).toMatchObject({
      ok: true,
      previousRevision: 5,
      revision: 6,
      patches: [],
    })
    expect((harness.sheets.getByRef('pokemon', 'actor')!.sheet.combat as { currentHp: number }).currentHp)
      .toBe(40)
    expect(cancelled.sheetUpdates).toEqual([expect.objectContaining({
      kind: 'pokemon',
      slug: 'actor',
      sheet: expect.objectContaining({ combat: { currentHp: 40 }, revision: 4 }),
    })])
    expect(harness.sheets.getByRef('pokemon', 'actor')?.revision).toBe(4)
    expect(harness.maps.getBySlug('pending-arena')).toMatchObject({
      revision: 6,
      encounterState: { pendingResolutionSummaries: [] },
    })
    const terminal = harness.pending.getById(command.payload.resolutionId)
    expect(terminal).toMatchObject({
      status: 'cancelled',
      terminalOpId: command.opId,
      resolution: { status: 'cancelled', outstandingWindows: [] },
    })
    expect(terminal?.resolution.trace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: command.opId,
      reasonCode: 'pending-resolution.gm-cancelled',
      result: expect.objectContaining({ declarationCompensation: 'applied' }),
    }))
    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(cancelled.result)
    expect(harness.maps.getBySlug('pending-arena')?.revision).toBe(6)
    expect(harness.pending.getById(command.payload.resolutionId)?.revision).toBe(1)
    expect(() => parsePendingMoveResponseCommand(command, {
      pendingResolutionRepository: harness.pending,
    })).toThrowError(expect.objectContaining({ code: 'inactive-resolution' }))
  })

  it('fails closed on a changed declaration-cost value and supports explicit non-restoring abandonment', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_abandondeclare1')
    const pendingResponse = await executePending(harness, declaration, {
      withDeclarationCost: true,
    })
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    const actor = harness.sheets.getByRef('pokemon', 'actor')!
    harness.sheets.save({
      kind: 'pokemon',
      slug: actor.slug,
      document: {
        ...actor.sheet,
        combat: { currentHp: 34 },
      },
      revision: 4,
      updatedAt: 1_500,
    })
    const command = cancelCommand({
      resolutionId: pendingResponse.result.pendingResolution.resolutionId,
      baseRevision: 5,
      opId: 'op_abandonpending1',
    })
    const beforeMap = deepCloneJson(harness.maps.getBySlug('pending-arena'))

    expect(() => executeTermination({ harness, command })).toThrowError(expect.objectContaining({
      statusCode: 409,
    }))
    expect(harness.maps.getBySlug('pending-arena')).toEqual(beforeMap)
    expect(harness.pending.getById(command.payload.resolutionId)?.status).toBe('pending')
    expect(harness.ops.getOpRecord('pending-arena', command.opId)).toBeNull()

    const abandoned = executeTermination({ harness, command, abandon: true, now: 2_500 })
    expect(abandoned.result).toMatchObject({ ok: true, revision: 6 })
    expect((harness.sheets.getByRef('pokemon', 'actor')!.sheet.combat as { currentHp: number }).currentHp)
      .toBe(34)
    expect(harness.pending.getById(command.payload.resolutionId)).toMatchObject({
      status: 'abandoned',
      resolution: {
        trace: {
          events: expect.arrayContaining([expect.objectContaining({
            reasonCode: 'pending-resolution.gm-abandoned',
            result: expect.objectContaining({ declarationCompensation: 'explicitly-abandoned' }),
          })]),
        },
      },
    })
  })

  it('expires pending work from a scene-end game event and compensates costs in the scene transaction', async () => {
    const harness = createHarness()
    const declaration = commandFor(harness.maps.getBySlug('pending-arena')!, 'op_expiredeclare01')
    const pendingResponse = await executePending(harness, declaration, {
      withDeclarationCost: true,
    })
    expect(isPendingMoveDeclarationResult(pendingResponse.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(pendingResponse.result)) return
    const command: SetSceneLivePlayCommand = {
      schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
      opId: 'op_sceneexpire001',
      mapSlug: 'pending-arena',
      baseRevision: 5,
      type: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
      scopes: [{ kind: 'map', lane: 'scene' }],
      payload: { name: null },
    }

    const ended = await executeLivePlaySceneCommandUseCase({
      role: 'gm',
      command,
      expectedType: LIVE_PLAY_COMMAND_TYPES.SET_SCENE,
    }, {
      database: harness.database,
      commandExecutor: harness.commandExecutor,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
      now: () => 3_000,
    })

    expect(ended.result).toMatchObject({ ok: true, revision: 6 })
    expect((harness.sheets.getByRef('pokemon', 'actor')!.sheet.combat as { currentHp: number }).currentHp)
      .toBe(40)
    const expired = harness.pending.getById(
      pendingResponse.result.pendingResolution.resolutionId,
    )
    expect(expired).toMatchObject({
      status: 'expired',
      terminalOpId: null,
      resolution: { status: 'expired', outstandingWindows: [] },
    })
    expect(expired?.resolution.trace.events).toContainEqual(expect.objectContaining({
      operationId: expect.stringMatching(/^scene\./),
      reasonCode: 'pending-resolution.scene-ended',
    }))
    expect(harness.maps.getBySlug('pending-arena')).toMatchObject({
      encounterState: { pendingResolutionSummaries: [] },
    })
    expect(harness.maps.getBySlug('pending-arena')).not.toHaveProperty('activeScene')
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

const TRACKED_PENDING_MOVE = 'Fire Blast'
const TRACKED_PENDING_MOVE_KEY = 'fire-blast'

const trackedMoveUses = (harness: Harness): number => (
  harness.maps.getBySlug('pending-arena')?.moveUsage
    ?.byPlacementId['actor-token']?.[TRACKED_PENDING_MOVE_KEY]?.uses
  ?? 0
)

const sheetCurrentHp = (harness: Harness, slug: string): number => {
  const combat = harness.sheets.getByRef('pokemon', slug)?.sheet.combat
  const currentHp = combat && typeof combat === 'object'
    ? (combat as { readonly currentHp?: unknown }).currentHp
    : null
  if (typeof currentHp !== 'number') {
    throw new Error(`Expected ${slug} to have authoritative current HP.`)
  }
  return currentHp
}

const durableResponseState = (harness: Harness, resolutionId: string) => deepCloneJson({
  map: harness.maps.getBySlug('pending-arena'),
  sheets: harness.sheets.list(),
  pending: harness.pending.getById(resolutionId),
  operationCount: (harness.database.connection.prepare(
    'SELECT COUNT(*) AS count FROM live_play_ops',
  ).get() as { count: number }).count,
  realtimeCursor: harness.realtime.cursorState(),
})

const responderProfile = (id: string, displayName: string): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: id as PlayerProfileId,
  displayName: displayName as PlayerProfileDisplayName,
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: 'actor' }],
})

const parseResponse = (harness: Harness, command: MoveResponseCommand) => (
  parsePendingMoveResponseCommand(command, {
    pendingResolutionRepository: harness.pending,
  })
)

const authorizePlayerResponse = (
  harness: Harness,
  parsed: ParsedMoveResponseCommand,
  profile: PlayerProfile,
) => authorizePendingMoveResponseWindow({
  role: 'player',
  command: parsed.command,
  playerProfile: profile,
  storedResolution: parsed.storedResolution,
  window: parsed.window,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
})

const declareTrackedPending = async (input: {
  readonly harness: Harness
  readonly opId: string
  readonly withDeclarationCost?: boolean
  readonly withDeferredEffects?: boolean
  readonly withSecondWindow?: boolean
}) => {
  const actor = input.harness.sheets.getByRef('pokemon', 'actor')!
  input.harness.sheets.save({
    kind: 'pokemon',
    slug: actor.slug,
    document: {
      ...actor.sheet,
      movelist: [{ name: 'Ember' }, { name: TRACKED_PENDING_MOVE }],
    },
    revision: actor.revision,
    updatedAt: actor.updatedAt,
  })
  const sourceMap = input.harness.maps.getBySlug('pending-arena')!
  if (!sourceMap.moveUsage) {
    input.harness.maps.save({
      slug: sourceMap.slug,
      document: {
        ...sourceMap,
        moveUsage: {
          scene: { name: 'Scene A', startedAt: 100 },
          byPlacementId: {
            'actor-token': {
              baseline: {
                moveName: 'Baseline',
                frequency: 'scene',
                uses: 1,
                updatedAt: 100,
              },
            },
          },
        },
      },
      revision: sourceMap.revision ?? 0,
      updatedAt: sourceMap.updatedAt ?? 100,
    })
  }
  const command = commandFor(
    input.harness.maps.getBySlug('pending-arena')!,
    input.opId,
    moveIntent(TRACKED_PENDING_MOVE),
  )
  const response = await executePending(input.harness, command, {
    withDeclarationCost: input.withDeclarationCost,
    withDeferredEffects: input.withDeferredEffects,
    withSecondWindow: input.withSecondWindow,
    canonicalMoveId: TRACKED_PENDING_MOVE,
    random: input.withDeferredEffects ? () => 0.25 : undefined,
  })
  if (!isPendingMoveDeclarationResult(response.result)) {
    throw new Error('Tracked response-race declaration did not suspend.')
  }
  return {
    command,
    response,
    resolutionId: response.result.pendingResolution.resolutionId,
  }
}

describe('pending move response concurrency and recovery', () => {
  it('lets exactly one of two eligible responders continue a window from the same snapshot', async () => {
    const harness = createHarness()
    const declared = await declareTrackedPending({
      harness,
      opId: 'op_racerdeclare01',
      withDeferredEffects: true,
    })
    const firstProfile = responderProfile('profile_respondera', 'Responder A')
    const secondProfile = responderProfile('profile_responderb', 'Responder B')
    const firstCommand = responseCommand({
      resolutionId: declared.resolutionId,
      baseRevision: 5,
      opId: 'op_respondera01',
      profileId: firstProfile.id,
    })
    const secondCommand = responseCommand({
      resolutionId: declared.resolutionId,
      baseRevision: 5,
      opId: 'op_responderb01',
      profileId: secondProfile.id,
    })
    const firstParsed = parseResponse(harness, firstCommand)
    const secondParsed = parseResponse(harness, secondCommand)
    const firstAuthorization = authorizePlayerResponse(harness, firstParsed, firstProfile)
    const secondAuthorization = authorizePlayerResponse(harness, secondParsed, secondProfile)

    const winner = executeParsedResponse({
      harness,
      parsed: firstParsed,
      role: 'player',
      playerProfile: firstProfile,
      authorization: firstAuthorization,
      withDeferredEffects: true,
      canonicalMoveId: TRACKED_PENDING_MOVE,
      random: () => { throw new Error('the durable roll prefix must not reroll') },
    })

    expect(winner.result).toMatchObject({ ok: true, previousRevision: 5, revision: 6 })
    expect(sheetCurrentHp(harness, 'target')).toBeLessThan(80)
    expect(trackedMoveUses(harness)).toBe(1)
    const stateAfterWinner = durableResponseState(harness, declared.resolutionId)

    expect(() => executeParsedResponse({
      harness,
      parsed: secondParsed,
      role: 'player',
      playerProfile: secondProfile,
      authorization: secondAuthorization,
      withDeferredEffects: true,
      canonicalMoveId: TRACKED_PENDING_MOVE,
    })).toThrowError(expect.objectContaining({ statusCode: 409 }))

    expect(durableResponseState(harness, declared.resolutionId)).toEqual(stateAfterWinner)
    expect(harness.pending.getById(declared.resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: firstCommand.opId,
    })
    expect(harness.ops.getOpRecord('pending-arena', secondCommand.opId)).toBeNull()
  })

  it.each(['response', 'cancel'] as const)(
    'makes a %s winner deterministic when a response races GM cancellation',
    async (winnerKind) => {
      const harness = createHarness()
      const declared = await declareTrackedPending({
        harness,
        opId: `op_${winnerKind}cancelrace`,
        withDeclarationCost: true,
        withDeferredEffects: true,
      })
      const response = responseCommand({
        resolutionId: declared.resolutionId,
        baseRevision: 5,
        opId: 'op_cancelraceresponse',
      })
      const cancellation = cancelCommand({
        resolutionId: declared.resolutionId,
        baseRevision: 5,
        opId: 'op_cancelracecancel',
      })
      const parsedResponse = parseResponse(harness, response)
      const parsedCancellation = parseResponse(harness, cancellation)

      if (winnerKind === 'response') {
        expect(executeParsedResponse({
          harness,
          parsed: parsedResponse,
          withDeclarationCost: true,
          withDeferredEffects: true,
          canonicalMoveId: TRACKED_PENDING_MOVE,
        }).result).toMatchObject({ ok: true, revision: 6 })
      }
      else {
        expect(executeParsedTermination({
          harness,
          parsed: parsedCancellation,
        }).result).toMatchObject({ ok: true, revision: 6 })
      }
      const stateAfterWinner = durableResponseState(harness, declared.resolutionId)

      const lose = winnerKind === 'response'
        ? () => executeParsedTermination({ harness, parsed: parsedCancellation })
        : () => executeParsedResponse({
            harness,
            parsed: parsedResponse,
            withDeclarationCost: true,
            withDeferredEffects: true,
            canonicalMoveId: TRACKED_PENDING_MOVE,
          })
      expect(lose).toThrowError(expect.objectContaining({ statusCode: 409 }))
      expect(durableResponseState(harness, declared.resolutionId)).toEqual(stateAfterWinner)

      expect(harness.pending.getById(declared.resolutionId)?.status).toBe(
        winnerKind === 'response' ? 'committed' : 'cancelled',
      )
      expect(sheetCurrentHp(harness, 'actor')).toBe(winnerKind === 'response' ? 35 : 40)
      if (winnerKind === 'response') expect(sheetCurrentHp(harness, 'target')).toBeLessThan(80)
      else expect(sheetCurrentHp(harness, 'target')).toBe(80)
      expect(trackedMoveUses(harness)).toBe(winnerKind === 'response' ? 1 : 0)
      const loserOpId = winnerKind === 'response' ? cancellation.opId : response.opId
      expect(harness.ops.getOpRecord('pending-arena', loserOpId)).toBeNull()
    },
  )

  it.each(['map', 'sheet'] as const)(
    'conflicts a response after a relevant %s edit without applying deferred effects',
    async (editedResource) => {
      const harness = createHarness()
      const declared = await declareTrackedPending({
        harness,
        opId: `op_${editedResource}editdeclare`,
        withDeferredEffects: true,
      })
      const command = responseCommand({
        resolutionId: declared.resolutionId,
        baseRevision: 5,
        opId: `op_${editedResource}editresponse`,
      })
      const parsed = parseResponse(harness, command)

      if (editedResource === 'map') {
        const current = harness.maps.getBySlug('pending-arena')!
        expect(harness.maps.applyLivePlayUpdate({
          slug: current.slug,
          expectedRevision: 5,
          nextMap: {
            ...deepCloneJson(current),
            metadata: { ...current.metadata, concurrentEdit: 'map' },
            updatedAt: 1_500,
          },
        })).toBe('applied')
      }
      else {
        const target = harness.sheets.getByRef('pokemon', 'target')!
        expect(harness.sheets.applyLivePlayUpdate({
          kind: 'pokemon',
          slug: target.slug,
          expectedRevision: target.revision,
          nextSheet: { ...target.sheet, nickname: 'edited-target' },
        })).toBe('applied')
      }

      const conflicted = executeParsedResponse({
        harness,
        parsed,
        withDeferredEffects: true,
        canonicalMoveId: TRACKED_PENDING_MOVE,
      })

      expect(conflicted.result).toMatchObject({
        ok: false,
        reason: 'conflict',
        currentRevision: editedResource === 'map' ? 7 : 6,
      })
      expect(conflicted).not.toHaveProperty('move')
      expect(harness.pending.getById(declared.resolutionId)).toMatchObject({
        status: 'conflicted',
        terminalOpId: command.opId,
      })
      expect(sheetCurrentHp(harness, 'target')).toBe(80)
      expect(trackedMoveUses(harness)).toBe(0)
      if (editedResource === 'map') {
        expect(harness.maps.getBySlug('pending-arena')?.metadata).toMatchObject({
          concurrentEdit: 'map',
        })
      }
      else {
        expect(harness.sheets.getByRef('pokemon', 'target')?.sheet.nickname).toBe('edited-target')
      }
    },
  )

  it('recovers a lost HTTP response from the persisted accepted SSE terminal without repeating work', async () => {
    const harness = createHarness()
    const declared = await declareTrackedPending({
      harness,
      opId: 'op_losthttpdeclare',
      withDeferredEffects: true,
    })
    const command = responseCommand({
      resolutionId: declared.resolutionId,
      baseRevision: 5,
      opId: 'op_losthttpresponse',
    })
    const published: PersistedRealtimeEvent[] = []

    executeResponse({
      harness,
      command,
      withDeferredEffects: true,
      canonicalMoveId: TRACKED_PENDING_MOVE,
      publishPersistedRealtimeEvent: event => published.push(event),
    })

    const acceptedSse = published.find(event => (
      event.event.type === 'live-play-command-accepted'
      && event.event.opId === command.opId
    ))
    expect(acceptedSse).toMatchObject({
      access: { kind: 'map-access', mapSlug: 'pending-arena' },
      event: {
        opId: command.opId,
        previousRevision: 5,
        revision: 6,
      },
    })
    expect(trackedMoveUses(harness)).toBe(1)
    expect(sheetCurrentHp(harness, 'target')).toBeLessThan(80)
    const stateAfterAcceptedSse = durableResponseState(harness, declared.resolutionId)
    const storedResult = harness.ops.getStoredOpRecord('pending-arena', command.opId)?.result

    const recovered = replayMoveResponseCommandUseCase({ role: 'gm', command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })

    expect(recovered?.result).toEqual(storedResult)
    expect(durableResponseState(harness, declared.resolutionId)).toEqual(stateAfterAcceptedSse)
  })

  it('restores the current window after refresh and rejects duplicate option submissions', async () => {
    const harness = createHarness()
    const declared = await declareTrackedPending({
      harness,
      opId: 'op_refreshdeclare01',
      withSecondWindow: true,
    })
    const firstCommand = responseCommand({
      resolutionId: declared.resolutionId,
      baseRevision: 5,
      opId: 'op_refreshfirst001',
    })
    const first = executeResponse({
      harness,
      command: firstCommand,
      withSecondWindow: true,
      canonicalMoveId: TRACKED_PENDING_MOVE,
    })
    expect(first.result).toMatchObject({ ok: true, revision: 6 })
    const stateAfterFirst = durableResponseState(harness, declared.resolutionId)

    expect(replayMoveResponseCommandUseCase({ role: 'gm', command: firstCommand }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })?.result).toEqual(first.result)
    const duplicateCommand = responseCommand({
      resolutionId: declared.resolutionId,
      baseRevision: 6,
      opId: 'op_refreshduplicate',
    })
    expect(() => parseResponse(harness, duplicateCommand)).toThrowError(expect.objectContaining({
      code: 'duplicate-response',
    }))
    expect(durableResponseState(harness, declared.resolutionId)).toEqual(stateAfterFirst)

    const refreshedWindows = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: 'pending-arena',
    }, {
      database: harness.database,
      mapRepository: createSqliteMapRepository<TabletopMap>(harness.database),
      sheetRepository: createSqliteSheetRepository<Record<string, unknown>>(harness.database),
      pendingResolutionRepository: createSqlitePendingMoveResolutionRepository(harness.database),
    })
    expect(refreshedWindows.windows).toEqual([
      expect.objectContaining({
        window: expect.objectContaining({
          windowId: 'scratch.follow-up-window',
          options: [{ id: 'follow-up.finish', labelKey: 'move.scratch.follow-up-finish' }],
        }),
      }),
    ])

    const currentWindow = refreshedWindows.windows[0]!.window
    const completed = executeResponse({
      harness,
      command: responseCommand({
        resolutionId: declared.resolutionId,
        baseRevision: 6,
        opId: 'op_refreshsecond01',
        windowId: currentWindow.windowId,
        optionId: currentWindow.options[0]!.id,
      }),
      withSecondWindow: true,
      canonicalMoveId: TRACKED_PENDING_MOVE,
    })
    expect(completed.result).toMatchObject({ ok: true, revision: 7 })
    expect(harness.pending.getById(declared.resolutionId)).toMatchObject({
      status: 'committed',
      revision: 2,
      resolution: { chosenOptions: [{}, {}] },
    })
    expect(trackedMoveUses(harness)).toBe(1)
  })

  it('resumes after a database restart and keeps the terminal replay idempotent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-response-restart-'))
    tempDirectories.push(directory)
    const databasePath = join(directory, 'rotom-table.sqlite')
    const originalHarness = createHarness({ path: databasePath })
    const declared = await declareTrackedPending({
      harness: originalHarness,
      opId: 'op_restartdeclare1',
      withDeclarationCost: true,
      withDeferredEffects: true,
    })
    const command = responseCommand({
      resolutionId: declared.resolutionId,
      baseRevision: 5,
      opId: 'op_restartresponse',
    })
    closeTrackedDatabase(originalHarness.database)

    const restartedHarness = createHarness({ path: databasePath, seed: false })
    const restoredWindows = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: 'pending-arena',
    }, {
      database: restartedHarness.database,
      mapRepository: restartedHarness.maps,
      sheetRepository: restartedHarness.sheets,
      pendingResolutionRepository: restartedHarness.pending,
    })
    expect(restoredWindows.windows).toHaveLength(1)
    expect(restoredWindows.windows[0]?.resolution.resolutionId).toBe(declared.resolutionId)

    const completed = executeResponse({
      harness: restartedHarness,
      command,
      withDeclarationCost: true,
      withDeferredEffects: true,
      canonicalMoveId: TRACKED_PENDING_MOVE,
      random: () => { throw new Error('restart must reuse the durable roll ledger') },
    })
    expect(completed.result).toMatchObject({ ok: true, revision: 6 })
    expect(sheetCurrentHp(restartedHarness, 'actor')).toBe(35)
    expect(sheetCurrentHp(restartedHarness, 'target')).toBeLessThan(80)
    expect(trackedMoveUses(restartedHarness)).toBe(1)
    expect(restartedHarness.pending.getById(declared.resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: command.opId,
    })
    closeTrackedDatabase(restartedHarness.database)

    const replayHarness = createHarness({ path: databasePath, seed: false })
    const stateBeforeReplay = durableResponseState(replayHarness, declared.resolutionId)
    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command }, {
      database: replayHarness.database,
      mapRepository: replayHarness.maps,
      opRepository: replayHarness.ops,
    })
    expect(replay?.result).toEqual(completed.result)
    expect(durableResponseState(replayHarness, declared.resolutionId)).toEqual(stateBeforeReplay)
    expect(trackedMoveUses(replayHarness)).toBe(1)
  })
})
