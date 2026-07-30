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
import { conditionAdjustedEvasion, conditionAccuracyModifier } from '~/utils/sheetConditionEffects'
import { projectEffectiveConditions } from '~/utils/encounterConditions'
import { pokemonMoveEntriesForSheet } from '~/utils/mapTokenMoves'
import { deepCloneJson } from '~/utils/serialization'
import {
  requiredStruggleCapabilityForMoveName,
  struggleAttackIsAvailableForCapabilities,
} from '~/utils/struggleMoves'
import {
  resolveAuthoritativeMove,
  type AuthoritativeMoveResolution,
} from '~~/server/domain/resolveAuthoritativeMove'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import { planInitiativeLifecycle } from '~~/server/domain/moveAutomation/planInitiativeLifecycle'
import { planSceneLifecycle } from '~~/server/domain/moveAutomation/planSceneLifecycle'
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'
import { SUPERSONIC_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/supersonic'
import { SWEET_SCENT_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/sweetScent'
import { SWORDS_DANCE_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/swordsDance'
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
  REG_029_MOVE_NAMES,
  REG_029_SCENARIOS_BY_MOVE,
  type RegisteredBatch029MoveName,
  type RegisteredMoveConformanceScenario,
} from '../fixtures/moveAutomation/registeredBatch029'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const NOW = 5_000
const REVIEWED_AT = '2026-07-19'

const LEGACY_MOVE_NAMES = Object.freeze([
  'Struggle (Zapper Special)',
  'Struggle Bug',
  'Stun Spore',
  'Swagger',
  'Swift',
] as const)

const TEMPORARY_CONDITION_BY_MOVE = Object.freeze({
  Supersonic: 'supersonic-accuracy-penalty',
  'Sweet Scent': 'sweet-scent-evasion-penalty',
} as const)

type TargetId = typeof TARGET_A_ID | typeof TARGET_B_ID | typeof TARGET_C_ID
type SelectionKind = 'self' | 'single-target' | 'cone' | 'burst' | 'ranged-blast'

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
  readonly moveName: RegisteredBatch029MoveName
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly excludedTargetIds?: readonly TargetId[]
  readonly actorCapabilities?: readonly string[]
  readonly actorCombatSkill?: string
  readonly actorMoves?: readonly CharacterSheetMove[]
  readonly actorTypes?: readonly string[]
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TokenProfile>>>
  readonly initialStages?: readonly StageExpectation[]
  readonly randomValues: readonly number[]
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedAreaCandidateTargetIds?: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedTemporaryConditionTargetIds?: readonly string[]
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

const randomValuesForNaturalRoll = (naturalRoll: number): readonly number[] => [
  (naturalRoll - 1) / 20,
  ...Array.from({ length: 12 }, () => 0),
]

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
  readonly types?: readonly string[]
  readonly capabilities?: readonly string[]
  readonly combatSkill?: string
  readonly initialStages?: readonly StageExpectation[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.actor ? 'Mew' : 'Clefairy',
  level: 20,
  revision: 3,
  types: [...(options.types ?? options.profile?.types ?? ['Normal'])],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  capabilities: {
    overland: 6,
    other: [...(options.capabilities ?? [])],
  },
  skills: { combat: options.combatSkill ?? '4d6', focus: '4d6' },
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
  if (selectionKind === 'cone') {
    if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
    if (id === TARGET_B_ID) return { x: 7, y: 0, z: 4 }
    return { x: 7, y: 0, z: 5 }
  }
  if (selectionKind === 'burst') {
    if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
    if (id === TARGET_B_ID) return { x: 5, y: 0, z: 4 }
    return { x: 4, y: 0, z: 5 }
  }
  if (selectionKind === 'ranged-blast') {
    if (id === TARGET_A_ID) return { x: 8, y: 0, z: 5 }
    if (id === TARGET_B_ID) return { x: 8, y: 0, z: 4 }
    return { x: 9, y: 0, z: 5 }
  }
  return { x: 6, y: 0, z: 5 }
}

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const selectionKind = scenario.selectionKind ?? 'single-target'
  const targetIds = scenario.targetIds ?? (selectionKind === 'self' ? [] : [TARGET_A_ID])
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-029-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-029 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 14, y: 3, z: 12 },
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
    activeScene: { name: 'REG-029 scene', startedAt: 100 },
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
  const isStruggle = scenario.moveName === 'Struggle (Zapper Special)'
  const actor = pokemonSheet({
    slug: 'actor',
    placementId: ACTOR_ID,
    actor: true,
    moves: scenario.actorMoves ?? (isStruggle ? [] : [{ name: scenario.moveName }]),
    types: scenario.actorTypes ?? (isStruggle ? ['Electric'] : ['Normal']),
    capabilities: scenario.actorCapabilities ?? (isStruggle ? ['Zapper'] : []),
    combatSkill: scenario.actorCombatSkill,
    initialStages: scenario.initialStages,
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    placementId: id,
    profile: scenario.targetProfiles?.[id],
    initialStages: scenario.initialStages,
  })] as const)
  const script = explicitScriptForMove(scenario.moveName)
  if (!script) throw new Error(`Missing reviewed compatibility script for ${scenario.moveName}.`)

  let selection: ResolveMoveSelection
  if (selectionKind === 'self') selection = { kind: 'self' }
  else if (selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const template = script.areaTemplates?.find(candidate => candidate.kind === selectionKind)
    if (!template) throw new Error(`${scenario.moveName} must retain ${selectionKind} geometry.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
      ...(selectionKind === 'cone' ? { direction: 'east' as const } : {}),
      ...(selectionKind === 'ranged-blast' ? { aimCell: { x: 8, y: 0, z: 5 } } : {}),
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

const evidenceWithSuffix = (
  moveName: RegisteredBatch029MoveName,
  suffix: string,
): RegisteredMoveConformanceScenario => {
  const evidence = REG_029_SCENARIOS_BY_MOVE[moveName]
    .find(candidate => candidate.scenarioId.endsWith(suffix))
  if (!evidence) throw new Error(`Missing ${suffix} evidence for ${moveName}.`)
  return evidence
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

const temporaryConditionTargets = (
  map: TabletopMap,
  conditionId: string,
): readonly string[] => (map.encounterState?.effects ?? [])
  .filter(effect => effect.kind === 'condition' && effect.payload.conditionId === conditionId)
  .flatMap(effect => [...effect.affected.placementIds])

const assertScenarioResolution = (
  scenario: ExecutionScenario,
  resolution: AuthoritativeMoveResolution,
): void => {
  const runtime = registeredMoveAutomationRuntimeFor(scenario.moveName)
  expect(resolution.auditTrace.program).toMatchObject({
    canonicalId: scenario.moveName,
    runtimeKind: runtime?.kind,
    runtimeVersion: runtime?.version,
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
    const updated = resolution.transaction.combatStageUpdates
      .find(update => update.id === expected.recipientId)?.stages[expected.key]
    expect(updated ?? (Math.abs(expected.value) === 6 ? expected.value : undefined))
      .toBe(expected.value)
  }

  if ((scenario.selectionKind ?? 'single-target') === 'self') {
    expect(resolution.selectedTargetIds).toEqual([])
  }
  else if ((scenario.selectionKind ?? 'single-target') === 'single-target') {
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
  clientId: 'reg-029-client',
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
    return () => `reg-029-id-${++sequence}`
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

const struggleScenario = (
  suffix: string,
  naturalRoll: number,
  options: Partial<ExecutionScenario> = {},
): ExecutionScenario => ({
  scenarioId: evidenceWithSuffix('Struggle (Zapper Special)', suffix).scenarioId,
  moveName: 'Struggle (Zapper Special)',
  randomValues: randomValuesForNaturalRoll(naturalRoll),
  expectedAttackedTargetIds: [TARGET_A_ID],
  expectedHitTargetIds: naturalRoll === 1 ? [] : [TARGET_A_ID],
  expectedDamagedTargetIds: naturalRoll === 1 ? [] : [TARGET_A_ID],
  expectedAccuracyNaturalResults: [naturalRoll],
  ...(naturalRoll === 20 ? { expectedCriticalTargetIds: [TARGET_A_ID] } : {}),
  ...options,
})

const normalScenarios: readonly ExecutionScenario[] = [
  struggleScenario('-novice-no-stab-hit', 10),
  struggleScenario('-expert-combat-branch', 10, { actorCombatSkill: '5d6' }),
  struggleScenario('-miss', 1),
  struggleScenario('-critical-hit', 20),
  struggleScenario('-ground-immunity', 10, {
    targetProfiles: { [TARGET_A_ID]: { types: ['Ground'] } },
    expectedDamagedTargetIds: [],
    expectedLogFragments: ['Electric immunity'],
  }),
  {
    scenarioId: evidenceWithSuffix('Struggle Bug', '-cone-mixed').scenarioId,
    moveName: 'Struggle Bug',
    selectionKind: 'cone',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: evidenceWithSuffix('Struggle Bug', '-critical-hit').scenarioId,
    moveName: 'Struggle Bug',
    selectionKind: 'cone',
    randomValues: randomValuesForNaturalRoll(20),
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: evidenceWithSuffix('Struggle Bug', '-stage-cap').scenarioId,
    moveName: 'Struggle Bug',
    selectionKind: 'cone',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    randomValues: randomValuesForNaturalRoll(10),
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'satk', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Stun Spore', '-paralysis-hit').scenarioId,
    moveName: 'Stun Spore',
    randomValues: [0.45],
    expectedConditions: { [TARGET_A_ID]: ['Paralysis'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Stun Spore', '-miss').scenarioId,
    moveName: 'Stun Spore',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: evidenceWithSuffix('Stun Spore', '-powder-immunity').scenarioId,
    moveName: 'Stun Spore',
    targetProfiles: { [TARGET_A_ID]: { types: ['Grass'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Grass type (Powder)'],
  },
  {
    scenarioId: evidenceWithSuffix('Stun Spore', '-electric-immunity').scenarioId,
    moveName: 'Stun Spore',
    targetProfiles: { [TARGET_A_ID]: { types: ['Electric'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Electric type'],
  },
  {
    scenarioId: evidenceWithSuffix('Supersonic', '-confusion-hit').scenarioId,
    moveName: 'Supersonic',
    randomValues: [0.45],
    expectedConditions: { [TARGET_A_ID]: ['Confused'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Supersonic', '-miss-penalty').scenarioId,
    moveName: 'Supersonic',
    randomValues: [0],
    expectedTemporaryConditionTargetIds: [TARGET_A_ID],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: evidenceWithSuffix('Supersonic', '-soundproof-hit-immunity').scenarioId,
    moveName: 'Supersonic',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Soundproof'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Soundproof'],
  },
  {
    scenarioId: evidenceWithSuffix('Supersonic', '-soundproof-miss-immunity').scenarioId,
    moveName: 'Supersonic',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Soundproof'] } },
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
    expectedLogFragments: ['Soundproof'],
  },
  {
    scenarioId: evidenceWithSuffix('Swagger', '-stage-and-confusion').scenarioId,
    moveName: 'Swagger',
    randomValues: [0.45],
    expectedConditions: { [TARGET_A_ID]: ['Confused'] },
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'atk', value: 2 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Swagger', '-miss').scenarioId,
    moveName: 'Swagger',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: evidenceWithSuffix('Swagger', '-stage-cap').scenarioId,
    moveName: 'Swagger',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'atk', value: 6 }],
    randomValues: [0.45],
    expectedConditions: { [TARGET_A_ID]: ['Confused'] },
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'atk', value: 6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Sweet Scent', '-burst-mixed').scenarioId,
    moveName: 'Sweet Scent',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0],
    expectedTemporaryConditionTargetIds: [TARGET_A_ID],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: evidenceWithSuffix('Sweet Scent', '-friendly-exclusion').scenarioId,
    moveName: 'Sweet Scent',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    excludedTargetIds: [TARGET_B_ID],
    randomValues: [0.45],
    expectedTemporaryConditionTargetIds: [TARGET_A_ID],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Sweet Scent', '-evasion-floor').scenarioId,
    moveName: 'Sweet Scent',
    selectionKind: 'burst',
    randomValues: [0.45],
    expectedTemporaryConditionTargetIds: [TARGET_A_ID],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: evidenceWithSuffix('Swift', '-automatic-area-hit').scenarioId,
    moveName: 'Swift',
    selectionKind: 'ranged-blast',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    excludedTargetIds: [TARGET_B_ID],
    randomValues: [0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: evidenceWithSuffix('Swift', '-ghost-immunity').scenarioId,
    moveName: 'Swift',
    selectionKind: 'ranged-blast',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ghost'] } },
    randomValues: [],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedLogFragments: ['Normal immunity'],
  },
  {
    scenarioId: 'swords-dance.v2-full-increase',
    moveName: 'Swords Dance',
    selectionKind: 'self',
    targetIds: [],
    randomValues: [],
    expectedStages: [{ recipientId: ACTOR_ID, key: 'atk', value: 2 }],
    expectedAttackedTargetIds: [],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
  },
]

const recoveryScenarioFor = (moveName: RegisteredBatch029MoveName): ExecutionScenario => {
  const preferredSuffix = moveName === 'Supersonic'
    ? '-miss-penalty'
    : moveName === 'Sweet Scent'
      ? '-burst-mixed'
      : null
  const matching = normalScenarios.find(scenario => (
    scenario.moveName === moveName
    && (preferredSuffix === null || scenario.scenarioId.endsWith(preferredSuffix))
    && (preferredSuffix !== null || scenario.expectedHitTargetIds.length > 0 || moveName === 'Swords Dance')
  ))
  if (!matching) throw new Error(`Missing accepted recovery scenario for ${moveName}.`)
  return matching
}

describe('REG-029 registered move conformance', () => {
  it('certifies exactly Zapper Special through Swords Dance with linked evidence', () => {
    expect(Object.keys(REG_029_SCENARIOS_BY_MOVE)).toEqual([...REG_029_MOVE_NAMES])
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)

    for (const [canonicalId, scenarios] of Object.entries(REG_029_SCENARIOS_BY_MOVE)) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === canonicalId)
      expect(row, canonicalId).toMatchObject({
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: REVIEWED_AT,
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

  it('retains each reviewed canonical definition and selects native duration specs', () => {
    expect(explicitScriptForMove('Struggle (Zapper Special)')).toMatchObject({
      ac: 4,
      damageBase: 4,
      damageClass: 'Special',
      type: 'Electric',
      range: 'Melee, 1 Target',
    })
    expect(explicitScriptForMove('Struggle Bug')).toMatchObject({
      ac: 2,
      damageBase: 5,
      damageClass: 'Special',
      type: 'Bug',
      range: 'Cone 2',
      areaTemplates: [{ kind: 'cone', size: 2 }],
      stageSuggestions: [{ recipient: 'target', key: 'satk', delta: -1 }],
    })
    expect(explicitScriptForMove('Stun Spore')).toMatchObject({
      ac: 6,
      damageClass: 'Status',
      range: '6, 1 Target, Powder',
      keywords: expect.arrayContaining(['Powder']),
      conditionSuggestions: [{ condition: 'Paralysis' }],
    })
    expect(explicitScriptForMove('Swagger')).toMatchObject({
      ac: 5,
      damageClass: 'Status',
      range: '6, 1 Target, Social',
      conditionSuggestions: [{ condition: 'Confused' }],
      stageSuggestions: [{ key: 'atk', delta: 2 }],
    })
    expect(explicitScriptForMove('Swift')).toMatchObject({
      ac: null,
      requiresAccuracy: false,
      damageBase: 6,
      damageClass: 'Special',
      range: '8, Ranged Blast 2, Friendly',
      areaTemplates: [{ kind: 'ranged-blast', size: 2, range: 8 }],
    })

    expect(registeredMoveAutomationRuntimeFor('Supersonic')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SUPERSONIC_MOVE_SPEC },
    })
    expect(SUPERSONIC_MOVE_SPEC.phases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: 'miss',
        operations: [expect.objectContaining({
          recipients: { kind: 'missed-targets' },
          payload: expect.objectContaining({
            conditionId: 'supersonic-accuracy-penalty',
            duration: expect.objectContaining({
              duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
            }),
          }),
        })],
      }),
    ]))
    expect(registeredMoveAutomationRuntimeFor('Sweet Scent')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SWEET_SCENT_MOVE_SPEC },
    })
    expect(SWEET_SCENT_MOVE_SPEC.phases).toEqual(expect.arrayContaining([
      expect.objectContaining({
        phase: 'hit',
        operations: [expect.objectContaining({
          recipients: { kind: 'hit-targets' },
          payload: expect.objectContaining({
            conditionId: 'sweet-scent-evasion-penalty',
            duration: expect.objectContaining({ duration: { kind: 'scene', remaining: null } }),
          }),
        })],
      }),
    ]))
    expect(registeredMoveAutomationRuntimeFor('Swords Dance')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: SWORDS_DANCE_MOVE_SPEC },
    })
  })

  it('derives Zapper Special authoritatively without a learned move or STAB', () => {
    const scenario = recoveryScenarioFor('Struggle (Zapper Special)')
    const fixture = fixtureFor(scenario)
    const actor = fixture.pokemonSheets.get('actor')!
    expect(actor.movelist).toEqual([])
    expect(pokemonMoveEntriesForSheet(actor)).toContainEqual({
      move: { name: 'Struggle (Zapper Special)' },
      automatic: true,
    })
    expect(requiredStruggleCapabilityForMoveName('Struggle (Zapper Special)')).toBe('Zapper')
    expect(struggleAttackIsAvailableForCapabilities('Struggle (Zapper Special)', ['Zapper'])).toBe(true)

    const resolution = resolveAuthoritativeMove({
      ...fixture,
      random: randomSequence(scenario.randomValues),
      now: () => NOW,
    })
    if ('kind' in resolution) throw new Error('Zapper Special unexpectedly suspended.')
    expect(resolution.damageFormula).toBe('1d8+6')
    expect(resolution.transaction.logLines.join(' ')).not.toContain('STAB')
  })

  it.each(normalScenarios)(
    'proves $scenarioId through the resolver, planner, and accepted command',
    async (scenario) => {
      const directFixture = fixtureFor(scenario)
      const snapshot = deepCloneJson({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] })
      const direct = resolveAuthoritativeMove({
        ...directFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-029-direct-id',
        resolutionId: `${scenario.scenarioId}.direct`,
      })
      if ('kind' in direct) throw new Error(`${scenario.moveName} unexpectedly suspended.`)
      assertScenarioResolution(scenario, direct)
      expect({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] }).toEqual(snapshot)

      const plannerFixture = fixtureFor(scenario)
      const plan = planAuthoritativeMoveState({
        ...plannerFixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
        idFactory: () => 'reg-029-plan-id',
        operationId: `op_${scenario.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}_plan`,
      })
      assertScenarioResolution(scenario, plan.resolution)
      expect(plan.resolution.transaction).toEqual(direct.transaction)
      const temporaryCondition = TEMPORARY_CONDITION_BY_MOVE[
        scenario.moveName as keyof typeof TEMPORARY_CONDITION_BY_MOVE
      ]
      if (temporaryCondition) {
        expect([...temporaryConditionTargets(plan.nextMap, temporaryCondition)].sort())
          .toEqual([...(scenario.expectedTemporaryConditionTargetIds ?? [])].sort())
      }

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
        program: { canonicalId: scenario.moveName, runtimeKind: registeredMoveAutomationRuntimeFor(scenario.moveName)?.kind },
      })
      expect(harness.ops.getOpResult(command.mapSlug, command.opId)).toEqual(response.result)
      const persistedMap = harness.maps.getBySlug(command.mapSlug)
      expect(persistedMap).toMatchObject({
        revision: plan.nextMap.revision,
        updatedAt: plan.nextMap.updatedAt,
        placements: plan.nextMap.placements,
        encounterState: {
          effects: expect.any(Array),
          turnResources: {
            [ACTOR_ID]: { actions: { standard: { spent: 1 } } },
          },
        },
      })
      if (temporaryCondition && persistedMap) {
        expect([...temporaryConditionTargets(persistedMap, temporaryCondition)].sort())
          .toEqual([...(scenario.expectedTemporaryConditionTargetIds ?? [])].sort())
      }
      for (const [slug, initialSheet] of commandFixture.pokemonSheets) {
        const expectedWrite = plan.sheetWrites.find(write => write.kind === 'pokemon' && write.slug === slug)
        expect(harness.sheets.getByRef('pokemon', slug)).toMatchObject({
          revision: expectedWrite?.revision ?? initialSheet.revision,
          sheet: expectedWrite?.nextSheet ?? initialSheet,
        })
      }
    },
  )

  it('applies the Supersonic miss penalty to later Accuracy and expires after one full source round', () => {
    const setup = recoveryScenarioFor('Supersonic')
    const fixture = fixtureFor(setup)
    const plan = planAuthoritativeMoveState({
      ...fixture,
      random: randomSequence(setup.randomValues),
      now: () => NOW,
      operationId: `op_${evidenceWithSuffix('Supersonic', '-penalty-next-accuracy').scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`,
    })
    const effect = plan.nextMap.encounterState?.effects.find(candidate => (
      candidate.kind === 'condition'
      && candidate.payload.conditionId === 'supersonic-accuracy-penalty'
    ))
    expect(effect).toMatchObject({
      affected: { placementIds: [TARGET_A_ID] },
      duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
      transferPolicy: 'expire',
    })
    const projection = projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: plan.nextMap.encounterState?.effects,
      target: { placementId: TARGET_A_ID },
    })
    expect(projection.conditions).toContain('Supersonic Accuracy Penalty')
    expect(conditionAccuracyModifier(projection.conditions)).toBe(-2)

    const lifecycle = planInitiativeLifecycle({
      map: { ...plan.nextMap, initiative: { activeId: TARGET_A_ID, round: 1 } },
      previous: { activeId: TARGET_A_ID, round: 1 },
      current: { activeId: ACTOR_ID, round: 2 },
      orderIds: [ACTOR_ID, TARGET_A_ID],
      operationId: `op_${evidenceWithSuffix('Supersonic', '-source-turn-expiry').scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
      time: NOW + 1_000,
      loadSheets: () => ({
        pokemonSheets: fixture.pokemonSheets,
        trainerSheets: fixture.trainerSheets,
      }),
    })
    expect(lifecycle.currentEncounterState.effects).not.toContainEqual(
      expect.objectContaining({ id: effect?.id }),
    )
    expect(lifecycle.reduction.transitions).toContainEqual(expect.objectContaining({
      transition: expect.objectContaining({ kind: 'expired', reasonCode: 'effect-duration-expired' }),
    }))
  })

  it('clamps Sweet Scent Evasion at zero and removes its marker at scene end', () => {
    const setup = normalScenarios.find(scenario => scenario.scenarioId.endsWith('-evasion-floor'))!
    const fixture = fixtureFor(setup)
    const plan = planAuthoritativeMoveState({
      ...fixture,
      random: randomSequence(setup.randomValues),
      now: () => NOW,
      operationId: 'op_sweet_scent_scene_setup',
    })
    const projection = projectEffectiveConditions({
      sheetConditions: [],
      encounterEffects: plan.nextMap.encounterState?.effects,
      target: { placementId: TARGET_A_ID },
    })
    expect(projection.conditions).toContain('Sweet Scent Evasion Penalty')
    expect(conditionAdjustedEvasion({
      statTotal: 5,
      combatStage: 0,
      bonus: 0,
      conditions: projection.conditions,
      statStageKey: 'spd',
      kind: 'speed',
    }).total).toBe(0)

    const lifecycle = planSceneLifecycle({
      map: plan.nextMap,
      previous: plan.nextMap.activeScene ?? null,
      current: null,
      operationId: `op_${evidenceWithSuffix('Sweet Scent', '-scene-cleanup').scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
      time: NOW + 1_000,
      loadSheets: () => ({
        pokemonSheets: fixture.pokemonSheets,
        trainerSheets: fixture.trainerSheets,
      }),
    })
    expect(lifecycle.currentEncounterState.effects).not.toContainEqual(expect.objectContaining({
      kind: 'condition',
      payload: expect.objectContaining({ conditionId: 'sweet-scent-evasion-penalty' }),
    }))
    expect(lifecycle.reductions.flatMap(reduction => reduction.transitions)).toContainEqual(
      expect.objectContaining({
        transition: expect.objectContaining({ kind: 'expired', reasonCode: 'effect-duration-expired' }),
      }),
    )
  })

  it('rejects Zapper Special without Zapper before rolls, costs, or effects', async () => {
    const accepted = recoveryScenarioFor('Struggle (Zapper Special)')
    const scenario: ExecutionScenario = {
      ...accepted,
      scenarioId: evidenceWithSuffix('Struggle (Zapper Special)', '-capability-required').scenarioId,
      actorCapabilities: [],
      actorMoves: [{ name: 'Struggle (Zapper Special)' }],
    }
    const fixture = fixtureFor(scenario)
    const snapshot = deepCloneJson({ map: fixture.map, sheets: [...fixture.pokemonSheets] })
    expect(() => resolveAuthoritativeMove({
      ...fixture,
      random: () => { throw new Error('missing capability must not roll') },
    })).toThrowError(expect.objectContaining({ code: 'move-creature-rule-blocked' }))
    expect({ map: fixture.map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)

    const harness = openHarness(fixture)
    const command = commandFor(fixture, `${scenario.scenarioId}.command`)
    const response = await executeCommand(harness, command, {
      random: () => { throw new Error('missing capability command must not roll') },
    })
    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentState: { code: 'move-creature-rule-blocked' },
    })
    expect(harness.maps.getBySlug(fixture.map.slug)?.revision).toBe(7)
    expect(harness.events).toEqual([])
  })

  it.each(REG_029_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_029_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_029_MOVE_NAMES)(
    'rejects stale %s state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_029_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))!
      const command = commandFor(fixture, evidence.scenarioId)
      const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      const racedSlug = moveName === 'Swords Dance' ? 'actor' : TARGET_A_ID
      let racedSheet: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
        const plan: AuthoritativeMoveStatePlan = planAuthoritativeMoveState({
          ...input,
          random: randomSequence(scenario.randomValues),
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
      expect(response.result).toMatchObject({
        ok: false,
        reason: 'conflict',
        message: expect.stringContaining('consulted while resolving the move changed'),
      })
      expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(mapBefore)
      expect(harness.sheets.getByRef('pokemon', racedSlug)?.sheet).toEqual(racedSheet)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )

  it('keeps only the reviewed native ports off the audited v1 adapter', () => {
    for (const moveName of LEGACY_MOVE_NAMES) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        version: 2,
      })
    }
    for (const moveName of ['Supersonic', 'Sweet Scent', 'Swords Dance']) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        version: 2,
      })
    }
  })
})
