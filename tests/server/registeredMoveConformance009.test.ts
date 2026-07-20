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
import { deepCloneJson } from '~/utils/serialization'
import {
  resolveAuthoritativeMove,
  type AuthoritativeMoveResolution,
} from '~~/server/domain/resolveAuthoritativeMove'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'
import { FAKE_OUT_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/fakeOut'
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
  ESPER_WING_REG_009_SCENARIOS,
  EXTRASENSORY_REG_009_SCENARIOS,
  EXTREME_SPEED_REG_009_SCENARIOS,
  FAIRY_WIND_REG_009_SCENARIOS,
  FAKE_OUT_REG_009_SCENARIOS,
  FAKE_TEARS_REG_009_SCENARIOS,
  FALSE_SURRENDER_REG_009_SCENARIOS,
  FEATHER_DANCE_REG_009_SCENARIOS,
  REG_009_MOVE_NAMES,
  REG_009_SCENARIOS_BY_MOVE,
  type RegisteredBatch009MoveName,
} from '../fixtures/moveAutomation/registeredBatch009'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const NOW = 5_000

const PASS_DESTINATION = { x: 5, y: 0, z: 1 } as const
const PASS_PATH = [
  { x: 2, y: 0, z: 1 },
  { x: 3, y: 0, z: 1 },
  { x: 4, y: 0, z: 1 },
  { x: 5, y: 0, z: 1 },
] as const

type SelectionKind = 'single-target' | 'pass' | 'burst'
type RuntimeKind = 'legacy-v1' | 'movespec-v2'

interface StageExpectation {
  readonly recipientId: string
  readonly key: CombatStageKey
  readonly value: number
}

interface MovementExpectation {
  readonly destination: { readonly x: number; readonly y: number; readonly z: number }
  readonly pathCells: readonly { readonly x: number; readonly y: number; readonly z: number }[]
}

interface ExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch009MoveName
  readonly selectionKind: SelectionKind
  readonly runtimeKind?: RuntimeKind
  readonly targetIds?: readonly string[]
  readonly excludedTargetIds?: readonly string[]
  readonly randomValues: readonly number[]
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly actorConditions?: readonly string[]
  readonly actedThisRound?: boolean
  readonly initialStages?: readonly StageExpectation[]
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedMovement?: MovementExpectation
  readonly expectedAreaCandidateTargetIds?: readonly string[]
  readonly expectedExcludedTargetIds?: readonly string[]
  readonly expectedReadTargetIds?: readonly string[]
  readonly expectedBlockSource?: string
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
  sideId: 'heroes' | 'foes',
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  sideId,
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
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly conditions?: readonly string[]
  readonly initialStages?: readonly StageExpectation[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.slug === 'actor' ? 'Audino' : 'Snorlax',
  level: 20,
  revision: 3,
  types: [...(options.types ?? ['Normal'])],
  abilities: (options.abilities ?? []).map(name => ({ name })),
  capabilities: { overland: 6 },
  movelist: [...(options.moves ?? [])],
  ...stageMap(options.initialStages, options.placementId),
  combat: { currentHp: 500, conditions: [...(options.conditions ?? [])] },
})

const targetPosition = (
  selectionKind: SelectionKind,
  id: string,
): { readonly x: number; readonly y: number; readonly z: number } => {
  if (selectionKind === 'pass') {
    return { x: id === TARGET_A_ID ? 2 : 3, y: 0, z: 1 }
  }
  if (selectionKind === 'burst') {
    if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
    if (id === TARGET_B_ID) return { x: 5, y: 0, z: 4 }
    return { x: 4, y: 0, z: 5 }
  }
  return { x: 6, y: 0, z: 5 }
}

const sideForTarget = (id: string): 'heroes' | 'foes' => (
  id === TARGET_B_ID ? 'heroes' : 'foes'
)

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const actorPosition = scenario.selectionKind === 'pass'
    ? { x: 1, y: 0, z: 1 }
    : { x: 5, y: 0, z: 5 }
  const placements = [
    placement(ACTOR_ID, 'actor', actorPosition, 'heroes'),
    ...targetIds.map(id => placement(
      id,
      id,
      targetPosition(scenario.selectionKind, id),
      sideForTarget(id),
    )),
  ]
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-009-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-009 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-009 scene', startedAt: 100 },
    encounterState: {
      ...emptyState,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: {
        ...emptyState.history,
        actedThisRoundPlacementIds: scenario.actedThisRound ? [ACTOR_ID] : [],
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
    conditions: scenario.actorConditions,
    initialStages: scenario.initialStages,
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    placementId: id,
    types: id === TARGET_A_ID ? scenario.targetTypes : undefined,
    abilities: id === TARGET_A_ID ? scenario.targetAbilities : undefined,
    initialStages: scenario.initialStages,
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (scenario.selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const template = script.areaTemplates?.find(candidate => candidate.kind === scenario.selectionKind)
    if (!template) {
      throw new Error(`${scenario.moveName} must retain its reviewed ${scenario.selectionKind} template.`)
    }
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
      ...(scenario.selectionKind === 'pass' ? { direction: 'east' as const } : {}),
      ...(scenario.excludedTargetIds?.length
        ? { excludedTargetPlacementIds: [...scenario.excludedTargetIds] }
        : {}),
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
  const runtimeKind = 'movespec-v2' as const
  expect(resolution.auditTrace.program).toMatchObject({
    canonicalId: scenario.moveName,
    runtimeKind,
    runtimeVersion: 2,
  })
  expect(resolution.transaction.attackedTargetIds).toEqual(scenario.expectedAttackedTargetIds)
  expect(resolution.transaction.hitTargetIds).toEqual(scenario.expectedHitTargetIds)
  expect(resolution.transaction.attackedTargetIds).not.toContain(ACTOR_ID)
  expect(resolution.transaction.hpUpdates.map(update => update.id).sort())
    .toEqual([...scenario.expectedDamagedTargetIds].sort())
  for (const update of resolution.transaction.hpUpdates) expect(update.currentHp).toBeLessThan(500)

  if (scenario.expectedStages) {
    for (const expected of scenario.expectedStages) {
      expect(stageValue(resolution.transaction, expected)).toBe(expected.value)
    }
  }
  else {
    expect(resolution.transaction.combatStageUpdates).toEqual([])
  }
  expect(conditionUpdatesByTarget(resolution.transaction))
    .toEqual(scenario.expectedConditions ?? {})
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  if (scenario.selectionKind === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(
      scenario.expectedAreaCandidateTargetIds ?? scenario.expectedAttackedTargetIds,
    )
    expect(resolution.area?.excludedTargetIds).toEqual(scenario.expectedExcludedTargetIds ?? [])
  }

  if (scenario.expectedMovement) {
    expect(resolution.movement).toMatchObject({
      kind: 'pass',
      destination: scenario.expectedMovement.destination,
      pathCells: scenario.expectedMovement.pathCells,
    })
    expect(resolution.resourceMovement).toMatchObject({
      distance: scenario.expectedMovement.pathCells.length,
      budget: 6,
    })
  }
  else {
    expect(resolution.movement).toBeUndefined()
  }

  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) {
      expect(resolution.feedback.crit).toBe(true)
    }
    else if (runtimeKind === 'movespec-v2') {
      expect(JSON.stringify(resolution.auditTrace)).toContain('"critical":true')
    }
    else {
      expect(JSON.stringify(resolution.auditTrace.events)).toContain('"critical":true')
    }
  }
  if (scenario.expectedBlockSource) {
    assertReviewedNativeEvidenceFragments([
      resolution.transaction.logLines.join('\n'),
      JSON.stringify(resolution.feedback ?? null),
      JSON.stringify(resolution.auditTrace),
    ].join('\n'), [scenario.expectedBlockSource])
  }

  const traceRolls = resolution.auditTrace.events.filter(event => event.kind === 'roll')
  expect(traceRolls).toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort()).toEqual(
    [...new Set(['actor', ...(scenario.expectedReadTargetIds ?? scenario.expectedAttackedTargetIds)])].sort(),
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
  clientId: 'reg-009-client',
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
    return () => `reg-009-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const flinched = { [TARGET_A_ID]: ['Flinch', 'Vulnerable'] } as const

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: ESPER_WING_REG_009_SCENARIOS[0].scenarioId,
    moveName: 'Esper Wing',
    selectionKind: 'pass',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
    expectedMovement: { destination: PASS_DESTINATION, pathCells: PASS_PATH },
  },
  {
    scenarioId: ESPER_WING_REG_009_SCENARIOS[1].scenarioId,
    moveName: 'Esper Wing',
    selectionKind: 'pass',
    randomValues: [0.85, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
    expectedCriticalTargetIds: [TARGET_A_ID],
    expectedMovement: { destination: PASS_DESTINATION, pathCells: PASS_PATH },
  },
  {
    scenarioId: ESPER_WING_REG_009_SCENARIOS[2].scenarioId,
    moveName: 'Esper Wing',
    selectionKind: 'pass',
    randomValues: [0.45, 0, 0],
    targetTypes: ['Dark'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedMovement: { destination: PASS_DESTINATION, pathCells: PASS_PATH },
  },
  {
    scenarioId: ESPER_WING_REG_009_SCENARIOS[3].scenarioId,
    moveName: 'Esper Wing',
    selectionKind: 'pass',
    targetIds: [],
    randomValues: [],
    expectedAttackedTargetIds: [],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedMovement: { destination: PASS_DESTINATION, pathCells: PASS_PATH },
  },
  {
    scenarioId: EXTRASENSORY_REG_009_SCENARIOS[0].scenarioId,
    moveName: 'Extrasensory',
    selectionKind: 'single-target',
    randomValues: [0.9, 0, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
  },
  {
    scenarioId: EXTRASENSORY_REG_009_SCENARIOS[1].scenarioId,
    moveName: 'Extrasensory',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: EXTRASENSORY_REG_009_SCENARIOS[2].scenarioId,
    moveName: 'Extrasensory',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: EXTRASENSORY_REG_009_SCENARIOS[3].scenarioId,
    moveName: 'Extrasensory',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: EXTRASENSORY_REG_009_SCENARIOS[4].scenarioId,
    moveName: 'Extrasensory',
    selectionKind: 'single-target',
    randomValues: [0.9, 0, 0],
    targetTypes: ['Dark'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [19],
  },
  {
    scenarioId: EXTRASENSORY_REG_009_SCENARIOS[5].scenarioId,
    moveName: 'Extrasensory',
    selectionKind: 'single-target',
    randomValues: [0.9, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
    expectedBlockSource: 'Shield Dust',
  },
  {
    scenarioId: EXTREME_SPEED_REG_009_SCENARIOS[0].scenarioId,
    moveName: 'Extreme Speed',
    selectionKind: 'single-target',
    randomValues: [0.45, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: EXTREME_SPEED_REG_009_SCENARIOS[1].scenarioId,
    moveName: 'Extreme Speed',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: EXTREME_SPEED_REG_009_SCENARIOS[2].scenarioId,
    moveName: 'Extreme Speed',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: EXTREME_SPEED_REG_009_SCENARIOS[3].scenarioId,
    moveName: 'Extreme Speed',
    selectionKind: 'single-target',
    randomValues: [0.45, 0, 0],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: FAIRY_WIND_REG_009_SCENARIOS[0].scenarioId,
    moveName: 'Fairy Wind',
    selectionKind: 'single-target',
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: FAIRY_WIND_REG_009_SCENARIOS[1].scenarioId,
    moveName: 'Fairy Wind',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: FAIRY_WIND_REG_009_SCENARIOS[2].scenarioId,
    moveName: 'Fairy Wind',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: FAKE_OUT_REG_009_SCENARIOS.find(({ scenarioId }) => scenarioId === 'fake-out.v2-joining-hit')!.scenarioId,
    moveName: 'Fake Out',
    selectionKind: 'single-target',
    runtimeKind: 'movespec-v2',
    randomValues: [0.45, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: FAKE_OUT_REG_009_SCENARIOS.find(({ scenarioId }) => scenarioId === 'fake-out.v2-miss')!.scenarioId,
    moveName: 'Fake Out',
    selectionKind: 'single-target',
    runtimeKind: 'movespec-v2',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: FAKE_OUT_REG_009_SCENARIOS.find(({ scenarioId }) => scenarioId === 'fake-out.v2-critical-hit')!.scenarioId,
    moveName: 'Fake Out',
    selectionKind: 'single-target',
    runtimeKind: 'movespec-v2',
    randomValues: [0.999, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: FAKE_OUT_REG_009_SCENARIOS.find(({ scenarioId }) => scenarioId === 'fake-out.v2-immunity')!.scenarioId,
    moveName: 'Fake Out',
    selectionKind: 'single-target',
    runtimeKind: 'movespec-v2',
    randomValues: [0.45, 0],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: FAKE_TEARS_REG_009_SCENARIOS[0].scenarioId,
    moveName: 'Fake Tears',
    selectionKind: 'single-target',
    randomValues: [0.45],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -2 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: FAKE_TEARS_REG_009_SCENARIOS[1].scenarioId,
    moveName: 'Fake Tears',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: FAKE_TEARS_REG_009_SCENARIOS[2].scenarioId,
    moveName: 'Fake Tears',
    selectionKind: 'single-target',
    randomValues: [0.45],
    initialStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -6 }],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: FALSE_SURRENDER_REG_009_SCENARIOS[0].scenarioId,
    moveName: 'False Surrender',
    selectionKind: 'single-target',
    randomValues: [0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: FEATHER_DANCE_REG_009_SCENARIOS[0].scenarioId,
    moveName: 'Feather Dance',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    excludedTargetIds: [TARGET_C_ID],
    randomValues: [0.45, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'atk', value: -2 }],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10, 1],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedExcludedTargetIds: [TARGET_C_ID],
    expectedReadTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
  },
  {
    scenarioId: FEATHER_DANCE_REG_009_SCENARIOS[1].scenarioId,
    moveName: 'Feather Dance',
    selectionKind: 'burst',
    randomValues: [0.45],
    initialStages: [{ recipientId: TARGET_A_ID, key: 'atk', value: -6 }],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'atk', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
]

const recoveryScenarioFor = (
  moveName: RegisteredBatch009MoveName,
): ExecutionScenario => {
  const matching = normalScenarios.find(scenario => (
    scenario.moveName === moveName && scenario.expectedHitTargetIds.includes(TARGET_A_ID)
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

describe('REG-009 registered move conformance', () => {
  it('certifies exactly Esper Wing through Feather Dance with linked evidence', () => {
    expect(Object.keys(REG_009_SCENARIOS_BY_MOVE)).toEqual([...REG_009_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_009_SCENARIOS_BY_MOVE)) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === canonicalId)
      expect(row, canonicalId).toMatchObject({
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: '2026-07-18',
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
      'Esper Wing': { ac: 4, damageBase: 8, damageClass: 'Special', range: 'Melee, Pass, Priority' },
      Extrasensory: { ac: 2, damageBase: 8, damageClass: 'Special', range: '5, 1 Target' },
      'Extreme Speed': { ac: 2, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target, Dash, Priority' },
      'Fairy Wind': { ac: 2, damageBase: 4, damageClass: 'Special', range: '6, 1 Target' },
      'Fake Tears': { ac: 2, damageBase: 0, damageClass: 'Status', range: '8, 1 Target, Social' },
      'False Surrender': { ac: null, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target', requiresAccuracy: false },
      'Feather Dance': { ac: 2, damageBase: 0, damageClass: 'Status', range: 'Burst 1, Friendly' },
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
    expect(explicitScriptForMove('Esper Wing')).toMatchObject({
      criticalRange: 18,
      keywords: expect.arrayContaining(['Pass', 'Priority']),
      areaTemplates: [{ kind: 'pass', size: 4, label: 'Pass 4' }],
    })
    expect(explicitScriptForMove('Extrasensory')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Flinch',
      action: 'add',
      label: 'Flinch on 19+',
      threshold: '19+',
      optional: true,
    }])
    expect(explicitScriptForMove('Extreme Speed')?.keywords)
      .toEqual(expect.arrayContaining(['Dash', 'Priority']))
    expect(registeredMoveAutomationRuntimeFor('Fake Out')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: FAKE_OUT_MOVE_SPEC },
    })
    expect(FAKE_OUT_MOVE_SPEC).toMatchObject({
      preconditions: [{ id: 'fake-out.opening-action' }],
      costs: [
        { cost: { kind: 'priority', mode: 'standard' } },
        { cost: { kind: 'action-resource', resource: 'standard', amount: 1 } },
      ],
    })
    expect(explicitScriptForMove('Fake Tears')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'sdef',
      delta: -2,
      label: 'Fake Tears lowers Special Defense: -2 Special Defense CS',
    }])
    expect(explicitScriptForMove('False Surrender')).toMatchObject({
      requiresAccuracy: false,
      conditionSuggestions: [],
      stageSuggestions: [],
    })
    expect(explicitScriptForMove('Feather Dance')).toMatchObject({
      keywords: expect.arrayContaining(['Friendly']),
      areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
      stageSuggestions: [{ recipient: 'target', key: 'atk', delta: -2 }],
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
        idFactory: () => 'reg-009-direct-id',
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
        idFactory: () => 'reg-009-plan-id',
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
        program: {
          canonicalId: scenario.moveName,
          runtimeKind: 'movespec-v2',
        },
      })
      expect(harness.ops.getOpResult(command.mapSlug, command.opId)).toEqual(response.result)

      const persistedMap = harness.maps.getBySlug(command.mapSlug)
      expect(persistedMap).toMatchObject({ revision: 8 })
      expect(persistedMap?.moveUsage).toEqual(plan.nextMap.moveUsage)
      expect(persistedMap?.encounterState?.turnResources[ACTOR_ID]).toMatchObject({
        actions: {
          standard: { spent: 1 },
          ...(scenario.selectionKind === 'pass' ? { shift: { spent: 1 } } : {}),
        },
      })
      if (scenario.expectedMovement) {
        expect(persistedMap?.placements.find(candidate => candidate.id === ACTOR_ID)?.position)
          .toEqual(scenario.expectedMovement.destination)
        expect(persistedMap?.encounterState?.turnResources[ACTOR_ID]?.movement).toMatchObject({
          budget: 6,
          spent: scenario.expectedMovement.pathCells.length,
        })
      }
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

  it.each([
    ['Esper Wing', ESPER_WING_REG_009_SCENARIOS[4].scenarioId],
    ['Extreme Speed', EXTREME_SPEED_REG_009_SCENARIOS[4].scenarioId],
  ] as const)('rejects unavailable Priority for %s without a partial mutation', async (moveName, scenarioId) => {
    const scenario: ExecutionScenario = {
      ...recoveryScenarioFor(moveName),
      scenarioId,
      actedThisRound: true,
    }
    const fixture = fixtureFor(scenario)
    const snapshot = deepCloneJson({ map: fixture.map, sheets: [...fixture.pokemonSheets] })
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: randomSequence(scenario.randomValues),
      now: () => NOW,
      operationId: `op_${scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
    })).toThrowError(expect.objectContaining({
      code: 'move-resource-unavailable',
      message: expect.stringContaining('priority-unavailable'),
    }))
    expect({ map: fixture.map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)

    const harness = openHarness(fixture)
    const command = commandFor(fixture, `${scenarioId}.command`)
    const beforeMap = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const beforeSheets = deepCloneJson(harness.sheets.list())
    const response = await executeCommand(harness, command, {
      random: randomSequence(scenario.randomValues),
    })
    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('priority-unavailable'),
    })
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.events).toEqual([])
  })

  it('rejects Extreme Speed while Stuck before rolls, costs, or effects', async () => {
    const scenario: ExecutionScenario = {
      ...recoveryScenarioFor('Extreme Speed'),
      scenarioId: EXTREME_SPEED_REG_009_SCENARIOS[5].scenarioId,
      actorConditions: ['Stuck'],
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

  it.each(REG_009_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_009_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_009_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_009_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))
      if (!evidence) throw new Error(`Missing conflict evidence for ${moveName}.`)
      const command = commandFor(fixture, evidence.scenarioId)
      const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      let racedSheet: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
        const plan: AuthoritativeMoveStatePlan = planAuthoritativeMoveState({
          ...input,
          random: randomSequence(scenario.randomValues),
        })
        const current = harness.sheets.getByRef('pokemon', TARGET_A_ID)
        if (!current) throw new Error(`Missing race sheet ${TARGET_A_ID}.`)
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
})
