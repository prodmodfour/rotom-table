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
import { DOUBLE_KICK_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/doubleKick'
import { DRAGON_RAGE_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/dragonRage'
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
  DIZZY_PUNCH_REG_007_SCENARIOS,
  DOUBLE_KICK_REG_007_SCENARIOS,
  DRAGON_BREATH_REG_007_SCENARIOS,
  DRAGON_CLAW_REG_007_SCENARIOS,
  DRAGON_HAMMER_REG_007_SCENARIOS,
  DRAGON_PULSE_REG_007_SCENARIOS,
  DRAGON_RAGE_REG_007_SCENARIOS,
  DRILL_PECK_REG_007_SCENARIOS,
  REG_007_MOVE_NAMES,
  REG_007_SCENARIOS_BY_MOVE,
  type RegisteredBatch007MoveName,
} from '../fixtures/moveAutomation/registeredBatch007'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const NOW = 5_000

type SelectionKind = 'single-target' | 'line'

interface LegacyExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch007MoveName
  readonly selectionKind: SelectionKind
  readonly targetBranchId?: string
  readonly targetIds?: readonly string[]
  readonly randomValues: readonly number[]
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly actorConditions?: readonly string[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
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
  x: number,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 5 },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly moves?: readonly CharacterSheetMove[]
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
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
  stats: {
    hp: { added: 500 },
    atk: { added: 30, stage: 0 },
    def: { added: 5, stage: 0 },
    satk: { added: 30, stage: 0 },
    sdef: { added: 5, stage: 0 },
    spd: { added: 5, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 500, conditions: [...(options.conditions ?? [])] },
})

const fixtureFor = (scenario: LegacyExecutionScenario): LegacyFixture => {
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const placements = [
    placement(ACTOR_ID, 'actor', 5),
    ...targetIds.map((id, index) => placement(id, id, 6 + index)),
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-007-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-007 ${scenario.moveName}`,
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
    activeScene: { name: 'REG-007 scene', startedAt: 100 },
    encounterState: createEmptyEncounterState(),
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  const actor = pokemonSheet({
    slug: 'actor',
    moves: [{ name: scenario.moveName }],
    conditions: scenario.actorConditions,
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    types: id === TARGET_A_ID ? scenario.targetTypes : undefined,
    abilities: id === TARGET_A_ID ? scenario.targetAbilities : undefined,
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (scenario.selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const template = script.areaTemplates?.find(candidate => candidate.kind === 'line')
    if (!template) throw new Error(`${scenario.moveName} must retain its reviewed Line template.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
      direction: 'east',
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
      ...(scenario.targetBranchId ? { targetBranchId: scenario.targetBranchId } : {}),
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
  expect(resolution.transaction.attackedTargetIds).not.toContain(ACTOR_ID)
  expect(resolution.transaction.hpUpdates.map(update => update.id).sort())
    .toEqual([...scenario.expectedDamagedTargetIds].sort())
  for (const update of resolution.transaction.hpUpdates) expect(update.currentHp).toBeLessThan(500)
  expect(resolution.transaction.combatStageUpdates).toEqual([])
  expect(conditionUpdatesByTarget(resolution.transaction))
    .toEqual(scenario.expectedConditions ?? {})
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)
  expect(resolution.targetBranchId).toBe(scenario.targetBranchId)

  if (scenario.selectionKind === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(
      scenario.expectedAreaCandidateTargetIds ?? scenario.expectedAttackedTargetIds,
    )
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
  clientId: 'reg-007-client',
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
    return () => `reg-007-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const confused = { [TARGET_A_ID]: ['Confused'] } as const
const paralyzed = { [TARGET_A_ID]: ['Paralysis'] } as const

const normalScenarios: readonly LegacyExecutionScenario[] = [
  {
    scenarioId: DIZZY_PUNCH_REG_007_SCENARIOS[0].scenarioId,
    moveName: 'Dizzy Punch',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0],
    expectedConditions: confused,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: DIZZY_PUNCH_REG_007_SCENARIOS[1].scenarioId,
    moveName: 'Dizzy Punch',
    selectionKind: 'single-target',
    randomValues: [0.75, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: DIZZY_PUNCH_REG_007_SCENARIOS[2].scenarioId,
    moveName: 'Dizzy Punch',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: DIZZY_PUNCH_REG_007_SCENARIOS[3].scenarioId,
    moveName: 'Dizzy Punch',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedConditions: confused,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: DIZZY_PUNCH_REG_007_SCENARIOS[4].scenarioId,
    moveName: 'Dizzy Punch',
    selectionKind: 'single-target',
    randomValues: [0.8],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: DIZZY_PUNCH_REG_007_SCENARIOS[5].scenarioId,
    moveName: 'Dizzy Punch',
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
    scenarioId: DRAGON_BREATH_REG_007_SCENARIOS[0].scenarioId,
    moveName: 'Dragon Breath',
    selectionKind: 'single-target',
    randomValues: [0.7, 0, 0],
    expectedConditions: paralyzed,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: DRAGON_BREATH_REG_007_SCENARIOS[1].scenarioId,
    moveName: 'Dragon Breath',
    selectionKind: 'single-target',
    randomValues: [0.65, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: DRAGON_BREATH_REG_007_SCENARIOS[2].scenarioId,
    moveName: 'Dragon Breath',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: DRAGON_BREATH_REG_007_SCENARIOS[3].scenarioId,
    moveName: 'Dragon Breath',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedConditions: paralyzed,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: DRAGON_BREATH_REG_007_SCENARIOS[4].scenarioId,
    moveName: 'Dragon Breath',
    selectionKind: 'single-target',
    randomValues: [0.7],
    targetTypes: ['Fairy'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: DRAGON_BREATH_REG_007_SCENARIOS[5].scenarioId,
    moveName: 'Dragon Breath',
    selectionKind: 'single-target',
    randomValues: [0.7, 0, 0],
    targetTypes: ['Electric'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: DRAGON_BREATH_REG_007_SCENARIOS[6].scenarioId,
    moveName: 'Dragon Breath',
    selectionKind: 'single-target',
    randomValues: [0.7, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedBlockSource: 'Shield Dust',
  },
  {
    scenarioId: DRAGON_CLAW_REG_007_SCENARIOS[0].scenarioId,
    moveName: 'Dragon Claw',
    selectionKind: 'single-target',
    randomValues: [0.5, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: DRAGON_CLAW_REG_007_SCENARIOS[1].scenarioId,
    moveName: 'Dragon Claw',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: DRAGON_CLAW_REG_007_SCENARIOS[2].scenarioId,
    moveName: 'Dragon Claw',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: DRAGON_CLAW_REG_007_SCENARIOS[3].scenarioId,
    moveName: 'Dragon Claw',
    selectionKind: 'single-target',
    randomValues: [0.5],
    targetTypes: ['Fairy'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: DRAGON_HAMMER_REG_007_SCENARIOS[0].scenarioId,
    moveName: 'Dragon Hammer',
    selectionKind: 'single-target',
    targetBranchId: 'melee-1-target',
    randomValues: [0.5, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: DRAGON_HAMMER_REG_007_SCENARIOS[1].scenarioId,
    moveName: 'Dragon Hammer',
    selectionKind: 'line',
    targetBranchId: 'line-3',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.5, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [11, 1],
  },
  {
    scenarioId: DRAGON_HAMMER_REG_007_SCENARIOS[2].scenarioId,
    moveName: 'Dragon Hammer',
    selectionKind: 'single-target',
    targetBranchId: 'melee-1-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: DRAGON_HAMMER_REG_007_SCENARIOS[3].scenarioId,
    moveName: 'Dragon Hammer',
    selectionKind: 'single-target',
    targetBranchId: 'melee-1-target',
    randomValues: [0.5],
    targetTypes: ['Fairy'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: DRAGON_PULSE_REG_007_SCENARIOS[0].scenarioId,
    moveName: 'Dragon Pulse',
    selectionKind: 'single-target',
    randomValues: [0.5, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: DRAGON_PULSE_REG_007_SCENARIOS[1].scenarioId,
    moveName: 'Dragon Pulse',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: DRAGON_PULSE_REG_007_SCENARIOS[2].scenarioId,
    moveName: 'Dragon Pulse',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: DRAGON_PULSE_REG_007_SCENARIOS[3].scenarioId,
    moveName: 'Dragon Pulse',
    selectionKind: 'single-target',
    randomValues: [0.5],
    targetTypes: ['Fairy'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: DRILL_PECK_REG_007_SCENARIOS[0].scenarioId,
    moveName: 'Drill Peck',
    selectionKind: 'single-target',
    randomValues: [0.5, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [11],
  },
  {
    scenarioId: DRILL_PECK_REG_007_SCENARIOS[1].scenarioId,
    moveName: 'Drill Peck',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: DRILL_PECK_REG_007_SCENARIOS[2].scenarioId,
    moveName: 'Drill Peck',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
]

const recoveryScenarioFor = (
  moveName: RegisteredBatch007MoveName,
): LegacyExecutionScenario => {
  if (moveName === 'Double Kick') {
    return {
      scenarioId: DOUBLE_KICK_REG_007_SCENARIOS[0].scenarioId,
      moveName,
      selectionKind: 'single-target',
      randomValues: [0.5, 0, 0.5, 0],
      expectedAttackedTargetIds: [TARGET_A_ID],
      expectedHitTargetIds: [TARGET_A_ID],
      expectedDamagedTargetIds: [TARGET_A_ID],
      expectedAccuracyNaturalResults: [11, 11],
    }
  }
  if (moveName === 'Dragon Rage') {
    return {
      scenarioId: DRAGON_RAGE_REG_007_SCENARIOS[0].scenarioId,
      moveName,
      selectionKind: 'single-target',
      randomValues: [0.5],
      expectedAttackedTargetIds: [TARGET_A_ID],
      expectedHitTargetIds: [TARGET_A_ID],
      expectedDamagedTargetIds: [TARGET_A_ID],
      expectedAccuracyNaturalResults: [11],
    }
  }
  const matching = normalScenarios.find(scenario => (
    scenario.moveName === moveName && scenario.expectedDamagedTargetIds.includes(TARGET_A_ID)
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

describe('REG-007 registered move conformance', () => {
  it('certifies exactly Dizzy Punch through Drill Peck with linked evidence', () => {
    expect(Object.keys(REG_007_SCENARIOS_BY_MOVE)).toEqual([...REG_007_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_007_SCENARIOS_BY_MOVE)) {
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

  it('retains all reviewed canonical mechanics without unresolved rule instructions', () => {
    const expected = {
      'Dizzy Punch': { ac: 2, damageBase: 7, damageClass: 'Physical', range: 'Melee, 1 Target' },
      'Double Kick': { ac: 3, damageBase: 3, damageClass: 'Physical', range: 'Melee, 1 Target, Double Strike' },
      'Dragon Breath': { ac: 2, damageBase: 6, damageClass: 'Special', range: '6, 1 Target' },
      'Dragon Claw': { ac: 2, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target' },
      'Dragon Hammer': { ac: 2, damageBase: 9, damageClass: 'Physical', range: 'Melee, 1 Target or Line 3' },
      'Dragon Pulse': { ac: 2, damageBase: 9, damageClass: 'Special', range: '8, 1 Target, Aura' },
      'Dragon Rage': { ac: 2, damageBase: null, damageClass: 'Special', range: '4, 1 Target' },
      'Drill Peck': { ac: 2, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target, Dash' },
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
    expect(explicitScriptForMove('Dizzy Punch')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Confused',
      action: 'add',
      label: 'Confused on 17+',
      threshold: '17+',
      optional: true,
    }])
    expect(registeredMoveAutomationRuntimeFor('Double Kick')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: DOUBLE_KICK_MOVE_SPEC },
    })
    expect(DOUBLE_KICK_MOVE_SPEC.phases[0]?.operations[0]).toMatchObject({
      kind: 'multi-hit',
      payload: {
        count: { kind: 'fixed', hits: 2 },
        accuracy: { kind: 'per-hit', stopOnMiss: false },
        critical: { kind: 'accuracy' },
      },
    })
    expect(explicitScriptForMove('Dragon Breath')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Paralysis',
      action: 'add',
      label: 'Paralysis on 15+',
      threshold: '15+',
      optional: true,
    }])
    expect(explicitScriptForMove('Dragon Hammer')).toMatchObject({
      areaTemplates: [{ kind: 'line', size: 3, label: 'Line 3' }],
      targetBranches: [
        expect.objectContaining({ id: 'melee-1-target', targetMode: 'one-target' }),
        expect.objectContaining({ id: 'line-3', targetMode: 'multi-target' }),
      ],
    })
    expect(explicitScriptForMove('Dragon Pulse')?.keywords).toContain('Aura')
    expect(registeredMoveAutomationRuntimeFor('Dragon Rage')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: DRAGON_RAGE_MOVE_SPEC },
    })
    expect(DRAGON_RAGE_MOVE_SPEC.phases[1]?.operations[0]).toMatchObject({
      kind: 'direct-hp',
      payload: {
        calculation: { kind: 'fixed', value: 15 },
        applyTypeImmunity: true,
        accuracyRollId: 'dragon-rage.accuracy-roll',
        injury: { massiveDamage: 'never' },
      },
    })
    expect(explicitScriptForMove('Drill Peck')?.keywords).toContain('Dash')
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
        idFactory: () => 'reg-007-direct-id',
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
        idFactory: () => 'reg-007-plan-id',
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

  it('rejects Drill Peck while Stuck before rolls, costs, or effects', async () => {
    const scenario: LegacyExecutionScenario = {
      ...recoveryScenarioFor('Drill Peck'),
      scenarioId: DRILL_PECK_REG_007_SCENARIOS[3].scenarioId,
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
      operationId: scenario.scenarioId,
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

  it.each(REG_007_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_007_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_007_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_007_SCENARIOS_BY_MOVE[moveName]
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
