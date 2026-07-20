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
import {
  createEmptyEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
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
import { createMoveSemiInvulnerableSetupPlan } from '~~/server/domain/moveAutomation/semiInvulnerableEffects'
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
  CROSS_POISON_REG_006_SCENARIOS,
  CRUNCH_REG_006_SCENARIOS,
  CRUSH_CLAW_REG_006_SCENARIOS,
  DARK_PULSE_REG_006_SCENARIOS,
  DAZZLING_GLEAM_REG_006_SCENARIOS,
  DECORATE_REG_006_SCENARIOS,
  DISARMING_VOICE_REG_006_SCENARIOS,
  DISCHARGE_REG_006_SCENARIOS,
  REG_006_MOVE_NAMES,
  REG_006_SCENARIOS_BY_MOVE,
  type RegisteredBatch006MoveName,
} from '../fixtures/moveAutomation/registeredBatch006'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const NOW = 5_000

type SelectionKind = 'single-target' | 'pass' | 'cone' | 'burst' | 'cardinally-adjacent'

interface StageExpectation {
  readonly recipientId: string
  readonly key: CombatStageKey
  readonly value: number
}

interface MovementExpectation {
  readonly destination: { readonly x: number; readonly y: number; readonly z: number }
  readonly pathCells: readonly { readonly x: number; readonly y: number; readonly z: number }[]
}

interface LegacyExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch006MoveName
  readonly selectionKind: SelectionKind
  readonly targetIds?: readonly string[]
  readonly randomValues: readonly number[]
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly actorConditions?: readonly string[]
  readonly initialStages?: readonly StageExpectation[]
  readonly expectedStages?: readonly StageExpectation[]
  readonly initialConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly semiInvulnerableTargetIds?: readonly string[]
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
  readonly expectedLogFragment?: string
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
  readonly initialStages?: readonly StageExpectation[]
  readonly conditions?: readonly string[]
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
  if (selectionKind === 'pass') return { x: id === TARGET_A_ID ? 2 : 3, y: 0, z: 1 }
  if (selectionKind === 'cone') return { x: id === TARGET_A_ID ? 6 : 7, y: 0, z: 5 }
  if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
  return { x: 5, y: 0, z: 4 }
}

const encounterStateFor = (
  placements: readonly SheetPlacement[],
  semiInvulnerableTargetIds: readonly string[],
): EncounterState => {
  let state = createEmptyEncounterState()
  for (const targetId of semiInvulnerableTargetIds) {
    const setup = createMoveSemiInvulnerableSetupPlan({
      authority: {
        placementIds: placements.map(entry => entry.id),
        effects: state.effects,
      },
      canonicalMoveId: 'Dig',
      operationId: `reg-006.setup.${targetId}`,
      actorPlacementId: targetId,
      createdRound: 1,
      createdTurn: 0,
    })
    state = { ...state, effects: [...state.effects, ...setup.effects] }
  }
  return state
}

const fixtureFor = (
  scenario: LegacyExecutionScenario,
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
    slug: `reg-006-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-006 ${scenario.moveName}`,
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
    activeScene: { name: 'REG-006 scene', startedAt: 100 },
    encounterState: encounterStateFor(placements, scenario.semiInvulnerableTargetIds ?? []),
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  const actor = pokemonSheet({
    slug: 'actor',
    placementId: ACTOR_ID,
    moves: [{ name: scenario.moveName }],
    initialStages: scenario.initialStages,
    conditions: scenario.actorConditions ?? scenario.initialConditions?.[ACTOR_ID],
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    placementId: id,
    types: id === TARGET_A_ID ? scenario.targetTypes : undefined,
    abilities: id === TARGET_A_ID ? scenario.targetAbilities : undefined,
    initialStages: scenario.initialStages,
    conditions: scenario.initialConditions?.[id],
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (scenario.selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const template = script.areaTemplates?.find(candidate => candidate.kind === scenario.selectionKind)
    if (!template) throw new Error(`${scenario.moveName} must retain its reviewed ${scenario.selectionKind} template.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
      ...(scenario.selectionKind === 'pass' || scenario.selectionKind === 'cone'
        ? { direction: 'east' as const }
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
    for (const targetId of scenario.expectedExcludedTargetIds ?? []) {
      expect(resolution.area?.targetEvaluations).toContainEqual(expect.objectContaining({
        targetPlacementId: targetId,
        outcome: 'excluded',
      }))
    }
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
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(JSON.stringify(resolution.auditTrace.events)).toContain('"critical":true')
  }

  const blockEvidence = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  if (scenario.expectedBlockSource) {
    assertReviewedNativeEvidenceFragments(blockEvidence, [scenario.expectedBlockSource])
  }
  if (scenario.expectedLogFragment) {
    assertReviewedNativeEvidenceFragments(blockEvidence, [scenario.expectedLogFragment])
  }

  const traceRolls = resolution.auditTrace.events.filter(event => event.kind === 'roll')
  expect(traceRolls).toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort()).toEqual(
    [...new Set(['actor', ...(scenario.expectedReadTargetIds ?? scenario.expectedAttackedTargetIds)])].sort(),
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
  clientId: 'reg-006-client',
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
    return () => `reg-006-id-${++sequence}`
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

const poisoned = { [TARGET_A_ID]: ['Poisoned'] } as const
const flinched = { [TARGET_A_ID]: ['Flinch', 'Vulnerable'] } as const
const paralyzed = { [TARGET_A_ID]: ['Paralysis'] } as const

const normalScenarios: readonly LegacyExecutionScenario[] = [
  {
    scenarioId: CROSS_POISON_REG_006_SCENARIOS[0].scenarioId,
    moveName: 'Cross Poison',
    selectionKind: 'pass',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.9, 0, 0, 0, 0, 0],
    expectedConditions: poisoned,
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19, 1],
    expectedMovement: { destination: PASS_DESTINATION, pathCells: PASS_PATH },
  },
  {
    scenarioId: CROSS_POISON_REG_006_SCENARIOS[1].scenarioId,
    moveName: 'Cross Poison',
    selectionKind: 'pass',
    randomValues: [0.8, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
    expectedMovement: { destination: PASS_DESTINATION, pathCells: PASS_PATH },
  },
  {
    scenarioId: CROSS_POISON_REG_006_SCENARIOS[2].scenarioId,
    moveName: 'Cross Poison',
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
    scenarioId: CROSS_POISON_REG_006_SCENARIOS[3].scenarioId,
    moveName: 'Cross Poison',
    selectionKind: 'pass',
    randomValues: [0.8],
    targetTypes: ['Steel'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [17],
    expectedMovement: { destination: PASS_DESTINATION, pathCells: PASS_PATH },
  },
  {
    scenarioId: CROSS_POISON_REG_006_SCENARIOS[4].scenarioId,
    moveName: 'Cross Poison',
    selectionKind: 'pass',
    randomValues: [0.9, 0, 0, 0, 0],
    targetTypes: ['Poison'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
    expectedCriticalTargetIds: [TARGET_A_ID],
    expectedMovement: { destination: PASS_DESTINATION, pathCells: PASS_PATH },
  },
  {
    scenarioId: CROSS_POISON_REG_006_SCENARIOS[5].scenarioId,
    moveName: 'Cross Poison',
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
    scenarioId: CRUNCH_REG_006_SCENARIOS[0].scenarioId,
    moveName: 'Crunch',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: CRUNCH_REG_006_SCENARIOS[1].scenarioId,
    moveName: 'Crunch',
    selectionKind: 'single-target',
    randomValues: [0.75, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: CRUNCH_REG_006_SCENARIOS[2].scenarioId,
    moveName: 'Crunch',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: CRUNCH_REG_006_SCENARIOS[3].scenarioId,
    moveName: 'Crunch',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: CRUNCH_REG_006_SCENARIOS[4].scenarioId,
    moveName: 'Crunch',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
    expectedBlockSource: 'Shield Dust',
  },
  {
    scenarioId: CRUNCH_REG_006_SCENARIOS[5].scenarioId,
    moveName: 'Crunch',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0],
    initialStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -6 }],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: CRUSH_CLAW_REG_006_SCENARIOS[0].scenarioId,
    moveName: 'Crush Claw',
    selectionKind: 'single-target',
    randomValues: [0.25, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [6],
  },
  {
    scenarioId: CRUSH_CLAW_REG_006_SCENARIOS[1].scenarioId,
    moveName: 'Crush Claw',
    selectionKind: 'single-target',
    randomValues: [0.3, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [7],
  },
  {
    scenarioId: CRUSH_CLAW_REG_006_SCENARIOS[2].scenarioId,
    moveName: 'Crush Claw',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: CRUSH_CLAW_REG_006_SCENARIOS[3].scenarioId,
    moveName: 'Crush Claw',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: CRUSH_CLAW_REG_006_SCENARIOS[4].scenarioId,
    moveName: 'Crush Claw',
    selectionKind: 'single-target',
    randomValues: [0.25],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [6],
  },
  {
    scenarioId: CRUSH_CLAW_REG_006_SCENARIOS[5].scenarioId,
    moveName: 'Crush Claw',
    selectionKind: 'single-target',
    randomValues: [0.25, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [6],
    expectedBlockSource: 'Shield Dust',
  },
  {
    scenarioId: CRUSH_CLAW_REG_006_SCENARIOS[6].scenarioId,
    moveName: 'Crush Claw',
    selectionKind: 'single-target',
    randomValues: [0.25, 0, 0],
    initialStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -6 }],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [6],
  },
  {
    scenarioId: DARK_PULSE_REG_006_SCENARIOS[0].scenarioId,
    moveName: 'Dark Pulse',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: DARK_PULSE_REG_006_SCENARIOS[1].scenarioId,
    moveName: 'Dark Pulse',
    selectionKind: 'single-target',
    randomValues: [0.75, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: DARK_PULSE_REG_006_SCENARIOS[2].scenarioId,
    moveName: 'Dark Pulse',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: DARK_PULSE_REG_006_SCENARIOS[3].scenarioId,
    moveName: 'Dark Pulse',
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
    scenarioId: DARK_PULSE_REG_006_SCENARIOS[4].scenarioId,
    moveName: 'Dark Pulse',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
    expectedBlockSource: 'Shield Dust',
  },
  {
    scenarioId: DAZZLING_GLEAM_REG_006_SCENARIOS[0].scenarioId,
    moveName: 'Dazzling Gleam',
    selectionKind: 'cone',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: DAZZLING_GLEAM_REG_006_SCENARIOS[1].scenarioId,
    moveName: 'Dazzling Gleam',
    selectionKind: 'cone',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: DECORATE_REG_006_SCENARIOS[0].scenarioId,
    moveName: 'Decorate',
    selectionKind: 'single-target',
    randomValues: [],
    expectedStages: [
      { recipientId: TARGET_A_ID, key: 'atk', value: 2 },
      { recipientId: TARGET_A_ID, key: 'satk', value: 2 },
    ],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: DECORATE_REG_006_SCENARIOS[1].scenarioId,
    moveName: 'Decorate',
    selectionKind: 'single-target',
    randomValues: [],
    initialStages: [
      { recipientId: TARGET_A_ID, key: 'atk', value: 6 },
      { recipientId: TARGET_A_ID, key: 'satk', value: 6 },
    ],
    expectedStages: [
      { recipientId: TARGET_A_ID, key: 'atk', value: 6 },
      { recipientId: TARGET_A_ID, key: 'satk', value: 6 },
    ],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: DISARMING_VOICE_REG_006_SCENARIOS[0].scenarioId,
    moveName: 'Disarming Voice',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedDamagedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: DISARMING_VOICE_REG_006_SCENARIOS[1].scenarioId,
    moveName: 'Disarming Voice',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0, 0],
    semiInvulnerableTargetIds: [TARGET_B_ID],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedExcludedTargetIds: [TARGET_B_ID],
    expectedReadTargetIds: [TARGET_A_ID, TARGET_B_ID],
  },
  {
    scenarioId: DISCHARGE_REG_006_SCENARIOS[0].scenarioId,
    moveName: 'Discharge',
    selectionKind: 'cardinally-adjacent',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.7, 0, 0, 0, 0],
    expectedConditions: paralyzed,
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15, 1],
  },
  {
    scenarioId: DISCHARGE_REG_006_SCENARIOS[1].scenarioId,
    moveName: 'Discharge',
    selectionKind: 'cardinally-adjacent',
    randomValues: [0.65, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: DISCHARGE_REG_006_SCENARIOS[2].scenarioId,
    moveName: 'Discharge',
    selectionKind: 'cardinally-adjacent',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedConditions: paralyzed,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: DISCHARGE_REG_006_SCENARIOS[3].scenarioId,
    moveName: 'Discharge',
    selectionKind: 'cardinally-adjacent',
    randomValues: [0.7],
    targetTypes: ['Ground'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: DISCHARGE_REG_006_SCENARIOS[4].scenarioId,
    moveName: 'Discharge',
    selectionKind: 'cardinally-adjacent',
    randomValues: [0.7, 0, 0],
    targetTypes: ['Electric'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: DISCHARGE_REG_006_SCENARIOS[5].scenarioId,
    moveName: 'Discharge',
    selectionKind: 'cardinally-adjacent',
    randomValues: [0.7, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
]

const recoveryScenarioFor = (
  moveName: RegisteredBatch006MoveName,
): LegacyExecutionScenario => {
  const matching = normalScenarios.find(scenario => scenario.moveName === moveName
    && (scenario.expectedHitTargetIds.includes(TARGET_A_ID) || !explicitScriptForMove(moveName)?.damaging))
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

describe('REG-006 registered move conformance', () => {
  it('certifies exactly Cross Poison through Discharge with linked evidence', () => {
    expect(Object.keys(REG_006_SCENARIOS_BY_MOVE)).toEqual([...REG_006_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_006_SCENARIOS_BY_MOVE)) {
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

  it('retains the reviewed canonical mechanics without unresolved rule instructions', () => {
    const expected = {
      'Cross Poison': { ac: 2, damageBase: 7, damageClass: 'Physical', range: 'Melee, Pass', criticalRange: 18 },
      Crunch: { ac: 2, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target' },
      'Crush Claw': { ac: 3, damageBase: 7, damageClass: 'Physical', range: 'Melee, 1 Target, Dash' },
      'Dark Pulse': { ac: 2, damageBase: 8, damageClass: 'Special', range: '8, 1 Target, Aura' },
      'Dazzling Gleam': { ac: 2, damageBase: 8, damageClass: 'Special', range: 'Cone 2' },
      Decorate: { ac: null, damageBase: null, damageClass: 'Status', range: 'Melee, 1 Target', requiresAccuracy: false },
      'Disarming Voice': { ac: null, damageBase: 4, damageClass: 'Special', range: 'Burst 1', requiresAccuracy: false },
      Discharge: { ac: 2, damageBase: 8, damageClass: 'Special', range: 'All Cardinally Adjacent Targets' },
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
    expect(explicitScriptForMove('Cross Poison')).toMatchObject({
      areaTemplates: [{ kind: 'pass', size: 4, label: 'Pass 4' }],
      conditionSuggestions: [{
        recipient: 'target',
        condition: 'Poisoned',
        threshold: '19+',
      }],
    })
    expect(explicitScriptForMove('Crunch')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'def',
      delta: -1,
      label: 'Crunch lowers Defense on 17+: -1 Defense CS',
      threshold: '17+',
      optional: true,
    }])
    expect(explicitScriptForMove('Crush Claw')).toMatchObject({
      keywords: expect.arrayContaining(['Dash']),
      stageSuggestions: [{
        recipient: 'target',
        key: 'def',
        delta: -1,
        threshold: 'even roll',
      }],
    })
    expect(explicitScriptForMove('Dark Pulse')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Flinch',
      action: 'add',
      label: 'Flinch on 17+',
      threshold: '17+',
      optional: true,
    }])
    expect(explicitScriptForMove('Dazzling Gleam')?.areaTemplates).toEqual([
      { kind: 'cone', size: 2, label: 'Cone 2' },
    ])
    expect(explicitScriptForMove('Decorate')?.stageSuggestions).toEqual([
      { recipient: 'target', key: 'atk', delta: 2, label: 'Decorate raises Attack: +2 Attack CS' },
      { recipient: 'target', key: 'satk', delta: 2, label: 'Decorate raises Special Attack: +2 Special Attack CS' },
    ])
    expect(explicitScriptForMove('Disarming Voice')?.areaTemplates).toEqual([
      { kind: 'burst', size: 1, label: 'Burst 1' },
    ])
    expect(explicitScriptForMove('Discharge')).toMatchObject({
      areaTemplates: [{ kind: 'cardinally-adjacent', size: 1, label: 'Cardinally Adjacent Targets' }],
      conditionSuggestions: [{
        recipient: 'target',
        condition: 'Paralysis',
        threshold: '15+',
      }],
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
        idFactory: () => 'reg-006-direct-id',
        resolutionId: `${scenario.scenarioId}.direct`,
      })
      assertScenarioResolution(scenario, direct)
      expect({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] })
        .toEqual(directSnapshot)

      const plannerFixture = fixtureFor(scenario)
      const plan = planAuthoritativeMoveState({
        ...plannerFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-006-plan-id',
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

  it('rejects Crush Claw while Stuck before rolls, costs, or effects', async () => {
    const scenario: LegacyExecutionScenario = {
      ...recoveryScenarioFor('Crush Claw'),
      scenarioId: CRUSH_CLAW_REG_006_SCENARIOS[7].scenarioId,
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

  it.each(REG_006_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_006_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_006_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_006_SCENARIOS_BY_MOVE[moveName]
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
