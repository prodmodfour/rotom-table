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
  GRASS_WHISTLE_REG_012_SCENARIOS,
  GRAV_APPLE_REG_012_SCENARIOS,
  GROWL_REG_012_SCENARIOS,
  GUNK_SHOT_REG_012_SCENARIOS,
  HEADBUTT_REG_012_SCENARIOS,
  HEAL_BELL_REG_012_SCENARIOS,
  HEART_STAMP_REG_012_SCENARIOS,
  HEAT_WAVE_REG_012_SCENARIOS,
  REG_012_MOVE_NAMES,
  REG_012_SCENARIOS_BY_MOVE,
  type RegisteredBatch012MoveName,
} from '../fixtures/moveAutomation/registeredBatch012'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const NOW = 5_000

type TargetId = typeof TARGET_A_ID | typeof TARGET_B_ID | typeof TARGET_C_ID
type SelectionKind = 'single-target' | 'burst' | 'close-blast'

interface StageExpectation {
  readonly recipientId: string
  readonly key: CombatStageKey
  readonly value: number
}

interface TargetProfile {
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly conditions?: readonly string[]
}

interface ExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch012MoveName
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly excludedTargetIds?: readonly TargetId[]
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TargetProfile>>>
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
  readonly expectedExcludedTargetIds?: readonly string[]
  readonly expectedReadTargetIds?: readonly string[]
  readonly expectedLogFragments?: readonly string[]
  readonly expectedSmiteMissTargetIds?: readonly string[]
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
  sideId: id === ACTOR_ID || id === TARGET_C_ID ? 'heroes' : 'foes',
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
  readonly profile?: TargetProfile
  readonly initialStages?: readonly StageExpectation[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.slug === 'actor' ? 'Audino' : 'Snorlax',
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
): { readonly x: number; readonly y: number; readonly z: number } => {
  if (selectionKind === 'close-blast') {
    if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
    if (id === TARGET_B_ID) return { x: 6, y: 0, z: 4 }
    return { x: 7, y: 0, z: 5 }
  }
  if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
  if (id === TARGET_B_ID) return { x: 5, y: 0, z: 4 }
  return { x: 4, y: 0, z: 5 }
}

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const selectionKind = scenario.selectionKind ?? 'single-target'
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-012-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-012 ${scenario.moveName}`,
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
    activeScene: { name: 'REG-012 scene', startedAt: 100 },
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
      ...(selectionKind === 'close-blast' ? { aimCell: { x: 6, y: 0, z: 5 } } : {}),
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
    expect(resolution.area?.excludedTargetIds).toEqual(scenario.expectedExcludedTargetIds ?? [])
  }

  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) {
      expect(resolution.feedback.crit).toBe(true)
    }
    else {
      expect(JSON.stringify(resolution.auditTrace.events)).toContain('"critical":true')
    }
  }

  const searchableEvidence = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  assertReviewedNativeEvidenceFragments(searchableEvidence, scenario.expectedLogFragments ?? [])
  for (const targetId of scenario.expectedSmiteMissTargetIds ?? []) {
    expect(resolution.transaction.hitTargetIds).not.toContain(targetId)
    expect(resolution.transaction.hpUpdates.map(update => update.id)).toContain(targetId)
    assertReviewedNativeSmiteMissEvidence(resolution, targetId)
  }

  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
  const readTargets = scenario.expectedReadTargetIds
    ?? scenario.targetIds
    ?? [TARGET_A_ID]
  expect(resolution.sheetReads.map(read => read.slug).sort())
    .toEqual([...new Set(['actor', ...readTargets])].sort())
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
  clientId: 'reg-012-client',
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
    return () => `reg-012-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const flinched = { [TARGET_A_ID]: ['Flinch', 'Vulnerable'] } as const
const poisoned = { [TARGET_A_ID]: ['Poisoned'] } as const
const burned = { [TARGET_A_ID]: ['Burned'] } as const

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: GRASS_WHISTLE_REG_012_SCENARIOS[0].scenarioId,
    moveName: 'Grass Whistle',
    randomValues: [0.45],
    expectedConditions: { [TARGET_A_ID]: ['Sleep'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: GRASS_WHISTLE_REG_012_SCENARIOS[1].scenarioId,
    moveName: 'Grass Whistle',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: GRASS_WHISTLE_REG_012_SCENARIOS[2].scenarioId,
    moveName: 'Grass Whistle',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Soundproof'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Soundproof'],
  },
  {
    scenarioId: GRASS_WHISTLE_REG_012_SCENARIOS[3].scenarioId,
    moveName: 'Grass Whistle',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Sweet Veil'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Sweet Veil'],
  },
  {
    scenarioId: GRAV_APPLE_REG_012_SCENARIOS[0].scenarioId,
    moveName: 'Grav Apple',
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: GRAV_APPLE_REG_012_SCENARIOS[1].scenarioId,
    moveName: 'Grav Apple',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: GRAV_APPLE_REG_012_SCENARIOS[2].scenarioId,
    moveName: 'Grav Apple',
    randomValues: [0.999, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: GRAV_APPLE_REG_012_SCENARIOS[3].scenarioId,
    moveName: 'Grav Apple',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Sap Sipper'] } },
    randomValues: [0.45, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Grass immunity'],
  },
  {
    scenarioId: GRAV_APPLE_REG_012_SCENARIOS[4].scenarioId,
    moveName: 'Grav Apple',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -6 }],
    randomValues: [0.45, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'def', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: GROWL_REG_012_SCENARIOS[0].scenarioId,
    moveName: 'Growl',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    excludedTargetIds: [TARGET_C_ID],
    randomValues: [0.45, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'atk', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10, 1],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedExcludedTargetIds: [TARGET_C_ID],
  },
  {
    scenarioId: GROWL_REG_012_SCENARIOS[1].scenarioId,
    moveName: 'Growl',
    selectionKind: 'burst',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Soundproof'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Soundproof'],
  },
  {
    scenarioId: GROWL_REG_012_SCENARIOS[2].scenarioId,
    moveName: 'Growl',
    selectionKind: 'burst',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'atk', value: -6 }],
    randomValues: [0.45],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'atk', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: GUNK_SHOT_REG_012_SCENARIOS[0].scenarioId,
    moveName: 'Gunk Shot',
    randomValues: [0.7, 0, 0, 0],
    expectedConditions: poisoned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: GUNK_SHOT_REG_012_SCENARIOS[1].scenarioId,
    moveName: 'Gunk Shot',
    randomValues: [0.65, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: GUNK_SHOT_REG_012_SCENARIOS[2].scenarioId,
    moveName: 'Gunk Shot',
    randomValues: [0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [1],
    expectedSmiteMissTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: GUNK_SHOT_REG_012_SCENARIOS[3].scenarioId,
    moveName: 'Gunk Shot',
    randomValues: [0.999, 0, 0, 0],
    expectedConditions: poisoned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: GUNK_SHOT_REG_012_SCENARIOS[4].scenarioId,
    moveName: 'Gunk Shot',
    targetProfiles: { [TARGET_A_ID]: { types: ['Steel'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Steel type'],
  },
  {
    scenarioId: GUNK_SHOT_REG_012_SCENARIOS[5].scenarioId,
    moveName: 'Gunk Shot',
    targetProfiles: { [TARGET_A_ID]: { types: ['Poison'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Poison type'],
  },
  {
    scenarioId: GUNK_SHOT_REG_012_SCENARIOS[6].scenarioId,
    moveName: 'Gunk Shot',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: HEADBUTT_REG_012_SCENARIOS[0].scenarioId,
    moveName: 'Headbutt',
    randomValues: [0.7, 0, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: HEADBUTT_REG_012_SCENARIOS[1].scenarioId,
    moveName: 'Headbutt',
    randomValues: [0.65, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: HEADBUTT_REG_012_SCENARIOS[2].scenarioId,
    moveName: 'Headbutt',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: HEADBUTT_REG_012_SCENARIOS[3].scenarioId,
    moveName: 'Headbutt',
    randomValues: [0.999, 0, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: HEADBUTT_REG_012_SCENARIOS[4].scenarioId,
    moveName: 'Headbutt',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ghost'] } },
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Normal immunity'],
  },
  {
    scenarioId: HEADBUTT_REG_012_SCENARIOS[5].scenarioId,
    moveName: 'Headbutt',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: HEAL_BELL_REG_012_SCENARIOS[0].scenarioId,
    moveName: 'Heal Bell',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    targetProfiles: {
      [TARGET_A_ID]: {
        conditions: ['Burned', 'Paralysis', 'Frozen', 'Poisoned', 'Badly Poisoned', 'Confused'],
      },
      [TARGET_B_ID]: { conditions: ['Sleep'] },
    },
    randomValues: [],
    expectedConditions: { [TARGET_A_ID]: ['Confused'] },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID],
  },
  {
    scenarioId: HEAL_BELL_REG_012_SCENARIOS[1].scenarioId,
    moveName: 'Heal Bell',
    selectionKind: 'burst',
    targetProfiles: {
      [TARGET_A_ID]: { abilities: ['Soundproof'], conditions: ['Burned'] },
    },
    randomValues: [],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
    expectedLogFragments: ['Soundproof'],
  },
  {
    scenarioId: HEART_STAMP_REG_012_SCENARIOS[0].scenarioId,
    moveName: 'Heart Stamp',
    randomValues: [0.7, 0, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: HEART_STAMP_REG_012_SCENARIOS[1].scenarioId,
    moveName: 'Heart Stamp',
    randomValues: [0.65, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [14],
  },
  {
    scenarioId: HEART_STAMP_REG_012_SCENARIOS[2].scenarioId,
    moveName: 'Heart Stamp',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: HEART_STAMP_REG_012_SCENARIOS[3].scenarioId,
    moveName: 'Heart Stamp',
    randomValues: [0.999, 0, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: HEART_STAMP_REG_012_SCENARIOS[4].scenarioId,
    moveName: 'Heart Stamp',
    targetProfiles: { [TARGET_A_ID]: { types: ['Dark'] } },
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Psychic immunity'],
  },
  {
    scenarioId: HEART_STAMP_REG_012_SCENARIOS[5].scenarioId,
    moveName: 'Heart Stamp',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.7, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: HEAT_WAVE_REG_012_SCENARIOS[0].scenarioId,
    moveName: 'Heat Wave',
    selectionKind: 'close-blast',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.85, 0, 0, 0, 0, 0, 0, 0],
    expectedConditions: burned,
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedAccuracyNaturalResults: [18, 1],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedSmiteMissTargetIds: [TARGET_B_ID],
  },
  {
    scenarioId: HEAT_WAVE_REG_012_SCENARIOS[1].scenarioId,
    moveName: 'Heat Wave',
    selectionKind: 'close-blast',
    randomValues: [0.8, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: HEAT_WAVE_REG_012_SCENARIOS[2].scenarioId,
    moveName: 'Heat Wave',
    selectionKind: 'close-blast',
    randomValues: [0.999, 0, 0, 0],
    expectedConditions: burned,
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: HEAT_WAVE_REG_012_SCENARIOS[3].scenarioId,
    moveName: 'Heat Wave',
    selectionKind: 'close-blast',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Flash Fire'] } },
    randomValues: [0.85, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [18],
    expectedLogFragments: ['Flash Fire'],
  },
  {
    scenarioId: HEAT_WAVE_REG_012_SCENARIOS[4].scenarioId,
    moveName: 'Heat Wave',
    selectionKind: 'close-blast',
    targetProfiles: { [TARGET_A_ID]: { types: ['Fire'] } },
    randomValues: [0.85, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
    expectedLogFragments: ['Fire type'],
  },
  {
    scenarioId: HEAT_WAVE_REG_012_SCENARIOS[5].scenarioId,
    moveName: 'Heat Wave',
    selectionKind: 'close-blast',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.85, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
    expectedLogFragments: ['Shield Dust'],
  },
]

const recoveryScenarioFor = (moveName: RegisteredBatch012MoveName): ExecutionScenario => {
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

describe('REG-012 registered move conformance', () => {
  it('certifies exactly Grass Whistle through Heat Wave with linked evidence', () => {
    expect(Object.keys(REG_012_SCENARIOS_BY_MOVE)).toEqual([...REG_012_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_012_SCENARIOS_BY_MOVE)) {
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
      'Grass Whistle': { ac: 6, damageBase: 0, damageClass: 'Status', range: '6, 1 Target, Sonic' },
      'Grav Apple': { ac: 2, damageBase: 8, damageClass: 'Physical', range: '6, 1 Target' },
      Growl: { ac: 2, damageBase: 0, damageClass: 'Status', range: 'Burst 1, Friendly, Sonic, Social' },
      'Gunk Shot': { ac: 5, damageBase: 12, damageClass: 'Physical', range: '6, 1 Target, Smite' },
      Headbutt: { ac: 2, damageBase: 7, damageClass: 'Physical', range: 'Melee, 1 Target' },
      'Heal Bell': { ac: null, damageBase: null, damageClass: 'Status', range: 'Burst 3, Sonic', requiresAccuracy: false },
      'Heart Stamp': { ac: 2, damageBase: 6, damageClass: 'Physical', range: 'Melee, 1 Target' },
      'Heat Wave': { ac: 4, damageBase: 10, damageClass: 'Special', range: 'Close Blast 3, Smite' },
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

    expect(explicitScriptForMove('Grass Whistle')).toMatchObject({
      keywords: expect.arrayContaining(['Sonic']),
      conditionSuggestions: [{ recipient: 'target', condition: 'Sleep', action: 'add' }],
    })
    expect(explicitScriptForMove('Grav Apple')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'def',
      delta: -1,
      label: 'Grav Apple lowers Defense: -1 Defense CS',
    }])
    expect(explicitScriptForMove('Growl')).toMatchObject({
      keywords: expect.arrayContaining(['Friendly', 'Sonic', 'Social']),
      areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
      stageSuggestions: [{ recipient: 'target', key: 'atk', delta: -1 }],
    })
    expect(explicitScriptForMove('Gunk Shot')).toMatchObject({
      keywords: expect.arrayContaining(['Smite']),
      conditionSuggestions: [{ recipient: 'target', condition: 'Poisoned', threshold: '15+' }],
    })
    for (const moveName of ['Headbutt', 'Heart Stamp']) {
      expect(explicitScriptForMove(moveName)?.conditionSuggestions, moveName).toEqual([{
        recipient: 'target',
        condition: 'Flinch',
        action: 'add',
        label: 'Flinch on 15+',
        threshold: '15+',
        optional: true,
      }])
    }
    expect(explicitScriptForMove('Heal Bell')).toMatchObject({
      keywords: expect.arrayContaining(['Sonic']),
      areaTemplates: [{ kind: 'burst', size: 3, label: 'Burst 3' }],
      conditionSuggestions: expect.arrayContaining([
        { recipient: 'target', condition: 'Burned', action: 'remove', label: 'Burned' },
        { recipient: 'target', condition: 'Paralysis', action: 'remove', label: 'Paralysis' },
        { recipient: 'target', condition: 'Frozen', action: 'remove', label: 'Frozen' },
        { recipient: 'target', condition: 'Poisoned', action: 'remove', label: 'Poisoned' },
        { recipient: 'target', condition: 'Badly Poisoned', action: 'remove', label: 'Badly Poisoned' },
      ]),
    })
    expect(explicitScriptForMove('Heat Wave')).toMatchObject({
      keywords: expect.arrayContaining(['Smite']),
      areaTemplates: [{ kind: 'close-blast', size: 3, label: 'Close Blast 3' }],
      conditionSuggestions: [{ recipient: 'target', condition: 'Burned', threshold: '18+' }],
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
        idFactory: () => 'reg-012-direct-id',
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
        idFactory: () => 'reg-012-plan-id',
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

  it.each(REG_012_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_012_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_012_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_012_SCENARIOS_BY_MOVE[moveName]
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
