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
import { EMBER_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/ember'
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
  DRILL_RUN_REG_008_SCENARIOS,
  DRUM_BEATING_REG_008_SCENARIOS,
  EARTH_POWER_REG_008_SCENARIOS,
  EERIE_IMPULSE_REG_008_SCENARIOS,
  EGG_BOMB_REG_008_SCENARIOS,
  ELECTROWEB_REG_008_SCENARIOS,
  EMBER_REG_008_SCENARIOS,
  ENERGY_BALL_REG_008_SCENARIOS,
  REG_008_MOVE_NAMES,
  REG_008_SCENARIOS_BY_MOVE,
  type RegisteredBatch008LegacyMoveName,
  type RegisteredBatch008MoveName,
} from '../fixtures/moveAutomation/registeredBatch008'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const NOW = 5_000
const BLAST_AIM_CELL = { x: 3, y: 0, z: 3 } as const

type SelectionKind = 'single-target' | 'ranged-blast'
type SheetCapabilities = NonNullable<CharacterSheet['capabilities']>

interface StageExpectation {
  readonly recipientId: string
  readonly key: CombatStageKey
  readonly value: number
}

interface MoveFixtureOptions {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch008MoveName
  readonly selectionKind: SelectionKind
  readonly targetIds?: readonly string[]
  readonly randomValues: readonly number[]
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly targetCapabilities?: Partial<SheetCapabilities>
  readonly targetConditions?: readonly string[]
  readonly initialStages?: readonly StageExpectation[]
}

interface LegacyExecutionScenario extends MoveFixtureOptions {
  readonly moveName: RegisteredBatch008LegacyMoveName
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedAreaCandidateTargetIds?: readonly string[]
  readonly expectedBlockSource?: string
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
  readonly capabilities?: Partial<SheetCapabilities>
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
  capabilities: { overland: 6, ...options.capabilities },
  movelist: [...(options.moves ?? [])],
  ...stageMap(options.initialStages, options.placementId),
  combat: { currentHp: 500, conditions: [...(options.conditions ?? [])] },
})

const targetPosition = (
  selectionKind: SelectionKind,
  id: string,
): { readonly x: number; readonly y: number; readonly z: number } => {
  if (selectionKind === 'ranged-blast') {
    return id === TARGET_A_ID ? BLAST_AIM_CELL : { x: 3, y: 0, z: 2 }
  }
  return id === TARGET_A_ID ? { x: 2, y: 0, z: 3 } : { x: 2, y: 0, z: 2 }
}

const fixtureFor = (scenario: MoveFixtureOptions): LegacyFixture => {
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const placements = [
    placement(ACTOR_ID, 'actor', { x: 1, y: 0, z: 3 }),
    ...targetIds.map(id => placement(id, id, targetPosition(scenario.selectionKind, id))),
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-008-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-008 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 8, y: 3, z: 8 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-008 scene', startedAt: 100 },
    encounterState: createEmptyEncounterState(),
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  const actor = pokemonSheet({
    slug: 'actor',
    placementId: ACTOR_ID,
    moves: [{ name: scenario.moveName }],
    initialStages: scenario.initialStages,
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    placementId: id,
    types: id === TARGET_A_ID ? scenario.targetTypes : undefined,
    abilities: id === TARGET_A_ID ? scenario.targetAbilities : undefined,
    capabilities: id === TARGET_A_ID ? scenario.targetCapabilities : undefined,
    conditions: id === TARGET_A_ID ? scenario.targetConditions : undefined,
    initialStages: scenario.initialStages,
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (scenario.selectionKind === 'single-target') {
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
  .filter(entry => entry.parentEffectId === 'legacy-v1.accuracy')
  .map(entry => entry.naturalResult)

const stageValue = (
  transaction: MoveAutomationTransaction,
  expected: StageExpectation,
): number | undefined => transaction.combatStageUpdates
  .find(update => update.id === expected.recipientId)
  ?.stages[expected.key]

const assertLegacyScenarioResolution = (
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
  expect(resolution.transaction.conditionUpdates).toEqual([])
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  if (scenario.selectionKind === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(
      scenario.expectedAreaCandidateTargetIds ?? scenario.expectedAttackedTargetIds,
    )
    expect(resolution.area?.aimCell).toEqual(BLAST_AIM_CELL)
  }

  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(resolution.transaction.logLines.join('\n')).toContain('critical')
  }
  if (scenario.expectedBlockSource) {
    expect([
      resolution.transaction.logLines.join('\n'),
      JSON.stringify(resolution.feedback ?? null),
      JSON.stringify(resolution.auditTrace),
    ].join('\n')).toContain(scenario.expectedBlockSource)
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
  clientId: 'reg-008-client',
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
    return () => `reg-008-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const normalScenarios: readonly LegacyExecutionScenario[] = [
  {
    scenarioId: DRILL_RUN_REG_008_SCENARIOS[0].scenarioId,
    moveName: 'Drill Run',
    selectionKind: 'single-target',
    randomValues: [0.45, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: DRILL_RUN_REG_008_SCENARIOS[1].scenarioId,
    moveName: 'Drill Run',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: DRILL_RUN_REG_008_SCENARIOS[2].scenarioId,
    moveName: 'Drill Run',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: DRUM_BEATING_REG_008_SCENARIOS[0].scenarioId,
    moveName: 'Drum Beating',
    selectionKind: 'single-target',
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: DRUM_BEATING_REG_008_SCENARIOS[1].scenarioId,
    moveName: 'Drum Beating',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: DRUM_BEATING_REG_008_SCENARIOS[2].scenarioId,
    moveName: 'Drum Beating',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: DRUM_BEATING_REG_008_SCENARIOS[3].scenarioId,
    moveName: 'Drum Beating',
    selectionKind: 'single-target',
    randomValues: [0.45],
    targetAbilities: ['Sap Sipper'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedBlockSource: 'Grass immunity',
  },
  {
    scenarioId: DRUM_BEATING_REG_008_SCENARIOS[4].scenarioId,
    moveName: 'Drum Beating',
    selectionKind: 'single-target',
    randomValues: [0.45, 0, 0],
    initialStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -6 }],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: EARTH_POWER_REG_008_SCENARIOS[0].scenarioId,
    moveName: 'Earth Power',
    selectionKind: 'single-target',
    randomValues: [0.75, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: EARTH_POWER_REG_008_SCENARIOS[1].scenarioId,
    moveName: 'Earth Power',
    selectionKind: 'single-target',
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: EARTH_POWER_REG_008_SCENARIOS[2].scenarioId,
    moveName: 'Earth Power',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: EARTH_POWER_REG_008_SCENARIOS[3].scenarioId,
    moveName: 'Earth Power',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: EARTH_POWER_REG_008_SCENARIOS[4].scenarioId,
    moveName: 'Earth Power',
    selectionKind: 'single-target',
    randomValues: [0.75],
    targetCapabilities: { sky: 6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [16],
    expectedBlockSource: 'Sky Capability',
  },
  {
    scenarioId: EARTH_POWER_REG_008_SCENARIOS[5].scenarioId,
    moveName: 'Earth Power',
    selectionKind: 'single-target',
    randomValues: [0.75, 0, 0],
    targetCapabilities: { sky: 6 },
    targetConditions: ['Smack Down Grounded'],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: EARTH_POWER_REG_008_SCENARIOS[6].scenarioId,
    moveName: 'Earth Power',
    selectionKind: 'single-target',
    randomValues: [0.75, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
    expectedBlockSource: 'Shield Dust',
  },
  {
    scenarioId: EARTH_POWER_REG_008_SCENARIOS[7].scenarioId,
    moveName: 'Earth Power',
    selectionKind: 'single-target',
    randomValues: [0.75, 0, 0],
    initialStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -6 }],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: EERIE_IMPULSE_REG_008_SCENARIOS[0].scenarioId,
    moveName: 'Eerie Impulse',
    selectionKind: 'single-target',
    randomValues: [0.45],
    targetTypes: ['Ground'],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -2 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: EERIE_IMPULSE_REG_008_SCENARIOS[1].scenarioId,
    moveName: 'Eerie Impulse',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: EERIE_IMPULSE_REG_008_SCENARIOS[2].scenarioId,
    moveName: 'Eerie Impulse',
    selectionKind: 'single-target',
    randomValues: [0.45],
    initialStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: EGG_BOMB_REG_008_SCENARIOS[0].scenarioId,
    moveName: 'Egg Bomb',
    selectionKind: 'ranged-blast',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.5, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [11, 1],
  },
  {
    scenarioId: EGG_BOMB_REG_008_SCENARIOS[1].scenarioId,
    moveName: 'Egg Bomb',
    selectionKind: 'ranged-blast',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: EGG_BOMB_REG_008_SCENARIOS[2].scenarioId,
    moveName: 'Egg Bomb',
    selectionKind: 'ranged-blast',
    randomValues: [0.5],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: ELECTROWEB_REG_008_SCENARIOS[0].scenarioId,
    moveName: 'Electroweb',
    selectionKind: 'ranged-blast',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.5, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [11, 1],
  },
  {
    scenarioId: ELECTROWEB_REG_008_SCENARIOS[1].scenarioId,
    moveName: 'Electroweb',
    selectionKind: 'ranged-blast',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: ELECTROWEB_REG_008_SCENARIOS[2].scenarioId,
    moveName: 'Electroweb',
    selectionKind: 'ranged-blast',
    randomValues: [0.5],
    targetTypes: ['Ground'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: ELECTROWEB_REG_008_SCENARIOS[3].scenarioId,
    moveName: 'Electroweb',
    selectionKind: 'ranged-blast',
    randomValues: [0.5, 0, 0],
    initialStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -6 }],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: ENERGY_BALL_REG_008_SCENARIOS[0].scenarioId,
    moveName: 'Energy Ball',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: ENERGY_BALL_REG_008_SCENARIOS[1].scenarioId,
    moveName: 'Energy Ball',
    selectionKind: 'single-target',
    randomValues: [0.75, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: ENERGY_BALL_REG_008_SCENARIOS[2].scenarioId,
    moveName: 'Energy Ball',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: ENERGY_BALL_REG_008_SCENARIOS[3].scenarioId,
    moveName: 'Energy Ball',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: ENERGY_BALL_REG_008_SCENARIOS[4].scenarioId,
    moveName: 'Energy Ball',
    selectionKind: 'single-target',
    randomValues: [0.8],
    targetAbilities: ['Sap Sipper'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [17],
    expectedBlockSource: 'Grass immunity',
  },
  {
    scenarioId: ENERGY_BALL_REG_008_SCENARIOS[5].scenarioId,
    moveName: 'Energy Ball',
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
    scenarioId: ENERGY_BALL_REG_008_SCENARIOS[6].scenarioId,
    moveName: 'Energy Ball',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0],
    initialStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -6 }],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'sdef', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
]

const recoveryScenarioFor = (moveName: RegisteredBatch008MoveName): MoveFixtureOptions => {
  if (moveName === 'Ember') {
    return {
      scenarioId: EMBER_REG_008_SCENARIOS[4].scenarioId,
      moveName,
      selectionKind: 'single-target',
      randomValues: [0.85, 0],
    }
  }
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

describe('REG-008 registered move conformance', () => {
  it('certifies exactly Drill Run through Energy Ball with linked evidence', () => {
    expect(Object.keys(REG_008_SCENARIOS_BY_MOVE)).toEqual([...REG_008_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_008_SCENARIOS_BY_MOVE)) {
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
      'Drill Run': { ac: 3, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target' },
      'Drum Beating': { ac: 2, damageBase: 8, damageClass: 'Physical', range: '4, 1 Target' },
      'Earth Power': { ac: 2, damageBase: 9, damageClass: 'Special', range: '6, 1 Target, Groundsource' },
      'Eerie Impulse': { ac: 2, damageBase: 0, damageClass: 'Status', range: '6, 1 Target' },
      'Egg Bomb': { ac: 6, damageBase: 10, damageClass: 'Physical', range: '5, Blast 2' },
      Electroweb: { ac: 3, damageBase: 6, damageClass: 'Special', range: '4, Ranged Blast 2' },
      Ember: { ac: 2, damageBase: 4, damageClass: 'Special', range: '4, 1 Target' },
      'Energy Ball': { ac: 2, damageBase: 9, damageClass: 'Special', range: '8, 1 Target' },
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
    expect(explicitScriptForMove('Drill Run')?.criticalRange).toBe(18)
    expect(explicitScriptForMove('Drum Beating')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'spd',
      delta: -1,
      label: 'Drum Beating lowers Speed: -1 Speed CS',
    }])
    expect(explicitScriptForMove('Earth Power')).toMatchObject({
      keywords: expect.arrayContaining(['Groundsource']),
      stageSuggestions: [{
        recipient: 'target',
        key: 'sdef',
        delta: -1,
        threshold: '16+',
      }],
    })
    expect(explicitScriptForMove('Eerie Impulse')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'satk',
      delta: -2,
      label: 'Eerie Impulse lowers Special Attack: -2 Special Attack CS',
    }])
    expect(explicitScriptForMove('Egg Bomb')?.areaTemplates).toEqual([
      { kind: 'ranged-blast', size: 2, range: 5, label: 'Ranged 5 Blast 2' },
    ])
    expect(explicitScriptForMove('Electroweb')).toMatchObject({
      areaTemplates: [{ kind: 'ranged-blast', size: 2, range: 4 }],
      stageSuggestions: [{ recipient: 'target', key: 'spd', delta: -1 }],
    })
    expect(registeredMoveAutomationRuntimeFor('Ember')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: EMBER_MOVE_SPEC },
    })
    expect(EMBER_MOVE_SPEC.phases[2]?.operations[0]).toMatchObject({
      id: 'ember.burn',
      kind: 'condition',
      payload: {
        conditionId: 'burned',
        accuracyRollTrigger: {
          rollId: 'ember.accuracy-roll',
          trigger: { kind: 'range', minimum: 18 },
        },
      },
    })
    expect(explicitScriptForMove('Energy Ball')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'sdef',
      delta: -1,
      label: 'Energy Ball lowers Special Defense on 17+: -1 Special Defense CS',
      threshold: '17+',
      optional: true,
    }])
    expect(resolveMoveGrantedCapabilities([{ name: 'Eerie Impulse' }, { name: 'Ember' }]).other)
      .toEqual(['Glow', 'Firestarter'])
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
        idFactory: () => 'reg-008-direct-id',
        resolutionId: `${scenario.scenarioId}.direct`,
      })
      assertLegacyScenarioResolution(scenario, direct)
      expect({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] })
        .toEqual(directSnapshot)

      const plannerFixture = fixtureFor(scenario)
      const plan = planAuthoritativeMoveState({
        ...plannerFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-008-plan-id',
        operationId: `${scenario.scenarioId}.plan`,
      })
      assertLegacyScenarioResolution(scenario, plan.resolution)
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

  it.each(REG_008_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_008_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_008_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_008_SCENARIOS_BY_MOVE[moveName]
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
