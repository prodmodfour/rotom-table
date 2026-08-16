import { afterEach, describe, expect, it, vi } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  isPendingMoveDeclarationResult,
} from '#shared/moveAutomation/pendingResolution'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import type { TabletopMap } from '~/types/map'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import {
  U_TURN_ACTOR_PLACEMENT_ID,
  U_TURN_REPLACEMENT_SLUG,
  U_TURN_TARGET_PLACEMENT_ID,
  U_TURN_TRAINER_PLACEMENT_ID,
  U_TURN_V2_SEMANTIC_SCENARIOS,
  uTurnV2Fixture,
  type UTurnV2Fixture,
  type UTurnV2FixtureOptions,
} from '../fixtures/moveAutomation/uTurnV2'
import { buildAuthoritativeMoveRulesContext } from '~~/server/domain/moveAutomation/context'
import { resolveEffectiveCapabilities } from '~~/server/domain/capabilityAutomation/effectiveCapabilities'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import {
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomSource,
} from '~~/server/domain/moveAutomation/random'
import {
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
  registeredMoveAutomationRuntimeFor,
} from '~~/server/domain/moveAutomation/registry'
import { U_TURN_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/uTurn'
import {
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { parsePendingMoveResponseCommand } from '~~/server/livePlay/moveResponseCommandParser'
import { executeLivePlayResolveMoveCommandUseCase } from '~~/server/useCases/applyResolveMoveCommand'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import {
  replayMoveResponseCommandUseCase,
  resumePendingMoveResolutionUseCase,
  type ResumePendingMoveResolutionInput,
} from '~~/server/useCases/resumePendingMoveResolution'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const uTurnRow = manifestJson.moves.find(row => row.canonicalId === 'U-Turn')!
const runtime = registeredMoveAutomationRuntimeFor('U-Turn')
if (!runtime || runtime.kind !== 'movespec-v2') {
  throw new Error('U-Turn native runtime was not selected.')
}

const execute = (input: {
  readonly fixtureOptions?: UTurnV2FixtureOptions
  readonly randomValues: readonly number[]
  readonly responses?: readonly { readonly requestId: string; readonly optionId: string | null }[]
}) => {
  const fixture = uTurnV2Fixture(input.fixtureOptions)
  const context = buildAuthoritativeMoveRulesContext({
    map: fixture.map,
    pokemonSheets: fixture.pokemonSheets,
    trainerSheets: fixture.trainerSheets,
    intent: fixture.intent,
    candidatePlacementIds: [U_TURN_TARGET_PLACEMENT_ID],
    selectedPlacementIds: [U_TURN_TARGET_PLACEMENT_ID],
    random: createFiniteAuthoritativeMoveRandomStream(input.randomValues),
    time: 5_000,
    resolutionId: 'resolution-u-turn-test',
  })
  return executeMoveSpec({
    definition: runtime.definition,
    context,
    authoritativeTargetIds: [U_TURN_TARGET_PLACEMENT_ID],
    resolutionId: 'resolution-u-turn-test',
    responses: input.responses,
  })
}

const traceOperation = (
  result: ReturnType<typeof executeMoveSpec>,
  operationId: string,
) => result.trace.events.find(event => (
  event.kind === 'operation' && event.operationId === operationId
))

describe('U-Turn native MoveSpec v2', () => {
  it('selects the complete reviewed runtime and semantic evidence', () => {
    expect(uTurnRow).toMatchObject({
      baseStatus: 'complete',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '22f97610f7d6f619881dc829f6ba1d7801dfebf95a8dd9abd3622ce64da0ecaf',
        sourceModule: 'server/domain/moveAutomation/specs/uTurn.ts',
      },
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
    })
    expect(uTurnRow.scenarioIds).toEqual(
      U_TURN_V2_SEMANTIC_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(runtime).toMatchObject({
      definition: { spec: U_TURN_MOVE_SPEC },
      definitionHash: uTurnRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'U-Turn' }),
    )
  })

  it('opens the actor-owned replacement window only after a server-confirmed hit', () => {
    const hit = execute({ randomValues: [0.45, 0, 0] })
    expect(hit.kind).toBe('pending-request')
    if (hit.kind !== 'pending-request') return
    expect(hit.request).toMatchObject({
      kind: 'switch-choice',
      operationId: 'u-turn.choose-replacement',
      recipientIds: [U_TURN_ACTOR_PLACEMENT_ID],
      requestId: 'u-turn.replacement-window',
      allowPass: true,
      options: [{ id: expect.stringMatching(/^switch\.replacement\./) }],
    })
    expect(hit.hitTargetIds).toEqual([U_TURN_TARGET_PLACEMENT_ID])
    expect(hit.preWindowOperations).toEqual([])
    expect(hit.deferredContinuation.operations.map(entry => entry.operation.id)).toEqual([
      'u-turn.accuracy',
      'u-turn.damage',
    ])

    const miss = execute({ randomValues: [0] })
    expect(miss.kind).toBe('complete')
    expect(miss.hitTargetIds).toEqual([])
    expect(miss.resolvedSwitches).toEqual([])
    expect(traceOperation(miss, 'u-turn.choose-replacement')).toMatchObject({
      outcome: 'no-op',
      result: { status: 'trigger-not-met', trigger: 'on-hit' },
    })
  })

  it('supports replacement selection, recall-only pass, empty rosters, and Trapped', () => {
    const offered = execute({ randomValues: [0.45, 0, 0] })
    if (offered.kind !== 'pending-request') throw new Error('Expected U-Turn replacement choice.')
    const optionId = offered.request.options[0]!.id

    const selected = execute({
      randomValues: [0.45, 0, 0],
      responses: [{ requestId: offered.request.requestId, optionId }],
    })
    expect(selected.kind).toBe('complete')
    expect(selected.resolvedSwitches).toMatchObject([{
      optionId,
      recalledPlacementId: U_TURN_ACTOR_PLACEMENT_ID,
      choice: { replacementSheetSlug: U_TURN_REPLACEMENT_SLUG },
    }])

    const passed = execute({
      randomValues: [0.45, 0, 0],
      responses: [{ requestId: offered.request.requestId, optionId: null }],
    })
    expect(passed.kind).toBe('complete')
    expect(passed.resolvedSwitches).toEqual([expect.objectContaining({
      optionId: null,
      choice: null,
      recalledPlacementId: U_TURN_ACTOR_PLACEMENT_ID,
      stateTransferPolicy: 'none',
    })])

    const noReplacement = execute({
      fixtureOptions: { trainerTeam: ['u-turn-actor-sheet'] },
      randomValues: [0.45, 0, 0],
    })
    expect(noReplacement.kind).toBe('pending-request')
    if (noReplacement.kind === 'pending-request') {
      expect(noReplacement.request).toMatchObject({ options: [], allowPass: true })
    }

    const trapped = execute({
      fixtureOptions: { actorConditions: ['Trapped'] },
      randomValues: [0.45, 0, 0],
    })
    expect(trapped.kind).toBe('pending-request')

    const stuck = execute({
      fixtureOptions: { actorConditions: ['Stuck'] },
      randomValues: [],
    })
    expect(stuck.kind).toBe('rejected')
    if (stuck.kind === 'rejected') {
      expect(stuck.rejection).toMatchObject({
        code: 'precondition-failed',
        reasonCode: 'u-turn.dash-blocked-by-stuck',
      })
    }
  })
})

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  readonly random: AuthoritativeMoveRandomSource
  readonly drawCount: () => number
}

const databases: RotomDatabase[] = []
afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
})

const createHarness = (options: {
  readonly fixture?: UTurnV2Fixture
  readonly fixtureOptions?: UTurnV2FixtureOptions
  readonly randomValues?: readonly number[]
} = {}): Harness => {
  const fixture = options.fixture ?? uTurnV2Fixture(options.fixtureOptions)
  const values = [...(options.randomValues ?? [0.45, 0, 0])]
  let draws = 0
  const random = () => {
    const value = values[draws]
    if (value === undefined) throw new Error(`U-Turn requested unexpected random draw ${draws + 1}.`)
    draws += 1
    return value
  }
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  databases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 5_000 })
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 5_000 })
  const modes = createSqliteMapInteractionModeRepository(database)
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks([]),
  })
  maps.save({
    slug: fixture.map.slug,
    document: fixture.map,
    revision: fixture.map.revision ?? 0,
    updatedAt: fixture.map.updatedAt ?? 100,
  })
  for (const [slug, sheet] of fixture.pokemonSheets) {
    sheets.save({
      kind: 'pokemon',
      slug,
      document: deepCloneJson(sheet) as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: 100,
    })
  }
  for (const [slug, sheet] of fixture.trainerSheets) {
    sheets.save({
      kind: 'trainer',
      slug,
      document: deepCloneJson(sheet) as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: 100,
    })
  }
  return {
    database,
    maps,
    sheets,
    ops,
    pending,
    realtime,
    commandExecutor,
    random,
    drawCount: () => draws,
  }
}

const resolveCommand = (
  map: TabletopMap,
  opId: string,
): ResolveMoveLivePlayCommand => {
  const intent = uTurnV2Fixture({ mapRevision: map.revision ?? 0 }).intent
  const scopes = buildResolveMoveScopes({
    map,
    intent,
    candidateScopePlacementIds: [U_TURN_TARGET_PLACEMENT_ID],
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

const invokeDeclaration = (
  harness: Harness,
  command: ResolveMoveLivePlayCommand,
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  clientId: 'u-turn-client',
  playerProfile: null,
  command,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  pendingResolutionRepository: harness.pending,
  commandExecutor: harness.commandExecutor,
  planner: input => planAuthoritativeMoveStateExecution(input),
  random: harness.random,
  now: () => 5_000,
})

const declare = (harness: Harness, opId: string) => {
  const map = harness.maps.getBySlug('u-turn-arena')!
  return invokeDeclaration(harness, resolveCommand(map, opId))
}

const responseCommand = (input: {
  readonly resolutionId: string
  readonly windowId: string
  readonly baseRevision: number
  readonly opId: string
  readonly optionId?: string
}): MoveResponseCommand => input.optionId === undefined
  ? {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'u-turn-arena',
      baseRevision: input.baseRevision,
      type: MOVE_RESPONSE_COMMAND_TYPES.PASS,
      payload: {
        resolutionId: input.resolutionId,
        windowId: input.windowId,
      },
    }
  : {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: 'u-turn-arena',
      baseRevision: input.baseRevision,
      type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
      payload: {
        resolutionId: input.resolutionId,
        windowId: input.windowId,
        optionId: input.optionId,
      },
    }

const gmAuthorization: ResumePendingMoveResolutionInput['authorization'] = {
  source: 'gm-authority',
  chosenBy: { kind: 'gm', id: null },
}

const respond = (harness: Harness, command: MoveResponseCommand) => {
  const parsed = parsePendingMoveResponseCommand(command, {
    pendingResolutionRepository: harness.pending,
  })
  return resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: gmAuthorization,
    clientId: 'u-turn-response-client',
  }, {
    database: harness.database,
    mapRepository: harness.maps,
    sheetRepository: harness.sheets,
    pendingResolutionRepository: harness.pending,
    opRepository: harness.ops,
    realtimeEventRepository: harness.realtime,
    random: harness.random,
    now: () => 5_000,
    publishPersistedRealtimeEvent: vi.fn(),
  })
}

const currentPending = (harness: Harness) => {
  const stored = harness.pending.listByMap('u-turn-arena')
    .find(candidate => candidate.status === 'pending')
  if (!stored) throw new Error('Expected one pending U-Turn resolution.')
  return stored
}

const answerCurrent = (input: {
  readonly harness: Harness
  readonly opId: string
  readonly optionId?: string
}) => {
  const stored = currentPending(input.harness)
  const window = stored.resolution.outstandingWindows[0]!
  const map = input.harness.maps.getBySlug('u-turn-arena')!
  const command = responseCommand({
    resolutionId: stored.resolutionId,
    windowId: window.windowId,
    baseRevision: map.revision ?? 0,
    opId: input.opId,
    ...(input.optionId === undefined ? {} : { optionId: input.optionId }),
  })
  return { command, result: respond(input.harness, command) }
}

const currentHp = (harness: Harness, slug: string): number => {
  const stored = harness.sheets.getByRef('pokemon', slug)
  const combat = stored?.sheet.combat as { readonly currentHp?: unknown } | undefined
  if (typeof combat?.currentHp !== 'number') throw new Error(`Missing HP for ${slug}.`)
  return combat.currentHp
}

const hasAppliedUTurnUsage = (harness: Harness): boolean => (
  harness.pending.listByMap('u-turn-arena').some(stored => (
    stored.resolution.trace.events.some(event => (
      event.kind === 'operation' && event.operationId === 'u-turn.usage'
    ))
  ))
)

describe('U-Turn accepted durable switching saga', () => {
  it('restores the replacement window and commits attack, usage, switch, and history once', async () => {
    const harness = createHarness()
    const initialMap = harness.maps.getBySlug('u-turn-arena')!
    const declarationCommand = resolveCommand(initialMap, 'op_u_turn_hit_switch')
    const declaration = await invokeDeclaration(harness, declarationCommand)

    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    expect(currentHp(harness, 'u-turn-target-sheet')).toBe(100)
    expect(hasAppliedUTurnUsage(harness)).toBe(false)
    const stored = currentPending(harness)
    const window = stored.resolution.outstandingWindows[0]!
    expect(window).toMatchObject({
      allowPass: true,
      ownership: [{ kind: 'actor', id: null }],
      options: [{ id: expect.stringMatching(/^switch\.replacement\./) }],
    })
    expect(listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: 'u-turn-arena',
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    }).windows[0]?.window).toMatchObject({
      windowId: window.windowId,
      options: window.options,
    })

    const terminal = answerCurrent({
      harness,
      opId: 'op_u_turn_hit_switch_response',
      optionId: window.options[0]!.id,
    })
    expect(terminal.result.result).toMatchObject({ ok: true, previousRevision: 1, revision: 2 })
    expect(currentHp(harness, 'u-turn-target-sheet')).toBeLessThan(100)
    expect(hasAppliedUTurnUsage(harness)).toBe(true)
    const committed = harness.maps.getBySlug('u-turn-arena')!
    expect(committed.placements.some(({ id }) => id === U_TURN_ACTOR_PLACEMENT_ID)).toBe(false)
    const replacement = committed.placements.find(
      placement => placement.sheetSlug === U_TURN_REPLACEMENT_SLUG,
    )!
    expect(replacement).toMatchObject({
      position: { x: 2, y: 0, z: 1 },
      sideId: 'heroes',
      initiative: 18,
    })
    expect(committed.initiative).toMatchObject({
      activeId: replacement.id,
      manualOrderIds: [
        replacement.id,
        U_TURN_TRAINER_PLACEMENT_ID,
        U_TURN_TARGET_PLACEMENT_ID,
      ],
    })
    expect(committed.encounterState?.history.switches).toContainEqual(expect.objectContaining({
      kind: 'switch',
      recalledPlacementId: U_TURN_ACTOR_PLACEMENT_ID,
      sentOutPlacementId: replacement.id,
    }))
    expect(committed.encounterState?.turnResources[U_TURN_ACTOR_PLACEMENT_ID]
      ?.actions.standard.spent).toBe(1)
    expect(harness.pending.getById(stored.resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: terminal.command.opId,
    })

    const revision = committed.revision
    const hp = currentHp(harness, 'u-turn-target-sheet')
    const draws = harness.drawCount()
    const realtimeSequence = harness.realtime.cursorState().latestSequence
    const replay = replayMoveResponseCommandUseCase({ role: 'gm', command: terminal.command }, {
      database: harness.database,
      mapRepository: harness.maps,
      opRepository: harness.ops,
    })
    expect(replay?.result).toEqual(terminal.result.result)
    expect(harness.maps.getBySlug('u-turn-arena')?.revision).toBe(revision)
    expect(currentHp(harness, 'u-turn-target-sheet')).toBe(hp)
    expect(harness.drawCount()).toBe(draws)
    expect(harness.realtime.cursorState().latestSequence).toBe(realtimeSequence)
  })

  it('reconciles an exact As One faint at the Regenerator recall boundary before source loss', async () => {
    const base = uTurnV2Fixture()
    const actor = {
      ...base.pokemonSheets.get('u-turn-actor-sheet')!,
      abilities: [{ name: 'Regenerator' }],
      capabilities: { overland: 6, other: ['As One'] },
      combat: { currentHp: 30, injuries: 0, conditions: [] },
    }
    const target = {
      ...base.pokemonSheets.get('u-turn-target-sheet')!,
      combat: { currentHp: 1, injuries: 0, conditions: [] },
    }
    const pokemonSheets = new Map(base.pokemonSheets)
    pokemonSheets.set(actor.slug, actor)
    pokemonSheets.set(target.slug, target)
    const actorPlacement = base.map.placements.find(({ id }) => id === U_TURN_ACTOR_PLACEMENT_ID)!
    const targetPlacement = base.map.placements.find(({ id }) => id === U_TURN_TARGET_PLACEMENT_ID)!
    const asOneAliasPlacement = {
      ...targetPlacement,
      id: 'u-turn-as-one-mount',
      position: { ...actorPlacement.position },
    }
    const unlinkedMap = {
      ...base.map,
      placements: [...base.map.placements, asOneAliasPlacement],
    }
    const source = resolveEffectiveCapabilities({
      map: unlinkedMap,
      placement: actorPlacement,
      sheet: actor,
      sheets: { pokemon: pokemonSheets, trainer: base.trainerSheets },
    }).instances.find(instance => instance.effective && instance.canonicalId === 'As One')!
    const encounter = base.map.encounterState!
    const fixture: UTurnV2Fixture = {
      ...base,
      pokemonSheets,
      map: {
        ...unlinkedMap,
        encounterState: {
          ...encounter,
          capabilityRuntime: {
            ...encounter.capabilityRuntime!,
            links: [{
              id: 'u-turn-as-one-link', kind: 'as-one-mount',
              ownerPlacementId: U_TURN_ACTOR_PLACEMENT_ID,
              participantPlacementIds: [asOneAliasPlacement.id],
              capabilityInstanceId: source.instanceId, canonicalId: 'As One', establishedAt: 100,
              configurationId: 'Chilling Neigh', sourceOperationId: 'operation.u-turn-as-one',
            }],
          },
        },
      },
    }
    const harness = createHarness({ fixture })
    const declaration = await declare(harness, 'op_u_turn_as_one_regenerator')
    if (!isPendingMoveDeclarationResult(declaration.result)) {
      throw new Error(`Expected pending As One U-Turn: ${JSON.stringify(declaration.result)}`)
    }

    const terminal = answerCurrent({
      harness,
      opId: 'op_u_turn_as_one_regenerator_response',
    })

    expect(terminal.result.result).toMatchObject({ ok: true })
    expect(currentHp(harness, 'u-turn-target-sheet')).toBe(-15)
    expect(currentHp(harness, 'u-turn-actor-sheet')).toBe(0)
    expect(harness.maps.getBySlug('u-turn-arena')?.encounterState?.capabilityRuntime?.links).toEqual([])
  })

  it('recalls a Trapped user without replacement when the responder passes', async () => {
    const harness = createHarness({ fixtureOptions: { actorConditions: ['Trapped'] } })
    const declaration = await declare(harness, 'op_u_turn_trapped_declare')
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)

    const terminal = answerCurrent({ harness, opId: 'op_u_turn_trapped_pass' })
    expect(terminal.result.result).toMatchObject({ ok: true })
    const committed = harness.maps.getBySlug('u-turn-arena')!
    expect(currentHp(harness, 'u-turn-target-sheet')).toBeLessThan(100)
    expect(committed.placements.some(({ id }) => id === U_TURN_ACTOR_PLACEMENT_ID)).toBe(false)
    expect(committed.placements.some(({ sheetSlug }) => sheetSlug === U_TURN_REPLACEMENT_SLUG)).toBe(false)
    expect(committed.initiative).toEqual({
      activeId: null,
      round: 2,
      manualOrderIds: [U_TURN_TRAINER_PLACEMENT_ID, U_TURN_TARGET_PLACEMENT_ID],
    })
    expect(committed.temporaryHitPoints).toBeUndefined()
    expect(committed.encounterState?.history.switches).toContainEqual(expect.objectContaining({
      kind: 'recall',
      recalledPlacementId: U_TURN_ACTOR_PLACEMENT_ID,
      sentOutPlacementId: null,
    }))
    expect(hasAppliedUTurnUsage(harness)).toBe(true)
  })

  it('offers an authorized pass and recalls cleanly when no replacement exists', async () => {
    const harness = createHarness({
      fixtureOptions: { trainerTeam: ['u-turn-actor-sheet'] },
    })
    const declaration = await declare(harness, 'op_u_turn_no_replacement')
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    const stored = currentPending(harness)
    expect(stored.resolution.outstandingWindows[0]).toMatchObject({
      options: [],
      allowPass: true,
    })

    const terminal = answerCurrent({ harness, opId: 'op_u_turn_no_replacement_pass' })
    expect(terminal.result.result).toMatchObject({ ok: true })
    const committed = harness.maps.getBySlug('u-turn-arena')!
    expect(committed.placements.some(({ id }) => id === U_TURN_ACTOR_PLACEMENT_ID)).toBe(false)
    expect(committed.placements.some(({ sheetSlug }) => sheetSlug === U_TURN_REPLACEMENT_SLUG)).toBe(false)
    expect(hasAppliedUTurnUsage(harness)).toBe(true)
  })

  it('terminally conflicts a stale trainer roster without attack, usage, or recall', async () => {
    const harness = createHarness()
    const declaration = await declare(harness, 'op_u_turn_stale_roster')
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    const stored = currentPending(harness)
    const window = stored.resolution.outstandingWindows[0]!
    const trainer = harness.sheets.getByRef('trainer', 'u-turn-owner')!
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'trainer',
      slug: trainer.slug,
      expectedRevision: trainer.revision,
      nextSheet: {
        ...deepCloneJson(trainer.sheet),
        currentTeam: ['u-turn-actor-sheet'],
        revision: trainer.revision + 1,
        updatedAt: 5_500,
      },
    })).toBe('applied')

    const command = responseCommand({
      resolutionId: stored.resolutionId,
      windowId: window.windowId,
      baseRevision: harness.maps.getBySlug('u-turn-arena')!.revision ?? 0,
      opId: 'op_u_turn_stale_roster_response',
      optionId: window.options[0]!.id,
    })
    const response = respond(harness, command)
    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(currentHp(harness, 'u-turn-target-sheet')).toBe(100)
    expect(hasAppliedUTurnUsage(harness)).toBe(false)
    const map = harness.maps.getBySlug('u-turn-arena')!
    expect(map.placements.some(({ id }) => id === U_TURN_ACTOR_PLACEMENT_ID)).toBe(true)
    expect(map.placements.some(({ sheetSlug }) => sheetSlug === U_TURN_REPLACEMENT_SLUG)).toBe(false)
    expect(harness.pending.getById(stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: command.opId,
    })
  })

  it('commits miss immediately, rejects Stuck before RNG, and records critical damage', async () => {
    const miss = createHarness({ randomValues: [0] })
    const missResponse = await declare(miss, 'op_u_turn_miss')
    expect(missResponse.result).toMatchObject({ ok: true, revision: 1 })
    expect(isPendingMoveDeclarationResult(missResponse.result)).toBe(false)
    expect(currentHp(miss, 'u-turn-target-sheet')).toBe(100)
    expect(miss.maps.getBySlug('u-turn-arena')?.placements.some(
      ({ id }) => id === U_TURN_ACTOR_PLACEMENT_ID,
    )).toBe(true)
    expect(missResponse.move?.trace?.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'u-turn.usage',
      outcome: 'no-op',
    }))
    expect(miss.pending.listByMap('u-turn-arena')).toEqual([])

    const stuck = createHarness({
      fixtureOptions: { actorConditions: ['Stuck'] },
      randomValues: [],
    })
    const mapBefore = deepCloneJson(stuck.maps.getBySlug('u-turn-arena'))
    const sheetsBefore = deepCloneJson(stuck.sheets.list())
    const rejected = await declare(stuck, 'op_u_turn_stuck')
    expect(rejected.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(stuck.maps.getBySlug('u-turn-arena')).toEqual(mapBefore)
    expect(stuck.sheets.list()).toEqual(sheetsBefore)
    expect(stuck.drawCount()).toBe(0)

    const critical = createHarness({ randomValues: [0.999, 0, 0] })
    const criticalDeclaration = await declare(critical, 'op_u_turn_critical')
    expect(isPendingMoveDeclarationResult(criticalDeclaration.result)).toBe(true)
    const criticalTerminal = answerCurrent({
      harness: critical,
      opId: 'op_u_turn_critical_pass',
    })
    expect(criticalTerminal.result.result).toMatchObject({ ok: true })
    const terminalTrace = critical.pending.listByMap('u-turn-arena')[0]?.resolution.trace.events
    expect(terminalTrace).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'u-turn.damage',
      outcome: 'applied',
      result: expect.objectContaining({
        recipients: [expect.objectContaining({
          details: expect.objectContaining({
            calculation: expect.objectContaining({
              criticalHit: expect.objectContaining({ critical: true, naturalRoll: 20 }),
            }),
          }),
        })],
      }),
    }))
  })

  it('replays an exact duplicate declaration without rerolling or reopening the window', async () => {
    const harness = createHarness()
    const initialMap = harness.maps.getBySlug('u-turn-arena')!
    const command = resolveCommand(initialMap, 'op_u_turn_duplicate_declaration')
    const first = await invokeDeclaration(harness, command)
    const draws = harness.drawCount()
    const duplicate = await invokeDeclaration(harness, command)

    expect(isPendingMoveDeclarationResult(first.result)).toBe(true)
    expect(duplicate.result).toEqual(first.result)
    expect(duplicate.map).toEqual(first.map)
    expect(harness.drawCount()).toBe(draws)
    expect(harness.pending.listByMap('u-turn-arena')).toHaveLength(1)
    expect(harness.maps.getBySlug('u-turn-arena')?.revision).toBe(1)
    expect(currentHp(harness, 'u-turn-target-sheet')).toBe(100)
    expect(hasAppliedUTurnUsage(harness)).toBe(false)
  })
})
