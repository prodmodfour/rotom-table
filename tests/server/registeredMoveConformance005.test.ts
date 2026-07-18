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
  CHARM_REG_005_SCENARIOS,
  CONFIDE_REG_005_SCENARIOS,
  CONFUSE_RAY_REG_005_SCENARIOS,
  CONFUSION_REG_005_SCENARIOS,
  COTTON_SPORE_REG_005_SCENARIOS,
  CRABHAMMER_REG_005_SCENARIOS,
  CROSS_CHOP_REG_005_SCENARIOS,
  REG_005_EXECUTED_MOVE_NAMES,
  REG_005_MOVE_NAMES,
  REG_005_SCENARIOS_BY_MOVE,
  type RegisteredBatch005ExecutedMoveName,
} from '../fixtures/moveAutomation/registeredBatch005'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const NOW = 5_000

interface StageExpectation {
  readonly recipientId: string
  readonly key: CombatStageKey
  readonly value: number
}

interface LegacyExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch005ExecutedMoveName
  readonly selectionKind: 'single-target' | 'burst'
  readonly targetIds?: readonly string[]
  readonly randomValues: readonly number[]
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly initialStage?: StageExpectation
  readonly initialConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedStage?: StageExpectation
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedConditionBlockSource?: string
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
      atk: { added: 30, stage: valueFor('atk') },
      def: { added: 5, stage: valueFor('def') },
      satk: { added: 30, stage: valueFor('satk') },
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
  readonly conditions?: readonly string[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.slug === 'actor' ? 'Audino' : 'Snorlax',
  level: 20,
  revision: 3,
  types: [...(options.types ?? ['Normal'])],
  abilities: (options.abilities ?? []).map(name => ({ name })),
  movelist: [...(options.moves ?? [])],
  ...stageMap(options.initialStage, options.placementId),
  combat: { currentHp: 500, conditions: [...(options.conditions ?? [])] },
})

const targetPosition = (
  id: string,
): { readonly x: number; readonly y: number; readonly z: number } => (
  id === TARGET_A_ID
    ? { x: 6, y: 0, z: 5 }
    : { x: 5, y: 0, z: 4 }
)

const fixtureFor = (
  scenario: LegacyExecutionScenario,
): LegacyFixture => {
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-005-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-005 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 5, y: 0, z: 5 }),
      ...targetIds.map(id => placement(id, id, targetPosition(id))),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-005 scene', startedAt: 100 },
    encounterState: createEmptyEncounterState(),
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  const actor = pokemonSheet({
    slug: 'actor',
    placementId: ACTOR_ID,
    moves: [{ name: scenario.moveName }],
    initialStage: scenario.initialStage,
    conditions: scenario.initialConditions?.[ACTOR_ID],
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    placementId: id,
    types: id === TARGET_A_ID ? scenario.targetTypes : undefined,
    abilities: id === TARGET_A_ID ? scenario.targetAbilities : undefined,
    initialStage: scenario.initialStage,
    conditions: scenario.initialConditions?.[id],
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (scenario.selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const template = script.areaTemplates?.find(candidate => candidate.kind === 'burst')
    if (!template) throw new Error(`${scenario.moveName} must retain its reviewed Burst template.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
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
  .filter(entry => entry.parentEffectId === 'legacy-v1.accuracy')
  .map(entry => entry.naturalResult)

const stageValue = (
  transaction: MoveAutomationTransaction,
  expected: StageExpectation,
): number | undefined => transaction.combatStageUpdates
  .find(update => update.id === expected.recipientId)
  ?.stages[expected.key]

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
    runtimeKind: 'legacy-v1',
    runtimeVersion: 1,
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
  expect(conditionUpdatesByTarget(resolution.transaction))
    .toEqual(scenario.expectedConditions ?? {})
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  if (scenario.selectionKind === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(scenario.expectedAttackedTargetIds)
  }

  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(resolution.transaction.logLines.join('\n')).toContain('critical')
  }

  if (scenario.expectedConditionBlockSource) {
    expect(resolution.feedback?.conditions).toContainEqual(expect.objectContaining({
      applied: false,
      blockedBy: scenario.expectedConditionBlockSource,
    }))
  }

  if (scenario.expectedLogFragment) {
    expect(resolution.transaction.logLines.join('\n')).toContain(scenario.expectedLogFragment)
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
  clientId: 'reg-005-client',
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
    return () => `reg-005-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const confused = { [TARGET_A_ID]: ['Confused'] } as const

const normalScenarios: readonly LegacyExecutionScenario[] = [
  {
    scenarioId: CHARM_REG_005_SCENARIOS[0].scenarioId,
    moveName: 'Charm',
    selectionKind: 'single-target',
    randomValues: [0.45],
    expectedStage: { recipientId: TARGET_A_ID, key: 'atk', value: -2 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: CHARM_REG_005_SCENARIOS[1].scenarioId,
    moveName: 'Charm',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: CHARM_REG_005_SCENARIOS[2].scenarioId,
    moveName: 'Charm',
    selectionKind: 'single-target',
    randomValues: [0.45],
    initialStage: { recipientId: TARGET_A_ID, key: 'atk', value: -6 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'atk', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: CONFIDE_REG_005_SCENARIOS[0].scenarioId,
    moveName: 'Confide',
    selectionKind: 'single-target',
    randomValues: [0.45],
    expectedStage: { recipientId: TARGET_A_ID, key: 'satk', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: CONFIDE_REG_005_SCENARIOS[1].scenarioId,
    moveName: 'Confide',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: CONFIDE_REG_005_SCENARIOS[2].scenarioId,
    moveName: 'Confide',
    selectionKind: 'single-target',
    randomValues: [0.45],
    initialStage: { recipientId: TARGET_A_ID, key: 'satk', value: -6 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'satk', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: CONFUSE_RAY_REG_005_SCENARIOS[0].scenarioId,
    moveName: 'Confuse Ray',
    selectionKind: 'single-target',
    randomValues: [0.45],
    expectedConditions: confused,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: CONFUSE_RAY_REG_005_SCENARIOS[1].scenarioId,
    moveName: 'Confuse Ray',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: CONFUSE_RAY_REG_005_SCENARIOS[2].scenarioId,
    moveName: 'Confuse Ray',
    selectionKind: 'single-target',
    randomValues: [0.45],
    initialConditions: confused,
    expectedConditions: confused,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: CONFUSION_REG_005_SCENARIOS[0].scenarioId,
    moveName: 'Confusion',
    selectionKind: 'single-target',
    randomValues: [0.9, 0],
    expectedConditions: confused,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
  },
  {
    scenarioId: CONFUSION_REG_005_SCENARIOS[1].scenarioId,
    moveName: 'Confusion',
    selectionKind: 'single-target',
    randomValues: [0.85, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: CONFUSION_REG_005_SCENARIOS[2].scenarioId,
    moveName: 'Confusion',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: CONFUSION_REG_005_SCENARIOS[3].scenarioId,
    moveName: 'Confusion',
    selectionKind: 'single-target',
    randomValues: [0.999, 0],
    expectedConditions: confused,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: CONFUSION_REG_005_SCENARIOS[4].scenarioId,
    moveName: 'Confusion',
    selectionKind: 'single-target',
    randomValues: [0.9, 0],
    targetTypes: ['Dark'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragment: 'Psychic immunity',
  },
  {
    scenarioId: CONFUSION_REG_005_SCENARIOS[5].scenarioId,
    moveName: 'Confusion',
    selectionKind: 'single-target',
    randomValues: [0.9, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
    expectedConditionBlockSource: 'Shield Dust',
  },
  {
    scenarioId: COTTON_SPORE_REG_005_SCENARIOS[0].scenarioId,
    moveName: 'Cotton Spore',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -2 },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: COTTON_SPORE_REG_005_SCENARIOS[1].scenarioId,
    moveName: 'Cotton Spore',
    selectionKind: 'burst',
    randomValues: [0.45],
    targetTypes: ['Grass'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragment: 'Grass type (Powder)',
  },
  {
    scenarioId: COTTON_SPORE_REG_005_SCENARIOS[2].scenarioId,
    moveName: 'Cotton Spore',
    selectionKind: 'burst',
    randomValues: [0.45],
    initialStage: { recipientId: TARGET_A_ID, key: 'spd', value: -6 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: CRABHAMMER_REG_005_SCENARIOS[0].scenarioId,
    moveName: 'Crabhammer',
    selectionKind: 'single-target',
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: CRABHAMMER_REG_005_SCENARIOS[1].scenarioId,
    moveName: 'Crabhammer',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: CRABHAMMER_REG_005_SCENARIOS[2].scenarioId,
    moveName: 'Crabhammer',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: CROSS_CHOP_REG_005_SCENARIOS[0].scenarioId,
    moveName: 'Cross Chop',
    selectionKind: 'single-target',
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: CROSS_CHOP_REG_005_SCENARIOS[1].scenarioId,
    moveName: 'Cross Chop',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: CROSS_CHOP_REG_005_SCENARIOS[2].scenarioId,
    moveName: 'Cross Chop',
    selectionKind: 'single-target',
    randomValues: [0.75, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: CROSS_CHOP_REG_005_SCENARIOS[3].scenarioId,
    moveName: 'Cross Chop',
    selectionKind: 'single-target',
    randomValues: [0.45, 0, 0, 0],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
]

const recoveryScenarioFor = (
  moveName: RegisteredBatch005ExecutedMoveName,
): LegacyExecutionScenario => {
  const matching = normalScenarios.find(scenario => scenario.moveName === moveName
    && scenario.expectedHitTargetIds.includes(TARGET_A_ID))
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

describe('REG-005 registered move conformance', () => {
  it('certifies exactly Charm through Cross Chop with linked evidence', () => {
    expect(Object.keys(REG_005_SCENARIOS_BY_MOVE)).toEqual([...REG_005_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_005_SCENARIOS_BY_MOVE)) {
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
      Charm: { version: 1, ac: 2, damageBase: 0, damageClass: 'Status', range: '6, 1 Target, Social' },
      Coaching: { version: 3, ac: null, damageBase: null, damageClass: 'Status', range: 'Burst 1' },
      Confide: { version: 1, ac: 2, damageBase: 0, damageClass: 'Status', range: '4, 1 Target, Social' },
      'Confuse Ray': { version: 1, ac: 2, damageBase: 0, damageClass: 'Status', range: '6, 1 Target' },
      Confusion: { version: 1, ac: 2, damageBase: 5, damageClass: 'Special', range: '6, 1 Target' },
      'Cotton Spore': { version: 1, ac: 2, damageBase: 0, damageClass: 'Status', range: 'Burst 1, Powder' },
      Crabhammer: { version: 1, ac: 4, damageBase: 10, damageClass: 'Physical', range: 'Melee, 1 Target', criticalRange: 18 },
      'Cross Chop': { version: 1, ac: 4, damageBase: 10, damageClass: 'Physical', range: 'Melee, 1 Target', criticalRange: 16 },
    } as const

    for (const [moveName, mechanics] of Object.entries(expected)) {
      const script = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get(moveName)
      expect(script, moveName).toMatchObject({
        kind: 'explicit',
        moveName,
        ...mechanics,
      })
      expect(script?.automationNotes.join(' '), moveName)
        .not.toMatch(/verify|adjust .* manually|apply .* manually|manual tracking|operator/i)
    }
    expect(explicitScriptForMove('Charm')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'atk',
      delta: -2,
      label: 'Charm lowers Attack: -2 Attack CS',
    }])
    expect(explicitScriptForMove('Coaching')).toMatchObject({
      areaTargetRelationship: 'ally',
      requiresAccuracy: false,
      stageSuggestions: [
        { recipient: 'user', key: 'atk', delta: 1 },
        { recipient: 'user', key: 'def', delta: 1 },
        { recipient: 'target', key: 'atk', delta: 1 },
        { recipient: 'target', key: 'def', delta: 1 },
      ],
    })
    expect(explicitScriptForMove('Confide')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'satk',
      delta: -1,
      label: 'Confide lowers Special Attack: -1 Special Attack CS',
    }])
    expect(explicitScriptForMove('Confuse Ray')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Confused',
      action: 'add',
      label: 'Confused',
      optional: false,
    }])
    expect(explicitScriptForMove('Confusion')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Confused',
      action: 'add',
      label: 'Confused on 19+',
      threshold: '19+',
      optional: true,
    }])
    expect(explicitScriptForMove('Cotton Spore')).toMatchObject({
      keywords: expect.arrayContaining(['Powder']),
      areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
      stageSuggestions: [{
        recipient: 'target',
        key: 'spd',
        delta: -2,
        label: 'Cotton Spore lowers Speed: -2 Speed CS',
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
        idFactory: () => 'reg-005-direct-id',
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
        idFactory: () => 'reg-005-plan-id',
        operationId: `${scenario.scenarioId}.plan`,
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
        program: { canonicalId: scenario.moveName, runtimeKind: 'legacy-v1' },
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

  it.each(REG_005_EXECUTED_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_005_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_005_EXECUTED_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_005_SCENARIOS_BY_MOVE[moveName]
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
