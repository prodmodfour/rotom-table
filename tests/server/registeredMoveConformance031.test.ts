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
import type { CombatStageKey } from '~/types/combatStages'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import {
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
  explicitScriptForMove,
} from '~/utils/moveAutomation'
import { deepCloneJson } from '~/utils/serialization'
import { resolveMoveGrantedCapabilities } from '~/utils/sheets/pokemonMoveGrantedCapabilities'
import {
  resolveAuthoritativeMove,
  type AuthoritativeMoveResolution,
} from '~~/server/domain/resolveAuthoritativeMove'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import { adaptLegacyMoveResourceCosts } from '~~/server/domain/moveAutomation/planMoveResources'
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'
import { U_TURN_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/uTurn'
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
  REG_031_MOVE_NAMES,
  REG_031_SCENARIOS_BY_MOVE,
  THUNDER_SHOCK_REG_031_SCENARIOS,
  THUNDERBOLT_REG_031_SCENARIOS,
  TICKLE_REG_031_SCENARIOS,
  TORMENT_REG_031_SCENARIOS,
  U_TURN_REG_031_SCENARIOS,
  VACUUM_WAVE_REG_031_SCENARIOS,
  VICE_GRIP_REG_031_SCENARIOS,
  VINE_WHIP_REG_031_SCENARIOS,
  type RegisteredBatch031MoveName,
  type RegisteredMoveConformanceScenario,
} from '../fixtures/moveAutomation/registeredBatch031'
import { U_TURN_V2_SEMANTIC_SCENARIOS } from '../fixtures/moveAutomation/uTurnV2'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_ID = 'target-token'
const NOW = 5_000

const LEGACY_MOVE_NAMES = Object.freeze(REG_031_MOVE_NAMES.filter(
  (moveName): moveName is Exclude<RegisteredBatch031MoveName, 'U-Turn'> => moveName !== 'U-Turn',
))

type LegacyMoveName = (typeof LEGACY_MOVE_NAMES)[number]

interface StageExpectation {
  readonly recipientId: string
  readonly key: CombatStageKey
  readonly value: number
}

interface TokenProfile {
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly conditions?: readonly string[]
}

interface ExecutionScenario {
  readonly scenarioId: string
  readonly moveName: LegacyMoveName
  readonly targetProfile?: TokenProfile
  readonly initialStages?: readonly StageExpectation[]
  readonly actedThisRound?: boolean
  readonly randomValues: readonly number[]
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedLogFragments?: readonly string[]
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

const placement = (
  id: string,
  sheetSlug: string,
  position: { readonly x: number; readonly y: number; readonly z: number },
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  sideId: id === ACTOR_ID ? 'heroes' : 'foes',
  position: { ...position },
})

const stageValue = (
  stages: readonly StageExpectation[] | undefined,
  placementId: string,
  key: CombatStageKey,
): number => stages?.find(stage => (
  stage.recipientId === placementId && stage.key === key
))?.value ?? 0

const pokemonSheet = (options: {
  readonly slug: string
  readonly placementId: string
  readonly actor?: boolean
  readonly moves?: readonly CharacterSheetMove[]
  readonly profile?: TokenProfile
  readonly initialStages?: readonly StageExpectation[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.actor ? 'Raichu' : 'Clefairy',
  level: 20,
  revision: 3,
  types: [...(options.profile?.types ?? (options.actor ? ['Psychic'] : ['Normal']))],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  capabilities: { overland: 6 },
  movelist: [...(options.moves ?? [])],
  stats: {
    hp: { added: 500 },
    atk: { added: options.actor ? 50 : 5, stage: stageValue(options.initialStages, options.placementId, 'atk') },
    def: { added: 5, stage: stageValue(options.initialStages, options.placementId, 'def') },
    satk: { added: options.actor ? 50 : 5, stage: stageValue(options.initialStages, options.placementId, 'satk') },
    sdef: { added: 5, stage: stageValue(options.initialStages, options.placementId, 'sdef') },
    spd: { added: 5, stage: stageValue(options.initialStages, options.placementId, 'spd') },
  },
  combatStages: { acc: stageValue(options.initialStages, options.placementId, 'acc') },
  combat: {
    currentHp: 500,
    conditions: [...(options.profile?.conditions ?? [])],
  },
})

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-031-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-031 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 5, y: 0, z: 5 }),
      placement(TARGET_ID, 'target', { x: 6, y: 0, z: 5 }),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-031 scene', startedAt: 100 },
    encounterState: {
      ...emptyState,
      history: {
        ...emptyState.history,
        actedThisRoundPlacementIds: scenario.actedThisRound ? [ACTOR_ID] : [],
      },
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
    placementId: ACTOR_ID,
    actor: true,
    moves: [{ name: scenario.moveName }],
    initialStages: scenario.initialStages,
  })
  const target = pokemonSheet({
    slug: 'target',
    placementId: TARGET_ID,
    profile: scenario.targetProfile,
    initialStages: scenario.initialStages,
  })
  if (!explicitScriptForMove(scenario.moveName)) {
    throw new Error(`Missing reviewed compatibility script for ${scenario.moveName}.`)
  }

  return {
    map,
    pokemonSheets: new Map([['actor', actor], ['target', target]]),
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

const conditionsByTarget = (
  transaction: MoveAutomationTransaction,
): Readonly<Record<string, readonly string[]>> => Object.fromEntries(
  transaction.conditionUpdates.map(update => [update.id, update.conditions]),
)

const accuracyNaturalResults = (
  resolution: AuthoritativeMoveResolution,
): readonly number[] => resolution.rollLedger
  .filter(entry => entry.formula.kind === 'dice' && entry.formula.sides === 20)
  .map(entry => entry.naturalResult)

const assertScenarioResolution = (
  scenario: ExecutionScenario,
  resolution: AuthoritativeMoveResolution,
): void => {
  expect(resolution.auditTrace.program).toMatchObject({
    canonicalId: scenario.moveName,
    runtimeKind: 'movespec-v2',
    runtimeVersion: 2,
  })
  expect(resolution.transaction.attackedTargetIds).toEqual(scenario.expectedAttackedTargetIds)
  expect(resolution.transaction.hitTargetIds).toEqual(scenario.expectedHitTargetIds)
  expect(resolution.transaction.hpUpdates.map(update => update.id).sort())
    .toEqual([...scenario.expectedDamagedTargetIds].sort())
  for (const update of resolution.transaction.hpUpdates) expect(update.currentHp).toBeLessThan(500)
  expect(conditionsByTarget(resolution.transaction)).toEqual(scenario.expectedConditions ?? {})
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  const expectedStages = scenario.expectedStages ?? []
  if (expectedStages.length === 0) expect(resolution.transaction.combatStageUpdates).toEqual([])
  for (const expected of expectedStages) {
    const updated = resolution.transaction.combatStageUpdates.find(update => (
      update.id === expected.recipientId
    ))?.stages[expected.key]
    expect(updated ?? (Math.abs(expected.value) === 6 ? expected.value : undefined))
      .toBe(expected.value)
  }

  const searchable = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(searchable.toLowerCase()).toContain('critical')
  }
  assertReviewedNativeEvidenceFragments(searchable, scenario.expectedLogFragments ?? [])

  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort()).toEqual(['actor', 'target'])
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
  clientId: 'reg-031-client',
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
    return () => `reg-031-id-${++sequence}`
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

const thunderScenarios = (options: {
  readonly moveName: 'Thunder Shock' | 'Thunderbolt'
  readonly evidence: readonly RegisteredMoveConformanceScenario[]
  readonly thresholdPassRandom: number
  readonly thresholdFailRandom: number
}): readonly ExecutionScenario[] => [
  {
    scenarioId: options.evidence[0]!.scenarioId,
    moveName: options.moveName,
    randomValues: [options.thresholdPassRandom, 0, 0, 0, 0],
    expectedConditions: { [TARGET_ID]: ['Paralysis'] },
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [Math.floor(options.thresholdPassRandom * 20) + 1],
  },
  {
    scenarioId: options.evidence[1]!.scenarioId,
    moveName: options.moveName,
    randomValues: [options.thresholdFailRandom, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [Math.floor(options.thresholdFailRandom * 20) + 1],
  },
  {
    scenarioId: options.evidence[2]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: options.evidence[3]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedConditions: { [TARGET_ID]: ['Paralysis'] },
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_ID],
  },
  {
    scenarioId: options.evidence[4]!.scenarioId,
    moveName: options.moveName,
    targetProfile: { types: ['Ground'] },
    randomValues: [options.thresholdPassRandom],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [Math.floor(options.thresholdPassRandom * 20) + 1],
    expectedLogFragments: ['Electric immunity'],
  },
  {
    scenarioId: options.evidence[5]!.scenarioId,
    moveName: options.moveName,
    targetProfile: { types: ['Electric'] },
    randomValues: [options.thresholdPassRandom, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [Math.floor(options.thresholdPassRandom * 20) + 1],
    expectedLogFragments: ['Electric type'],
  },
  {
    scenarioId: options.evidence[6]!.scenarioId,
    moveName: options.moveName,
    targetProfile: { abilities: ['Shield Dust'] },
    randomValues: [options.thresholdPassRandom, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [Math.floor(options.thresholdPassRandom * 20) + 1],
    expectedLogFragments: ['Shield Dust'],
  },
]

const ordinaryAttackScenarios = (options: {
  readonly moveName: 'Vacuum Wave' | 'Vice Grip' | 'Vine Whip'
  readonly evidence: readonly RegisteredMoveConformanceScenario[]
  readonly immunityProfile: TokenProfile
  readonly immunityLog: string
}): readonly ExecutionScenario[] => [
  {
    scenarioId: options.evidence[0]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: options.evidence[1]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: options.evidence[2]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.999, 0, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_ID],
  },
  {
    scenarioId: options.evidence[3]!.scenarioId,
    moveName: options.moveName,
    targetProfile: options.immunityProfile,
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: [options.immunityLog],
  },
]

const normalScenarios: readonly ExecutionScenario[] = [
  ...thunderScenarios({
    moveName: 'Thunder Shock',
    evidence: THUNDER_SHOCK_REG_031_SCENARIOS,
    thresholdPassRandom: 0.8,
    thresholdFailRandom: 0.75,
  }),
  ...thunderScenarios({
    moveName: 'Thunderbolt',
    evidence: THUNDERBOLT_REG_031_SCENARIOS,
    thresholdPassRandom: 0.9,
    thresholdFailRandom: 0.85,
  }),
  {
    scenarioId: TICKLE_REG_031_SCENARIOS[0].scenarioId,
    moveName: 'Tickle',
    randomValues: [0.45],
    expectedStages: [
      { recipientId: TARGET_ID, key: 'atk', value: -1 },
      { recipientId: TARGET_ID, key: 'def', value: -1 },
    ],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: TICKLE_REG_031_SCENARIOS[1].scenarioId,
    moveName: 'Tickle',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: TICKLE_REG_031_SCENARIOS[2].scenarioId,
    moveName: 'Tickle',
    initialStages: [
      { recipientId: TARGET_ID, key: 'atk', value: -6 },
      { recipientId: TARGET_ID, key: 'def', value: -6 },
    ],
    randomValues: [0.45],
    expectedStages: [
      { recipientId: TARGET_ID, key: 'atk', value: -6 },
      { recipientId: TARGET_ID, key: 'def', value: -6 },
    ],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: TORMENT_REG_031_SCENARIOS[0].scenarioId,
    moveName: 'Torment',
    randomValues: [0.45],
    expectedConditions: { [TARGET_ID]: ['Suppressed'] },
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: TORMENT_REG_031_SCENARIOS[1].scenarioId,
    moveName: 'Torment',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  ...ordinaryAttackScenarios({
    moveName: 'Vacuum Wave',
    evidence: VACUUM_WAVE_REG_031_SCENARIOS,
    immunityProfile: { types: ['Ghost'] },
    immunityLog: 'Fighting immunity',
  }),
  ...ordinaryAttackScenarios({
    moveName: 'Vice Grip',
    evidence: VICE_GRIP_REG_031_SCENARIOS,
    immunityProfile: { types: ['Ghost'] },
    immunityLog: 'Normal immunity',
  }),
  ...ordinaryAttackScenarios({
    moveName: 'Vine Whip',
    evidence: VINE_WHIP_REG_031_SCENARIOS,
    immunityProfile: { abilities: ['Sap Sipper'] },
    immunityLog: 'Grass immunity',
  }),
]

const recoveryScenarioFor = (moveName: LegacyMoveName): ExecutionScenario => {
  const matching = normalScenarios.find(scenario => (
    scenario.moveName === moveName && scenario.expectedHitTargetIds.includes(TARGET_ID)
  ))
  if (!matching) throw new Error(`Missing accepted recovery scenario for ${moveName}.`)
  return matching
}

describe('REG-031 registered move conformance', () => {
  it('certifies exactly Thunder Shock through Vine Whip with linked evidence', () => {
    expect(Object.keys(REG_031_SCENARIOS_BY_MOVE)).toEqual([...REG_031_MOVE_NAMES])
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)

    for (const [canonicalId, scenarios] of Object.entries(REG_031_SCENARIOS_BY_MOVE)) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === canonicalId)
      expect(row, canonicalId).toMatchObject({
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: expect.any(String),
      })
      if (!row) continue
      expect([...row.scenarioIds].sort()).toEqual(scenarios.map(scenario => scenario.scenarioId).sort())
      expect(normalizedEvidence(row.conformanceEvidence.scenarios))
        .toEqual(normalizedEvidence(scenarios))
      expect(registeredMoveAutomationRuntimeFor(canonicalId), canonicalId).toMatchObject({
        canonicalId,
        kind: row.runtime.kind,
        version: row.runtime.version,
        definitionHash: row.runtime.definitionHash,
        sourceModule: row.runtime.sourceModule,
      })
    }
  })

  it('retains every reviewed canonical mechanic without unresolved rule instructions', () => {
    const expected = {
      'Thunder Shock': { ac: 2, damageBase: 4, damageClass: 'Special', range: '4, 1 Target', special: 'Grants Zapper' },
      Thunderbolt: { ac: 2, damageBase: 9, damageClass: 'Special', range: '4, 1 Target' },
      Tickle: { ac: 2, damageBase: 0, damageClass: 'Status', range: 'Melee, 1 Target' },
      Torment: { ac: 2, damageBase: 0, damageClass: 'Status', range: '10, 1 Target, Social' },
      'Vacuum Wave': { ac: 2, damageBase: 4, damageClass: 'Special', range: '4, 1 Target, Priority, Aura' },
      'Vice Grip': { ac: 2, damageBase: 6, damageClass: 'Physical', range: 'Melee, 1 Target' },
      'Vine Whip': { ac: 2, damageBase: 4, damageClass: 'Physical', range: '4, 1 Target', special: 'Grants Threaded' },
    } as const

    for (const [moveName, mechanics] of Object.entries(expected)) {
      expect(explicitScriptForMove(moveName), moveName).toMatchObject({
        kind: 'explicit',
        moveName,
        version: 1,
        ...mechanics,
      })
      expect(explicitScriptForMove(moveName)?.automationNotes.join(' '), moveName)
        .not.toMatch(/verify|adjust .* manually|apply .* manually|manual tracking|operator/i)
    }

    for (const [moveName, threshold] of [['Thunder Shock', '17+'], ['Thunderbolt', '19+']] as const) {
      expect(explicitScriptForMove(moveName)?.conditionSuggestions, moveName).toEqual([{
        recipient: 'target',
        condition: 'Paralysis',
        action: 'add',
        label: `Paralysis on ${threshold}`,
        threshold,
        optional: true,
      }])
    }
    expect(explicitScriptForMove('Tickle')?.stageSuggestions).toEqual([
      expect.objectContaining({ recipient: 'target', key: 'atk', delta: -1 }),
      expect.objectContaining({ recipient: 'target', key: 'def', delta: -1 }),
    ])
    expect(explicitScriptForMove('Torment')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Suppressed',
      action: 'add',
      label: 'Suppressed',
    }])
    expect(explicitScriptForMove('Vacuum Wave')?.keywords)
      .toEqual(expect.arrayContaining(['Priority', 'Aura']))
    expect(adaptLegacyMoveResourceCosts({
      range: explicitScriptForMove('Vacuum Wave')!.range,
      movementDistance: 0,
      setupStep: 'set-up',
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ cost: { kind: 'priority', mode: 'standard' } }),
      expect.objectContaining({ cost: { kind: 'action-resource', resource: 'standard', amount: 1 } }),
    ]))
    expect(resolveMoveGrantedCapabilities([{ name: 'Thunder Shock' }]).other).toEqual(['Zapper'])
    expect(resolveMoveGrantedCapabilities([{ name: 'Vine Whip' }]).other).toEqual(['Threaded'])

    expect(registeredMoveAutomationRuntimeFor('U-Turn')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: U_TURN_MOVE_SPEC },
    })
    expect(U_TURN_REG_031_SCENARIOS).toEqual(U_TURN_V2_SEMANTIC_SCENARIOS)
  })

  it.each(normalScenarios)(
    'proves $scenarioId through the executor, planner, and accepted command',
    async (scenario) => {
      const directFixture = fixtureFor(scenario)
      const snapshot = deepCloneJson({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] })
      const direct = resolveAuthoritativeMove({
        ...directFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-031-direct-id',
        resolutionId: `${scenario.scenarioId}.direct`,
      })
      assertScenarioResolution(scenario, direct)
      expect({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] }).toEqual(snapshot)

      const plannerFixture = fixtureFor(scenario)
      const plan = planAuthoritativeMoveState({
        ...plannerFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-031-plan-id',
        operationId: `op_${scenario.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}_plan`,
      })
      assertScenarioResolution(scenario, plan.resolution)
      expect(plan.resolution.transaction).toEqual(direct.transaction)

      const commandFixture = fixtureFor(scenario)
      const harness = openHarness(commandFixture)
      const command = commandFor(commandFixture, `${scenario.scenarioId}.command`)
      const response = await executeCommand(harness, command, {
        random: randomSequence(scenario.randomValues),
      })
      expect(response.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
      expect(response.move?.transaction).toEqual(plan.resolution.transaction)
      expect(response.move?.rollLedger).toEqual(plan.resolution.rollLedger)
      expect(response.move?.trace).toMatchObject({
        program: { canonicalId: scenario.moveName, runtimeKind: 'movespec-v2' },
      })
      expect(harness.ops.getOpResult(command.mapSlug, command.opId)).toEqual(response.result)
      const persistedMap = harness.maps.getBySlug(command.mapSlug)
      expect(persistedMap).toMatchObject({
        revision: 8,
        encounterState: {
          turnResources: {
            [ACTOR_ID]: { actions: { standard: { spent: 1 } } },
          },
        },
      })
      expect(persistedMap?.moveUsage).toEqual(plan.nextMap.moveUsage)
      for (const [slug, initialSheet] of commandFixture.pokemonSheets) {
        const expectedWrite = plan.sheetWrites.find(write => write.kind === 'pokemon' && write.slug === slug)
        expect(harness.sheets.getByRef('pokemon', slug)).toMatchObject({
          revision: expectedWrite?.revision ?? initialSheet.revision,
          sheet: expectedWrite?.nextSheet ?? initialSheet,
        })
      }
    },
  )

  it('rejects Vacuum Wave Priority after the actor has acted without partial mutation', async () => {
    const scenario: ExecutionScenario = {
      ...recoveryScenarioFor('Vacuum Wave'),
      scenarioId: VACUUM_WAVE_REG_031_SCENARIOS[4].scenarioId,
      actedThisRound: true,
    }
    const fixture = fixtureFor(scenario)
    const snapshot = deepCloneJson({ map: fixture.map, sheets: [...fixture.pokemonSheets] })
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: randomSequence(scenario.randomValues),
      now: () => NOW,
      operationId: `op_${scenario.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
    })).toThrowError(expect.objectContaining({
      code: 'move-resource-unavailable',
      message: expect.stringContaining('priority-unavailable'),
    }))
    expect({ map: fixture.map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)

    const harness = openHarness(fixture)
    const command = commandFor(fixture, `${scenario.scenarioId}.command`)
    const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const sheetsBefore = deepCloneJson(harness.sheets.list())
    const response = await executeCommand(harness, command, {
      random: randomSequence(scenario.randomValues),
    })
    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('priority-unavailable'),
    })
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(mapBefore)
    expect(harness.sheets.list()).toEqual(sheetsBefore)
    expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toEqual(response.result)
    expect(harness.events).toEqual([])
  })

  it.each(LEGACY_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_031_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('retry'))!
      const command = commandFor(fixture, evidence.scenarioId)
      const first = await executeCommand(harness, command, {
        random: randomSequence(scenario.randomValues),
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

  it.each(LEGACY_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_031_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))!
      const command = commandFor(fixture, evidence.scenarioId)
      const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      let racedSheet: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
        const plan: AuthoritativeMoveStatePlan = planAuthoritativeMoveState({
          ...input,
          random: randomSequence(scenario.randomValues),
        })
        expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: 'target' }))
        const current = harness.sheets.getByRef('pokemon', 'target')
        if (!current) throw new Error(`Missing ${moveName} raced target sheet.`)
        racedSheet = {
          ...deepCloneJson(current.sheet),
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        }
        harness.sheets.save({
          kind: 'pokemon',
          slug: 'target',
          document: racedSheet,
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
      expect(harness.sheets.getByRef('pokemon', 'target')?.sheet).toEqual(racedSheet)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )

  it('keeps only U-Turn on the reviewed native runtime in this batch', () => {
    for (const moveName of LEGACY_MOVE_NAMES) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        version: 2,
      })
    }
    expect(registeredMoveAutomationRuntimeFor('U-Turn')).toMatchObject({
      kind: 'movespec-v2',
      version: 2,
    })
  })
})
