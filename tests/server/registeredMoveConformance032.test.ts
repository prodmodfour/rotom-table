import { afterEach, describe, expect, it } from 'vitest'
import {
  assertReviewedNativeEvidenceFragments,
  assertReviewedNativeSmiteMissEvidence,
} from '../fixtures/moveAutomation/nativeEvidence'
import manifestJson from '../../data/move-automation/manifest.json'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
  type ResolveMoveSelection,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationTransaction } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import {
  EXPLICIT_MOVE_AUTOMATION_SCRIPTS,
  explicitScriptForMove,
} from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
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
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'
import { YAWN_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/yawn'
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
  REG_032_MOVE_NAMES,
  REG_032_SCENARIOS_BY_MOVE,
  WATER_GUN_REG_032_SCENARIOS,
  WATER_PULSE_REG_032_SCENARIOS,
  WATERFALL_REG_032_SCENARIOS,
  WILDBOLT_STORM_REG_032_SCENARIOS,
  WILL_O_WISP_REG_032_SCENARIOS,
  WING_ATTACK_REG_032_SCENARIOS,
  X_SCISSOR_REG_032_SCENARIOS,
  YAWN_REG_032_SCENARIOS,
  type RegisteredBatch032MoveName,
  type RegisteredMoveConformanceScenario,
} from '../fixtures/moveAutomation/registeredBatch032'
import {
  YAWN_V2_SEMANTIC_SCENARIOS,
  yawnV2Fixture,
} from '../fixtures/moveAutomation/yawnV2'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const BLAST_AIM_CELL = Object.freeze({ x: 5, y: 0, z: 5 })
const NOW = 5_000

const LEGACY_MOVE_NAMES = Object.freeze(REG_032_MOVE_NAMES.filter(
  (moveName): moveName is Exclude<RegisteredBatch032MoveName, 'Yawn'> => moveName !== 'Yawn',
))

type LegacyMoveName = (typeof LEGACY_MOVE_NAMES)[number]
type TargetId = typeof TARGET_A_ID | typeof TARGET_B_ID | typeof TARGET_C_ID
type SelectionKind = 'single-target' | 'ranged-blast'

interface TokenProfile {
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly conditions?: readonly string[]
}

interface ExecutionScenario {
  readonly scenarioId: string
  readonly moveName: LegacyMoveName
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly actorProfile?: TokenProfile
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TokenProfile>>>
  readonly randomValues: readonly number[]
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedSmiteMissTargetIds?: readonly string[]
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

const pokemonSheet = (options: {
  readonly slug: string
  readonly actor?: boolean
  readonly moves?: readonly CharacterSheetMove[]
  readonly profile?: TokenProfile
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.actor ? 'Mew' : 'Clefairy',
  level: 20,
  revision: 3,
  types: [...(options.profile?.types ?? ['Normal'])],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  capabilities: { overland: 6 },
  movelist: [...(options.moves ?? [])],
  stats: {
    hp: { added: 500 },
    atk: { added: options.actor ? 50 : 5, stage: 0 },
    def: { added: 5, stage: 0 },
    satk: { added: options.actor ? 50 : 5, stage: 0 },
    sdef: { added: 5, stage: 0 },
    spd: { added: 5, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: {
    currentHp: 500,
    conditions: [...(options.profile?.conditions ?? [])],
  },
})

const targetPosition = (
  selectionKind: SelectionKind,
  id: TargetId,
): { readonly x: number; readonly y: number; readonly z: number } => {
  if (selectionKind === 'ranged-blast') {
    if (id === TARGET_A_ID) return { ...BLAST_AIM_CELL }
    if (id === TARGET_B_ID) return { x: 5, y: 0, z: 4 }
    return { x: 4, y: 0, z: 5 }
  }
  return { x: 6, y: 0, z: 5 }
}

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const selectionKind = scenario.selectionKind ?? 'single-target'
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-032-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-032 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', {
        x: selectionKind === 'ranged-blast' ? 1 : 5,
        y: 0,
        z: 5,
      }),
      ...targetIds.map(id => placement(id, id, targetPosition(selectionKind, id))),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-032 scene', startedAt: 100 },
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
    moves: [{ name: scenario.moveName }],
    profile: scenario.actorProfile,
  })
  const targets = targetIds.map(id => [id, pokemonSheet({
    slug: id,
    profile: scenario.targetProfiles?.[id],
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed compatibility script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const template = script.areaTemplates?.find(candidate => candidate.kind === 'ranged-blast')
    if (!template) throw new Error(`${scenario.moveName} must retain Ranged Blast geometry.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
      aimCell: { ...BLAST_AIM_CELL },
    }
  }

  return {
    map,
    pokemonSheets: new Map([['actor', actor], ...targets]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: ACTOR_ID,
      moveName: scenario.moveName,
      selection,
    },
    candidateScopePlacementIds: targetIds,
  }
}

const yawnConflictFixture = (): MoveFixture => {
  const fixture = yawnV2Fixture()
  return {
    ...fixture,
    map: {
      ...fixture.map,
      slug: 'reg-032-yawn-v2-stale-target',
      encounterState: createEmptyEncounterState(),
    },
    candidateScopePlacementIds: ['target-token'],
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
  expect(resolution.transaction.combatStageUpdates).toEqual([])
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  if ((scenario.selectionKind ?? 'single-target') === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(scenario.expectedAttackedTargetIds)
    expect(resolution.area?.excludedTargetIds).toEqual([])
    expect(resolution.area?.aimCell).toEqual(BLAST_AIM_CELL)
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
  for (const targetId of scenario.expectedSmiteMissTargetIds ?? []) {
    expect(resolution.transaction.hitTargetIds).not.toContain(targetId)
    expect(resolution.transaction.hpUpdates.map(update => update.id)).toContain(targetId)
    assertReviewedNativeSmiteMissEvidence(resolution, targetId)
  }
  assertReviewedNativeEvidenceFragments(searchable, scenario.expectedLogFragments ?? [])

  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort())
    .toEqual(['actor', ...(scenario.targetIds ?? [TARGET_A_ID])].sort())
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
  clientId: 'reg-032-client',
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
    return () => `reg-032-id-${++sequence}`
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

const ordinaryAttackScenarios = (options: {
  readonly moveName: 'Water Gun' | 'Wing Attack' | 'X-Scissor'
  readonly evidence: readonly RegisteredMoveConformanceScenario[]
}): readonly ExecutionScenario[] => [
  {
    scenarioId: options.evidence[0]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: options.evidence[1]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: options.evidence[2]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.999, 0, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
]

const thresholdConditionScenarios = (options: {
  readonly moveName: 'Water Pulse' | 'Waterfall'
  readonly evidence: readonly RegisteredMoveConformanceScenario[]
  readonly condition: readonly string[]
}): readonly ExecutionScenario[] => [
  {
    scenarioId: options.evidence[0]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.8, 0, 0, 0],
    expectedConditions: { [TARGET_A_ID]: options.condition },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: options.evidence[1]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.75, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: options.evidence[2]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: options.evidence[3]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.999, 0, 0, 0, 0, 0],
    expectedConditions: { [TARGET_A_ID]: options.condition },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: options.evidence[4]!.scenarioId,
    moveName: options.moveName,
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.8, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
    expectedLogFragments: ['Shield Dust'],
  },
]

const normalScenarios: readonly ExecutionScenario[] = [
  ...ordinaryAttackScenarios({
    moveName: 'Water Gun',
    evidence: WATER_GUN_REG_032_SCENARIOS,
  }),
  ...thresholdConditionScenarios({
    moveName: 'Water Pulse',
    evidence: WATER_PULSE_REG_032_SCENARIOS,
    condition: ['Confused'],
  }),
  ...thresholdConditionScenarios({
    moveName: 'Waterfall',
    evidence: WATERFALL_REG_032_SCENARIOS,
    condition: ['Flinch', 'Vulnerable'],
  }),
  {
    scenarioId: WILDBOLT_STORM_REG_032_SCENARIOS[0].scenarioId,
    moveName: 'Wildbolt Storm',
    selectionKind: 'ranged-blast',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    randomValues: [0.7, 0.65, 0],
    expectedConditions: { [TARGET_A_ID]: ['Paralysis'] },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedHitTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedDamagedTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedAccuracyNaturalResults: [15, 14, 1],
    expectedSmiteMissTargetIds: [TARGET_C_ID],
  },
  {
    scenarioId: WILDBOLT_STORM_REG_032_SCENARIOS[1].scenarioId,
    moveName: 'Wildbolt Storm',
    selectionKind: 'ranged-blast',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedConditions: { [TARGET_A_ID]: ['Paralysis'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: WILDBOLT_STORM_REG_032_SCENARIOS[2].scenarioId,
    moveName: 'Wildbolt Storm',
    selectionKind: 'ranged-blast',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ground'] } },
    randomValues: [0.7],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Electric immunity'],
  },
  {
    scenarioId: WILDBOLT_STORM_REG_032_SCENARIOS[3].scenarioId,
    moveName: 'Wildbolt Storm',
    selectionKind: 'ranged-blast',
    targetProfiles: { [TARGET_A_ID]: { types: ['Electric'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Electric type'],
  },
  {
    scenarioId: WILDBOLT_STORM_REG_032_SCENARIOS[4].scenarioId,
    moveName: 'Wildbolt Storm',
    selectionKind: 'ranged-blast',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: WILL_O_WISP_REG_032_SCENARIOS[0].scenarioId,
    moveName: 'Will-O-Wisp',
    randomValues: [0.45],
    expectedConditions: { [TARGET_A_ID]: ['Burned'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: WILL_O_WISP_REG_032_SCENARIOS[1].scenarioId,
    moveName: 'Will-O-Wisp',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: WILL_O_WISP_REG_032_SCENARIOS[2].scenarioId,
    moveName: 'Will-O-Wisp',
    targetProfiles: { [TARGET_A_ID]: { types: ['Fire'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Fire type'],
  },
  {
    scenarioId: WILL_O_WISP_REG_032_SCENARIOS[3].scenarioId,
    moveName: 'Will-O-Wisp',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Water Veil'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Water Veil'],
  },
  {
    scenarioId: WILL_O_WISP_REG_032_SCENARIOS[4].scenarioId,
    moveName: 'Will-O-Wisp',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Flash Fire'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Flash Fire'],
  },
  ...ordinaryAttackScenarios({
    moveName: 'Wing Attack',
    evidence: WING_ATTACK_REG_032_SCENARIOS,
  }),
  ...ordinaryAttackScenarios({
    moveName: 'X-Scissor',
    evidence: X_SCISSOR_REG_032_SCENARIOS,
  }),
]

const recoveryScenarioFor = (moveName: LegacyMoveName): ExecutionScenario => {
  const matching = normalScenarios.find(scenario => (
    scenario.moveName === moveName
    && scenario.expectedHitTargetIds.includes(TARGET_A_ID)
    && (
      scenario.expectedDamagedTargetIds.includes(TARGET_A_ID)
      || Object.hasOwn(scenario.expectedConditions ?? {}, TARGET_A_ID)
    )
  ))
  if (!matching) throw new Error(`Missing accepted recovery scenario for ${moveName}.`)
  return matching
}

describe('REG-032 registered move conformance', () => {
  it('certifies exactly Water Gun through Yawn with linked evidence', () => {
    expect(Object.keys(REG_032_SCENARIOS_BY_MOVE)).toEqual([...REG_032_MOVE_NAMES])
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)

    for (const [canonicalId, scenarios] of Object.entries(REG_032_SCENARIOS_BY_MOVE)) {
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
      'Water Gun': { ac: 2, damageBase: 4, damageClass: 'Special', range: '4, 1 Target', special: 'Grants Fountain' },
      'Water Pulse': { ac: 2, damageBase: 6, damageClass: 'Special', range: '8, 1 Target, Aura' },
      Waterfall: { ac: 2, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target' },
      'Wildbolt Storm': { ac: 5, damageBase: 10, damageClass: 'Special', range: '6, Ranged Blast 3, Smite' },
      'Will-O-Wisp': { ac: 5, damageBase: 0, damageClass: 'Status', range: '6, 1 Target' },
      'Wing Attack': { ac: 2, damageBase: 6, damageClass: 'Physical', range: 'Melee, 1 Target' },
      'X-Scissor': { ac: 2, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target, Dash' },
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

    expect(resolveMoveGrantedCapabilities([{ name: 'Water Gun' }]).other).toEqual(['Fountain'])
    expect(explicitScriptForMove('Water Pulse')).toMatchObject({
      keywords: expect.arrayContaining(['Aura']),
      conditionSuggestions: [{ condition: 'Confused', threshold: '17+' }],
    })
    expect(explicitScriptForMove('Waterfall')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Flinch',
      action: 'add',
      label: 'Flinch on 17+',
      threshold: '17+',
      optional: true,
    }])
    expect(explicitScriptForMove('Wildbolt Storm')).toMatchObject({
      keywords: expect.arrayContaining(['Ranged Blast 3', 'Smite']),
      areaTemplates: [{ kind: 'ranged-blast', size: 3, range: 6 }],
      conditionSuggestions: [{ condition: 'Paralysis', threshold: '15+' }],
    })
    expect(explicitScriptForMove('Will-O-Wisp')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Burned',
      action: 'add',
      label: 'Burned',
      optional: false,
    }])
    expect(explicitScriptForMove('X-Scissor')?.keywords).toContain('Dash')

    expect(registeredMoveAutomationRuntimeFor('Yawn')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: YAWN_MOVE_SPEC },
    })
    expect(YAWN_REG_032_SCENARIOS).toEqual([
      ...YAWN_V2_SEMANTIC_SCENARIOS,
      { scenarioId: 'yawn.v2-stale-target', evidenceClasses: ['multi-resource-conflict'] },
    ])
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
        idFactory: () => 'reg-032-direct-id',
        resolutionId: `${scenario.scenarioId}.direct`,
      })
      assertScenarioResolution(scenario, direct)
      expect({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] }).toEqual(snapshot)

      const plannerFixture = fixtureFor(scenario)
      const plan = planAuthoritativeMoveState({
        ...plannerFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-032-plan-id',
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

  it('rejects X-Scissor while Stuck before rolls, costs, or effects', async () => {
    const scenario: ExecutionScenario = {
      ...recoveryScenarioFor('X-Scissor'),
      scenarioId: X_SCISSOR_REG_032_SCENARIOS[3].scenarioId,
      actorProfile: { conditions: ['Stuck'] },
    }
    const fixture = fixtureFor(scenario)
    const snapshot = deepCloneJson({ map: fixture.map, sheets: [...fixture.pokemonSheets] })
    expect(() => resolveAuthoritativeMove({
      ...fixture,
      random: () => { throw new Error('blocked Dash must not roll') },
    })).toThrowError(expect.objectContaining({
      code: 'move-condition-blocked',
      message: expect.stringContaining('Dash keyword cannot be used while Stuck'),
    }))
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: () => { throw new Error('blocked Dash must not roll') },
      operationId: `op_${scenario.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
    })).toThrowError(expect.objectContaining({ code: 'move-condition-blocked' }))
    expect({ map: fixture.map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)

    const harness = openHarness(fixture)
    const command = commandFor(fixture, `${scenario.scenarioId}.command`)
    const response = await executeCommand(harness, command, {
      random: () => { throw new Error('blocked Dash command must not roll') },
    })
    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('Dash keyword cannot be used while Stuck'),
    })
    expect(harness.maps.getBySlug(fixture.map.slug)?.revision).toBe(7)
    expect(harness.sheets.list().every(sheet => sheet.revision === 3)).toBe(true)
    expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toEqual(response.result)
    expect(harness.events).toEqual([])
  })

  it.each(LEGACY_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_032_SCENARIOS_BY_MOVE[moveName]
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
      const evidence = REG_032_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))!
      const command = commandFor(fixture, evidence.scenarioId)
      const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      let racedSheet: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
        const plan: AuthoritativeMoveStatePlan = planAuthoritativeMoveState({
          ...input,
          random: randomSequence(scenario.randomValues),
        })
        expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: TARGET_A_ID }))
        const current = harness.sheets.getByRef('pokemon', TARGET_A_ID)
        if (!current) throw new Error(`Missing ${moveName} raced target sheet.`)
        racedSheet = {
          ...deepCloneJson(current.sheet),
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        }
        harness.sheets.save({
          kind: 'pokemon',
          slug: TARGET_A_ID,
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
      expect(harness.sheets.getByRef('pokemon', TARGET_A_ID)?.sheet).toEqual(racedSheet)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )

  it('rejects stale Yawn target state without creating its delayed effect', async () => {
    const fixture = yawnConflictFixture()
    const harness = openHarness(fixture)
    const evidence = YAWN_REG_032_SCENARIOS.find(
      candidate => candidate.scenarioId === 'yawn.v2-stale-target',
    )!
    const command = commandFor(fixture, evidence.scenarioId)
    const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    let racedSheet: Record<string, unknown> | null = null
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      const plan = planAuthoritativeMoveState({ ...input, random: randomSequence([]) })
      expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: 'target' }))
      const current = harness.sheets.getByRef('pokemon', 'target')
      if (!current) throw new Error('Missing Yawn raced target sheet.')
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
  })

  it('keeps only Yawn on the reviewed native runtime in this batch', () => {
    for (const moveName of LEGACY_MOVE_NAMES) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        version: 2,
      })
    }
    expect(registeredMoveAutomationRuntimeFor('Yawn')).toMatchObject({
      kind: 'movespec-v2',
      version: 2,
    })
  })
})
