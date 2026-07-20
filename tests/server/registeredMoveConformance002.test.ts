import { afterEach, describe, expect, it } from 'vitest'
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
import { resolveMoveGrantedCapabilities } from '~/utils/sheets/pokemonMoveGrantedCapabilities'
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
  APPLE_ACID_REG_002_SCENARIOS,
  AQUA_JET_REG_002_SCENARIOS,
  AQUA_TAIL_REG_002_SCENARIOS,
  ATTACK_ORDER_REG_002_SCENARIOS,
  AURA_SPHERE_REG_002_SCENARIOS,
  AURORA_BEAM_REG_002_SCENARIOS,
  REG_002_MOVE_NAMES,
  REG_002_SCENARIOS_BY_MOVE,
  type RegisteredBatch002MoveName,
} from '../fixtures/moveAutomation/registeredBatch002'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const NOW = 5_000

type LegacyBatch002MoveName = Exclude<
  RegisteredBatch002MoveName,
  'Aromatic Mist' | 'Astonish'
>

type SelectionKind = 'single-target' | 'cone' | 'pass'

interface StageExpectation {
  readonly recipientId: string
  readonly key: CombatStageKey
  readonly value: number
}

interface LegacyExecutionScenario {
  readonly scenarioId: string
  readonly moveName: LegacyBatch002MoveName
  readonly selectionKind: SelectionKind
  readonly targetIds?: readonly string[]
  readonly randomValues: readonly number[]
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly initialStage?: StageExpectation
  readonly expectedStage?: StageExpectation
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedMovement?: {
    readonly destination: { readonly x: number; readonly y: number; readonly z: number }
    readonly pathCells: readonly { readonly x: number; readonly y: number; readonly z: number }[]
  }
}

interface LegacyFixture {
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
  position: { ...position },
})

const stageMap = (
  stage: StageExpectation | undefined,
  recipientId: string,
): {
  readonly stats: NonNullable<CharacterSheet['stats']>
  readonly combatStages: NonNullable<CharacterSheet['combatStages']>
} => {
  const valueFor = (key: Exclude<CombatStageKey, 'acc'>): number => (
    stage?.recipientId === recipientId && stage.key === key ? stage.value : 0
  )
  return {
    stats: {
      hp: { added: 500 },
      atk: { added: 20, stage: valueFor('atk') },
      def: { added: 5, stage: valueFor('def') },
      satk: { added: 20, stage: valueFor('satk') },
      sdef: { added: 5, stage: valueFor('sdef') },
      spd: { added: 5, stage: valueFor('spd') },
    },
    combatStages: {
      acc: stage?.recipientId === recipientId && stage.key === 'acc' ? stage.value : 0,
    },
  }
}

const pokemonSheet = (options: {
  readonly slug: string
  readonly placementId: string
  readonly moves?: readonly CharacterSheetMove[]
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly initialStage?: StageExpectation
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.slug === 'actor' ? 'Floatzel' : 'Snorlax',
  level: 20,
  revision: 3,
  types: [...(options.types ?? ['Normal'])],
  abilities: (options.abilities ?? []).map(name => ({ name })),
  ...(options.slug === 'actor'
    ? { capabilities: { overland: 6, swim: 6, sky: 0, levitate: 0, burrow: 0 } }
    : {}),
  movelist: [...(options.moves ?? [])],
  ...stageMap(options.initialStage, options.placementId),
  combat: { currentHp: 500, conditions: [] },
})

const targetPosition = (
  selectionKind: SelectionKind,
  id: string,
): { readonly x: number; readonly y: number; readonly z: number } => {
  if (selectionKind === 'pass') {
    return { x: id === TARGET_A_ID ? 2 : 3, y: 0, z: 1 }
  }
  if (id === TARGET_A_ID) return { x: 5, y: 0, z: 4 }
  return { x: 4, y: 0, z: 3 }
}

const fixtureFor = (
  scenario: LegacyExecutionScenario,
  mapOverrides: Partial<TabletopMap> = {},
): LegacyFixture => {
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const actorPosition = scenario.selectionKind === 'pass'
    ? { x: 1, y: 0, z: 1 }
    : { x: 5, y: 0, z: 5 }
  const placements = [
    placement(ACTOR_ID, 'actor', actorPosition),
    ...targetIds.map(id => placement(id, id, targetPosition(scenario.selectionKind, id))),
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-002-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-002 ${scenario.moveName}`,
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
    activeScene: { name: 'REG-002 scene', startedAt: 100 },
    encounterState: createEmptyEncounterState(),
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
    ...deepCloneJson(mapOverrides),
  }
  const actor = pokemonSheet({
    slug: 'actor',
    placementId: ACTOR_ID,
    moves: [{ name: scenario.moveName }],
    initialStage: scenario.initialStage,
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    placementId: id,
    types: id === TARGET_A_ID ? scenario.targetTypes : undefined,
    abilities: id === TARGET_A_ID ? scenario.targetAbilities : undefined,
    initialStage: scenario.initialStage,
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (scenario.selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const templateKind = scenario.selectionKind === 'cone' ? 'cone' : 'pass'
    const template = script.areaTemplates?.find(candidate => candidate.kind === templateKind)
    if (!template) throw new Error(`${scenario.moveName} must retain its reviewed ${templateKind} template.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
      direction: scenario.selectionKind === 'cone' ? 'north' : 'east',
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

const assertScenarioResolution = (
  scenario: LegacyExecutionScenario,
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

  if (scenario.expectedStage) {
    expect(stageValue(resolution.transaction, scenario.expectedStage))
      .toBe(scenario.expectedStage.value)
  }
  else {
    expect(resolution.transaction.combatStageUpdates).toEqual([])
  }
  expect(resolution.transaction.conditionUpdates).toEqual([])
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

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
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(JSON.stringify(resolution.auditTrace.events)).toContain('"critical":true')
  }

  const traceRolls = resolution.auditTrace.events.filter(event => event.kind === 'roll')
  expect(traceRolls).toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort()).toEqual(
    [...new Set(['actor', ...scenario.expectedAttackedTargetIds])].sort(),
  )
}

const openHarness = (fixture: LegacyFixture): CommandHarness => {
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
  fixture: LegacyFixture,
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
  clientId: 'reg-002-client',
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
    return () => `reg-002-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const PASS_DESTINATION = { x: 5, y: 0, z: 1 } as const
const PASS_PATH = [
  { x: 2, y: 0, z: 1 },
  { x: 3, y: 0, z: 1 },
  { x: 4, y: 0, z: 1 },
  { x: 5, y: 0, z: 1 },
] as const

const normalScenarios: readonly LegacyExecutionScenario[] = [
  {
    scenarioId: APPLE_ACID_REG_002_SCENARIOS[0].scenarioId,
    moveName: 'Apple Acid',
    selectionKind: 'cone',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: APPLE_ACID_REG_002_SCENARIOS[1].scenarioId,
    moveName: 'Apple Acid',
    selectionKind: 'cone',
    randomValues: [0.999, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: APPLE_ACID_REG_002_SCENARIOS[2].scenarioId,
    moveName: 'Apple Acid',
    selectionKind: 'cone',
    randomValues: [0.45, 0, 0],
    targetAbilities: ['Sap Sipper'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: APPLE_ACID_REG_002_SCENARIOS[3].scenarioId,
    moveName: 'Apple Acid',
    selectionKind: 'cone',
    randomValues: [0.45, 0, 0],
    initialStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -6 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: AQUA_JET_REG_002_SCENARIOS[0].scenarioId,
    moveName: 'Aqua Jet',
    selectionKind: 'single-target',
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: AQUA_JET_REG_002_SCENARIOS[1].scenarioId,
    moveName: 'Aqua Jet',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: AQUA_JET_REG_002_SCENARIOS[2].scenarioId,
    moveName: 'Aqua Jet',
    selectionKind: 'single-target',
    randomValues: [0.999, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: AQUA_TAIL_REG_002_SCENARIOS[0].scenarioId,
    moveName: 'Aqua Tail',
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
    scenarioId: AQUA_TAIL_REG_002_SCENARIOS[1].scenarioId,
    moveName: 'Aqua Tail',
    selectionKind: 'pass',
    randomValues: [0.999, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
    expectedMovement: { destination: PASS_DESTINATION, pathCells: PASS_PATH },
  },
  {
    scenarioId: AQUA_TAIL_REG_002_SCENARIOS[2].scenarioId,
    moveName: 'Aqua Tail',
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
    scenarioId: ATTACK_ORDER_REG_002_SCENARIOS[0].scenarioId,
    moveName: 'Attack Order',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: ATTACK_ORDER_REG_002_SCENARIOS[1].scenarioId,
    moveName: 'Attack Order',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: ATTACK_ORDER_REG_002_SCENARIOS[2].scenarioId,
    moveName: 'Attack Order',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: AURA_SPHERE_REG_002_SCENARIOS[0].scenarioId,
    moveName: 'Aura Sphere',
    selectionKind: 'single-target',
    randomValues: [0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: AURA_SPHERE_REG_002_SCENARIOS[1].scenarioId,
    moveName: 'Aura Sphere',
    selectionKind: 'single-target',
    randomValues: [0, 0],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: AURORA_BEAM_REG_002_SCENARIOS[0].scenarioId,
    moveName: 'Aurora Beam',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'atk', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: AURORA_BEAM_REG_002_SCENARIOS[1].scenarioId,
    moveName: 'Aurora Beam',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: AURORA_BEAM_REG_002_SCENARIOS[2].scenarioId,
    moveName: 'Aurora Beam',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: AURORA_BEAM_REG_002_SCENARIOS[3].scenarioId,
    moveName: 'Aurora Beam',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'atk', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: AURORA_BEAM_REG_002_SCENARIOS[4].scenarioId,
    moveName: 'Aurora Beam',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: AURORA_BEAM_REG_002_SCENARIOS[5].scenarioId,
    moveName: 'Aurora Beam',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0],
    initialStage: { recipientId: TARGET_A_ID, key: 'atk', value: -6 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'atk', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
  },
]

const recoveryScenarioFor = (
  moveName: LegacyBatch002MoveName,
): LegacyExecutionScenario => {
  const matching = normalScenarios.find(scenario => scenario.moveName === moveName
    && scenario.expectedHitTargetIds.length > 0
    && scenario.expectedDamagedTargetIds.length > 0)
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

describe('REG-002 registered move conformance', () => {
  it('certifies exactly Apple Acid through Aurora Beam with linked runtime evidence', () => {
    expect(Object.keys(REG_002_SCENARIOS_BY_MOVE)).toEqual([...REG_002_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_002_SCENARIOS_BY_MOVE)) {
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

  it('retains the reviewed v1 mechanics without unresolved rule instructions', () => {
    const expected = {
      'Apple Acid': { ac: 2, damageBase: 8, damageClass: 'Special', range: 'Cone 2' },
      'Aqua Jet': { ac: 2, damageBase: 4, damageClass: 'Physical', range: 'Melee, 1 Target, Priority' },
      'Aqua Tail': { ac: 4, damageBase: 9, damageClass: 'Physical', range: 'Melee, Pass' },
      'Attack Order': { ac: 2, damageBase: 9, damageClass: 'Physical', range: '6, 1 Target', criticalRange: 18 },
      'Aura Sphere': { ac: null, damageBase: 8, damageClass: 'Special', range: '8, 1 Target, Aura', requiresAccuracy: false },
      'Aurora Beam': { ac: 2, damageBase: 7, damageClass: 'Special', range: '6, 1 Target', special: 'Grants Freezer' },
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
        .not.toMatch(/verify|adjust .* manually|apply .* manually|manual tracking/i)
    }
    expect(explicitScriptForMove('Apple Acid')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'sdef',
      delta: -1,
      label: 'Apple Acid lowers Special Defense: -1 Special Defense CS',
    }])
    expect(explicitScriptForMove('Aqua Tail')?.areaTemplates).toEqual([{
      kind: 'pass',
      size: 4,
      label: 'Pass 4',
    }])
    expect(explicitScriptForMove('Aurora Beam')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'atk',
      delta: -1,
      label: 'Aurora Beam lowers Attack on 18+: -1 Attack CS',
      threshold: '18+',
      optional: true,
    }])
    expect(resolveMoveGrantedCapabilities([{ name: 'Aurora Beam' }])).toMatchObject({
      other: ['Freezer'],
    })
  })

  it.each(normalScenarios)(
    'proves $scenarioId through the legacy executor, planner, and accepted command',
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
        idFactory: () => 'reg-002-direct-id',
        resolutionId: `${scenario.scenarioId}.direct`,
      })
      expect('kind' in direct).toBe(false)
      if ('kind' in direct) return
      assertScenarioResolution(scenario, direct)
      expect({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] })
        .toEqual(directSnapshot)

      const plannerFixture = fixtureFor(scenario)
      const plan = planAuthoritativeMoveState({
        ...plannerFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-002-plan-id',
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

  it('rejects Aqua Jet after the actor has acted and applies no partial mutation', async () => {
    const scenario = recoveryScenarioFor('Aqua Jet')
    const fixture = fixtureFor(scenario, {
      encounterState: {
        ...createEmptyEncounterState(),
        history: {
          ...createEmptyEncounterState().history,
          actedThisRoundPlacementIds: [ACTOR_ID],
        },
      },
    })
    const inputSnapshot = deepCloneJson({
      map: fixture.map,
      pokemonSheets: [...fixture.pokemonSheets],
      trainerSheets: [...fixture.trainerSheets],
    })
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: randomSequence(scenario.randomValues),
      now: () => NOW,
      operationId: `op_${AQUA_JET_REG_002_SCENARIOS[3].scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
    })).toThrowError(expect.objectContaining({
      code: 'move-resource-unavailable',
      message: expect.stringContaining('priority-unavailable'),
    }))
    expect({
      map: fixture.map,
      pokemonSheets: [...fixture.pokemonSheets],
      trainerSheets: [...fixture.trainerSheets],
    }).toEqual(inputSnapshot)

    const harness = openHarness(fixture)
    const command = commandFor(fixture, `${AQUA_JET_REG_002_SCENARIOS[3].scenarioId}.command`)
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

  it.each([
    'Apple Acid',
    'Aqua Jet',
    'Aqua Tail',
    'Attack Order',
    'Aura Sphere',
    'Aurora Beam',
  ] as const)('replays accepted %s delivery without rerolling or mutating twice', async (moveName) => {
    const scenario = recoveryScenarioFor(moveName)
    const fixture = fixtureFor(scenario)
    const harness = openHarness(fixture)
    const evidence = REG_002_SCENARIOS_BY_MOVE[moveName]
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
  })

  it.each([
    'Apple Acid',
    'Aqua Jet',
    'Aqua Tail',
    'Attack Order',
    'Aura Sphere',
    'Aurora Beam',
  ] as const)('rejects stale %s target state without a partial accepted result', async (moveName) => {
    const scenario = recoveryScenarioFor(moveName)
    const fixture = fixtureFor(scenario)
    const harness = openHarness(fixture)
    const evidence = REG_002_SCENARIOS_BY_MOVE[moveName]
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
  })
})
