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
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import { deepCloneJson } from '~/utils/serialization'
import {
  resolveAuthoritativeMove,
  type AuthoritativeMoveResolution,
} from '~~/server/domain/resolveAuthoritativeMove'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import { planInitiativeLifecycle } from '~~/server/domain/moveAutomation/planInitiativeLifecycle'
import { createFiniteAuthoritativeMoveRandomStream } from '~~/server/domain/moveAutomation/random'
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'
import { SAND_ATTACK_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/sandAttack'
import { SAND_TOMB_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/sandTomb'
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
  REG_023_MOVE_NAMES,
  REG_023_SCENARIOS_BY_MOVE,
  SACRED_FIRE_REG_023_SCENARIOS,
  SACRED_SWORD_REG_023_SCENARIOS,
  SAND_ATTACK_REG_023_SCENARIOS,
  SANDSTORM_SEAR_REG_023_SCENARIOS,
  SCALD_REG_023_SCENARIOS,
  SCARY_FACE_REG_023_SCENARIOS,
  SCORCHING_SANDS_REG_023_SCENARIOS,
  type RegisteredBatch023MoveName,
  type RegisteredMoveConformanceScenario,
} from '../fixtures/moveAutomation/registeredBatch023'
import {
  allSandAttackV2ImmediateScenarios,
  sandAttackV2SemanticScenario,
} from '../fixtures/moveAutomation/sandAttackV2'
import { runAndAssertMoveAutomationSemanticScenario } from '../fixtures/moveAutomation/scenario'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const BLAST_AIM_CELL = Object.freeze({ x: 5, y: 0, z: 5 })
const NOW = 5_000

const LEGACY_MOVE_NAMES = Object.freeze([
  'Sacred Fire',
  'Sacred Sword',
  'Sandstorm Sear',
  'Scald',
  'Scary Face',
  'Scorching Sands',
] as const satisfies readonly Exclude<
  RegisteredBatch023MoveName,
  'Sand Attack' | 'Sand Tomb'
>[])

type LegacyMoveName = (typeof LEGACY_MOVE_NAMES)[number]
type TargetId = typeof TARGET_A_ID | typeof TARGET_B_ID | typeof TARGET_C_ID
type SelectionKind = 'single-target' | 'ranged-blast'

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
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly actorProfile?: TokenProfile
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TokenProfile>>>
  readonly initialStages?: readonly StageExpectation[]
  readonly randomValues: readonly number[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedAreaCandidateTargetIds?: readonly string[]
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

const stageMap = (
  stages: readonly StageExpectation[] | undefined,
  recipientId: string,
): {
  readonly stats: NonNullable<CharacterSheet['stats']>
  readonly combatStages: NonNullable<CharacterSheet['combatStages']>
} => {
  const valueFor = (key: CombatStageKey): number => (
    stages?.find(stage => stage.recipientId === recipientId && stage.key === key)?.value ?? 0
  )
  return {
    stats: {
      hp: { added: 500 },
      atk: { added: 30, stage: valueFor('atk') },
      def: { added: 5, stage: valueFor('def') },
      satk: { added: 30, stage: valueFor('satk') },
      sdef: { added: 5, stage: valueFor('sdef') },
      spd: { added: 5, stage: valueFor('spd') },
    },
    combatStages: { acc: valueFor('acc') },
  }
}

const pokemonSheet = (options: {
  readonly slug: string
  readonly placementId: string
  readonly moves?: readonly CharacterSheetMove[]
  readonly profile?: TokenProfile
  readonly initialStages?: readonly StageExpectation[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.slug === 'actor' ? 'Mew' : 'Clefairy',
  level: 20,
  revision: 3,
  types: [...(options.profile?.types ?? ['Normal'])],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  capabilities: { overland: 6 },
  movelist: [...(options.moves ?? [])],
  ...stageMap(options.initialStages, options.placementId),
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
    slug: `reg-023-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-023 ${scenario.moveName}`,
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
    activeScene: { name: 'REG-023 scene', startedAt: 100 },
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
    placementId: ACTOR_ID,
    moves: [{ name: scenario.moveName }],
    profile: scenario.actorProfile,
    initialStages: scenario.initialStages,
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    placementId: id,
    profile: scenario.targetProfiles?.[id],
    initialStages: scenario.initialStages,
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const template = script.areaTemplates?.find(candidate => candidate.kind === 'ranged-blast')
    if (!template) throw new Error(`${scenario.moveName} must retain its reviewed Ranged Blast template.`)
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

const accuracyNaturalResults = (
  resolution: AuthoritativeMoveResolution,
): readonly number[] => resolution.rollLedger
  .filter(entry => entry.formula.kind === 'dice' && entry.formula.sides === 20)
  .map(entry => entry.naturalResult)

const stageValue = (
  transaction: MoveAutomationTransaction,
  expected: StageExpectation,
): number | undefined => {
  const updated = transaction.combatStageUpdates
    .find(update => update.id === expected.recipientId)
    ?.stages[expected.key]
  // Native reducers omit no-op writes when a stage is already at its canonical cap.
  return updated ?? (Math.abs(expected.value) === 6 ? expected.value : undefined)
}

const conditionUpdatesByTarget = (
  transaction: MoveAutomationTransaction,
): Readonly<Record<string, readonly string[]>> => Object.fromEntries(
  transaction.conditionUpdates.map(update => [update.id, update.conditions]),
)

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
  expect(conditionUpdatesByTarget(resolution.transaction))
    .toEqual(scenario.expectedConditions ?? {})

  if (scenario.expectedStages) {
    for (const expected of scenario.expectedStages) {
      expect(stageValue(resolution.transaction, expected)).toBe(expected.value)
    }
  }
  else {
    expect(resolution.transaction.combatStageUpdates).toEqual([])
  }
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  if ((scenario.selectionKind ?? 'single-target') === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(
      scenario.expectedAreaCandidateTargetIds ?? scenario.expectedAttackedTargetIds,
    )
    expect(resolution.area?.aimCell).toEqual(BLAST_AIM_CELL)
    expect(resolution.area?.excludedTargetIds).toEqual([])
  }

  const searchableEvidence = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(searchableEvidence.toLowerCase()).toContain('critical')
  }
  for (const targetId of scenario.expectedSmiteMissTargetIds ?? []) {
    expect(resolution.transaction.hitTargetIds).not.toContain(targetId)
    expect(resolution.transaction.hpUpdates.map(update => update.id)).toContain(targetId)
    assertReviewedNativeSmiteMissEvidence(resolution, targetId)
  }
  assertReviewedNativeEvidenceFragments(searchableEvidence, scenario.expectedLogFragments ?? [])

  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort()).toEqual(
    ['actor', ...(scenario.targetIds ?? [TARGET_A_ID])].sort(),
  )
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
  const opId = `op_${operationId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99)
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
    readonly random?: () => number
    readonly planner?: LivePlayResolveMoveCommandDependencies['planner']
  } = {},
): Promise<LivePlayResolveMoveCommandResponse> => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  command,
  clientId: 'reg-023-client',
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
    return () => `reg-023-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const burned = { [TARGET_A_ID]: ['Burned'] } as const

const thresholdBurnScenarios = (
  moveName: 'Scald' | 'Scorching Sands',
  evidence: readonly RegisteredMoveConformanceScenario[],
): readonly ExecutionScenario[] => [
  {
    scenarioId: evidence[0]!.scenarioId,
    moveName,
    randomValues: [0.7, 0, 0, 0],
    expectedConditions: burned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: evidence[1]!.scenarioId,
    moveName,
    randomValues: [0.65, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: evidence[2]!.scenarioId,
    moveName,
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: evidence[3]!.scenarioId,
    moveName,
    randomValues: [0.999, 0, 0, 0, 0, 0],
    expectedConditions: burned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: evidence[4]!.scenarioId,
    moveName,
    targetProfiles: { [TARGET_A_ID]: { types: ['Fire'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Fire type'],
  },
  {
    scenarioId: evidence[5]!.scenarioId,
    moveName,
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
]

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: SACRED_FIRE_REG_023_SCENARIOS[0].scenarioId,
    moveName: 'Sacred Fire',
    randomValues: [0.45, 0, 0, 0, 0],
    expectedConditions: burned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: SACRED_FIRE_REG_023_SCENARIOS[1].scenarioId,
    moveName: 'Sacred Fire',
    randomValues: [0.4, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [9],
  },
  {
    scenarioId: SACRED_FIRE_REG_023_SCENARIOS[2].scenarioId,
    moveName: 'Sacred Fire',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: SACRED_FIRE_REG_023_SCENARIOS[3].scenarioId,
    moveName: 'Sacred Fire',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedConditions: burned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: SACRED_FIRE_REG_023_SCENARIOS[4].scenarioId,
    moveName: 'Sacred Fire',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Flash Fire'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Flash Fire'],
  },
  {
    scenarioId: SACRED_FIRE_REG_023_SCENARIOS[5].scenarioId,
    moveName: 'Sacred Fire',
    targetProfiles: { [TARGET_A_ID]: { types: ['Fire'] } },
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Fire type'],
  },
  {
    scenarioId: SACRED_FIRE_REG_023_SCENARIOS[6].scenarioId,
    moveName: 'Sacred Fire',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: SACRED_SWORD_REG_023_SCENARIOS[0].scenarioId,
    moveName: 'Sacred Sword',
    randomValues: [0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: SACRED_SWORD_REG_023_SCENARIOS[1].scenarioId,
    moveName: 'Sacred Sword',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ghost'] } },
    randomValues: [],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedLogFragments: ['Fighting immunity'],
  },
  {
    scenarioId: SANDSTORM_SEAR_REG_023_SCENARIOS[0].scenarioId,
    moveName: 'Sandstorm Sear',
    selectionKind: 'ranged-blast',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    // Native execution resolves the complete area accuracy phase first.
    randomValues: [0.7, 0.65, 0],
    expectedConditions: burned,
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedHitTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedDamagedTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedAccuracyNaturalResults: [15, 14, 1],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedSmiteMissTargetIds: [TARGET_C_ID],
  },
  {
    scenarioId: SANDSTORM_SEAR_REG_023_SCENARIOS[1].scenarioId,
    moveName: 'Sandstorm Sear',
    selectionKind: 'ranged-blast',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedConditions: burned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: SANDSTORM_SEAR_REG_023_SCENARIOS[2].scenarioId,
    moveName: 'Sandstorm Sear',
    selectionKind: 'ranged-blast',
    targetProfiles: { [TARGET_A_ID]: { types: ['Fire'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Fire type'],
  },
  {
    scenarioId: SANDSTORM_SEAR_REG_023_SCENARIOS[3].scenarioId,
    moveName: 'Sandstorm Sear',
    selectionKind: 'ranged-blast',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
  ...thresholdBurnScenarios('Scald', SCALD_REG_023_SCENARIOS),
  {
    scenarioId: SCARY_FACE_REG_023_SCENARIOS[0].scenarioId,
    moveName: 'Scary Face',
    randomValues: [0.45],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -2 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: SCARY_FACE_REG_023_SCENARIOS[1].scenarioId,
    moveName: 'Scary Face',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: SCARY_FACE_REG_023_SCENARIOS[2].scenarioId,
    moveName: 'Scary Face',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -6 }],
    randomValues: [0.45],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  ...thresholdBurnScenarios('Scorching Sands', SCORCHING_SANDS_REG_023_SCENARIOS),
]

const recoveryScenarioFor = (moveName: LegacyMoveName): ExecutionScenario => {
  const matching = normalScenarios.find(scenario => (
    scenario.moveName === moveName
    && scenario.expectedHitTargetIds.includes(TARGET_A_ID)
    && (scenario.expectedDamagedTargetIds.includes(TARGET_A_ID) || moveName === 'Scary Face')
  ))
  if (!matching) throw new Error(`Missing accepted recovery scenario for ${moveName}.`)
  return matching
}

const normalizedEvidence = (
  scenarios: readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[],
): readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[] => scenarios
  .map(scenario => ({
    scenarioId: scenario.scenarioId,
    evidenceClasses: [...scenario.evidenceClasses].sort(),
  }))
  .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const sandAttackCommandFixture = (): MoveFixture => {
  const scenario = sandAttackV2SemanticScenario('sand-attack.v2-blindness-hit')
  return {
    map: {
      ...deepCloneJson(scenario.initialState.map),
      encounterState: deepCloneJson(scenario.initialState.encounterState),
    },
    pokemonSheets: new Map([...scenario.initialState.pokemonSheets].map(([slug, sheet]) => [
      slug,
      deepCloneJson(sheet),
    ])),
    trainerSheets: new Map(),
    intent: deepCloneJson(scenario.intent),
    candidateScopePlacementIds: ['target-token'],
  }
}

describe('REG-023 registered move conformance', () => {
  it('certifies exactly Sacred Fire through Scorching Sands with linked evidence', () => {
    expect(Object.keys(REG_023_SCENARIOS_BY_MOVE)).toEqual([...REG_023_MOVE_NAMES])
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)

    for (const [canonicalId, scenarios] of Object.entries(REG_023_SCENARIOS_BY_MOVE)) {
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

  it('retains every reviewed canonical mechanic without unresolved rule instructions', () => {
    const expected = {
      'Sacred Fire': { ac: 3, damageBase: 10, damageClass: 'Physical', range: '6, 1 Target' },
      'Sacred Sword': { ac: null, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target', requiresAccuracy: false },
      'Sandstorm Sear': { ac: 5, damageBase: 10, damageClass: 'Special', range: '6, Ranged Blast 3, Smite' },
      Scald: { ac: 2, damageBase: 8, damageClass: 'Special', range: '5, 1 Target' },
      'Scary Face': { ac: 2, damageBase: 0, damageClass: 'Status', range: '4, 1 Target, Social' },
      'Scorching Sands': { ac: 2, damageBase: 7, damageClass: 'Special', range: '5, 1 Target' },
    } as const

    for (const [moveName, mechanics] of Object.entries(expected)) {
      const script = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(moveName)
      expect(script, moveName).toMatchObject({
        kind: 'explicit',
        moveName,
        version: 1,
        ...mechanics,
      })
      expect(script?.automationNotes.join(' '), moveName)
        .not.toMatch(/verify|adjust .* manually|apply .* manually|manual tracking|operator/i)
    }

    expect(explicitScriptForMove('Sacred Fire')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Burned',
      action: 'add',
      label: 'Burned on even roll',
      threshold: 'even roll',
      optional: true,
    }])
    expect(explicitScriptForMove('Sacred Sword')?.requiresAccuracy).toBe(false)
    expect(explicitScriptForMove('Sandstorm Sear')).toMatchObject({
      keywords: expect.arrayContaining(['Ranged Blast 3', 'Smite']),
      areaTemplates: [{ kind: 'ranged-blast', size: 3, range: 6 }],
      conditionSuggestions: [{ condition: 'Burned', threshold: '15+' }],
    })
    for (const moveName of ['Scald', 'Scorching Sands']) {
      expect(explicitScriptForMove(moveName)?.conditionSuggestions, moveName).toEqual([{
        recipient: 'target',
        condition: 'Burned',
        action: 'add',
        label: 'Burned on 15+',
        threshold: '15+',
        optional: true,
      }])
    }
    expect(explicitScriptForMove('Scary Face')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'spd',
      delta: -2,
      label: 'Scary Face lowers Speed: -2 Speed CS',
    }])
    expect(registeredMoveAutomationRuntimeFor('Sand Attack')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SAND_ATTACK_MOVE_SPEC },
    })
    expect(registeredMoveAutomationRuntimeFor('Sand Tomb')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SAND_TOMB_MOVE_SPEC },
    })
  })

  it.each(normalScenarios)(
    'proves $scenarioId through the executor, planner, and accepted command',
    async (scenario) => {
      const directFixture = fixtureFor(scenario)
      const directSnapshot = deepCloneJson({
        map: directFixture.map,
        sheets: [...directFixture.pokemonSheets],
      })
      const direct = resolveAuthoritativeMove({
        ...directFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-023-direct-id',
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
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-023-plan-id',
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
      expect(persistedMap).toMatchObject({ revision: 8 })
      expect(persistedMap?.moveUsage).toEqual(plan.nextMap.moveUsage)
      expect(persistedMap?.encounterState?.turnResources[ACTOR_ID]).toMatchObject({
        actions: { standard: { spent: 1 } },
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

  it.each(allSandAttackV2ImmediateScenarios())(
    'proves $scenarioId through the native interpreter, planner, and accepted command',
    async (scenario) => {
      const result = await runAndAssertMoveAutomationSemanticScenario(scenario)
      expect([result.interpreter.status, result.plan.status, result.command.status])
        .toEqual(['completed', 'completed', 'completed'])
    },
  )

  it('expires Sand Attack Blindness at the end of the target next turn', () => {
    const scenario = sandAttackV2SemanticScenario('sand-attack.v2-blindness-hit')
    const plan = planAuthoritativeMoveState({
      map: deepCloneJson(scenario.initialState.map),
      pokemonSheets: new Map([...scenario.initialState.pokemonSheets].map(([slug, sheet]) => [
        slug,
        deepCloneJson(sheet),
      ])),
      trainerSheets: new Map(),
      intent: deepCloneJson(scenario.intent),
      random: createFiniteAuthoritativeMoveRandomStream(scenario.seed.randomValues),
      now: () => NOW,
      operationId: 'op_sandattack_expiry_setup',
    })
    const effect = plan.nextMap.encounterState?.effects.find(candidate => (
      candidate.kind === 'condition'
      && candidate.payload.conditionId === 'blindness'
    ))
    expect(effect).toMatchObject({
      duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
      affected: { placementIds: ['target-token'] },
      transferPolicy: 'expire',
    })
    expect(projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: plan.nextMap.encounterState?.effects,
      target: { placementId: 'target-token' },
    }).conditions).toContain('Blindness')

    const lifecycle = planInitiativeLifecycle({
      map: {
        ...plan.nextMap,
        initiative: { activeId: 'target-token', round: 1 },
      },
      previous: { activeId: 'target-token', round: 1 },
      current: { activeId: 'actor-token', round: 2 },
      orderIds: ['actor-token', 'target-token'],
      operationId: `op_${SAND_ATTACK_REG_023_SCENARIOS[3]!.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
      time: NOW + 1_000,
      loadSheets: () => ({
        pokemonSheets: scenario.initialState.pokemonSheets,
        trainerSheets: scenario.initialState.trainerSheets,
      }),
    })

    expect(lifecycle.currentEncounterState.effects).not.toContainEqual(
      expect.objectContaining({ id: effect?.id }),
    )
    expect(projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: lifecycle.currentEncounterState.effects,
      target: { placementId: 'target-token' },
    }).conditions).not.toContain('Blindness')
    expect(lifecycle.reduction.transitions).toContainEqual(expect.objectContaining({
      transition: expect.objectContaining({
        kind: 'expired',
        reasonCode: 'effect-duration-expired',
      }),
    }))
  })

  it.each(LEGACY_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_023_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('retry'))
      if (!evidence) throw new Error(`Missing retry evidence for ${moveName}.`)
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
    'rejects stale %s state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_023_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))
      if (!evidence) throw new Error(`Missing conflict evidence for ${moveName}.`)
      const command = commandFor(fixture, evidence.scenarioId)
      const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      let racedTarget: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
        const plan: AuthoritativeMoveStatePlan = planAuthoritativeMoveState({
          ...input,
          random: randomSequence(scenario.randomValues),
        })
        expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: TARGET_A_ID }))
        const current = harness.sheets.getByRef('pokemon', TARGET_A_ID)
        if (!current) throw new Error(`Missing ${moveName} target sheet.`)
        racedTarget = {
          ...deepCloneJson(current.sheet),
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        }
        harness.sheets.save({
          kind: 'pokemon',
          slug: TARGET_A_ID,
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
      expect(harness.sheets.getByRef('pokemon', TARGET_A_ID)?.sheet).toEqual(racedTarget)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )

  it('replays Sand Attack without rerolling or creating a second effect', async () => {
    const fixture = sandAttackCommandFixture()
    const harness = openHarness(fixture)
    const command = commandFor(fixture, SAND_ATTACK_REG_023_SCENARIOS[4]!.scenarioId)
    const first = await executeCommand(harness, command, { random: randomSequence([0.45]) })
    expect(first.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
    const committedMap = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const committedEvents = deepCloneJson(harness.events)

    const duplicate = await executeCommand(harness, command, {
      random: () => { throw new Error('duplicate Sand Attack must not reroll') },
      planner: () => { throw new Error('duplicate Sand Attack must not replan') },
    })
    expect(duplicate).toEqual(first)
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(committedMap)
    expect(harness.events).toEqual(committedEvents)
    expect(committedMap?.encounterState?.effects.filter(effect => (
      effect.kind === 'condition' && effect.payload.conditionId === 'blindness'
    ))).toHaveLength(1)
  })

  it('rejects stale Sand Attack state without an effect or accepted result', async () => {
    const fixture = sandAttackCommandFixture()
    const harness = openHarness(fixture)
    const command = commandFor(fixture, SAND_ATTACK_REG_023_SCENARIOS[5]!.scenarioId)
    const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    let racedTarget: Record<string, unknown> | null = null
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      const plan = planAuthoritativeMoveState({
        ...input,
        random: randomSequence([0.45]),
      })
      const current = harness.sheets.getByRef('pokemon', 'target')
      if (!current) throw new Error('Missing Sand Attack target sheet.')
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
    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(mapBefore)
    expect(harness.sheets.getByRef('pokemon', 'target')?.sheet).toEqual(racedTarget)
    expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
    expect(harness.events).toEqual([])
  })
})
