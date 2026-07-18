import { afterEach, describe, expect, it, vi } from 'vitest'
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
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import {
  applyEncounterEffectLifecycleEvent,
} from '~~/server/domain/moveAutomation/effectLifecycle'
import {
  ASTONISH_AWARE_OPTION_ID,
  ASTONISH_UNAWARE_MARKER_CAPABILITY_ID,
  ASTONISH_UNAWARE_OPTION_ID,
} from '~~/server/domain/moveAutomation/handlers/astonish'
import {
  createFiniteAuthoritativeMoveRandomStream,
  type AuthoritativeMoveRandomSource,
} from '~~/server/domain/moveAutomation/random'
import {
  registeredMoveAutomationRuntimeFor,
} from '~~/server/domain/moveAutomation/registry'
import {
  buildAuthoritativeMoveRulesContext,
} from '~~/server/domain/moveAutomation/context'
import { executeMoveSpec } from '~~/server/domain/moveAutomation/executeSpec'
import {
  planAuthoritativeMoveStateExecution,
} from '~~/server/domain/planAuthoritativeMoveState'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { parsePendingMoveResponseCommand } from '~~/server/livePlay/moveResponseCommandParser'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository, type PersistedSheet } from '~~/server/storage/sheetRepository'
import { executeLivePlayResolveMoveCommandUseCase } from '~~/server/useCases/applyResolveMoveCommand'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import {
  resumePendingMoveResolutionUseCase,
  type ResumePendingMoveResolutionInput,
} from '~~/server/useCases/resumePendingMoveResolution'
import {
  OPENING_MOVE_ACTOR_ID,
  OPENING_MOVE_ACTOR_SLUG,
  OPENING_MOVE_TARGET_ID,
  OPENING_MOVE_TARGET_SLUG,
  openingMoveV2Fixture,
} from '../fixtures/moveAutomation/openingMovesV2'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import {
  LivePlayIntegrationHarness,
  assertAccepted,
} from './livePlayIntegrationHarness'

interface DurableHarness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  readonly random: AuthoritativeMoveRandomSource
  readonly drawCount: () => number
  readonly fixture: ReturnType<typeof openingMoveV2Fixture>
}

const databases: RotomDatabase[] = []
const integrationHarnesses: LivePlayIntegrationHarness[] = []

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close()
  while (integrationHarnesses.length > 0) integrationHarnesses.pop()?.dispose()
})

const persistedSheets = (
  sheets: ReadonlyMap<string, CharacterSheet>,
): readonly PersistedSheet[] => [...sheets].map(([slug, sheet]) => ({
  kind: 'pokemon' as const,
  slug,
  revision: sheet.revision ?? 0,
  updatedAt: 100,
  sheet: { ...deepCloneJson(sheet), slug, updatedAt: 100 },
}))

const createDurableHarness = (
  randomValues: readonly number[] = [0.45, 0],
): DurableHarness => {
  const fixture = openingMoveV2Fixture({ moveName: 'Astonish', mapRevision: 0 })
  const values = [...randomValues]
  let draws = 0
  const random = () => {
    const value = values[draws]
    if (value === undefined) {
      throw new Error(`Astonish requested unexpected random draw ${draws + 1}.`)
    }
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
  for (const sheet of persistedSheets(fixture.pokemonSheets)) {
    sheets.save({
      kind: sheet.kind,
      slug: sheet.slug,
      document: sheet.sheet,
      revision: sheet.revision,
      updatedAt: sheet.updatedAt,
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
    fixture,
  }
}

const resolveCommand = (
  harness: DurableHarness,
  opId: string,
): ResolveMoveLivePlayCommand => {
  const map = harness.maps.getBySlug(harness.fixture.map.slug)!
  const scopes = buildResolveMoveScopes({
    map,
    intent: harness.fixture.intent,
    candidateScopePlacementIds: [OPENING_MOVE_TARGET_ID],
  })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: map.slug,
    baseRevision: map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload: harness.fixture.intent,
  }
}

const declareAstonish = (
  harness: DurableHarness,
  command: ResolveMoveLivePlayCommand,
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  clientId: 'astonish-declaration-client',
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

const responseCommand = (input: {
  readonly resolutionId: string
  readonly windowId: string
  readonly baseRevision: number
  readonly opId: string
  readonly optionId: string
}): MoveResponseCommand => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId,
  mapSlug: 'opening-moves-arena',
  baseRevision: input.baseRevision,
  type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  payload: {
    resolutionId: input.resolutionId,
    windowId: input.windowId,
    optionId: input.optionId,
  },
})

const gmAuthorization: ResumePendingMoveResolutionInput['authorization'] = {
  source: 'gm-authority',
  chosenBy: { kind: 'gm', id: null },
}

const respond = (
  harness: DurableHarness,
  command: MoveResponseCommand,
) => {
  const parsed = parsePendingMoveResponseCommand(command, {
    pendingResolutionRepository: harness.pending,
  })
  return () => resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: gmAuthorization,
    clientId: 'astonish-response-client',
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

const currentConditions = (
  sheets: DurableHarness['sheets'],
): readonly string[] => {
  const stored = sheets.getByRef('pokemon', OPENING_MOVE_TARGET_SLUG)
  const combat = stored?.sheet.combat as { readonly conditions?: unknown } | undefined
  return Array.isArray(combat?.conditions) ? combat.conditions as string[] : []
}

const isAstonishMarker = (effect: NonNullable<TabletopMap['encounterState']>['effects'][number]) => (
  effect.kind === 'capability'
  && effect.payload.capabilityId === ASTONISH_UNAWARE_MARKER_CAPABILITY_ID
)

describe('durable opening-move command flow', () => {
  it('persists Astonish awareness, reconnects, commits automatic Flinch once, and consumes the scene branch', async () => {
    const harness = createDurableHarness([0.45, 0])
    const command = resolveCommand(harness, 'op_astonish_unaware_declare')
    const declaration = await declareAstonish(harness, command)
    const drawsAfterDeclaration = harness.drawCount()
    const duplicateDeclaration = await declareAstonish(harness, command)

    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(declaration.result)) return
    expect(duplicateDeclaration.result).toEqual(declaration.result)
    expect(harness.drawCount()).toBe(drawsAfterDeclaration)
    expect(drawsAfterDeclaration).toBe(2)
    expect(currentConditions(harness.sheets)).toEqual([])
    expect(harness.sheets.getByRef('pokemon', OPENING_MOVE_TARGET_SLUG)?.sheet)
      .toMatchObject({ combat: { currentHp: 500 } })
    expect(harness.maps.getBySlug('opening-moves-arena')?.moveUsage).toBeUndefined()
    expect(harness.maps.getBySlug('opening-moves-arena')?.encounterState
      ?.turnResources[OPENING_MOVE_ACTOR_ID]).toMatchObject({
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: expect.arrayContaining([
          expect.objectContaining({ id: 'encounter.acted-since-entry' }),
        ]),
      })

    const listed = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: 'opening-moves-arena',
      playerProfile: null,
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    expect(listed.windows).toMatchObject([{
      resolution: { resolutionId: declaration.result.pendingResolution.resolutionId },
      window: {
        windowId: 'astonish.target-awareness',
        options: [
          { id: 'target-aware' },
          { id: ASTONISH_UNAWARE_OPTION_ID },
        ],
        allowPass: false,
      },
    }])

    const window = harness.pending.listByMap('opening-moves-arena')[0]!
      .resolution.outstandingWindows[0]!
    expect(window.ownership).toEqual([{
      kind: 'target',
      id: OPENING_MOVE_TARGET_ID,
    }])
    const response = responseCommand({
      resolutionId: declaration.result.pendingResolution.resolutionId,
      windowId: window.windowId,
      baseRevision: harness.maps.getBySlug('opening-moves-arena')!.revision ?? 0,
      opId: 'op_astonish_unaware_response',
      optionId: ASTONISH_UNAWARE_OPTION_ID,
    })
    const invoke = respond(harness, response)
    const accepted = invoke()
    const drawsAfterCommit = harness.drawCount()
    const duplicate = invoke()

    expect(accepted.result).toMatchObject({ ok: true, previousRevision: 1, revision: 2 })
    expect(duplicate.result).toEqual(accepted.result)
    expect(harness.drawCount()).toBe(drawsAfterCommit)
    expect(drawsAfterCommit).toBe(2)
    expect(currentConditions(harness.sheets)).toEqual(['Flinch', 'Vulnerable'])
    const acceptedMap = harness.maps.getBySlug('opening-moves-arena')!
    expect(acceptedMap.encounterState?.effects.filter(isAstonishMarker)).toHaveLength(1)
    expect(harness.pending.getById(declaration.result.pendingResolution.resolutionId))
      .toMatchObject({
        status: 'committed',
        terminalOpId: 'op_astonish_unaware_response',
        resolution: {
          chosenOptions: [{
            windowId: 'astonish.target-awareness',
            optionId: ASTONISH_UNAWARE_OPTION_ID,
          }],
        },
      })

    const runtime = registeredMoveAutomationRuntimeFor('Astonish')
    if (!runtime || runtime.kind !== 'movespec-v2') throw new Error('Astonish v2 is missing.')
    const repeatedFixture = openingMoveV2Fixture({ moveName: 'Astonish' })
    const repeatedContext = buildAuthoritativeMoveRulesContext({
      ...repeatedFixture,
      map: {
        ...repeatedFixture.map,
        encounterState: {
          ...repeatedFixture.map.encounterState!,
          effects: acceptedMap.encounterState?.effects ?? [],
        },
      },
      candidatePlacementIds: [OPENING_MOVE_TARGET_ID],
      selectedPlacementIds: [OPENING_MOVE_TARGET_ID],
      random: createFiniteAuthoritativeMoveRandomStream([0.45, 0]),
      time: 5_000,
      resolutionId: 'resolution.astonish.repeated',
    })
    const repeated = executeMoveSpec({
      definition: runtime.definition,
      context: repeatedContext,
      authoritativeTargetIds: [OPENING_MOVE_TARGET_ID],
    })
    expect(repeated.kind).toBe('complete')
    expect(repeated.trace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'astonish.unaware-flinch-available',
      outcome: false,
      reasonCode: 'astonish.unaware-flinch-already-used',
    }))

    const cleaned = applyEncounterEffectLifecycleEvent(
      { effects: acceptedMap.encounterState?.effects ?? [] },
      { kind: 'scene-end' },
    )
    expect(cleaned.effects.filter(isAstonishMarker)).toEqual([])
    expect(cleaned.transitions).toContainEqual(expect.objectContaining({
      kind: 'expired',
      reasonCode: 'effect-duration-expired',
    }))
  })

  it.each([
    {
      caseId: 'threshold',
      label: '15+ threshold',
      randomValues: [0.7, 0],
      expectedConditions: ['Flinch', 'Vulnerable'],
      expectedOutcome: 'applied',
      expectedCritical: false,
    },
    {
      caseId: 'below',
      label: 'below threshold',
      randomValues: [0.45, 0],
      expectedConditions: [],
      expectedOutcome: 'no-op',
      expectedCritical: false,
    },
    {
      caseId: 'critical',
      label: 'critical hit',
      randomValues: [0.999, 0],
      expectedConditions: ['Flinch', 'Vulnerable'],
      expectedOutcome: 'applied',
      expectedCritical: true,
    },
  ] as const)(
    'resolves the aware Astonish $label branch through authoritative condition rules',
    async ({ caseId, randomValues, expectedConditions, expectedOutcome, expectedCritical }) => {
      const harness = createDurableHarness(randomValues)
      const declaration = await declareAstonish(
        harness,
        resolveCommand(harness, `op_astonish_aware_${caseId}_declare`),
      )
      if (!isPendingMoveDeclarationResult(declaration.result)) {
        throw new Error('Astonish did not suspend for awareness.')
      }
      const stored = harness.pending.getById(
        declaration.result.pendingResolution.resolutionId,
      )!
      const result = respond(harness, responseCommand({
        resolutionId: stored.resolutionId,
        windowId: stored.resolution.outstandingWindows[0]!.windowId,
        baseRevision: harness.maps.getBySlug('opening-moves-arena')!.revision ?? 0,
        opId: `op_astonish_aware_${caseId}_response`,
        optionId: ASTONISH_AWARE_OPTION_ID,
      }))()

      expect(result.result).toMatchObject({ ok: true, previousRevision: 1, revision: 2 })
      expect(currentConditions(harness.sheets)).toEqual(expectedConditions)
      expect(harness.maps.getBySlug('opening-moves-arena')?.encounterState
        ?.effects.filter(isAstonishMarker)).toEqual([])
      const events = harness.pending.getById(stored.resolutionId)?.resolution.trace.events ?? []
      expect(events).toContainEqual(expect.objectContaining({
        kind: 'operation',
        operationId: 'astonish.threshold-flinch',
        outcome: expectedOutcome,
      }))
      expect(events).toContainEqual(expect.objectContaining({
        kind: 'operation',
        operationId: 'astonish.damage',
        result: expect.objectContaining({
          recipients: [expect.objectContaining({
            details: expect.objectContaining({
              calculation: expect.objectContaining({
                criticalHit: expect.objectContaining({ critical: expectedCritical }),
              }),
            }),
          })],
        }),
      }))
    },
  )

  it('conflicts stale Astonish awareness without deferred damage, Flinch, usage, or marker', async () => {
    const harness = createDurableHarness([0.45, 0])
    const declaration = await declareAstonish(
      harness,
      resolveCommand(harness, 'op_astonish_stale_declare'),
    )
    if (!isPendingMoveDeclarationResult(declaration.result)) {
      throw new Error('Astonish did not suspend for awareness.')
    }
    const stored = harness.pending.getById(declaration.result.pendingResolution.resolutionId)!
    const target = harness.sheets.getByRef('pokemon', OPENING_MOVE_TARGET_SLUG)!
    expect(harness.sheets.applyLivePlayUpdate({
      kind: 'pokemon',
      slug: target.slug,
      expectedRevision: target.revision,
      nextSheet: { ...target.sheet, nickname: 'Concurrent edit' },
    })).toBe('applied')

    const result = respond(harness, responseCommand({
      resolutionId: stored.resolutionId,
      windowId: stored.resolution.outstandingWindows[0]!.windowId,
      baseRevision: harness.maps.getBySlug('opening-moves-arena')!.revision ?? 0,
      opId: 'op_astonish_stale_response',
      optionId: ASTONISH_UNAWARE_OPTION_ID,
    }))()

    expect(result.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(currentConditions(harness.sheets)).toEqual([])
    expect(harness.maps.getBySlug('opening-moves-arena')?.moveUsage).toBeUndefined()
    expect(harness.maps.getBySlug('opening-moves-arena')?.encounterState
      ?.effects.filter(isAstonishMarker)).toEqual([])
    expect(harness.pending.getById(stored.resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: 'op_astonish_stale_response',
    })
  })

  it('accepts joining Fake Out once and duplicate or illegal repeat delivery cannot reroll or stack Flinch', async () => {
    const fixture = openingMoveV2Fixture({ moveName: 'Fake Out', mapRevision: 0 })
    const values = [0.45, 0]
    let draws = 0
    const harness = LivePlayIntegrationHarness.create({
      map: { ...fixture.map, slug: 'integration-arena' },
      sheets: persistedSheets(fixture.pokemonSheets),
      random: () => {
        const value = values[draws]
        if (value === undefined) throw new Error('Illegal repeated Fake Out rerolled.')
        draws += 1
        return value
      },
    })
    integrationHarnesses.push(harness)
    const gm = { role: 'gm' as const, clientId: 'fake-out-client' }
    const command = harness.resolveMoveCommand({
      opId: 'op_fake_out_joining_live',
      baseRevision: 0,
      intent: fixture.intent,
      candidateScopePlacementIds: [OPENING_MOVE_TARGET_ID],
    })
    const first = await harness.resolveMove({ actor: gm, command })
    const duplicate = await harness.resolveMove({ actor: gm, command })
    const accepted = assertAccepted(first.result)

    expect(accepted).toMatchObject({ previousRevision: 0, revision: 1 })
    expect(duplicate.result).toEqual(first.result)
    expect(draws).toBe(2)
    expect((await harness.readSheet('pokemon', OPENING_MOVE_TARGET_SLUG))?.sheet)
      .toMatchObject({ combat: { conditions: ['Flinch', 'Vulnerable'] } })

    const repeated = harness.resolveMoveCommand({
      opId: 'op_fake_out_illegal_repeat',
      baseRevision: 1,
      intent: fixture.intent,
      candidateScopePlacementIds: [OPENING_MOVE_TARGET_ID],
    })
    const rejected = await harness.resolveMove({ actor: gm, command: repeated })
    expect(rejected.result).toMatchObject({ ok: false, reason: 'invalid' })
    if (rejected.result.ok) throw new Error('Repeated Fake Out unexpectedly succeeded.')
    expect(rejected.result.message).toContain('fake-out.not-joining-encounter')
    expect(draws).toBe(2)
    expect((await harness.readMap())?.revision).toBe(1)
    expect((await harness.readSheet('pokemon', OPENING_MOVE_TARGET_SLUG))?.sheet)
      .toMatchObject({ combat: { conditions: ['Flinch', 'Vulnerable'] } })
    expect(harness.operationRecordCount()).toBe(2)
  })
})
