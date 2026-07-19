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
  REG_026_MOVE_NAMES,
  REG_026_SCENARIOS_BY_MOVE,
  SLUDGE_WAVE_REG_026_SCENARIOS,
  SMART_STRIKE_REG_026_SCENARIOS,
  SMOG_REG_026_SCENARIOS,
  SNARL_REG_026_SCENARIOS,
  SPARK_REG_026_SCENARIOS,
  SPIRIT_BREAK_REG_026_SCENARIOS,
  SPORE_REG_026_SCENARIOS,
  STEAM_ERUPTION_REG_026_SCENARIOS,
  type RegisteredBatch026MoveName,
} from '../fixtures/moveAutomation/registeredBatch026'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const CLOSE_BLAST_AIM_CELL = Object.freeze({ x: 6, y: 0, z: 5 })
const NOW = 5_000

const LEGACY_MOVE_NAMES = REG_026_MOVE_NAMES

type TargetId = typeof TARGET_A_ID | typeof TARGET_B_ID | typeof TARGET_C_ID
type SelectionKind = 'single-target' | 'burst' | 'close-blast' | 'line' | 'cone'

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
  readonly moveName: RegisteredBatch026MoveName
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly actorProfile?: TokenProfile
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TokenProfile>>>
  readonly initialStages?: readonly StageExpectation[]
  readonly electricTerrain?: boolean
  readonly randomValues: readonly number[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
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
  if (selectionKind === 'line') {
    return id === TARGET_A_ID
      ? { x: 6, y: 0, z: 5 }
      : { x: 7, y: 0, z: 5 }
  }
  if (selectionKind === 'cone') {
    if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
    if (id === TARGET_B_ID) return { x: 7, y: 0, z: 4 }
    return { x: 7, y: 0, z: 5 }
  }
  if (selectionKind === 'close-blast') {
    if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
    if (id === TARGET_B_ID) return { x: 6, y: 0, z: 4 }
    return { x: 7, y: 0, z: 5 }
  }
  if (selectionKind === 'burst') {
    if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
    if (id === TARGET_B_ID) return { x: 5, y: 0, z: 4 }
    return { x: 4, y: 0, z: 5 }
  }
  return id === TARGET_A_ID
    ? { x: 6, y: 0, z: 5 }
    : { x: 5, y: 0, z: 4 }
}

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const selectionKind = scenario.selectionKind ?? 'single-target'
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-026-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-026 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: {
      weather: [],
      terrains: scenario.electricTerrain ? [{ kind: 'electric', scope: 'field' }] : [],
      rooms: [],
    },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 5, y: 0, z: 5 }),
      ...targetIds.map(id => placement(id, id, targetPosition(selectionKind, id))),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-026 scene', startedAt: 100 },
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
    const template = script.areaTemplates?.find(candidate => candidate.kind === selectionKind)
    if (!template) throw new Error(`${scenario.moveName} must retain its reviewed ${selectionKind} template.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
      ...(['line', 'cone'].includes(selectionKind) ? { direction: 'east' as const } : {}),
      ...(selectionKind === 'close-blast' ? { aimCell: { ...CLOSE_BLAST_AIM_CELL } } : {}),
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

const conditionUpdatesByTarget = (
  transaction: MoveAutomationTransaction,
): Readonly<Record<string, readonly string[]>> => Object.fromEntries(
  transaction.conditionUpdates.map(update => [update.id, update.conditions]),
)

const stageValue = (
  transaction: MoveAutomationTransaction,
  expected: StageExpectation,
): number | undefined => transaction.combatStageUpdates
  .find(update => update.id === expected.recipientId)
  ?.stages[expected.key]

const runtimeVersionFor = (moveName: RegisteredBatch026MoveName): number => (
  moveName === 'Spore' ? 2 : 1
)

const assertScenarioResolution = (
  scenario: ExecutionScenario,
  resolution: AuthoritativeMoveResolution,
): void => {
  expect(resolution.auditTrace.program).toMatchObject({
    canonicalId: scenario.moveName,
    runtimeKind: 'legacy-v1',
    runtimeVersion: runtimeVersionFor(scenario.moveName),
  })
  expect(resolution.transaction.attackedTargetIds).toEqual(scenario.expectedAttackedTargetIds)
  expect(resolution.transaction.hitTargetIds).toEqual(scenario.expectedHitTargetIds)
  expect(resolution.transaction.attackedTargetIds).not.toContain(ACTOR_ID)
  expect(resolution.transaction.hpUpdates.map(update => update.id).sort())
    .toEqual([...scenario.expectedDamagedTargetIds].sort())
  for (const update of resolution.transaction.hpUpdates) expect(update.currentHp).toBeLessThan(500)
  expect(conditionUpdatesByTarget(resolution.transaction))
    .toEqual(scenario.expectedConditions ?? {})

  const expectedStages = scenario.expectedStages ?? []
  if (expectedStages.length === 0) {
    expect(resolution.transaction.combatStageUpdates).toEqual([])
  }
  else {
    for (const expected of expectedStages) {
      expect(stageValue(resolution.transaction, expected)).toBe(expected.value)
    }
    expect(new Set(resolution.transaction.combatStageUpdates.map(update => update.id)))
      .toEqual(new Set(expectedStages.map(stage => stage.recipientId)))
  }
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  const selectionKind = scenario.selectionKind ?? 'single-target'
  if (selectionKind === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(scenario.expectedAttackedTargetIds)
    expect(resolution.area?.excludedTargetIds).toEqual([])
    if (selectionKind === 'close-blast') expect(resolution.area?.aimCell).toEqual(CLOSE_BLAST_AIM_CELL)
    if (selectionKind === 'line' || selectionKind === 'cone') expect(resolution.area?.direction).toBe('east')
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
    expect(searchableEvidence).toContain('Smite miss')
  }
  for (const fragment of scenario.expectedLogFragments ?? []) {
    expect(searchableEvidence).toContain(fragment)
  }

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
  clientId: 'reg-026-client',
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
    return () => `reg-026-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const poisonedA = { [TARGET_A_ID]: ['Poisoned'] } as const
const paralyzedA = { [TARGET_A_ID]: ['Paralysis'] } as const
const sleepingA = { [TARGET_A_ID]: ['Sleep'] } as const
const burnedA = { [TARGET_A_ID]: ['Burned'] } as const
const specialAttackDropA = [{ recipientId: TARGET_A_ID, key: 'satk', value: -1 }] as const

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: SLUDGE_WAVE_REG_026_SCENARIOS[0].scenarioId,
    moveName: 'Sludge Wave',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    randomValues: [0.9, 0, 0, 0, 0, 0.85, 0, 0, 0],
    expectedConditions: poisonedA,
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedHitTargetIds: [TARGET_A_ID, TARGET_C_ID],
    expectedDamagedTargetIds: [TARGET_A_ID, TARGET_C_ID],
    expectedAccuracyNaturalResults: [19, 1, 18],
  },
  {
    scenarioId: SLUDGE_WAVE_REG_026_SCENARIOS[1].scenarioId,
    moveName: 'Sludge Wave',
    selectionKind: 'close-blast',
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: SLUDGE_WAVE_REG_026_SCENARIOS[2].scenarioId,
    moveName: 'Sludge Wave',
    selectionKind: 'burst',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedConditions: poisonedA,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: SLUDGE_WAVE_REG_026_SCENARIOS[3].scenarioId,
    moveName: 'Sludge Wave',
    selectionKind: 'burst',
    targetProfiles: { [TARGET_A_ID]: { types: ['Steel'] } },
    randomValues: [0.9, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragments: ['Steel type'],
  },
  {
    scenarioId: SLUDGE_WAVE_REG_026_SCENARIOS[4].scenarioId,
    moveName: 'Sludge Wave',
    selectionKind: 'burst',
    targetProfiles: { [TARGET_A_ID]: { types: ['Poison'] } },
    randomValues: [0.9, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragments: ['Poison type'],
  },
  {
    scenarioId: SLUDGE_WAVE_REG_026_SCENARIOS[5].scenarioId,
    moveName: 'Sludge Wave',
    selectionKind: 'burst',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.9, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: SMART_STRIKE_REG_026_SCENARIOS[0].scenarioId,
    moveName: 'Smart Strike',
    randomValues: [0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: SMOG_REG_026_SCENARIOS[0].scenarioId,
    moveName: 'Smog',
    selectionKind: 'line',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0.5, 0],
    expectedConditions: poisonedA,
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedDamagedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedAccuracyNaturalResults: [10, 11],
  },
  {
    scenarioId: SMOG_REG_026_SCENARIOS[1].scenarioId,
    moveName: 'Smog',
    selectionKind: 'line',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: SMOG_REG_026_SCENARIOS[2].scenarioId,
    moveName: 'Smog',
    selectionKind: 'line',
    randomValues: [0.999, 0, 0],
    expectedConditions: poisonedA,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: SMOG_REG_026_SCENARIOS[3].scenarioId,
    moveName: 'Smog',
    selectionKind: 'line',
    targetProfiles: { [TARGET_A_ID]: { types: ['Steel'] } },
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Steel type'],
  },
  {
    scenarioId: SMOG_REG_026_SCENARIOS[4].scenarioId,
    moveName: 'Smog',
    selectionKind: 'line',
    targetProfiles: { [TARGET_A_ID]: { types: ['Poison'] } },
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Poison type'],
  },
  {
    scenarioId: SMOG_REG_026_SCENARIOS[5].scenarioId,
    moveName: 'Smog',
    selectionKind: 'line',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: SNARL_REG_026_SCENARIOS[0].scenarioId,
    moveName: 'Snarl',
    selectionKind: 'cone',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0],
    expectedStages: specialAttackDropA,
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: SNARL_REG_026_SCENARIOS[1].scenarioId,
    moveName: 'Snarl',
    selectionKind: 'cone',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: specialAttackDropA,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: SNARL_REG_026_SCENARIOS[2].scenarioId,
    moveName: 'Snarl',
    selectionKind: 'cone',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Soundproof'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Soundproof'],
  },
  {
    scenarioId: SNARL_REG_026_SCENARIOS[3].scenarioId,
    moveName: 'Snarl',
    selectionKind: 'cone',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: SPARK_REG_026_SCENARIOS[0].scenarioId,
    moveName: 'Spark',
    randomValues: [0.7, 0, 0],
    expectedConditions: paralyzedA,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: SPARK_REG_026_SCENARIOS[1].scenarioId,
    moveName: 'Spark',
    randomValues: [0.65, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: SPARK_REG_026_SCENARIOS[2].scenarioId,
    moveName: 'Spark',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: SPARK_REG_026_SCENARIOS[3].scenarioId,
    moveName: 'Spark',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedConditions: paralyzedA,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: SPARK_REG_026_SCENARIOS[4].scenarioId,
    moveName: 'Spark',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ground'] } },
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Electric immunity'],
  },
  {
    scenarioId: SPARK_REG_026_SCENARIOS[5].scenarioId,
    moveName: 'Spark',
    targetProfiles: { [TARGET_A_ID]: { types: ['Electric'] } },
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Electric type'],
  },
  {
    scenarioId: SPARK_REG_026_SCENARIOS[6].scenarioId,
    moveName: 'Spark',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: SPIRIT_BREAK_REG_026_SCENARIOS[0].scenarioId,
    moveName: 'Spirit Break',
    randomValues: [0.45, 0, 0],
    expectedStages: specialAttackDropA,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: SPIRIT_BREAK_REG_026_SCENARIOS[1].scenarioId,
    moveName: 'Spirit Break',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: SPIRIT_BREAK_REG_026_SCENARIOS[2].scenarioId,
    moveName: 'Spirit Break',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: specialAttackDropA,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: SPIRIT_BREAK_REG_026_SCENARIOS[3].scenarioId,
    moveName: 'Spirit Break',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: SPORE_REG_026_SCENARIOS[0].scenarioId,
    moveName: 'Spore',
    randomValues: [],
    expectedConditions: sleepingA,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: SPORE_REG_026_SCENARIOS[1].scenarioId,
    moveName: 'Spore',
    targetProfiles: { [TARGET_A_ID]: { types: ['Grass'] } },
    randomValues: [],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedLogFragments: ['Grass type (Powder)'],
  },
  {
    scenarioId: SPORE_REG_026_SCENARIOS[2].scenarioId,
    moveName: 'Spore',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Sweet Veil'] } },
    randomValues: [],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedLogFragments: ['Sweet Veil'],
  },
  {
    scenarioId: SPORE_REG_026_SCENARIOS[3].scenarioId,
    moveName: 'Spore',
    electricTerrain: true,
    randomValues: [],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedLogFragments: ['Electric Terrain'],
  },
  {
    scenarioId: STEAM_ERUPTION_REG_026_SCENARIOS[0].scenarioId,
    moveName: 'Steam Eruption',
    selectionKind: 'close-blast',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    randomValues: [
      0.7, 0, 0, 0,
      0, 0, 0, 0,
      0.65, 0, 0, 0,
    ],
    expectedConditions: burnedA,
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedHitTargetIds: [TARGET_A_ID, TARGET_C_ID],
    expectedDamagedTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedAccuracyNaturalResults: [15, 1, 14],
    expectedSmiteMissTargetIds: [TARGET_B_ID],
  },
  {
    scenarioId: STEAM_ERUPTION_REG_026_SCENARIOS[1].scenarioId,
    moveName: 'Steam Eruption',
    selectionKind: 'close-blast',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedConditions: burnedA,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: STEAM_ERUPTION_REG_026_SCENARIOS[2].scenarioId,
    moveName: 'Steam Eruption',
    selectionKind: 'close-blast',
    targetProfiles: { [TARGET_A_ID]: { types: ['Fire'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Fire type'],
  },
  {
    scenarioId: STEAM_ERUPTION_REG_026_SCENARIOS[3].scenarioId,
    moveName: 'Steam Eruption',
    selectionKind: 'close-blast',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
]

const recoveryScenarioFor = (moveName: RegisteredBatch026MoveName): ExecutionScenario => {
  const matching = normalScenarios.find(scenario => (
    scenario.moveName === moveName
    && scenario.expectedHitTargetIds.includes(TARGET_A_ID)
    && (
      scenario.expectedDamagedTargetIds.includes(TARGET_A_ID)
      || Object.hasOwn(scenario.expectedConditions ?? {}, TARGET_A_ID)
      || (scenario.expectedStages ?? []).some(stage => stage.recipientId === TARGET_A_ID)
    )
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

describe('REG-026 registered move conformance', () => {
  it('certifies exactly Sludge Wave through Steam Eruption with linked evidence', () => {
    expect(Object.keys(REG_026_SCENARIOS_BY_MOVE)).toEqual([...REG_026_MOVE_NAMES])
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)

    for (const [canonicalId, scenarios] of Object.entries(REG_026_SCENARIOS_BY_MOVE)) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === canonicalId)
      expect(row, canonicalId).toMatchObject({
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: '2026-07-19',
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
      'Sludge Wave': { version: 1, ac: 2, damageBase: 10, damageClass: 'Special', range: 'Burst 1 or Close Blast 2' },
      'Smart Strike': { version: 1, ac: null, damageBase: 7, damageClass: 'Physical', range: 'Melee, 1 Target', requiresAccuracy: false },
      Smog: { version: 1, ac: 7, damageBase: 3, damageClass: 'Special', range: 'Line 2' },
      Snarl: { version: 1, ac: 3, damageBase: 6, damageClass: 'Special', range: 'Cone 2, Sonic' },
      Spark: { version: 1, ac: 2, damageBase: 6, damageClass: 'Physical', range: 'Melee, 1 Target, Dash' },
      'Spirit Break': { version: 1, ac: 2, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target' },
      Spore: { version: 2, ac: null, damageBase: null, damageClass: 'Status', range: '4, 1 Target, Powder', requiresAccuracy: false },
      'Steam Eruption': { version: 1, ac: 3, damageBase: 11, damageClass: 'Special', range: 'Close Blast 3, Smite' },
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

    expect(explicitScriptForMove('Sludge Wave')).toMatchObject({
      areaTemplates: [
        { kind: 'burst', size: 1 },
        { kind: 'close-blast', size: 2 },
      ],
      conditionSuggestions: [{ condition: 'Poisoned', threshold: '19+' }],
    })
    expect(explicitScriptForMove('Smart Strike')).toMatchObject({
      requiresAccuracy: false,
      conditionSuggestions: [],
      stageSuggestions: [],
    })
    expect(explicitScriptForMove('Smog')).toMatchObject({
      areaTemplates: [{ kind: 'line', size: 2 }],
      conditionSuggestions: [{ condition: 'Poisoned', threshold: 'even roll' }],
    })
    expect(explicitScriptForMove('Snarl')).toMatchObject({
      keywords: expect.arrayContaining(['Sonic']),
      areaTemplates: [{ kind: 'cone', size: 2 }],
      stageSuggestions: [{ recipient: 'target', key: 'satk', delta: -1 }],
    })
    expect(explicitScriptForMove('Spark')).toMatchObject({
      keywords: expect.arrayContaining(['Dash']),
      conditionSuggestions: [{ condition: 'Paralysis', threshold: '15+' }],
    })
    expect(explicitScriptForMove('Spirit Break')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'satk',
      delta: -1,
      label: 'Spirit Break lowers Special Attack: -1 Special Attack CS',
    }])
    expect(explicitScriptForMove('Spore')).toMatchObject({
      requiresAccuracy: false,
      keywords: expect.arrayContaining(['Powder']),
      conditionSuggestions: [{ recipient: 'target', condition: 'Sleep' }],
    })
    expect(explicitScriptForMove('Steam Eruption')).toMatchObject({
      keywords: expect.arrayContaining(['Smite']),
      areaTemplates: [{ kind: 'close-blast', size: 3 }],
      conditionSuggestions: [{ condition: 'Burned', threshold: '15+' }],
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
        idFactory: () => 'reg-026-direct-id',
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
        idFactory: () => 'reg-026-plan-id',
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

  it('executes Spore as an automatic no-roll Powder status move', async () => {
    const scenario = recoveryScenarioFor('Spore')
    const directFixture = fixtureFor(scenario)
    const direct = resolveAuthoritativeMove({
      ...directFixture,
      random: () => { throw new Error('Spore must not draw RNG') },
      now: () => NOW,
    })
    expect(direct.rollLedger).toEqual([])
    expect(direct.transaction).toMatchObject({
      attackedTargetIds: [TARGET_A_ID],
      hitTargetIds: [TARGET_A_ID],
      conditionUpdates: [{ id: TARGET_A_ID, conditions: ['Sleep'] }],
    })

    const plannerFixture = fixtureFor(scenario)
    const plan = planAuthoritativeMoveState({
      ...plannerFixture,
      random: () => { throw new Error('Spore planner must not draw RNG') },
      now: () => NOW,
      operationId: 'op_spore_no_roll_plan',
    })
    expect(plan.resolution.rollLedger).toEqual([])

    const commandFixture = fixtureFor(scenario)
    const harness = openHarness(commandFixture)
    const command = commandFor(commandFixture, 'spore-no-roll-command')
    const response = await executeCommand(harness, command, {
      random: () => { throw new Error('Spore command must not draw RNG') },
    })
    expect(response.result.ok).toBe(true)
    expect(response.move?.rollLedger).toEqual([])
  })

  it('rejects Spark while Stuck before rolls, costs, or effects', async () => {
    const scenario: ExecutionScenario = {
      ...recoveryScenarioFor('Spark'),
      scenarioId: SPARK_REG_026_SCENARIOS[7].scenarioId,
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
    expect(harness.events).toEqual([])
  })

  it.each(REG_026_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_026_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_026_MOVE_NAMES)(
    'rejects stale %s state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_026_SCENARIOS_BY_MOVE[moveName]
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

  it('keeps every REG-026 definition on the audited v1 adapter', () => {
    for (const moveName of LEGACY_MOVE_NAMES) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'legacy-v1',
        version: runtimeVersionFor(moveName),
      })
    }
  })
})
