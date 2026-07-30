import { afterEach, describe, expect, it } from 'vitest'
import { assertReviewedNativeEvidenceFragments } from '../fixtures/moveAutomation/nativeEvidence'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import {
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
  explicitScriptForMove,
} from '~/utils/moveAutomation'
import { pokemonMoveEntriesForSheet } from '~/utils/mapTokenMoves'
import { deepCloneJson } from '~/utils/serialization'
import {
  requiredStruggleCapabilityForMoveName,
  struggleAttackIsAvailableForCapabilities,
} from '~/utils/struggleMoves'
import {
  resolveAuthoritativeMove,
  type AuthoritativeMoveResolution,
} from '~~/server/domain/resolveAuthoritativeMove'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandDependencies,
  type LivePlayResolveMoveCommandResponse,
} from '~~/server/useCases/applyResolveMoveCommand'
import {
  REG_028_MOVE_NAMES,
  REG_028_SCENARIOS_BY_MOVE,
  REG_028_STRUGGLE_MECHANICS,
  type RegisteredBatch028MoveName,
  type RegisteredMoveConformanceScenario,
} from '../fixtures/moveAutomation/registeredBatch028'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_ID = 'target-token'
const NOW = 5_000
const REVIEWED_AT = '2026-07-19'

interface TokenProfile {
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
}

interface ExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch028MoveName
  readonly naturalRoll: number
  readonly expert?: boolean
  readonly targetProfile?: TokenProfile
  readonly expectDamage?: boolean
  readonly targetDistance?: number
  readonly actorCapabilities?: readonly string[]
  readonly actorMoves?: readonly CharacterSheetMove[]
}

interface MoveFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly candidateScopePlacementIds: readonly string[]
}

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

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? 0
}

const randomValuesForNaturalRoll = (naturalRoll: number): readonly number[] => [
  (naturalRoll - 1) / 20,
  ...Array.from({ length: 12 }, () => 0),
]

const placement = (
  id: string,
  sheetSlug: string,
  x: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  sideId: id === ACTOR_ID ? 'heroes' : 'foes',
  position: { x, y: 0, z: 3 },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly actor?: boolean
  readonly moves?: readonly CharacterSheetMove[]
  readonly profile?: TokenProfile
  readonly capabilities?: readonly string[]
  readonly combatSkill?: string
  readonly focusSkill?: string
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: 'Clefairy',
  level: 20,
  revision: 3,
  types: [...(options.profile?.types ?? ['Normal'])],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  capabilities: {
    overland: 6,
    ...(options.capabilities?.length ? { other: [...options.capabilities] } : { other: [] }),
  },
  skills: {
    combat: options.combatSkill ?? '4d6',
    focus: options.focusSkill ?? '4d6',
  },
  movelist: [...(options.moves ?? [])],
  stats: {
    hp: { added: 500 },
    atk: { added: options.actor ? 50 : 5, stage: 0 },
    def: { added: 5, stage: 0 },
    satk: { added: options.actor ? 5 : 5, stage: 0 },
    sdef: { added: 5, stage: 0 },
    spd: { added: 5, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 500, conditions: [] },
})

const defaultTargetDistance = (moveName: RegisteredBatch028MoveName): number => (
  REG_028_STRUGGLE_MECHANICS[moveName].range === 'Focus Rank, 1 Target' ? 4 : 1
)

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const mechanics = REG_028_STRUGGLE_MECHANICS[scenario.moveName]
  const targetDistance = scenario.targetDistance ?? defaultTargetDistance(scenario.moveName)
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-028-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-028 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 14, y: 3, z: 10 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', 3),
      placement(TARGET_ID, TARGET_ID, 3 + targetDistance),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-028 scene', startedAt: 100 },
    encounterState: {
      ...emptyState,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
    },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  const actor = pokemonSheet({
    slug: 'actor',
    actor: true,
    moves: scenario.actorMoves ?? [],
    profile: { types: [mechanics.type] },
    capabilities: scenario.actorCapabilities ?? [mechanics.capability],
    combatSkill: scenario.expert ? '5d6' : '4d6',
    focusSkill: '4d6',
  })
  const target = pokemonSheet({
    slug: TARGET_ID,
    profile: scenario.targetProfile,
  })

  return {
    map,
    pokemonSheets: new Map([
      ['actor', actor],
      [TARGET_ID, target],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: ACTOR_ID,
      moveName: scenario.moveName,
      selection: { kind: 'single-target', targetPlacementId: TARGET_ID },
    },
    candidateScopePlacementIds: [TARGET_ID],
  }
}

const evidenceWithSuffix = (
  moveName: RegisteredBatch028MoveName,
  suffix: string,
): RegisteredMoveConformanceScenario => {
  const evidence = REG_028_SCENARIOS_BY_MOVE[moveName]
    .find(candidate => candidate.scenarioId.endsWith(suffix))
  if (!evidence) throw new Error(`Missing ${suffix} evidence for ${moveName}.`)
  return evidence
}

const scenarioFor = (
  moveName: RegisteredBatch028MoveName,
  suffix: string,
  naturalRoll: number,
  options: Omit<ExecutionScenario, 'scenarioId' | 'moveName' | 'naturalRoll'> = {},
): ExecutionScenario => ({
  scenarioId: evidenceWithSuffix(moveName, suffix).scenarioId,
  moveName,
  naturalRoll,
  ...options,
})

const normalScenarios: readonly ExecutionScenario[] = REG_028_MOVE_NAMES.flatMap((moveName) => {
  const mechanics = REG_028_STRUGGLE_MECHANICS[moveName]
  const scenarios: ExecutionScenario[] = [
    scenarioFor(moveName, '-novice-no-stab-hit', 10),
    scenarioFor(moveName, '-expert-combat-branch', 10, { expert: true }),
    scenarioFor(moveName, '-miss', 1),
    scenarioFor(moveName, '-critical-hit', 20),
  ]
  if (mechanics.immuneDefenderType) {
    scenarios.push(scenarioFor(
      moveName,
      `-${mechanics.immuneDefenderType.toLowerCase()}-immunity`,
      10,
      {
        targetProfile: { types: [mechanics.immuneDefenderType] },
        expectDamage: false,
      },
    ))
  }
  return scenarios
})

const acceptedScenarioFor = (moveName: RegisteredBatch028MoveName): ExecutionScenario => (
  normalScenarios.find(scenario => (
    scenario.moveName === moveName
    && scenario.scenarioId.endsWith('-novice-no-stab-hit')
  )) ?? (() => { throw new Error(`Missing accepted scenario for ${moveName}.`) })()
)

const assertScenarioResolution = (
  scenario: ExecutionScenario,
  resolution: AuthoritativeMoveResolution,
): void => {
  const mechanics = REG_028_STRUGGLE_MECHANICS[scenario.moveName]
  const hit = scenario.naturalRoll !== 1
  const expectDamage = scenario.expectDamage ?? hit
  expect(resolution.auditTrace.program).toMatchObject({
    canonicalId: scenario.moveName,
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  })
  expect(resolution.script).toMatchObject({
    moveName: scenario.moveName,
    ac: scenario.expert ? 3 : 4,
    damageBase: scenario.expert ? 5 : 4,
    damageClass: mechanics.damageClass,
    type: mechanics.type,
    range: mechanics.range === 'Focus Rank, 1 Target'
      ? '4, 1 Target'
      : mechanics.range,
    targetMode: 'one-target',
    targetCount: 1,
  })
  expect(resolution.damageFormula).toBe(scenario.expert ? '1d8+8' : '1d8+6')
  expect(resolution.transaction.attackedTargetIds).toEqual([TARGET_ID])
  expect(resolution.transaction.hitTargetIds).toEqual(hit ? [TARGET_ID] : [])
  expect(resolution.transaction.hpUpdates.map(update => update.id))
    .toEqual(expectDamage ? [TARGET_ID] : [])
  expect(resolution.rollLedger
    .filter(entry => entry.formula.kind === 'dice' && entry.formula.sides === 20)
    .map(entry => entry.naturalResult))
    .toEqual([scenario.naturalRoll])
  expect(resolution.sheetReads.map(read => read.slug).sort())
    .toEqual(['actor', TARGET_ID].sort())
  expect(resolution.transaction.logLines.join(' ')).not.toContain('STAB')

  const searchableEvidence = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  if (scenario.naturalRoll === 20) {
    expect(JSON.stringify(resolution.auditTrace.events)).toContain('"critical":true')
  }
  if (hit && !expectDamage) {
    assertReviewedNativeEvidenceFragments(searchableEvidence, [`${mechanics.type} immunity`])
  }
  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
}

const openHarness = (fixture: MoveFixture): CommandHarness => {
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
    ...acceptedRealtimeTestHooks(events),
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
      updatedAt: 100,
    })
  }

  return { database, maps, sheets, ops, commandExecutor, events }
}

const commandFor = (
  fixture: MoveFixture,
  operationId: string,
): ResolveMoveLivePlayCommand => {
  const scopes = buildResolveMoveScopes({
    map: fixture.map,
    intent: fixture.intent,
    candidateScopePlacementIds: fixture.candidateScopePlacementIds,
  })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: `op_${operationId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
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
    readonly random?: () => number
    readonly planner?: LivePlayResolveMoveCommandDependencies['planner']
  } = {},
): Promise<LivePlayResolveMoveCommandResponse> => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  command,
  clientId: 'reg-028-client',
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
    return () => `reg-028-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const normalizedEvidence = (
  scenarios: readonly RegisteredMoveConformanceScenario[],
): readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[] => scenarios
  .map(scenario => ({
    scenarioId: scenario.scenarioId,
    evidenceClasses: [...scenario.evidenceClasses].sort(),
  }))
  .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const hpLossFor = (scenario: ExecutionScenario): number => {
  const fixture = fixtureFor(scenario)
  const resolution = resolveAuthoritativeMove({
    ...fixture,
    random: randomSequence(randomValuesForNaturalRoll(scenario.naturalRoll)),
    now: () => NOW,
  })
  if ('kind' in resolution) throw new Error(`${scenario.moveName} unexpectedly suspended.`)
  const update = resolution.transaction.hpUpdates.find(candidate => candidate.id === TARGET_ID)
  return update ? 500 - update.currentHp : 0
}

describe('REG-028 registered move conformance', () => {
  it('certifies exactly Freezer Special through Zapper Physical with linked evidence', () => {
    expect(Object.keys(REG_028_SCENARIOS_BY_MOVE)).toEqual([...REG_028_MOVE_NAMES])
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)

    for (const [canonicalId, scenarios] of Object.entries(REG_028_SCENARIOS_BY_MOVE)) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === canonicalId)
      expect(row, canonicalId).toMatchObject({
        baseStatus: 'complete',
        capabilityTags: ['expressions.bounded', 'targeting.authoritative'],
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: REVIEWED_AT,
      })
      if (!row) continue
      expect([...row.scenarioIds].sort()).toEqual(scenarios.map(scenario => scenario.scenarioId).sort())
      expect(normalizedEvidence(row.conformanceEvidence.scenarios))
        .toEqual(normalizedEvidence(scenarios))

      const runtime = registeredMoveAutomationRuntimeFor(canonicalId)
      expect(runtime, canonicalId).toMatchObject({
        canonicalId,
        kind: row.runtime.kind,
        version: row.runtime.version,
        definitionHash: row.runtime.definitionHash,
        sourceModule: row.runtime.sourceModule,
      })
    }
  })

  it('retains each canonical capability, type, damage class, range, and empty operator notes', () => {
    for (const moveName of REG_028_MOVE_NAMES) {
      const mechanics = REG_028_STRUGGLE_MECHANICS[moveName]
      expect(requiredStruggleCapabilityForMoveName(moveName)).toBe(mechanics.capability)
      expect(struggleAttackIsAvailableForCapabilities(moveName, [mechanics.capability])).toBe(true)
      expect(struggleAttackIsAvailableForCapabilities(moveName, [])).toBe(false)
      const script = explicitScriptForMove(moveName)
      expect(script, moveName).toMatchObject({
        kind: 'explicit',
        version: 1,
        ac: 4,
        damageBase: 4,
        damageClass: mechanics.damageClass,
        type: mechanics.type,
        range: mechanics.range,
        targetMode: 'one-target',
        targetCount: 1,
      })
      expect(script?.automationNotes, moveName).toEqual([])
    }
  })

  it('derives every variant authoritatively without a learned move or STAB', () => {
    for (const moveName of REG_028_MOVE_NAMES) {
      const scenario = acceptedScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const actor = fixture.pokemonSheets.get('actor')
      if (!actor) throw new Error(`Missing ${moveName} actor sheet.`)
      expect(actor.movelist).toEqual([])
      expect(pokemonMoveEntriesForSheet(actor), moveName).toContainEqual({
        move: { name: moveName },
        automatic: true,
      })

      const resolution = resolveAuthoritativeMove({
        ...fixture,
        random: randomSequence(randomValuesForNaturalRoll(scenario.naturalRoll)),
        now: () => NOW,
      })
      if ('kind' in resolution) throw new Error(`${moveName} unexpectedly suspended.`)
      expect(resolution.script.damageBase).toBe(4)
      expect(resolution.damageFormula).toBe('1d8+6')
      expect(resolution.transaction.logLines.join(' ')).not.toContain('STAB')
    }
  })

  it('uses Attack for physical variants and Special Attack for special variants', () => {
    for (const [physicalName, specialName] of [
      ['Struggle (Guster Physical)', 'Struggle (Guster Special)'],
      ['Struggle (Materializer Physical)', 'Struggle (Materializer Special)'],
      ['Struggle (Telekinetic Physical)', 'Struggle (Telekinetic Special)'],
    ] as const) {
      expect(hpLossFor(acceptedScenarioFor(physicalName)), physicalName)
        .toBeGreaterThan(hpLossFor(acceptedScenarioFor(specialName)))
    }
  })

  it.each(normalScenarios)(
    'proves $scenarioId through the executor, planner, and accepted command',
    async (scenario) => {
      const directFixture = fixtureFor(scenario)
      const directSnapshot = deepCloneJson({
        map: directFixture.map,
        sheets: [...directFixture.pokemonSheets],
      })
      const randomValues = randomValuesForNaturalRoll(scenario.naturalRoll)
      const direct = resolveAuthoritativeMove({
        ...directFixture,
        random: randomSequence(randomValues),
        now: () => NOW,
        idFactory: () => 'reg-028-direct-id',
        resolutionId: `${scenario.scenarioId}.direct`,
      })
      expect('kind' in direct).toBe(false)
      if ('kind' in direct) throw new Error(`${scenario.moveName} unexpectedly suspended.`)
      assertScenarioResolution(scenario, direct)
      expect({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] })
        .toEqual(directSnapshot)

      const plannerFixture = fixtureFor(scenario)
      const plan = planAuthoritativeMoveState({
        ...plannerFixture,
        random: randomSequence(randomValues),
        now: () => NOW,
        idFactory: () => 'reg-028-plan-id',
        operationId: `op_${scenario.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}_plan`,
      })
      assertScenarioResolution(scenario, plan.resolution)
      expect(plan.resolution.transaction).toEqual(direct.transaction)

      const commandFixture = fixtureFor(scenario)
      const harness = openHarness(commandFixture)
      const command = commandFor(commandFixture, `${scenario.scenarioId}.command`)
      const response = await executeCommand(harness, command, {
        random: randomSequence(randomValues),
      })
      expect(response.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
      expect(response.move?.transaction).toEqual(plan.resolution.transaction)
      expect(response.move?.rollLedger).toEqual(plan.resolution.rollLedger)
      expect(response.move?.trace).toMatchObject({
        program: { canonicalId: scenario.moveName, runtimeKind: 'movespec-v2' },
      })
      expect(harness.ops.getOpResult(command.mapSlug, command.opId)).toEqual(response.result)
      expect(harness.maps.getBySlug(command.mapSlug)).toMatchObject({
        revision: 8,
        encounterState: {
          turnResources: {
            [ACTOR_ID]: { actions: { standard: { spent: 1 } } },
          },
        },
      })
      for (const [slug, initialSheet] of commandFixture.pokemonSheets) {
        const expectedWrite = plan.sheetWrites.find(write => (
          write.kind === 'pokemon' && write.slug === slug
        ))
        expect(harness.sheets.getByRef('pokemon', slug)).toMatchObject({
          revision: expectedWrite?.revision ?? initialSheet.revision,
          sheet: expectedWrite?.nextSheet ?? initialSheet,
        })
      }
    },
  )

  it.each(REG_028_MOVE_NAMES)(
    'rejects %s without its authoritative capability before rolls, costs, or effects',
    async (moveName) => {
      const evidence = evidenceWithSuffix(moveName, '-capability-required')
      const scenario: ExecutionScenario = {
        ...acceptedScenarioFor(moveName),
        scenarioId: evidence.scenarioId,
        actorCapabilities: [],
        actorMoves: [{ name: moveName }],
      }
      const fixture = fixtureFor(scenario)
      const snapshot = deepCloneJson({ map: fixture.map, sheets: [...fixture.pokemonSheets] })

      expect(() => resolveAuthoritativeMove({
        ...fixture,
        random: () => { throw new Error('missing capability must not roll') },
      })).toThrowError(expect.objectContaining({ code: 'move-creature-rule-blocked' }))
      expect(() => planAuthoritativeMoveState({
        ...fixture,
        random: () => { throw new Error('missing capability must not roll') },
        operationId: `op_${evidence.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
      })).toThrowError(expect.objectContaining({ code: 'move-creature-rule-blocked' }))
      expect({ map: fixture.map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)

      const harness = openHarness(fixture)
      const command = commandFor(fixture, `${evidence.scenarioId}.command`)
      const response = await executeCommand(harness, command, {
        random: () => { throw new Error('missing capability command must not roll') },
      })
      expect(response.result).toMatchObject({
        ok: false,
        reason: 'conflict',
        message: expect.stringContaining('requires effective'),
        currentState: { code: 'move-creature-rule-blocked' },
      })
      expect(harness.maps.getBySlug(fixture.map.slug)?.revision).toBe(7)
      expect(harness.sheets.list().every(sheet => sheet.revision === 3)).toBe(true)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toEqual(response.result)
      expect(harness.events).toEqual([])
    },
  )

  it.each([
    'Struggle (Telekinetic Physical)',
    'Struggle (Telekinetic Special)',
  ] as const)(
    'enforces %s range from the authoritative Focus rank',
    async (moveName) => {
      const accepted = acceptedScenarioFor(moveName)
      const inRangeFixture = fixtureFor(accepted)
      const inRange = resolveAuthoritativeMove({
        ...inRangeFixture,
        random: randomSequence(randomValuesForNaturalRoll(accepted.naturalRoll)),
      })
      if ('kind' in inRange) throw new Error(`${moveName} unexpectedly suspended.`)
      expect(inRange.transaction.hitTargetIds).toEqual([TARGET_ID])

      const evidence = evidenceWithSuffix(moveName, '-focus-range-rejected')
      const scenario: ExecutionScenario = {
        ...accepted,
        scenarioId: evidence.scenarioId,
        targetDistance: 5,
      }
      const fixture = fixtureFor(scenario)
      const snapshot = deepCloneJson({ map: fixture.map, sheets: [...fixture.pokemonSheets] })
      expect(() => resolveAuthoritativeMove({
        ...fixture,
        random: () => { throw new Error('out-of-range target must not roll') },
      })).toThrowError(expect.objectContaining({ code: 'target-out-of-range' }))
      expect(() => planAuthoritativeMoveState({
        ...fixture,
        random: () => { throw new Error('out-of-range planner must not roll') },
        operationId: `op_${evidence.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
      })).toThrowError(expect.objectContaining({ code: 'target-out-of-range' }))
      expect({ map: fixture.map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)

      const harness = openHarness(fixture)
      const command = commandFor(fixture, `${evidence.scenarioId}.command`)
      const response = await executeCommand(harness, command, {
        random: () => { throw new Error('out-of-range command must not roll') },
      })
      expect(response.result).toMatchObject({
        ok: false,
        reason: 'invalid',
        currentState: { code: 'target-out-of-range' },
      })
      expect(harness.maps.getBySlug(fixture.map.slug)?.revision).toBe(7)
      expect(harness.sheets.list().every(sheet => sheet.revision === 3)).toBe(true)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toEqual(response.result)
      expect(harness.events).toEqual([])
    },
  )

  it.each(REG_028_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = acceptedScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = evidenceWithSuffix(moveName, '-duplicate-replay')
      const command = commandFor(fixture, evidence.scenarioId)
      const first = await executeCommand(harness, command, {
        random: randomSequence(randomValuesForNaturalRoll(scenario.naturalRoll)),
      })
      expect(first.result.ok).toBe(true)
      const committedMap = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      const committedSheets = deepCloneJson(harness.sheets.list())
      const committedEvents = deepCloneJson(harness.events)

      const duplicate = await executeCommand(harness, command, {
        random: () => { throw new Error(`duplicate ${moveName} must not reroll`) },
        planner: () => { throw new Error(`duplicate ${moveName} must not replan`) },
      })
      expect(duplicate).toEqual(first)
      expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(committedMap)
      expect(harness.sheets.list()).toEqual(committedSheets)
      expect(harness.events).toEqual(committedEvents)
    },
  )

  it.each(REG_028_MOVE_NAMES)(
    'rejects stale %s state without a partial accepted result',
    async (moveName) => {
      const scenario = acceptedScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = evidenceWithSuffix(moveName, '-stale-target')
      const command = commandFor(fixture, evidence.scenarioId)
      const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      let racedTarget: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
        const plan: AuthoritativeMoveStatePlan = planAuthoritativeMoveState({
          ...input,
          random: randomSequence(randomValuesForNaturalRoll(scenario.naturalRoll)),
        })
        expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: TARGET_ID }))
        const current = harness.sheets.getByRef('pokemon', TARGET_ID)
        if (!current) throw new Error(`Missing ${moveName} target sheet.`)
        racedTarget = {
          ...deepCloneJson(current.sheet),
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        }
        harness.sheets.save({
          kind: 'pokemon',
          slug: TARGET_ID,
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
      expect(harness.sheets.getByRef('pokemon', TARGET_ID)?.sheet).toEqual(racedTarget)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )

  it('keeps every REG-028 definition on the audited v1 adapter', () => {
    for (const moveName of REG_028_MOVE_NAMES) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        version: 2,
      })
    }
  })
})
