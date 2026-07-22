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
  MOONBLAST_REG_017_SCENARIOS,
  MOUNTAIN_GALE_REG_017_SCENARIOS,
  MUD_BOMB_REG_017_SCENARIOS,
  MUD_SHOT_REG_017_SCENARIOS,
  MUD_SLAP_REG_017_SCENARIOS,
  MUD_SPORT_REG_017_SCENARIOS,
  MYSTICAL_FIRE_REG_017_SCENARIOS,
  NEEDLE_ARM_REG_017_SCENARIOS,
  REG_017_MOVE_NAMES,
  REG_017_SCENARIOS_BY_MOVE,
  type RegisteredBatch017MoveName,
} from '../fixtures/moveAutomation/registeredBatch017'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const NOW = 5_000
const ELECTRIC_RESISTANT_COAT = 'Electric-Resistant Coat'

type TargetId = typeof TARGET_A_ID | typeof TARGET_B_ID | typeof TARGET_C_ID
type SelectionKind = 'single-target' | 'burst'

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
  readonly moveName: RegisteredBatch017MoveName
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly outsideTargetIds?: readonly TargetId[]
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TokenProfile>>>
  readonly targetMoves?: Readonly<Partial<Record<TargetId, readonly CharacterSheetMove[]>>>
  readonly initialStages?: readonly StageExpectation[]
  readonly randomValues: readonly number[]
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedAreaCandidateTargetIds?: readonly string[]
  readonly expectedReadTargetIds?: readonly string[]
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
  sideId: id === ACTOR_ID || id === TARGET_B_ID ? 'heroes' : 'foes',
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
  species: options.slug === 'actor' ? 'Audino' : 'Clefairy',
  level: 20,
  revision: 3,
  types: [...(options.profile?.types ?? ['Normal'])],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  capabilities: { overland: 6 },
  movelist: [...(options.moves ?? [])],
  ...stageMap(options.profile?.abilities?.includes('Flash Fire')
    ? [
        ...(options.initialStages ?? []),
        { recipientId: options.placementId, key: 'atk', value: 6 },
        { recipientId: options.placementId, key: 'satk', value: 6 },
      ]
    : options.initialStages, options.placementId),
  combat: {
    currentHp: 500,
    conditions: [...(options.profile?.conditions ?? [])],
  },
})

const targetPosition = (
  selectionKind: SelectionKind,
  id: TargetId,
  outsideArea: boolean,
): { readonly x: number; readonly y: number; readonly z: number } => {
  if (selectionKind === 'burst') {
    if (outsideArea) return { x: 5, y: 0, z: 3 }
    if (id === TARGET_A_ID) return { x: 3, y: 0, z: 3 }
    return { x: 2, y: 0, z: 5 }
  }
  return { x: 3, y: 0, z: 3 }
}

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const selectionKind = scenario.selectionKind ?? 'single-target'
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-017-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-017 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 2, y: 0, z: 3 }),
      ...targetIds.map(id => placement(
        id,
        id,
        targetPosition(selectionKind, id, scenario.outsideTargetIds?.includes(id) ?? false),
      )),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-017 scene', startedAt: 100 },
    encounterState: {
      ...emptyState,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
      history: emptyState.history,
    },
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
    moves: scenario.targetMoves?.[id],
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
    candidateScopePlacementIds: scenario.expectedAreaCandidateTargetIds ?? targetIds,
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

  if ((scenario.selectionKind ?? 'single-target') === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(
      scenario.expectedAreaCandidateTargetIds ?? scenario.expectedAttackedTargetIds,
    )
    expect(resolution.area?.excludedTargetIds).toEqual([])
  }

  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(JSON.stringify(resolution.auditTrace.events)).toContain('"critical":true')
  }

  const searchableEvidence = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  assertReviewedNativeEvidenceFragments(searchableEvidence, scenario.expectedLogFragments ?? [])

  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
  const expectedReadTargetIds = scenario.expectedReadTargetIds
    ?? scenario.targetIds
    ?? [TARGET_A_ID]
  expect(resolution.sheetReads.map(read => read.slug).sort()).toEqual(
    ['actor', ...expectedReadTargetIds].sort(),
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
  clientId: 'reg-017-client',
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
    return () => `reg-017-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: MOONBLAST_REG_017_SCENARIOS[0].scenarioId,
    moveName: 'Moonblast',
    randomValues: [0.7, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: MOONBLAST_REG_017_SCENARIOS[1].scenarioId,
    moveName: 'Moonblast',
    randomValues: [0.65, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: MOONBLAST_REG_017_SCENARIOS[2].scenarioId,
    moveName: 'Moonblast',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: MOONBLAST_REG_017_SCENARIOS[3].scenarioId,
    moveName: 'Moonblast',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: MOONBLAST_REG_017_SCENARIOS[4].scenarioId,
    moveName: 'Moonblast',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: MOONBLAST_REG_017_SCENARIOS[5].scenarioId,
    moveName: 'Moonblast',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    randomValues: [0.7, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: MOUNTAIN_GALE_REG_017_SCENARIOS[0].scenarioId,
    moveName: 'Mountain Gale',
    randomValues: [0.7, 0, 0, 0],
    expectedConditions: { [TARGET_A_ID]: ['Flinch', 'Vulnerable'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: MOUNTAIN_GALE_REG_017_SCENARIOS[1].scenarioId,
    moveName: 'Mountain Gale',
    randomValues: [0.65, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: MOUNTAIN_GALE_REG_017_SCENARIOS[2].scenarioId,
    moveName: 'Mountain Gale',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: MOUNTAIN_GALE_REG_017_SCENARIOS[3].scenarioId,
    moveName: 'Mountain Gale',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedConditions: { [TARGET_A_ID]: ['Flinch', 'Vulnerable'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: MOUNTAIN_GALE_REG_017_SCENARIOS[4].scenarioId,
    moveName: 'Mountain Gale',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: MUD_BOMB_REG_017_SCENARIOS[0].scenarioId,
    moveName: 'Mud Bomb',
    randomValues: [0.75, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: MUD_BOMB_REG_017_SCENARIOS[1].scenarioId,
    moveName: 'Mud Bomb',
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: MUD_BOMB_REG_017_SCENARIOS[2].scenarioId,
    moveName: 'Mud Bomb',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: MUD_BOMB_REG_017_SCENARIOS[3].scenarioId,
    moveName: 'Mud Bomb',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: MUD_BOMB_REG_017_SCENARIOS[4].scenarioId,
    moveName: 'Mud Bomb',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Keen Eye'] } },
    randomValues: [0.75, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
    expectedLogFragments: ['Keen Eye'],
  },
  {
    scenarioId: MUD_BOMB_REG_017_SCENARIOS[5].scenarioId,
    moveName: 'Mud Bomb',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -6 }],
    randomValues: [0.75, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: MUD_SHOT_REG_017_SCENARIOS[0].scenarioId,
    moveName: 'Mud Shot',
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: MUD_SHOT_REG_017_SCENARIOS[1].scenarioId,
    moveName: 'Mud Shot',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: MUD_SHOT_REG_017_SCENARIOS[2].scenarioId,
    moveName: 'Mud Shot',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: MUD_SHOT_REG_017_SCENARIOS[3].scenarioId,
    moveName: 'Mud Shot',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -6 }],
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'spd', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: MUD_SPORT_REG_017_SCENARIOS[0].scenarioId,
    moveName: 'Mud Sport',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    outsideTargetIds: [TARGET_C_ID],
    targetMoves: {
      [TARGET_C_ID]: [{ name: 'Thunder Shock' }, { name: 'Bolt Strike' }],
    },
    randomValues: [],
    expectedConditions: {
      [ACTOR_ID]: [ELECTRIC_RESISTANT_COAT],
      [TARGET_A_ID]: [ELECTRIC_RESISTANT_COAT],
      [TARGET_B_ID]: [ELECTRIC_RESISTANT_COAT],
    },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedReadTargetIds: [TARGET_A_ID, TARGET_B_ID],
  },
  {
    scenarioId: MUD_SLAP_REG_017_SCENARIOS[0].scenarioId,
    moveName: 'Mud-Slap',
    randomValues: [0.45, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: MUD_SLAP_REG_017_SCENARIOS[1].scenarioId,
    moveName: 'Mud-Slap',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: MUD_SLAP_REG_017_SCENARIOS[2].scenarioId,
    moveName: 'Mud-Slap',
    randomValues: [0.999, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: MUD_SLAP_REG_017_SCENARIOS[3].scenarioId,
    moveName: 'Mud-Slap',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Keen Eye'] } },
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Keen Eye'],
  },
  {
    scenarioId: MUD_SLAP_REG_017_SCENARIOS[4].scenarioId,
    moveName: 'Mud-Slap',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -6 }],
    randomValues: [0.45, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: MYSTICAL_FIRE_REG_017_SCENARIOS[0].scenarioId,
    moveName: 'Mystical Fire',
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: MYSTICAL_FIRE_REG_017_SCENARIOS[1].scenarioId,
    moveName: 'Mystical Fire',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: MYSTICAL_FIRE_REG_017_SCENARIOS[2].scenarioId,
    moveName: 'Mystical Fire',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: MYSTICAL_FIRE_REG_017_SCENARIOS[3].scenarioId,
    moveName: 'Mystical Fire',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Flash Fire'] } },
    randomValues: [0.45, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Fire immunity'],
  },
  {
    scenarioId: MYSTICAL_FIRE_REG_017_SCENARIOS[4].scenarioId,
    moveName: 'Mystical Fire',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: NEEDLE_ARM_REG_017_SCENARIOS[0].scenarioId,
    moveName: 'Needle Arm',
    randomValues: [0.7, 0, 0],
    expectedConditions: { [TARGET_A_ID]: ['Flinch', 'Vulnerable'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: NEEDLE_ARM_REG_017_SCENARIOS[1].scenarioId,
    moveName: 'Needle Arm',
    randomValues: [0.65, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: NEEDLE_ARM_REG_017_SCENARIOS[2].scenarioId,
    moveName: 'Needle Arm',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: NEEDLE_ARM_REG_017_SCENARIOS[3].scenarioId,
    moveName: 'Needle Arm',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedConditions: { [TARGET_A_ID]: ['Flinch', 'Vulnerable'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: NEEDLE_ARM_REG_017_SCENARIOS[4].scenarioId,
    moveName: 'Needle Arm',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Sap Sipper'] } },
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Grass immunity'],
  },
  {
    scenarioId: NEEDLE_ARM_REG_017_SCENARIOS[5].scenarioId,
    moveName: 'Needle Arm',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
]

const recoveryScenarioFor = (moveName: RegisteredBatch017MoveName): ExecutionScenario => {
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

const storedPokemonSheet = (
  harness: CommandHarness,
  slug: string,
): CharacterSheet => {
  const stored = harness.sheets.getByRef('pokemon', slug)
  if (!stored) throw new Error(`Missing stored Pokémon sheet ${slug}.`)
  return stored.sheet as unknown as CharacterSheet
}

const storedConditions = (
  harness: CommandHarness,
  slug: string,
): readonly string[] => storedPokemonSheet(harness, slug).combat?.conditions ?? []

const persistedFollowUpFixture = (
  harness: CommandHarness,
  mapSlug: string,
  moveName: 'Thunder Shock' | 'Bolt Strike',
): MoveFixture => {
  const map = harness.maps.getBySlug(mapSlug)
  if (!map) throw new Error('Missing persisted REG-017 map.')
  return {
    map,
    pokemonSheets: new Map<string, CharacterSheet>(),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: TARGET_C_ID,
      moveName,
      selection: { kind: 'single-target', targetPlacementId: TARGET_A_ID },
    },
    candidateScopePlacementIds: [TARGET_A_ID],
  }
}

const applyAcceptedMudSport = async (options: {
  readonly operationId: string
  readonly targetAProfile?: TokenProfile
}): Promise<{
  readonly harness: CommandHarness
  readonly mapSlug: string
  readonly response: LivePlayResolveMoveCommandResponse
}> => {
  const base = recoveryScenarioFor('Mud Sport')
  const scenario: ExecutionScenario = {
    ...base,
    targetProfiles: {
      ...base.targetProfiles,
      ...(options.targetAProfile ? { [TARGET_A_ID]: options.targetAProfile } : {}),
    },
  }
  const fixture = fixtureFor(scenario)
  const harness = openHarness(fixture)
  const command = commandFor(fixture, options.operationId)
  const response = await executeCommand(harness, command, { random: randomSequence([]) })
  expect(response.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
  expect(storedConditions(harness, 'actor')).toEqual([ELECTRIC_RESISTANT_COAT])
  expect(storedConditions(harness, TARGET_A_ID)).toEqual([ELECTRIC_RESISTANT_COAT])
  expect(storedConditions(harness, TARGET_B_ID)).toEqual([ELECTRIC_RESISTANT_COAT])
  expect(storedConditions(harness, TARGET_C_ID)).toEqual([])
  return { harness, mapSlug: fixture.map.slug, response }
}

describe('REG-017 registered move conformance', () => {
  it('certifies exactly Moonblast through Needle Arm with linked evidence', () => {
    expect(Object.keys(REG_017_SCENARIOS_BY_MOVE)).toEqual([...REG_017_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_017_SCENARIOS_BY_MOVE)) {
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
      Moonblast: { ac: 2, damageBase: 10, damageClass: 'Special', range: '6, 1 Target' },
      'Mountain Gale': { ac: 5, damageBase: 10, damageClass: 'Physical', range: '5, 1 Target' },
      'Mud Bomb': { ac: 4, damageBase: 7, damageClass: 'Special', range: '6, 1 Target' },
      'Mud Shot': { ac: 3, damageBase: 6, damageClass: 'Special', range: '3, 1 Target' },
      'Mud Sport': { ac: null, damageBase: 0, damageClass: 'Status', range: 'Burst 2', requiresAccuracy: false },
      'Mud-Slap': { ac: 2, damageBase: 2, damageClass: 'Special', range: '3, 1 Target' },
      'Mystical Fire': { ac: 2, damageBase: 7, damageClass: 'Special', range: '6, 1 Target' },
      'Needle Arm': { ac: 2, damageBase: 6, damageClass: 'Physical', range: 'Melee, 1 Target' },
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

    expect(explicitScriptForMove('Moonblast')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'satk',
      delta: -1,
      label: 'Moonblast lowers Special Attack on 15+: -1 Special Attack CS',
      threshold: '15+',
      optional: true,
    }])
    expect(explicitScriptForMove('Mountain Gale')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Flinch',
      action: 'add',
      label: 'Flinch on 15+',
      threshold: '15+',
      optional: true,
    }])
    expect(explicitScriptForMove('Mud Bomb')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'acc',
      delta: -1,
      label: 'Mud Bomb lowers Accuracy on 16+: -1 Accuracy CS',
      threshold: '16+',
      optional: true,
    }])
    expect(explicitScriptForMove('Mud Shot')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'spd',
      delta: -1,
      label: 'Mud Shot lowers Speed: -1 Speed CS',
    }])
    expect(explicitScriptForMove('Mud Sport')).toMatchObject({
      areaTemplates: [{ kind: 'burst', size: 2, label: 'Burst 2' }],
      conditionSuggestions: [
        { recipient: 'user', condition: ELECTRIC_RESISTANT_COAT, action: 'add' },
        { recipient: 'target', condition: ELECTRIC_RESISTANT_COAT, action: 'add' },
      ],
      automationNotes: [
        expect.stringContaining('user also receives the Coat'),
        expect.stringContaining('consumed automatically'),
      ],
    })
    expect(explicitScriptForMove('Mud-Slap')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'acc',
      delta: -1,
      label: 'Mud-Slap lowers Accuracy: -1 Accuracy CS',
    }])
    expect(explicitScriptForMove('Mystical Fire')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'satk',
      delta: -1,
      label: 'Mystical Fire lowers Special Attack: -1 Special Attack CS',
    }])
    expect(explicitScriptForMove('Needle Arm')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Flinch',
      action: 'add',
      label: 'Flinch on 15+',
      threshold: '15+',
      optional: true,
    }])
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
        idFactory: () => 'reg-017-direct-id',
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
        idFactory: () => 'reg-017-plan-id',
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

  it('applies Mud Sport resistance and consumes the coat once after an Electric hit', async () => {
    const scenarioId = MUD_SPORT_REG_017_SCENARIOS[1].scenarioId
    const { harness, mapSlug } = await applyAcceptedMudSport({ operationId: scenarioId })
    const fixture = persistedFollowUpFixture(harness, mapSlug, 'Thunder Shock')
    const command = commandFor(fixture, `${scenarioId}.trigger`)
    const response = await executeCommand(harness, command, {
      random: randomSequence([0.45, 0]),
    })

    expect(response.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    expect(response.move?.transaction.hitTargetIds).toEqual([TARGET_A_ID])
    expect(response.move?.transaction.hpUpdates).toEqual([{
      id: TARGET_A_ID,
      currentHp: 485,
      injuries: 0,
    }])
    expect(response.move?.transaction.conditionUpdates).toEqual([{
      id: TARGET_A_ID,
      conditions: [],
    }])
    if (!response.move?.trace) throw new Error('Accepted coat trigger did not retain its native trace.')
    const coatTrace = JSON.stringify(response.move.trace)
    expect(coatTrace).toContain('consume-electric-resistant-coat')
    expect(storedConditions(harness, TARGET_A_ID)).toEqual([])
    expect(storedConditions(harness, TARGET_B_ID)).toEqual([ELECTRIC_RESISTANT_COAT])
    expect(storedConditions(harness, 'actor')).toEqual([ELECTRIC_RESISTANT_COAT])

    const committedMap = deepCloneJson(harness.maps.getBySlug(mapSlug))
    const committedSheets = deepCloneJson(harness.sheets.list())
    const committedEvents = deepCloneJson(harness.events)
    const duplicate = await executeCommand(harness, command, {
      random: () => { throw new Error('duplicate coat trigger must not reroll') },
      planner: () => { throw new Error('duplicate coat trigger must not replan') },
    })
    expect(duplicate).toEqual(response)
    expect(harness.maps.getBySlug(mapSlug)).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(committedSheets)
    expect(harness.events).toEqual(committedEvents)
  })

  it('consumes Mud Sport Coat when a damaging Electric move hits an immune target', async () => {
    const scenarioId = MUD_SPORT_REG_017_SCENARIOS[2].scenarioId
    const { harness, mapSlug } = await applyAcceptedMudSport({
      operationId: `op_${scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
      targetAProfile: { types: ['Ground'] },
    })
    const fixture = persistedFollowUpFixture(harness, mapSlug, 'Thunder Shock')
    const response = await executeCommand(
      harness,
      commandFor(fixture, `${scenarioId}.trigger`),
      { random: randomSequence([0.45, 0]) },
    )

    expect(response.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    expect(response.move?.transaction.hitTargetIds).toEqual([TARGET_A_ID])
    expect(response.move?.transaction.hpUpdates).toEqual([])
    expect(response.move?.transaction.conditionUpdates).toEqual([{
      id: TARGET_A_ID,
      conditions: [],
    }])
    if (!response.move?.trace) throw new Error('Accepted immune hit did not retain its native trace.')
    assertReviewedNativeEvidenceFragments(JSON.stringify(response.move.trace), ['Electric immunity'])
    expect(JSON.stringify(response.move.trace)).toContain('consume-electric-resistant-coat')
    expect(storedConditions(harness, TARGET_A_ID)).toEqual([])
  })

  it('retains Mud Sport Coat when Electric Smite damage occurs on a miss', async () => {
    const scenarioId = MUD_SPORT_REG_017_SCENARIOS[3].scenarioId
    const { harness, mapSlug } = await applyAcceptedMudSport({ operationId: scenarioId })
    const fixture = persistedFollowUpFixture(harness, mapSlug, 'Bolt Strike')
    const response = await executeCommand(
      harness,
      commandFor(fixture, `${scenarioId}.trigger`),
      { random: randomSequence([0, 0, 0, 0, 0]) },
    )

    expect(response.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    expect(response.move?.transaction.hitTargetIds).toEqual([])
    expect(response.move?.transaction.hpUpdates.map(update => update.id)).toEqual([TARGET_A_ID])
    expect(response.move?.transaction.conditionUpdates).toEqual([])
    if (!response.move?.trace) throw new Error('Accepted Smite move did not retain its native trace.')
    const smiteTrace = JSON.stringify(response.move.trace)
    expect(smiteTrace).toContain('bolt-strike.damage')
    expect(smiteTrace).toContain('"naturalResult":1')
    expect(storedConditions(harness, TARGET_A_ID)).toEqual([ELECTRIC_RESISTANT_COAT])
  })

  it.each(REG_017_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_017_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_017_MOVE_NAMES)(
    'rejects stale %s state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_017_SCENARIOS_BY_MOVE[moveName]
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
})
