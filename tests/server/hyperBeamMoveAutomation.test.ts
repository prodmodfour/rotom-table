import { afterEach, describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import type { TabletopMap } from '~/types/map'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { deepCloneJson } from '~/utils/serialization'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  ENCOUNTER_EXHAUST_COMMAND_FLAG_ID,
  ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID,
  spendEncounterMoveResourceCosts,
} from '~~/server/domain/moveAutomation/reduceEncounterResources'
import {
  createFiniteAuthoritativeMoveRandomStream,
} from '~~/server/domain/moveAutomation/random'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import { HYPER_BEAM_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/hyperBeam'
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
  type LivePlayResolveMoveCommandResponse,
} from '~~/server/useCases/applyResolveMoveCommand'
import {
  allHyperBeamV2SemanticScenarios,
  HYPER_BEAM_V2_SCENARIOS,
  hyperBeamV2Fixture,
  hyperBeamV2ScenarioDefinition,
  type HyperBeamV2Fixture,
  type HyperBeamV2SemanticScenarioId,
} from '../fixtures/moveAutomation/hyperBeamV2'
import {
  runAndAssertMoveAutomationSemanticScenario,
} from '../fixtures/moveAutomation/scenario'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const NOW = 5_000
const hyperBeamRow = manifestJson.moves.find(row => row.canonicalId === 'Hyper Beam')!

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

const normalizedEvidence = (
  value: readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[],
) => value.map(entry => ({
  scenarioId: entry.scenarioId,
  evidenceClasses: [...entry.evidenceClasses].sort(),
})).sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const damageEvent = (
  events: AuthoritativeMoveStatePlan['resolution']['auditTrace']['events'] | undefined,
) => events?.find(event => (
  event.kind === 'operation' && event.operationId === 'hyper-beam.damage'
))

const openHarness = (fixture: HyperBeamV2Fixture): CommandHarness => {
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
  fixture: HyperBeamV2Fixture,
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

const executeCommand = async (
  harness: CommandHarness,
  command: ResolveMoveLivePlayCommand,
  options: {
    readonly random?: LivePlayResolveMoveCommandDependencies['random']
    readonly planner?: LivePlayResolveMoveCommandDependencies['planner']
  } = {},
): Promise<LivePlayResolveMoveCommandResponse> => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  command,
  clientId: 'hyper-beam-test-client',
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
    return () => `hyper-beam-test-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const flagCount = (
  map: TabletopMap | null,
  flagId: string,
): number => map?.encounterState?.turnResources['actor-token']?.oncePerTurnFlags
  .filter(flag => flag.id === flagId).length ?? 0

describe('Hyper Beam native MoveSpec v2', () => {
  it('selects exactly one reviewed complete runtime with linked cohort evidence', () => {
    expect(hyperBeamRow).toMatchObject({
      baseStatus: 'complete',
      interactionStatus: 'unassessed',
      runtime: {
        kind: 'movespec-v2',
        version: 2,
        definitionHash: '2914bb9b0bae3f7e983f88ae63077c7ad669d5d3e75f2a3c03522cb9eb870f11',
        sourceModule: 'server/domain/moveAutomation/specs/hyperBeam.ts',
      },
      capabilityTags: ['targeting.authoritative'],
      suggestedCapabilityTags: [],
      blockerCodes: [],
      limitations: [],
      manualSteps: [],
      reviewedAt: '2026-07-19',
      rolloutCohortId: 'ma-200',
    })
    expect(hyperBeamRow.scenarioIds).toEqual(
      HYPER_BEAM_V2_SCENARIOS.map(({ scenarioId }) => scenarioId),
    )
    expect(normalizedEvidence(hyperBeamRow.conformanceEvidence.scenarios))
      .toEqual(normalizedEvidence(HYPER_BEAM_V2_SCENARIOS))
    expect(registeredMoveAutomationRuntimeFor('Hyper Beam')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: HYPER_BEAM_MOVE_SPEC },
      definitionHash: hyperBeamRow.runtime.definitionHash,
    })
    expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS).toContainEqual(
      expect.objectContaining({ canonicalId: 'Hyper Beam' }),
    )
  })

  it('encodes canonical DB 15 Special Normal damage, Smite, Standard, and Exhaust mechanics', () => {
    expect(HYPER_BEAM_MOVE_SPEC).toMatchObject({
      canonicalId: 'Hyper Beam',
      targeting: { kind: 'single-target', minTargets: 1, maxTargets: 1 },
      costs: [{
        id: 'hyper-beam.cost.standard-action',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
      }, {
        id: 'hyper-beam.cost.exhaust',
        phase: 'cleanup',
        cost: { kind: 'exhaust', timing: 'next-turn', forfeitCommand: true },
      }],
    })
    const operations = HYPER_BEAM_MOVE_SPEC.phases.reduce<unknown[]>(
      (all, phase) => [...all, ...(phase.operations as readonly unknown[])],
      [],
    )
    expect(operations).toContainEqual(expect.objectContaining({
      id: 'hyper-beam.damage',
      recipients: { kind: 'attacked-targets' },
      payload: expect.objectContaining({
        damageClass: 'special',
        damageBase: 15,
        moveType: 'normal',
        accuracyRollId: 'hyper-beam.accuracy-roll',
        criticalRollId: 'hyper-beam.accuracy-roll',
      }),
    }))
  })

  it('rejects an out-of-range target before rolls, costs, or effects', () => {
    const fixture = hyperBeamV2Fixture('hyper-beam.v2-hit')
    const map = deepCloneJson(fixture.map)
    map.dimensions = { x: 20, y: 3, z: 4 }
    map.placements[1]!.position = { x: 15, y: 0, z: 1 }
    const snapshot = deepCloneJson({ map, sheets: [...fixture.pokemonSheets] })

    expect(() => planAuthoritativeMoveState({
      ...fixture,
      map,
      random: () => { throw new Error('out-of-range Hyper Beam must not roll') },
      now: () => NOW,
      operationId: 'op_hyperbeam_out_of_range',
    })).toThrowError(expect.objectContaining({
      code: 'target-out-of-range',
      reason: 'invalid',
    }))
    expect({ map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)
  })

  it.each(allHyperBeamV2SemanticScenarios())(
    'proves $scenarioId through interpreter, planner, and accepted command',
    async (scenario) => {
      const scenarioId = scenario.scenarioId as HyperBeamV2SemanticScenarioId
      const definition = hyperBeamV2ScenarioDefinition(scenarioId)
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)

      expect([
        result.interpreter.status,
        result.plan.status,
        result.command.status,
      ]).toEqual(['completed', 'completed', 'completed'])
      expect(result.committedDocuments.operationResult).toEqual(result.command.value?.result)
      expect(result.plan.value?.nextMap.encounterState?.turnResources['actor-token'])
        .toMatchObject({ actions: { standard: { spent: 1 } } })
      expect(flagCount(result.plan.value?.nextMap ?? null, ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID))
        .toBe(1)
      expect(flagCount(result.plan.value?.nextMap ?? null, ENCOUNTER_EXHAUST_COMMAND_FLAG_ID))
        .toBe(1)
      expect(result.plan.value?.usage).toMatchObject({
        moveName: 'Hyper Beam',
        frequency: 'Daily x2',
        uses: 1,
        remainingUses: 1,
      })

      const damage = damageEvent(result.plan.value?.resolution.auditTrace.events)
      expect(damage).toMatchObject({ outcome: definition.damageOutcome })
      if (scenarioId === 'hyper-beam.v2-hit') {
        expect(damage).toMatchObject({
          result: { recipients: [{ details: {
            requestedHpLoss: 44,
            calculation: {
              criticalHit: { critical: false },
              damagePipeline: { damageBase: 15, hpLoss: 44 },
            },
          } }] },
        })
      }
      if (scenarioId === 'hyper-beam.v2-smite-miss') {
        expect(result.plan.value?.resolution.transaction).toMatchObject({
          attackedTargetIds: ['target-token'],
          hitTargetIds: [],
          hpUpdates: [{ id: 'target-token', currentHp: 478 }],
        })
        expect(damage).toMatchObject({
          result: { recipients: [{ details: { calculation: { damagePipeline: {
            preTypeDamage: 44,
            typeScaledDamage: 22,
            hpLoss: 22,
            stages: expect.arrayContaining([expect.objectContaining({
              stage: 'type-effectiveness',
              modifiers: [expect.objectContaining({
                reasonCode: 'damage.smite-miss-resistance-step',
                value: 0.5,
              })],
            })]),
          } } } }] },
        })
      }
      if (scenarioId === 'hyper-beam.v2-critical-hit') {
        expect(damage).toMatchObject({
          result: { recipients: [{ details: {
            requestedHpLoss: 48,
            calculation: {
              criticalHit: { naturalRoll: 20, critical: true },
              damagePipeline: { criticalScaledDamage: 48, hpLoss: 48 },
            },
          } }] },
        })
      }
      if (scenarioId === 'hyper-beam.v2-normal-immunity') {
        expect(result.plan.value?.resolution.transaction.hpUpdates).toEqual([])
        expect(damage).toMatchObject({
          outcome: 'prevented',
          result: { recipients: [{
            reasonCode: 'damage-immunity',
            blockers: [{ subject: 'Normal', source: 'Ghost type' }],
          }] },
        })
      }
    },
  )

  it('rejects an Exhaust declaration after prior Shift spend without mutating source state', () => {
    const fixture = hyperBeamV2Fixture('hyper-beam.v2-hit')
    const seeded = spendEncounterMoveResourceCosts(
      fixture.map.encounterState?.turnResources ?? {},
      {
        placementId: 'actor-token',
        canonicalMoveId: 'Earlier Shift',
        resolutionId: 'resolution.earlier-shift',
        sourceOperationId: 'op_earlier_shift',
        costs: [{
          id: 'earlier.cost.shift',
          phase: 'pay',
          cost: { kind: 'action-resource', resource: 'shift', amount: 1 },
        }],
        movementBudget: null,
        movementDistance: 0,
        round: 1,
        turn: null,
        actedThisRound: false,
      },
    )
    const map: TabletopMap = {
      ...deepCloneJson(fixture.map),
      encounterState: {
        ...deepCloneJson(fixture.map.encounterState!),
        turnResources: seeded.resources,
      },
    }
    const snapshot = deepCloneJson({ map, sheets: [...fixture.pokemonSheets] })

    expect(() => planAuthoritativeMoveState({
      ...fixture,
      map,
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
      now: () => NOW,
      operationId: 'op_hyperbeam_exhaust_reject',
    })).toThrowError(expect.objectContaining({
      code: 'move-resource-unavailable',
      message: expect.stringContaining('exhaust-prerequisite-failed'),
    }))
    expect({ map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)
  })

  it('replays an accepted duplicate without rerolling, spending, damaging, or publishing twice', async () => {
    const fixture = hyperBeamV2Fixture('hyper-beam.v2-hit')
    const harness = openHarness(fixture)
    const command = commandFor(fixture, 'op_hyperbeam_duplicate_replay')
    const first = await executeCommand(harness, command, {
      random: createFiniteAuthoritativeMoveRandomStream(fixture.randomValues),
    })
    expect(first.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
    const committedMap = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const committedSheets = deepCloneJson(harness.sheets.list())
    const committedEvents = deepCloneJson(harness.events)

    const duplicate = await executeCommand(harness, command, {
      random: () => { throw new Error('duplicate Hyper Beam must not reroll') },
      planner: () => { throw new Error('duplicate Hyper Beam must not replan') },
    })
    expect(duplicate).toEqual(first)
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(committedSheets)
    expect(harness.events).toEqual(committedEvents)
    expect(harness.sheets.getByRef('pokemon', 'target')?.sheet).toMatchObject({
      revision: 4,
      combat: { currentHp: 456 },
    })
    expect(harness.sheets.getByRef('pokemon', 'actor')?.sheet).toMatchObject({
      revision: 4,
      moveUsage: { daily: { 'hyper-beam': { uses: 1 } } },
    })
    expect(flagCount(committedMap, ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID)).toBe(1)
    expect(flagCount(committedMap, ENCOUNTER_EXHAUST_COMMAND_FLAG_ID)).toBe(1)
    expect(harness.events.filter((event) => (
      typeof event === 'object'
      && event !== null
      && (event as { readonly type?: string }).type === 'live-play-command-accepted'
    ))).toHaveLength(1)
  })

  it('rejects a raced target revision without partial damage, usage, Exhaust, or realtime state', async () => {
    const fixture = hyperBeamV2Fixture('hyper-beam.v2-hit')
    const harness = openHarness(fixture)
    const command = commandFor(fixture, 'op_hyperbeam_stale_target')
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
      if (!current) throw new Error('Missing Hyper Beam raced target sheet.')
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
