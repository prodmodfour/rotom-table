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
  ABSORB_REG_001_SCENARIOS,
  ACCELEROCK_REG_001_SCENARIOS,
  ACID_REG_001_SCENARIOS,
  ACID_SPRAY_REG_001_SCENARIOS,
  ACUPRESSURE_REG_001_SCENARIOS,
  AERIAL_ACE_REG_001_SCENARIOS,
  AIR_CUTTER_REG_001_SCENARIOS,
  AIR_SLASH_REG_001_SCENARIOS,
  REG_001_SCENARIOS_BY_MOVE,
  type RegisteredBatch001MoveName,
} from '../fixtures/moveAutomation/registeredBatch001'
import { absorbV2Fixture } from '../fixtures/moveAutomation/absorbV2'
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
  readonly moveName: Exclude<RegisteredBatch001MoveName, 'Absorb'>
  readonly areaTargetIds?: readonly string[]
  readonly selfTarget?: boolean
  readonly randomValues: readonly number[]
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly initialStage?: StageExpectation
  readonly expectedStage?: StageExpectation
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedConditions?: readonly string[]
  readonly expectedAccuracyNaturalResults?: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly automaticHit?: boolean
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
  species: options.slug === 'actor' ? 'Pidgeotto' : 'Snorlax',
  level: 20,
  revision: 3,
  types: [...(options.types ?? ['Normal'])],
  abilities: (options.abilities ?? []).map(name => ({ name })),
  movelist: [...(options.moves ?? [])],
  ...stageMap(options.initialStage, options.placementId),
  combat: { currentHp: 500, conditions: [] },
})

const targetPosition = (id: string): { readonly x: number; readonly y: number; readonly z: number } => {
  if (id === TARGET_A_ID) return { x: 5, y: 0, z: 4 }
  if (id === TARGET_B_ID) return { x: 4, y: 0, z: 3 }
  return { x: 5, y: 0, z: 3 }
}

const fixtureFor = (
  scenario: LegacyExecutionScenario,
  mapOverrides: Partial<TabletopMap> = {},
): LegacyFixture => {
  const targetIds = scenario.areaTargetIds ?? (scenario.selfTarget ? [] : [TARGET_A_ID])
  const placements = [
    placement(ACTOR_ID, 'actor', { x: 5, y: 0, z: 5 }),
    ...targetIds.map(id => placement(id, id, targetPosition(id))),
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-001-${scenario.moveName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: `REG-001 ${scenario.moveName}`,
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
    activeScene: { name: 'REG-001 scene', startedAt: 100 },
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
  if (scenario.areaTargetIds) {
    const template = script.areaTemplates?.find(candidate => candidate.kind === 'cone')
    if (!template) throw new Error(`${scenario.moveName} must retain its reviewed Cone template.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
      direction: 'north',
    }
  }
  else {
    selection = {
      kind: 'single-target',
      targetPlacementId: scenario.selfTarget ? ACTOR_ID : TARGET_A_ID,
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

  if (scenario.expectedConditions) {
    expect(resolution.transaction.conditionUpdates).toEqual([{
      id: TARGET_A_ID,
      conditions: scenario.expectedConditions,
    }])
  }
  else {
    expect(resolution.transaction.conditionUpdates).toEqual([])
  }

  if (scenario.expectedAccuracyNaturalResults) {
    expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)
  }
  if (scenario.automaticHit) {
    expect(accuracyNaturalResults(resolution)).toEqual([])
    expect(resolution.transaction.hitTargetIds).toEqual(scenario.expectedAttackedTargetIds)
  }

  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(resolution.transaction.logLines.join('\n')).toContain('critical')
  }

  const traceRolls = resolution.auditTrace.events.filter(event => event.kind === 'roll')
  expect(traceRolls).toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort()).toEqual(
    [...new Set(['actor', ...scenario.expectedAttackedTargetIds.map(id => id === ACTOR_ID ? 'actor' : id)])].sort(),
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
  clientId: 'reg-001-client',
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
    return () => `reg-001-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const normalScenarios: readonly LegacyExecutionScenario[] = [
  {
    scenarioId: ACCELEROCK_REG_001_SCENARIOS[0].scenarioId,
    moveName: 'Accelerock',
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: ACCELEROCK_REG_001_SCENARIOS[1].scenarioId,
    moveName: 'Accelerock',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: ACCELEROCK_REG_001_SCENARIOS[2].scenarioId,
    moveName: 'Accelerock',
    randomValues: [0.999, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: ACID_REG_001_SCENARIOS[0].scenarioId,
    moveName: 'Acid',
    areaTargetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.85, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18, 1],
  },
  {
    scenarioId: ACID_REG_001_SCENARIOS[1].scenarioId,
    moveName: 'Acid',
    areaTargetIds: [TARGET_A_ID],
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: ACID_REG_001_SCENARIOS[2].scenarioId,
    moveName: 'Acid',
    areaTargetIds: [TARGET_A_ID],
    randomValues: [0.999, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: ACID_REG_001_SCENARIOS[3].scenarioId,
    moveName: 'Acid',
    areaTargetIds: [TARGET_A_ID],
    randomValues: [0.85, 0],
    targetTypes: ['Steel'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: ACID_SPRAY_REG_001_SCENARIOS[0].scenarioId,
    moveName: 'Acid Spray',
    randomValues: [0.45, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -2 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: ACID_SPRAY_REG_001_SCENARIOS[1].scenarioId,
    moveName: 'Acid Spray',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: ACID_SPRAY_REG_001_SCENARIOS[2].scenarioId,
    moveName: 'Acid Spray',
    randomValues: [0.999, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -2 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: ACID_SPRAY_REG_001_SCENARIOS[3].scenarioId,
    moveName: 'Acid Spray',
    randomValues: [0.45, 0],
    targetTypes: ['Steel'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: ACID_SPRAY_REG_001_SCENARIOS[4].scenarioId,
    moveName: 'Acid Spray',
    randomValues: [0.45, 0],
    initialStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -5 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'sdef', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  ...([
    ['attack-self', 0, { recipientId: ACTOR_ID, key: 'atk', value: 6 }, true],
    ['defense-target', 0.2, { recipientId: TARGET_A_ID, key: 'def', value: 2 }, false],
    ['special-attack-target', 0.34, { recipientId: TARGET_A_ID, key: 'satk', value: 2 }, false],
    ['special-defense-target', 0.5, { recipientId: TARGET_A_ID, key: 'sdef', value: 2 }, false],
    ['speed-target', 0.7, { recipientId: TARGET_A_ID, key: 'spd', value: 2 }, false],
    ['accuracy-target', 0.999, { recipientId: TARGET_A_ID, key: 'acc', value: 2 }, false],
  ] as const).map((_entry, index): LegacyExecutionScenario => {
    const [, randomStage, expectedStage, selfTarget] = _entry
    return {
      scenarioId: ACUPRESSURE_REG_001_SCENARIOS[index]!.scenarioId,
      moveName: 'Acupressure',
      selfTarget,
      randomValues: [0.45, randomStage],
      ...(selfTarget
        ? { initialStage: { recipientId: ACTOR_ID, key: 'atk', value: 5 } as const }
        : {}),
      expectedStage,
      expectedAttackedTargetIds: [selfTarget ? ACTOR_ID : TARGET_A_ID],
      expectedHitTargetIds: [selfTarget ? ACTOR_ID : TARGET_A_ID],
      expectedDamagedTargetIds: [],
      expectedAccuracyNaturalResults: [10],
    }
  }),
  {
    scenarioId: ACUPRESSURE_REG_001_SCENARIOS[6].scenarioId,
    moveName: 'Acupressure',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: AERIAL_ACE_REG_001_SCENARIOS[0].scenarioId,
    moveName: 'Aerial Ace',
    randomValues: [0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    automaticHit: true,
  },
  {
    scenarioId: AIR_CUTTER_REG_001_SCENARIOS[0].scenarioId,
    moveName: 'Air Cutter',
    areaTargetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.85, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18, 1],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: AIR_CUTTER_REG_001_SCENARIOS[1].scenarioId,
    moveName: 'Air Cutter',
    areaTargetIds: [TARGET_A_ID],
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: AIR_SLASH_REG_001_SCENARIOS[0].scenarioId,
    moveName: 'Air Slash',
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedConditions: ['Flinch', 'Vulnerable'],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: AIR_SLASH_REG_001_SCENARIOS[1].scenarioId,
    moveName: 'Air Slash',
    randomValues: [0.65, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: AIR_SLASH_REG_001_SCENARIOS[2].scenarioId,
    moveName: 'Air Slash',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: AIR_SLASH_REG_001_SCENARIOS[3].scenarioId,
    moveName: 'Air Slash',
    randomValues: [0.999, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedConditions: ['Flinch', 'Vulnerable'],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: AIR_SLASH_REG_001_SCENARIOS[4].scenarioId,
    moveName: 'Air Slash',
    randomValues: [0.7, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
]

const recoveryScenarioFor = (
  moveName: RegisteredBatch001MoveName,
): LegacyExecutionScenario => {
  if (moveName === 'Absorb') {
    throw new Error('Absorb uses its native-v2 fixtures and focused recovery suites.')
  }
  const matching = normalScenarios.find(scenario => scenario.moveName === moveName
    && scenario.expectedHitTargetIds.length > 0)
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

describe('REG-001 registered move conformance', () => {
  it('certifies only the eight reviewed catalog rows with linked runtime evidence', () => {
    expect(Object.keys(REG_001_SCENARIOS_BY_MOVE)).toEqual([
      'Absorb',
      'Accelerock',
      'Acid',
      'Acid Spray',
      'Acupressure',
      'Aerial Ace',
      'Air Cutter',
      'Air Slash',
    ])

    for (const [canonicalId, scenarios] of Object.entries(REG_001_SCENARIOS_BY_MOVE)) {
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

  it('retains exact reviewed v1 mechanics without rule-debt instructions', () => {
    const expected = {
      Accelerock: { ac: 2, damageBase: 4, damageClass: 'Physical', range: 'Melee, 1 Target, Priority' },
      Acid: { ac: 2, damageBase: 4, damageClass: 'Special', range: 'Cone 2', criticalRange: null },
      'Acid Spray': { ac: 2, damageBase: 4, damageClass: 'Special', range: '4, 1 Target' },
      Acupressure: { ac: 2, damageBase: 0, damageClass: 'Status', range: 'Melee, 1 Target or Self' },
      'Aerial Ace': { ac: null, damageBase: 6, damageClass: 'Physical', range: 'Melee, 1 Target', requiresAccuracy: false },
      'Air Cutter': { ac: 2, damageBase: 6, damageClass: 'Special', range: 'Cone 2', criticalRange: 18 },
      'Air Slash': { ac: 3, damageBase: 8, damageClass: 'Special', range: '6, 1 Target' },
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
    expect(explicitScriptForMove('Acid')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'sdef',
      delta: -1,
      label: 'Acid lowers Special Defense on 18+: -1 Special Defense CS',
      threshold: '18+',
      optional: true,
    }])
    expect(explicitScriptForMove('Acid Spray')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'sdef',
      delta: -2,
      label: 'Acid Spray lowers Special Defense: -2 Special Defense CS',
    }])
    expect(explicitScriptForMove('Acupressure')?.randomStageSuggestion?.entries)
      .toHaveLength(6)
    expect(explicitScriptForMove('Air Slash')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Flinch',
      action: 'add',
      label: 'Flinch on 15+',
      threshold: '15+',
      optional: true,
    }])
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
        idFactory: () => 'reg-001-direct-id',
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
        idFactory: () => 'reg-001-plan-id',
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

  it('rejects Accelerock after the actor has acted and applies no partial mutation', async () => {
    const scenario = recoveryScenarioFor('Accelerock')
    const base = fixtureFor(scenario)
    const fixture = fixtureFor(scenario, {
      encounterState: {
        ...createEmptyEncounterState(),
        history: {
          ...createEmptyEncounterState().history,
          actedThisRoundPlacementIds: [ACTOR_ID],
        },
      },
    })
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: randomSequence(scenario.randomValues),
      now: () => NOW,
      operationId: ACCELEROCK_REG_001_SCENARIOS[3].scenarioId,
    })).toThrowError(expect.objectContaining({
      code: 'move-resource-unavailable',
      message: expect.stringContaining('priority-unavailable'),
    }))
    expect(fixture.map).not.toEqual(base.map)

    const harness = openHarness(fixture)
    const command = commandFor(fixture, `${ACCELEROCK_REG_001_SCENARIOS[3].scenarioId}.command`)
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

  it('rejects a stale Absorb participant without committing either HP write', async () => {
    const source = absorbV2Fixture('absorb.v2-hit-mitigated')
    const fixture: LegacyFixture = {
      map: source.map,
      pokemonSheets: source.pokemonSheets,
      trainerSheets: source.trainerSheets,
      intent: source.intent,
      candidateScopePlacementIds: ['target-token'],
    }
    const harness = openHarness(fixture)
    const command = commandFor(fixture, ABSORB_REG_001_SCENARIOS[7].scenarioId)
    const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const targetBefore = deepCloneJson(harness.sheets.getByRef('pokemon', 'target'))
    let racedActor: Record<string, unknown> | null = null
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      const plan = planAuthoritativeMoveState({
        ...input,
        random: randomSequence(source.randomValues),
      })
      expect(plan.sheetWrites.map(write => write.slug)).toEqual(['target', 'actor'])
      const actor = harness.sheets.getByRef('pokemon', 'actor')
      if (!actor) throw new Error('Missing Absorb actor sheet.')
      racedActor = {
        ...deepCloneJson(actor.sheet),
        revision: actor.revision + 1,
        updatedAt: NOW + 1,
      }
      harness.sheets.save({
        kind: 'pokemon',
        slug: 'actor',
        document: racedActor,
        revision: actor.revision + 1,
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
    expect(harness.sheets.getByRef('pokemon', 'target')).toEqual(targetBefore)
    expect(harness.sheets.getByRef('pokemon', 'actor')?.sheet).toEqual(racedActor)
    expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
    expect(harness.events).toEqual([])
  })

  it.each(Object.keys(REG_001_SCENARIOS_BY_MOVE).filter(
    (moveName): moveName is Exclude<RegisteredBatch001MoveName, 'Absorb'> => moveName !== 'Absorb',
  ))('replays accepted %s delivery without rerolling or mutating twice', async (moveName) => {
    const scenario = recoveryScenarioFor(moveName)
    const fixture = fixtureFor(scenario)
    const harness = openHarness(fixture)
    const evidence = REG_001_SCENARIOS_BY_MOVE[moveName]
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

  it.each(Object.keys(REG_001_SCENARIOS_BY_MOVE).filter(
    (moveName): moveName is Exclude<RegisteredBatch001MoveName, 'Absorb'> => moveName !== 'Absorb',
  ))('rejects stale %s target state without a partial accepted result', async (moveName) => {
    const scenario = recoveryScenarioFor(moveName)
    const fixture = fixtureFor(scenario)
    const harness = openHarness(fixture)
    const evidence = REG_001_SCENARIOS_BY_MOVE[moveName]
      .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))
    if (!evidence) throw new Error(`Missing conflict evidence for ${moveName}.`)
    const command = commandFor(fixture, evidence.scenarioId)
    const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const staleSlug = scenario.selfTarget ? 'actor' : TARGET_A_ID
    let racedSheet: Record<string, unknown> | null = null
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      const plan: AuthoritativeMoveStatePlan = planAuthoritativeMoveState({
        ...input,
        random: randomSequence(scenario.randomValues),
      })
      const current = harness.sheets.getByRef('pokemon', staleSlug)
      if (!current) throw new Error(`Missing race sheet ${staleSlug}.`)
      racedSheet = {
        ...deepCloneJson(current.sheet),
        revision: current.revision + 1,
        updatedAt: NOW + 1,
      }
      harness.sheets.save({
        kind: 'pokemon',
        slug: staleSlug,
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
    expect(harness.sheets.getByRef('pokemon', staleSlug)?.sheet).toEqual(racedSheet)
    expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
    expect(harness.events).toEqual([])
  })
})
