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
import { SYNTHESIS_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/synthesis'
import { TACKLE_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/tackle'
import { TAKE_DOWN_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/takeDown'
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
import { synthesisV2Fixture } from '../fixtures/moveAutomation/synthesisV2'
import { tackleV2SemanticScenario } from '../fixtures/moveAutomation/tackleFamilyV2'
import {
  REG_030_MOVE_NAMES,
  REG_030_SCENARIOS_BY_MOVE,
  type RegisteredBatch030MoveName,
  type RegisteredMoveConformanceScenario,
} from '../fixtures/moveAutomation/registeredBatch030'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const NOW = 5_000

const LEGACY_MOVE_NAMES = Object.freeze([
  'Tail Whip',
  'Taunt',
  'Tearful Look',
  'Teeter Dance',
  'Thunder Punch',
] as const)

type LegacyMoveName = (typeof LEGACY_MOVE_NAMES)[number]
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
  readonly moveName: LegacyMoveName
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly excludedTargetIds?: readonly TargetId[]
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TokenProfile>>>
  readonly initialStages?: readonly StageExpectation[]
  readonly randomValues: readonly number[]
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedAreaCandidateTargetIds?: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
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

const stageValue = (
  stages: readonly StageExpectation[] | undefined,
  placementId: string,
  key: CombatStageKey,
): number => stages?.find(stage => (
  stage.recipientId === placementId && stage.key === key
))?.value ?? 0

const pokemonSheet = (options: {
  readonly slug: string
  readonly placementId: string
  readonly actor?: boolean
  readonly moves?: readonly CharacterSheetMove[]
  readonly profile?: TokenProfile
  readonly initialStages?: readonly StageExpectation[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.actor ? 'Mew' : 'Clefairy',
  level: 20,
  revision: 3,
  types: [...(options.profile?.types ?? ['Normal'])],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  capabilities: { overland: 6 },
  movelist: [...(options.moves ?? [])],
  stats: {
    hp: { added: 500 },
    atk: { added: options.actor ? 50 : 5, stage: stageValue(options.initialStages, options.placementId, 'atk') },
    def: { added: 5, stage: stageValue(options.initialStages, options.placementId, 'def') },
    satk: { added: options.actor ? 30 : 5, stage: stageValue(options.initialStages, options.placementId, 'satk') },
    sdef: { added: 5, stage: stageValue(options.initialStages, options.placementId, 'sdef') },
    spd: { added: 5, stage: stageValue(options.initialStages, options.placementId, 'spd') },
  },
  combatStages: { acc: stageValue(options.initialStages, options.placementId, 'acc') },
  combat: {
    currentHp: 500,
    conditions: [...(options.profile?.conditions ?? [])],
  },
})

const targetPosition = (
  selectionKind: SelectionKind,
  id: TargetId,
): { readonly x: number; readonly y: number; readonly z: number } => {
  if (selectionKind === 'burst') {
    if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
    if (id === TARGET_B_ID) return { x: 5, y: 0, z: 4 }
    return { x: 4, y: 0, z: 5 }
  }
  return { x: 6, y: 0, z: 5 }
}

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const selectionKind = scenario.selectionKind ?? 'single-target'
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-030-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-030 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 5, y: 0, z: 5 }),
      ...targetIds.map(id => placement(id, id, targetPosition(selectionKind, id))),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-030 scene', startedAt: 100 },
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
    actor: true,
    moves: [{ name: scenario.moveName }],
    initialStages: scenario.initialStages,
  })
  const targets = targetIds.map(id => [id, pokemonSheet({
    slug: id,
    placementId: id,
    profile: scenario.targetProfiles?.[id],
    initialStages: scenario.initialStages,
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed compatibility script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const template = script.areaTemplates?.find(candidate => candidate.kind === 'burst')
    if (!template) throw new Error(`${scenario.moveName} must retain Burst geometry.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
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

const conditionsByTarget = (
  transaction: MoveAutomationTransaction,
): Readonly<Record<string, readonly string[]>> => Object.fromEntries(
  transaction.conditionUpdates.map(update => [update.id, update.conditions]),
)

const accuracyNaturalResults = (
  resolution: AuthoritativeMoveResolution,
): readonly number[] => resolution.rollLedger
  .filter(entry => entry.formula.kind === 'dice' && entry.formula.sides === 20)
  .map(entry => entry.naturalResult)

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
  expect(resolution.transaction.hpUpdates.map(update => update.id).sort())
    .toEqual([...scenario.expectedDamagedTargetIds].sort())
  expect(conditionsByTarget(resolution.transaction)).toEqual(scenario.expectedConditions ?? {})
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  const expectedStages = scenario.expectedStages ?? []
  if (expectedStages.length === 0) expect(resolution.transaction.combatStageUpdates).toEqual([])
  for (const expected of expectedStages) {
    const updated = resolution.transaction.combatStageUpdates.find(update => (
      update.id === expected.recipientId
    ))?.stages[expected.key]
    expect(updated ?? (Math.abs(expected.value) === 6 ? expected.value : undefined))
      .toBe(expected.value)
  }

  if ((scenario.selectionKind ?? 'single-target') === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(
      scenario.expectedAreaCandidateTargetIds ?? scenario.expectedAttackedTargetIds,
    )
    expect(resolution.area?.excludedTargetIds).toEqual(scenario.excludedTargetIds ?? [])
  }

  const searchable = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(searchable.toLowerCase()).toContain('critical')
  }
  assertReviewedNativeEvidenceFragments(searchable, scenario.expectedLogFragments ?? [])
  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
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
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId: `op_${operationId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
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
  clientId: 'reg-030-client',
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
    return () => `reg-030-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const normalizedEvidence = (
  scenarios: readonly RegisteredMoveConformanceScenario[],
): readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[] => scenarios
  .map(scenario => ({
    scenarioId: scenario.scenarioId,
    evidenceClasses: [...scenario.evidenceClasses].sort(),
  }))
  .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const evidenceWithSuffix = (
  moveName: RegisteredBatch030MoveName,
  suffix: string,
): RegisteredMoveConformanceScenario => {
  const evidence = REG_030_SCENARIOS_BY_MOVE[moveName]
    .find(candidate => candidate.scenarioId.endsWith(suffix))
  if (!evidence) throw new Error(`Missing ${suffix} evidence for ${moveName}.`)
  return evidence
}

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: evidenceWithSuffix('Tail Whip', '-friendly-area-mixed').scenarioId,
    moveName: 'Tail Whip',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    excludedTargetIds: [TARGET_C_ID],
    randomValues: [0.45, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: evidenceWithSuffix('Tail Whip', '-stage-cap').scenarioId,
    moveName: 'Tail Whip',
    selectionKind: 'burst',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -6 }],
    randomValues: [0.45],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Taunt', '-enrage-hit').scenarioId,
    moveName: 'Taunt',
    randomValues: [0.45],
    expectedConditions: { [TARGET_A_ID]: ['Rage'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Taunt', '-miss').scenarioId,
    moveName: 'Taunt',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: evidenceWithSuffix('Tearful Look', '-friendly-area-mixed').scenarioId,
    moveName: 'Tearful Look',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    excludedTargetIds: [TARGET_C_ID],
    randomValues: [0.45, 0],
    expectedStages: [
      { recipientId: TARGET_A_ID, key: 'atk', value: -1 },
      { recipientId: TARGET_A_ID, key: 'satk', value: -1 },
    ],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: evidenceWithSuffix('Tearful Look', '-stage-cap').scenarioId,
    moveName: 'Tearful Look',
    selectionKind: 'burst',
    initialStages: [
      { recipientId: TARGET_A_ID, key: 'atk', value: -6 },
      { recipientId: TARGET_A_ID, key: 'satk', value: -6 },
    ],
    randomValues: [0.45],
    expectedStages: [
      { recipientId: TARGET_A_ID, key: 'atk', value: -6 },
      { recipientId: TARGET_A_ID, key: 'satk', value: -6 },
    ],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Teeter Dance', '-burst-mixed').scenarioId,
    moveName: 'Teeter Dance',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0],
    expectedConditions: { [TARGET_A_ID]: ['Confused'] },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: evidenceWithSuffix('Thunder Punch', '-paralysis-threshold-pass').scenarioId,
    moveName: 'Thunder Punch',
    randomValues: [0.9, 0, 0],
    expectedConditions: { [TARGET_A_ID]: ['Paralysis'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
  },
  {
    scenarioId: evidenceWithSuffix('Thunder Punch', '-paralysis-threshold-fail').scenarioId,
    moveName: 'Thunder Punch',
    randomValues: [0.85, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: evidenceWithSuffix('Thunder Punch', '-miss').scenarioId,
    moveName: 'Thunder Punch',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: evidenceWithSuffix('Thunder Punch', '-critical-hit').scenarioId,
    moveName: 'Thunder Punch',
    randomValues: [0.999, 0, 0],
    expectedConditions: { [TARGET_A_ID]: ['Paralysis'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: evidenceWithSuffix('Thunder Punch', '-ground-immunity').scenarioId,
    moveName: 'Thunder Punch',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ground'] } },
    randomValues: [0.9],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragments: ['Electric immunity'],
  },
  {
    scenarioId: evidenceWithSuffix('Thunder Punch', '-paralysis-immunity').scenarioId,
    moveName: 'Thunder Punch',
    targetProfiles: { [TARGET_A_ID]: { types: ['Electric'] } },
    randomValues: [0.9, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragments: ['Electric type'],
  },
  {
    scenarioId: evidenceWithSuffix('Thunder Punch', '-secondary-immunity').scenarioId,
    moveName: 'Thunder Punch',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.9, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragments: ['Shield Dust'],
  },
]

const recoveryScenarioFor = (moveName: LegacyMoveName): ExecutionScenario => {
  const matching = normalScenarios.find(scenario => (
    scenario.moveName === moveName && scenario.expectedHitTargetIds.includes(TARGET_A_ID)
  ))
  if (!matching) throw new Error(`Missing accepted recovery scenario for ${moveName}.`)
  return matching
}

const nativeConflictFixture = (
  moveName: 'Synthesis' | 'Tackle',
): { readonly fixture: MoveFixture; readonly randomValues: readonly number[]; readonly racedSlug: string } => {
  if (moveName === 'Synthesis') {
    const source = synthesisV2Fixture('synthesis.v2-sunny')
    return {
      fixture: {
        ...source,
        map: { ...source.map, encounterState: createEmptyEncounterState() },
        candidateScopePlacementIds: [],
      },
      randomValues: [],
      racedSlug: 'actor',
    }
  }
  const source = tackleV2SemanticScenario('tackle.v2-hit-push')
  return {
    fixture: {
      map: {
        ...deepCloneJson(source.initialState.map),
        encounterState: deepCloneJson(source.initialState.encounterState),
      },
      pokemonSheets: source.initialState.pokemonSheets,
      trainerSheets: source.initialState.trainerSheets,
      intent: source.intent,
      candidateScopePlacementIds: ['target-token'],
    },
    randomValues: source.seed.randomValues,
    racedSlug: 'target',
  }
}

describe('REG-030 registered move conformance', () => {
  it('certifies exactly Synthesis through Thunder Punch with linked evidence', () => {
    expect(Object.keys(REG_030_SCENARIOS_BY_MOVE)).toEqual([...REG_030_MOVE_NAMES])
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)

    for (const [canonicalId, scenarios] of Object.entries(REG_030_SCENARIOS_BY_MOVE)) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === canonicalId)
      expect(row, canonicalId).toMatchObject({
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: expect.any(String),
      })
      if (!row) continue
      expect([...row.scenarioIds].sort()).toEqual(scenarios.map(scenario => scenario.scenarioId).sort())
      expect(normalizedEvidence(row.conformanceEvidence.scenarios))
        .toEqual(normalizedEvidence(scenarios))
      expect(registeredMoveAutomationRuntimeFor(canonicalId), canonicalId).toMatchObject({
        canonicalId,
        kind: row.runtime.kind,
        version: row.runtime.version,
        definitionHash: row.runtime.definitionHash,
        sourceModule: row.runtime.sourceModule,
      })
    }
  })

  it('retains each canonical mechanic and rejects Tackle while Stuck', () => {
    expect(registeredMoveAutomationRuntimeFor('Synthesis')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SYNTHESIS_MOVE_SPEC },
    })
    expect(registeredMoveAutomationRuntimeFor('Tackle')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: TACKLE_MOVE_SPEC },
    })
    expect(TACKLE_MOVE_SPEC.preconditions).toContainEqual(expect.objectContaining({
      id: 'tackle.dash-not-stuck',
      failureReasonCode: 'tackle.dash-blocked-by-stuck',
    }))
    expect(registeredMoveAutomationRuntimeFor('Take Down')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: TAKE_DOWN_MOVE_SPEC },
    })

    const expected = {
      'Tail Whip': { ac: 2, damageBase: 0, damageClass: 'Status', range: 'Burst 1, Friendly' },
      Taunt: { ac: 3, damageBase: 0, damageClass: 'Status', range: '6, 1 Target, Social' },
      'Tearful Look': { ac: 2, damageBase: 0, damageClass: 'Status', range: 'Burst 1, Social, Friendly' },
      'Teeter Dance': { ac: 2, damageBase: 0, damageClass: 'Status', range: 'Burst 1' },
      'Thunder Punch': { ac: 2, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target' },
    } as const
    for (const [moveName, mechanics] of Object.entries(expected)) {
      expect(explicitScriptForMove(moveName), moveName).toMatchObject({
        kind: 'explicit',
        moveName,
        version: 1,
        ...mechanics,
      })
      expect(explicitScriptForMove(moveName)?.automationNotes.join(' '), moveName)
        .not.toMatch(/verify|adjust .* manually|apply .* manually|manual tracking|operator/i)
    }
    expect(explicitScriptForMove('Tail Whip')).toMatchObject({
      areaTemplates: [{ kind: 'burst', size: 1 }],
      stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1 }],
    })
    expect(explicitScriptForMove('Taunt')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Rage',
      action: 'add',
      label: 'Enraged',
    }])
    expect(explicitScriptForMove('Tearful Look')?.stageSuggestions).toEqual([
      expect.objectContaining({ recipient: 'target', key: 'atk', delta: -1 }),
      expect.objectContaining({ recipient: 'target', key: 'satk', delta: -1 }),
    ])
    expect(explicitScriptForMove('Teeter Dance')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Confused',
      action: 'add',
      label: 'Confused',
    }])
    expect(explicitScriptForMove('Thunder Punch')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Paralysis',
      action: 'add',
      label: 'Paralysis on 19+',
      threshold: '19+',
      optional: true,
    }])
  })

  it.each(normalScenarios)(
    'proves $scenarioId through the executor, planner, and accepted command',
    async (scenario) => {
      const directFixture = fixtureFor(scenario)
      const snapshot = deepCloneJson({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] })
      const direct = resolveAuthoritativeMove({
        ...directFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-030-direct-id',
        resolutionId: `${scenario.scenarioId}.direct`,
      })
      assertScenarioResolution(scenario, direct)
      expect({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] }).toEqual(snapshot)

      const plannerFixture = fixtureFor(scenario)
      const plan = planAuthoritativeMoveState({
        ...plannerFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-030-plan-id',
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
      expect(harness.maps.getBySlug(command.mapSlug)).toMatchObject({
        revision: 8,
        encounterState: {
          turnResources: {
            [ACTOR_ID]: { actions: { standard: { spent: 1 } } },
          },
        },
      })
      for (const [slug, initialSheet] of commandFixture.pokemonSheets) {
        const expectedWrite = plan.sheetWrites.find(write => write.kind === 'pokemon' && write.slug === slug)
        expect(harness.sheets.getByRef('pokemon', slug)).toMatchObject({
          revision: expectedWrite?.revision ?? initialSheet.revision,
          sheet: expectedWrite?.nextSheet ?? initialSheet,
        })
      }
    },
  )

  it.each(LEGACY_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_030_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('retry'))!
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

  it.each(LEGACY_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_030_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))!
      const command = commandFor(fixture, evidence.scenarioId)
      const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      let racedSheet: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
        const plan: AuthoritativeMoveStatePlan = planAuthoritativeMoveState({
          ...input,
          random: randomSequence(scenario.randomValues),
        })
        expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: TARGET_A_ID }))
        const current = harness.sheets.getByRef('pokemon', TARGET_A_ID)
        if (!current) throw new Error(`Missing ${moveName} raced sheet.`)
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

  it.each(['Synthesis', 'Tackle'] as const)(
    'rejects stale native %s state without a partial accepted result',
    async (moveName) => {
      const { fixture, randomValues, racedSlug } = nativeConflictFixture(moveName)
      const harness = openHarness(fixture)
      const evidence = REG_030_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))!
      const command = commandFor(fixture, evidence.scenarioId)
      const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      let racedSheet: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
        const plan = planAuthoritativeMoveState({
          ...input,
          random: randomSequence(randomValues),
        })
        expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: racedSlug }))
        const current = harness.sheets.getByRef('pokemon', racedSlug)
        if (!current) throw new Error(`Missing ${moveName} raced sheet.`)
        racedSheet = {
          ...deepCloneJson(current.sheet),
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        }
        harness.sheets.save({
          kind: 'pokemon',
          slug: racedSlug,
          document: racedSheet,
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        })
        return plan
      }

      const response = await executeCommand(harness, command, { planner })
      expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
      expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(mapBefore)
      expect(harness.sheets.getByRef('pokemon', racedSlug)?.sheet).toEqual(racedSheet)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )

  it('keeps only the audited compatibility moves on the v1 adapter', () => {
    for (const moveName of LEGACY_MOVE_NAMES) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        version: 2,
      })
    }
    for (const moveName of ['Synthesis', 'Tackle', 'Take Down']) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        version: 2,
      })
    }
  })
})
