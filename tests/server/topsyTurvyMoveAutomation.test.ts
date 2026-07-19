import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import menuStatusJson from '../../data/move-automation/menu-status.json'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import type { CombatStageMap } from '~/types/combatStages'
import type { TabletopMap } from '~/types/map'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { deepCloneJson } from '~/utils/serialization'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { TOPSY_TURVY_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/topsyTurvy'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandDependencies,
} from '~~/server/useCases/applyResolveMoveCommand'
import {
  allTopsyTurvyV2SemanticScenarios,
  TOPSY_TURVY_V2_SCENARIOS,
  topsyTurvyV2Fixture,
  topsyTurvyV2ScenarioDefinition,
  type TopsyTurvyV2Fixture,
  type TopsyTurvyV2SemanticScenarioId,
} from '../fixtures/moveAutomation/topsyTurvyV2'
import { runAndAssertMoveAutomationSemanticScenario } from '../fixtures/moveAutomation/scenario'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const NOW = 5_000
const topsyTurvyRow = manifestJson.moves.find(row => row.canonicalId === 'Topsy-Turvy')!

interface CommandHarness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  readonly events: unknown[]
}

const openDatabases: RotomDatabase[] = []

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const openHarness = (fixture: TopsyTurvyV2Fixture): CommandHarness => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => NOW })
  const modes = createSqliteMapInteractionModeRepository(database)
  const events: unknown[] = []
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks(events, { clock: () => NOW }),
  })

  maps.save({
    slug: fixture.map.slug,
    document: deepCloneJson(fixture.map),
    revision: fixture.map.revision ?? 0,
    updatedAt: fixture.map.updatedAt ?? 100,
  })
  for (const [slug, sheet] of fixture.pokemonSheets) {
    sheets.save({
      kind: 'pokemon',
      slug,
      document: deepCloneJson(sheet) as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: fixture.map.updatedAt ?? 100,
    })
  }
  return { database, maps, sheets, ops, commandExecutor, events }
}

const commandFor = (
  fixture: TopsyTurvyV2Fixture,
  opId: string,
): ResolveMoveLivePlayCommand => {
  const scopes = buildResolveMoveScopes({
    map: fixture.map,
    intent: fixture.intent,
    candidateScopePlacementIds: ['target-token'],
  })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: fixture.map.slug,
    baseRevision: fixture.map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload: deepCloneJson(fixture.intent),
  }
}

const executeCommand = (
  harness: CommandHarness,
  command: ResolveMoveLivePlayCommand,
  options: {
    readonly random?: LivePlayResolveMoveCommandDependencies['random']
    readonly planner?: LivePlayResolveMoveCommandDependencies['planner']
  } = {},
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  command,
  clientId: 'topsy-turvy-test-client',
  playerProfile: null,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  commandExecutor: harness.commandExecutor,
  random: options.random,
  planner: options.planner,
  now: () => NOW,
  idFactory: (() => {
    let sequence = 0
    return () => `topsy-turvy-test-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const stageEvent = (
  plan: AuthoritativeMoveStatePlan | undefined,
) => plan?.resolution.auditTrace.events.find(event => (
  event.kind === 'operation' && event.operationId === 'topsy-turvy.invert-stages'
))

const currentStages = (
  harness: CommandHarness,
): CombatStageMap => {
  const target = harness.sheets.getByRef('pokemon', 'target')?.sheet as {
    readonly stats?: Readonly<Record<string, { readonly stage?: number }>>
    readonly combatStages?: { readonly acc?: number }
  } | undefined
  return {
    atk: target?.stats?.atk?.stage ?? 0,
    def: target?.stats?.def?.stage ?? 0,
    satk: target?.stats?.satk?.stage ?? 0,
    sdef: target?.stats?.sdef?.stage ?? 0,
    spd: target?.stats?.spd?.stage ?? 0,
    acc: target?.combatStages?.acc ?? 0,
  }
}

const normalizedEvidence = (
  entries: readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[],
) => entries.map(entry => ({
  scenarioId: entry.scenarioId,
  evidenceClasses: [...entry.evidenceClasses].sort(),
})).sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

describe('Topsy-Turvy native MoveSpec v2', () => {
  it('selects one complete reviewed runtime with linked MA-202 evidence and presentation', () => {
    expect(topsyTurvyRow).toMatchObject({
      baseStatus: 'complete',
      interactionStatus: 'unassessed',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '7e5f4d8bf55e2b6355d5ee8522ce4a790bd905d072f3c729058cde8d85d963d3',
        sourceModule: 'server/domain/moveAutomation/specs/topsyTurvy.ts',
      },
      capabilityTags: ['stages.typed', 'targeting.authoritative'],
      suggestedCapabilityTags: [],
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
      reviewedAt: '2026-07-19',
      rolloutCohortId: 'ma-202',
    })
    expect(topsyTurvyRow.scenarioIds).toEqual(
      TOPSY_TURVY_V2_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(normalizedEvidence(topsyTurvyRow.conformanceEvidence.scenarios))
      .toEqual(normalizedEvidence(TOPSY_TURVY_V2_SCENARIOS))
    expect(registeredMoveAutomationRuntimeFor('Topsy-Turvy')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: TOPSY_TURVY_MOVE_SPEC },
      definitionHash: topsyTurvyRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Topsy-Turvy' }),
    )
    expect(menuStatusJson.moves.find(row => row.canonicalId === 'Topsy-Turvy')).toMatchObject({
      baseStatus: 'complete',
      runtimeKind: 'movespec-v2',
      blockerCodes: [],
    })
    expect(nativeMoveAutomationPresentationScriptForMove('Topsy-Turvy')).toMatchObject({
      moveName: 'Topsy-Turvy',
      targetMode: 'one-target',
      targetCount: 1,
      requiresAccuracy: true,
      ac: 4,
      range: '6, 1 Target',
      automationNotes: [],
    })
  })

  it('encodes a server-owned AC 4 gate followed by one all-stage inversion', () => {
    expect(TOPSY_TURVY_MOVE_SPEC).toMatchObject({
      canonicalId: 'Topsy-Turvy',
      targeting: {
        kind: 'single-target',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'selected-targets' },
      },
      costs: [{
        id: 'topsy-turvy.cost.standard-action',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
      }],
    })
    const operations = TOPSY_TURVY_MOVE_SPEC.phases.reduce<unknown[]>(
      (all, phase) => [...all, ...(phase.operations as readonly unknown[])],
      [],
    )
    expect(operations).toContainEqual(expect.objectContaining({
      id: 'topsy-turvy.accuracy',
      kind: 'roll',
      recipients: { kind: 'attacked-targets' },
      payload: {
        rollId: 'topsy-turvy.accuracy-roll',
        formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
      },
    }))
    expect(operations).toContainEqual(expect.objectContaining({
      id: 'topsy-turvy.invert-stages',
      kind: 'combat-stage',
      recipients: { kind: 'hit-targets' },
      payload: {
        action: 'invert',
        stage: 'all',
        selectedStage: null,
        value: null,
        stageSource: null,
        rounding: null,
      },
    }))
  })

  it('rejects an out-of-range target before rolling, spending, or mutating inputs', () => {
    const fixture = topsyTurvyV2Fixture('topsy-turvy.v2-mixed-inversion')
    const map = deepCloneJson(fixture.map)
    map.placements[1]!.position = { x: 9, y: 0, z: 1 }
    const snapshot = deepCloneJson({ map, sheets: [...fixture.pokemonSheets] })

    expect(() => planAuthoritativeMoveState({
      ...fixture,
      map,
      random: () => { throw new Error('out-of-range Topsy-Turvy must not roll') },
      now: () => NOW,
      operationId: 'op_topsyturvy_out_of_range',
    })).toThrowError(expect.objectContaining({
      code: 'target-out-of-range',
      reason: 'invalid',
    }))
    expect({ map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)
  })

  it.each(allTopsyTurvyV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const scenarioId = scenario.scenarioId as TopsyTurvyV2SemanticScenarioId
      const definition = topsyTurvyV2ScenarioDefinition(scenarioId)
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
      expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)
      expect(result.plan.value?.nextMap.encounterState?.turnResources['actor-token'])
        .toMatchObject({ actions: { standard: { spent: 1 } } })
      expect(result.plan.value?.nextMap.moveUsage?.byPlacementId['actor-token']?.['topsy-turvy'])
        .toMatchObject({
          moveName: 'Topsy-Turvy',
          frequency: 'eot',
          uses: 1,
          lastUsedRound: 1,
        })
      expect(result.plan.value?.resolution.rollLedger).toHaveLength(1)

      const event = stageEvent(result.plan.value)
      expect(event).toMatchObject({
        outcome: definition.stageOutcome,
        recipientIds: definition.hit ? ['target-token'] : [],
      })
      if (scenarioId === 'topsy-turvy.v2-mixed-inversion') {
        expect(event).toMatchObject({
          result: {
            recipients: [{
              reasonCode: 'topsy-turvy.invert-combat-stages',
              current: {
                kind: 'combat-stages',
                stages: definition.expectedStages,
              },
              details: {
                action: 'invert',
                changes: [
                  expect.objectContaining({ stage: 'atk', previous: 3, current: -3 }),
                  expect.objectContaining({ stage: 'def', previous: -2, current: 2 }),
                  expect.objectContaining({ stage: 'satk', previous: 0, current: 0, outcome: 'no-op' }),
                  expect.objectContaining({ stage: 'sdef', previous: 6, current: -6 }),
                  expect.objectContaining({ stage: 'spd', previous: -6, current: 6 }),
                  expect.objectContaining({ stage: 'acc', previous: 1, current: -1 }),
                ],
              },
            }],
          },
        })
      }
      else if (scenarioId === 'topsy-turvy.v2-zero-stage-no-op') {
        expect(event).toMatchObject({
          result: {
            recipients: [{
              outcome: 'no-op',
              reasonCode: 'combat-stage-unchanged',
              changedFields: [],
              details: {
                changes: Array.from({ length: 6 }, () => expect.objectContaining({
                  previous: 0,
                  current: 0,
                  outcome: 'no-op',
                })),
              },
            }],
          },
        })
        expect(result.plan.value?.sheetWrites).toEqual([])
        expect(result.plan.value?.resolution.sheetReads).toContainEqual({
          kind: 'pokemon',
          slug: 'target',
          revision: 3,
        })
      }
      else {
        expect(result.plan.value?.resolution.transaction).toMatchObject({
          attackedTargetIds: ['target-token'],
          hitTargetIds: [],
          combatStageUpdates: [],
        })
        expect(result.plan.value?.sheetWrites).toEqual([])
      }
    },
  )

  it('replays an accepted duplicate without rerolling, reinverting, spending, or publishing twice', async () => {
    const fixture = topsyTurvyV2Fixture('topsy-turvy.v2-mixed-inversion')
    const definition = topsyTurvyV2ScenarioDefinition('topsy-turvy.v2-mixed-inversion')
    const harness = openHarness(fixture)
    const command = commandFor(fixture, 'op_topsyturvy_duplicate_replay')
    const first = await executeCommand(harness, command, {
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
    })
    expect(first.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
    expect(currentStages(harness)).toEqual(definition.expectedStages)
    const committedMap = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const committedSheets = deepCloneJson(harness.sheets.list())
    const committedEvents = deepCloneJson(harness.events)

    const duplicate = await executeCommand(harness, command, {
      random: () => { throw new Error('duplicate Topsy-Turvy must not reroll') },
      planner: () => { throw new Error('duplicate Topsy-Turvy must not replan') },
    })
    expect(duplicate).toEqual(first)
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(committedSheets)
    expect(harness.events).toEqual(committedEvents)
    expect(currentStages(harness)).toEqual(definition.expectedStages)
    expect(committedMap?.moveUsage?.byPlacementId['actor-token']?.['topsy-turvy']?.uses).toBe(1)
    expect(committedMap?.encounterState?.turnResources['actor-token']?.actions.standard.spent).toBe(1)
    expect(harness.events.filter(event => (
      typeof event === 'object'
      && event !== null
      && (event as { readonly type?: string }).type === 'live-play-command-accepted'
    ))).toHaveLength(1)
  })

  it('rejects a raced target revision without partial inversion, usage, resources, or realtime state', async () => {
    const fixture = topsyTurvyV2Fixture('topsy-turvy.v2-mixed-inversion')
    const harness = openHarness(fixture)
    const command = commandFor(fixture, 'op_topsyturvy_stale_target')
    const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const actorBefore = deepCloneJson(harness.sheets.getByRef('pokemon', 'actor'))
    let racedTarget: Record<string, unknown> | null = null
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      const plan = planAuthoritativeMoveState({
        ...input,
        random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      })
      expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: 'target' }))
      const current = harness.sheets.getByRef('pokemon', 'target')
      if (!current) throw new Error('Missing Topsy-Turvy raced target sheet.')
      racedTarget = {
        ...deepCloneJson(current.sheet),
        revision: current.revision + 1,
        updatedAt: NOW + 1,
      }
      harness.sheets.save({
        kind: 'pokemon',
        slug: 'target',
        document: racedTarget,
        revision: current.revision + 1,
        updatedAt: NOW + 1,
      })
      return plan
    }

    const response = await executeCommand(harness, command, { planner })
    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('consulted while resolving the move changed'),
    })
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(mapBefore)
    expect(harness.sheets.getByRef('pokemon', 'actor')).toEqual(actorBefore)
    expect(harness.sheets.getByRef('pokemon', 'target')?.sheet).toEqual(racedTarget)
    expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
    expect(harness.events).toEqual([])
  })
})
