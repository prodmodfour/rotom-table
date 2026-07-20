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
  REG_025_MOVE_NAMES,
  REG_025_SCENARIOS_BY_MOVE,
  SHADOW_PUNCH_REG_025_SCENARIOS,
  SHADOW_SNEAK_REG_025_SCENARIOS,
  SHOCK_WAVE_REG_025_SCENARIOS,
  SIGNAL_BEAM_REG_025_SCENARIOS,
  SLASH_REG_025_SCENARIOS,
  SLEEP_POWDER_REG_025_SCENARIOS,
  SLUDGE_BOMB_REG_025_SCENARIOS,
  SLUDGE_REG_025_SCENARIOS,
  type RegisteredBatch025MoveName,
  type RegisteredMoveConformanceScenario,
} from '../fixtures/moveAutomation/registeredBatch025'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const NOW = 5_000

const LEGACY_MOVE_NAMES = REG_025_MOVE_NAMES

type TargetId = typeof TARGET_A_ID | typeof TARGET_B_ID
type SelectionKind = 'single-target' | 'pass'

interface TokenProfile {
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly conditions?: readonly string[]
}

interface MovementExpectation {
  readonly destination: { readonly x: number; readonly y: number; readonly z: number }
  readonly pathCells: readonly { readonly x: number; readonly y: number; readonly z: number }[]
}

interface ExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch025MoveName
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TokenProfile>>>
  readonly actedThisRound?: boolean
  readonly randomValues: readonly number[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedMovement?: MovementExpectation
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
  readonly moves?: readonly CharacterSheetMove[]
  readonly profile?: TokenProfile
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.slug === 'actor' ? 'Mew' : 'Clefairy',
  level: 20,
  revision: 3,
  types: [...(options.profile?.types ?? ['Psychic'])],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
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
  combat: {
    currentHp: 500,
    conditions: [...(options.profile?.conditions ?? [])],
  },
})

const targetPosition = (
  selectionKind: SelectionKind,
  id: TargetId,
): { readonly x: number; readonly y: number; readonly z: number } => {
  if (selectionKind === 'pass') {
    return id === TARGET_A_ID
      ? { x: 2, y: 0, z: 1 }
      : { x: 3, y: 0, z: 1 }
  }
  return id === TARGET_A_ID
    ? { x: 6, y: 0, z: 5 }
    : { x: 5, y: 0, z: 4 }
}

const actorPosition = (selectionKind: SelectionKind) => selectionKind === 'pass'
  ? { x: 1, y: 0, z: 1 }
  : { x: 5, y: 0, z: 5 }

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const selectionKind = scenario.selectionKind ?? 'single-target'
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-025-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-025 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', actorPosition(selectionKind)),
      ...targetIds.map(id => placement(id, id, targetPosition(selectionKind, id))),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-025 scene', startedAt: 100 },
    encounterState: {
      ...emptyState,
      history: {
        ...emptyState.history,
        actedThisRoundPlacementIds: scenario.actedThisRound ? [ACTOR_ID] : [],
      },
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
    moves: [{ name: scenario.moveName }],
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    profile: scenario.targetProfiles?.[id],
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
  expect(resolution.transaction.attackedTargetIds).not.toContain(ACTOR_ID)
  expect(resolution.transaction.hpUpdates.map(update => update.id).sort())
    .toEqual([...scenario.expectedDamagedTargetIds].sort())
  for (const update of resolution.transaction.hpUpdates) expect(update.currentHp).toBeLessThan(500)
  expect(resolution.transaction.combatStageUpdates).toEqual([])
  expect(conditionUpdatesByTarget(resolution.transaction))
    .toEqual(scenario.expectedConditions ?? {})
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  const selectionKind = scenario.selectionKind ?? 'single-target'
  if (selectionKind === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(scenario.expectedAttackedTargetIds)
    expect(resolution.area?.direction).toBe('east')
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

  const searchableEvidence = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(searchableEvidence.toLowerCase()).toContain('critical')
  }
  assertReviewedNativeEvidenceFragments(searchableEvidence, scenario.expectedLogFragments ?? [])

  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort())
    .toEqual([...new Set(['actor', ...(scenario.targetIds ?? [TARGET_A_ID])])].sort())
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
  clientId: 'reg-025-client',
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
    return () => `reg-025-id-${++sequence}`
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
const PASS_MOVEMENT = { destination: PASS_DESTINATION, pathCells: PASS_PATH } as const
const confused = { [TARGET_A_ID]: ['Confused'] } as const
const sleeping = { [TARGET_A_ID]: ['Sleep'] } as const
const poisoned = { [TARGET_A_ID]: ['Poisoned'] } as const

const poisonScenarios = (options: {
  readonly moveName: 'Sludge' | 'Sludge Bomb'
  readonly evidence: readonly RegisteredMoveConformanceScenario[]
}): readonly ExecutionScenario[] => [
  {
    scenarioId: options.evidence[0]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.7, 0, 0, 0, 0],
    expectedConditions: poisoned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: options.evidence[1]!.scenarioId,
    moveName: options.moveName,
    randomValues: [0.65, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
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
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedConditions: poisoned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: options.evidence[4]!.scenarioId,
    moveName: options.moveName,
    targetProfiles: { [TARGET_A_ID]: { types: ['Steel'] } },
    randomValues: [0.7],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Steel type'],
  },
  {
    scenarioId: options.evidence[5]!.scenarioId,
    moveName: options.moveName,
    targetProfiles: { [TARGET_A_ID]: { types: ['Poison'] } },
    randomValues: [0.7, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Poison type'],
  },
  {
    scenarioId: options.evidence[6]!.scenarioId,
    moveName: options.moveName,
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
]

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: SHADOW_PUNCH_REG_025_SCENARIOS[0].scenarioId,
    moveName: 'Shadow Punch',
    randomValues: [0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: SHADOW_PUNCH_REG_025_SCENARIOS[1].scenarioId,
    moveName: 'Shadow Punch',
    targetProfiles: { [TARGET_A_ID]: { types: ['Normal'] } },
    randomValues: [],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedLogFragments: ['Ghost immunity'],
  },
  {
    scenarioId: SHADOW_SNEAK_REG_025_SCENARIOS[0].scenarioId,
    moveName: 'Shadow Sneak',
    randomValues: [0.45, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: SHADOW_SNEAK_REG_025_SCENARIOS[1].scenarioId,
    moveName: 'Shadow Sneak',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: SHADOW_SNEAK_REG_025_SCENARIOS[2].scenarioId,
    moveName: 'Shadow Sneak',
    randomValues: [0.999, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: SHADOW_SNEAK_REG_025_SCENARIOS[3].scenarioId,
    moveName: 'Shadow Sneak',
    targetProfiles: { [TARGET_A_ID]: { types: ['Normal'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Ghost immunity'],
  },
  {
    scenarioId: SHOCK_WAVE_REG_025_SCENARIOS[0].scenarioId,
    moveName: 'Shock Wave',
    randomValues: [0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: SHOCK_WAVE_REG_025_SCENARIOS[1].scenarioId,
    moveName: 'Shock Wave',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ground'] } },
    randomValues: [],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedLogFragments: ['Electric immunity'],
  },
  {
    scenarioId: SIGNAL_BEAM_REG_025_SCENARIOS[0].scenarioId,
    moveName: 'Signal Beam',
    randomValues: [0.9, 0, 0, 0, 0],
    expectedConditions: confused,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
  },
  {
    scenarioId: SIGNAL_BEAM_REG_025_SCENARIOS[1].scenarioId,
    moveName: 'Signal Beam',
    randomValues: [0.85, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: SIGNAL_BEAM_REG_025_SCENARIOS[2].scenarioId,
    moveName: 'Signal Beam',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: SIGNAL_BEAM_REG_025_SCENARIOS[3].scenarioId,
    moveName: 'Signal Beam',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedConditions: confused,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: SIGNAL_BEAM_REG_025_SCENARIOS[4].scenarioId,
    moveName: 'Signal Beam',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.9, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: SLASH_REG_025_SCENARIOS[0].scenarioId,
    moveName: 'Slash',
    selectionKind: 'pass',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
    expectedMovement: PASS_MOVEMENT,
  },
  {
    scenarioId: SLASH_REG_025_SCENARIOS[1].scenarioId,
    moveName: 'Slash',
    selectionKind: 'pass',
    randomValues: [0.85, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
    expectedCriticalTargetIds: [TARGET_A_ID],
    expectedMovement: PASS_MOVEMENT,
  },
  {
    scenarioId: SLASH_REG_025_SCENARIOS[2].scenarioId,
    moveName: 'Slash',
    selectionKind: 'pass',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ghost'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedMovement: PASS_MOVEMENT,
    expectedLogFragments: ['Normal immunity'],
  },
  {
    scenarioId: SLASH_REG_025_SCENARIOS[3].scenarioId,
    moveName: 'Slash',
    selectionKind: 'pass',
    targetIds: [],
    randomValues: [],
    expectedAttackedTargetIds: [],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedMovement: PASS_MOVEMENT,
  },
  {
    scenarioId: SLEEP_POWDER_REG_025_SCENARIOS[0].scenarioId,
    moveName: 'Sleep Powder',
    randomValues: [0.45],
    expectedConditions: sleeping,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: SLEEP_POWDER_REG_025_SCENARIOS[1].scenarioId,
    moveName: 'Sleep Powder',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: SLEEP_POWDER_REG_025_SCENARIOS[2].scenarioId,
    moveName: 'Sleep Powder',
    targetProfiles: { [TARGET_A_ID]: { types: ['Grass'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Grass type (Powder)'],
  },
  {
    scenarioId: SLEEP_POWDER_REG_025_SCENARIOS[3].scenarioId,
    moveName: 'Sleep Powder',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Sweet Veil'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Sweet Veil'],
  },
  ...poisonScenarios({
    moveName: 'Sludge',
    evidence: SLUDGE_REG_025_SCENARIOS,
  }),
  ...poisonScenarios({
    moveName: 'Sludge Bomb',
    evidence: SLUDGE_BOMB_REG_025_SCENARIOS,
  }),
]

const recoveryScenarioFor = (moveName: RegisteredBatch025MoveName): ExecutionScenario => {
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

const normalizedEvidence = (
  scenarios: readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[],
): readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[] => scenarios
  .map(scenario => ({
    scenarioId: scenario.scenarioId,
    evidenceClasses: [...scenario.evidenceClasses].sort(),
  }))
  .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

describe('REG-025 registered move conformance', () => {
  it('certifies exactly Shadow Punch through Sludge Bomb with linked evidence', () => {
    expect(Object.keys(REG_025_SCENARIOS_BY_MOVE)).toEqual([...REG_025_MOVE_NAMES])
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)

    for (const [canonicalId, scenarios] of Object.entries(REG_025_SCENARIOS_BY_MOVE)) {
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
      'Shadow Punch': { ac: null, damageBase: 6, damageClass: 'Physical', range: '6, 1 Target', requiresAccuracy: false },
      'Shadow Sneak': { ac: 2, damageBase: 4, damageClass: 'Physical', range: 'Melee, 1 Target, Priority' },
      'Shock Wave': { ac: null, damageBase: 6, damageClass: 'Special', range: '6, 1 Target', requiresAccuracy: false, special: 'Grants Zapper' },
      'Signal Beam': { ac: 2, damageBase: 8, damageClass: 'Special', range: '6, 1 Target' },
      Slash: { ac: 2, damageBase: 7, damageClass: 'Physical', range: 'Melee, Pass', criticalRange: 18 },
      'Sleep Powder': { ac: 6, damageBase: 0, damageClass: 'Status', range: '4, 1 Target, Powder' },
      Sludge: { ac: 2, damageBase: 7, damageClass: 'Special', range: '6, 1 Target' },
      'Sludge Bomb': { ac: 2, damageBase: 9, damageClass: 'Special', range: '8, 1 Target' },
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

    expect(explicitScriptForMove('Shadow Sneak')?.keywords).toContain('Priority')
    expect(explicitScriptForMove('Shock Wave')).toMatchObject({
      requiresAccuracy: false,
      special: 'Grants Zapper',
      conditionSuggestions: [],
      stageSuggestions: [],
    })
    expect(resolveMoveGrantedCapabilities([{ name: 'Shock Wave' }]).other).toEqual(['Zapper'])
    expect(explicitScriptForMove('Signal Beam')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Confused',
      action: 'add',
      label: 'Confused on 19+',
      threshold: '19+',
      optional: true,
    }])
    expect(explicitScriptForMove('Slash')).toMatchObject({
      criticalRange: 18,
      areaTemplates: [{ kind: 'pass', size: 4, label: 'Pass 4' }],
    })
    expect(explicitScriptForMove('Sleep Powder')).toMatchObject({
      keywords: expect.arrayContaining(['Powder']),
      conditionSuggestions: [{
        recipient: 'target',
        condition: 'Sleep',
        action: 'add',
        optional: false,
      }],
    })
    for (const moveName of ['Sludge', 'Sludge Bomb']) {
      expect(explicitScriptForMove(moveName)?.conditionSuggestions, moveName).toEqual([{
        recipient: 'target',
        condition: 'Poisoned',
        action: 'add',
        label: 'Poisoned on 15+',
        threshold: '15+',
        optional: true,
      }])
    }
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
        idFactory: () => 'reg-025-direct-id',
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
        idFactory: () => 'reg-025-plan-id',
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
      if (scenario.expectedMovement) {
        expect(persistedMap?.placements.find(item => item.id === ACTOR_ID)?.position)
          .toEqual(scenario.expectedMovement.destination)
        expect(persistedMap?.encounterState?.turnResources[ACTOR_ID]).toMatchObject({
          actions: { shift: { spent: 1 } },
          movement: { spent: scenario.expectedMovement.pathCells.length },
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

  it('rejects Shadow Sneak Priority after the actor has acted without partial mutation', async () => {
    const scenario: ExecutionScenario = {
      ...recoveryScenarioFor('Shadow Sneak'),
      scenarioId: SHADOW_SNEAK_REG_025_SCENARIOS[4].scenarioId,
      actedThisRound: true,
    }
    const fixture = fixtureFor(scenario)
    const snapshot = deepCloneJson({ map: fixture.map, sheets: [...fixture.pokemonSheets] })

    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: randomSequence(scenario.randomValues),
      now: () => NOW,
      operationId: `op_${scenario.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
    })).toThrowError(expect.objectContaining({
      code: 'move-resource-unavailable',
      message: expect.stringContaining('priority-unavailable'),
    }))
    expect({ map: fixture.map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)

    const harness = openHarness(fixture)
    const command = commandFor(fixture, `${scenario.scenarioId}.command`)
    const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const sheetsBefore = deepCloneJson(harness.sheets.list())
    const response = await executeCommand(harness, command, {
      random: randomSequence(scenario.randomValues),
    })
    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('priority-unavailable'),
    })
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(mapBefore)
    expect(harness.sheets.list()).toEqual(sheetsBefore)
    expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toEqual(response.result)
    expect(harness.events).toEqual([])
  })

  it.each(REG_025_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_025_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_025_MOVE_NAMES)(
    'rejects stale %s state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_025_SCENARIOS_BY_MOVE[moveName]
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

  it('keeps every REG-025 definition on the audited v1 adapter', () => {
    for (const moveName of LEGACY_MOVE_NAMES) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        version: 2,
      })
    }
  })
})
