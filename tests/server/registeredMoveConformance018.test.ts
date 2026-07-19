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
  NIGHT_DAZE_REG_018_SCENARIOS,
  NIGHT_SLASH_REG_018_SCENARIOS,
  NOBLE_ROAR_REG_018_SCENARIOS,
  NUZZLE_REG_018_SCENARIOS,
  OCTAZOOKA_REG_018_SCENARIOS,
  ORIGIN_PULSE_REG_018_SCENARIOS,
  OVERDRIVE_REG_018_SCENARIOS,
  PECK_REG_018_SCENARIOS,
  REG_018_MOVE_NAMES,
  REG_018_SCENARIOS_BY_MOVE,
  type RegisteredBatch018MoveName,
} from '../fixtures/moveAutomation/registeredBatch018'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const NOW = 5_000

const PASS_DESTINATION = { x: 5, y: 0, z: 1 } as const
const PASS_PATH = [
  { x: 2, y: 0, z: 1 },
  { x: 3, y: 0, z: 1 },
  { x: 4, y: 0, z: 1 },
  { x: 5, y: 0, z: 1 },
] as const

type TargetId = typeof TARGET_A_ID | typeof TARGET_B_ID | typeof TARGET_C_ID
type SelectionKind = 'single-target' | 'pass' | 'burst' | 'close-blast' | 'cone'

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
  readonly moveName: RegisteredBatch018MoveName
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly excludedTargetIds?: readonly TargetId[]
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TokenProfile>>>
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
  species: options.slug === 'actor' ? 'Lurantis' : 'Clefairy',
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
  if (selectionKind === 'pass') {
    if (id === TARGET_A_ID) return { x: 2, y: 0, z: 1 }
    if (id === TARGET_B_ID) return { x: 3, y: 0, z: 1 }
    return { x: 4, y: 0, z: 1 }
  }
  if (selectionKind === 'cone') {
    if (id === TARGET_A_ID) return { x: 5, y: 0, z: 4 }
    if (id === TARGET_B_ID) return { x: 4, y: 0, z: 3 }
    return { x: 6, y: 0, z: 3 }
  }
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
  const actorPosition = selectionKind === 'pass'
    ? { x: 1, y: 0, z: 1 }
    : { x: 5, y: 0, z: 5 }
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-018-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-018 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', actorPosition),
      ...targetIds.map(id => placement(id, id, targetPosition(selectionKind, id))),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-018 scene', startedAt: 100 },
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
      ...(selectionKind === 'pass' ? { direction: 'east' as const } : {}),
      ...(selectionKind === 'cone' ? { direction: 'north' as const } : {}),
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
  scenario: ExecutionScenario,
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
  expect(conditionUpdatesByTarget(resolution.transaction))
    .toEqual(scenario.expectedConditions ?? {})
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  const selectionKind = scenario.selectionKind ?? 'single-target'
  if (selectionKind === 'single-target') {
    expect(resolution.area).toBeUndefined()
  }
  else {
    expect(resolution.area?.candidateTargetIds).toEqual(
      scenario.expectedAreaCandidateTargetIds ?? scenario.expectedAttackedTargetIds,
    )
    expect(resolution.area?.excludedTargetIds).toEqual(scenario.expectedExcludedTargetIds ?? [])
  }

  if (selectionKind === 'pass') {
    expect(resolution.movement).toMatchObject({
      kind: 'pass',
      destination: PASS_DESTINATION,
      pathCells: PASS_PATH,
    })
    expect(resolution.resourceMovement).toMatchObject({ distance: 4, budget: 6 })
  }
  else {
    expect(resolution.movement).toBeUndefined()
  }

  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(resolution.transaction.logLines.join('\n')).toContain('critical')
  }
  for (const targetId of scenario.expectedSmiteMissTargetIds ?? []) {
    expect(resolution.transaction.hitTargetIds).not.toContain(targetId)
    expect(resolution.transaction.hpUpdates.map(update => update.id)).toContain(targetId)
    expect(resolution.transaction.logLines.join('\n')).toContain('Smite miss dealt damage')
  }

  const searchableEvidence = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  for (const fragment of scenario.expectedLogFragments ?? []) {
    expect(searchableEvidence).toContain(fragment)
  }

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
  clientId: 'reg-018-client',
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
    return () => `reg-018-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: NIGHT_DAZE_REG_018_SCENARIOS[0].scenarioId,
    moveName: 'Night Daze',
    randomValues: [0.6, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [13],
  },
  {
    scenarioId: NIGHT_DAZE_REG_018_SCENARIOS[1].scenarioId,
    moveName: 'Night Daze',
    randomValues: [0.55, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [12],
  },
  {
    scenarioId: NIGHT_DAZE_REG_018_SCENARIOS[2].scenarioId,
    moveName: 'Night Daze',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: NIGHT_DAZE_REG_018_SCENARIOS[3].scenarioId,
    moveName: 'Night Daze',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: NIGHT_DAZE_REG_018_SCENARIOS[4].scenarioId,
    moveName: 'Night Daze',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Keen Eye'] } },
    randomValues: [0.6, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [13],
    expectedLogFragments: ['Keen Eye'],
  },
  {
    scenarioId: NIGHT_DAZE_REG_018_SCENARIOS[5].scenarioId,
    moveName: 'Night Daze',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.6, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [13],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: NIGHT_DAZE_REG_018_SCENARIOS[6].scenarioId,
    moveName: 'Night Daze',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -6 }],
    randomValues: [0.6, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [13],
  },
  {
    scenarioId: NIGHT_SLASH_REG_018_SCENARIOS[0].scenarioId,
    moveName: 'Night Slash',
    selectionKind: 'pass',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID],
  },
  {
    scenarioId: NIGHT_SLASH_REG_018_SCENARIOS[1].scenarioId,
    moveName: 'Night Slash',
    selectionKind: 'pass',
    randomValues: [0.85, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: NIGHT_SLASH_REG_018_SCENARIOS[2].scenarioId,
    moveName: 'Night Slash',
    selectionKind: 'pass',
    targetIds: [],
    randomValues: [],
    expectedAttackedTargetIds: [],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: NOBLE_ROAR_REG_018_SCENARIOS[0].scenarioId,
    moveName: 'Noble Roar',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    excludedTargetIds: [TARGET_B_ID],
    randomValues: [0.45, 0],
    expectedStages: [
      { recipientId: TARGET_A_ID, key: 'atk', value: -1 },
      { recipientId: TARGET_A_ID, key: 'satk', value: -1 },
    ],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_C_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10, 1],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedExcludedTargetIds: [TARGET_B_ID],
  },
  {
    scenarioId: NOBLE_ROAR_REG_018_SCENARIOS[1].scenarioId,
    moveName: 'Noble Roar',
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
    scenarioId: NOBLE_ROAR_REG_018_SCENARIOS[2].scenarioId,
    moveName: 'Noble Roar',
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
    scenarioId: NUZZLE_REG_018_SCENARIOS[0].scenarioId,
    moveName: 'Nuzzle',
    randomValues: [0.45, 0],
    expectedConditions: { [TARGET_A_ID]: ['Paralysis'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: NUZZLE_REG_018_SCENARIOS[1].scenarioId,
    moveName: 'Nuzzle',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: NUZZLE_REG_018_SCENARIOS[2].scenarioId,
    moveName: 'Nuzzle',
    randomValues: [0.999, 0, 0],
    expectedConditions: { [TARGET_A_ID]: ['Paralysis'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: NUZZLE_REG_018_SCENARIOS[3].scenarioId,
    moveName: 'Nuzzle',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ground'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Electric immunity'],
  },
  {
    scenarioId: NUZZLE_REG_018_SCENARIOS[4].scenarioId,
    moveName: 'Nuzzle',
    targetProfiles: { [TARGET_A_ID]: { types: ['Electric'] } },
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Electric type'],
  },
  {
    scenarioId: OCTAZOOKA_REG_018_SCENARIOS[0].scenarioId,
    moveName: 'Octazooka',
    randomValues: [0.25, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [6],
  },
  {
    scenarioId: OCTAZOOKA_REG_018_SCENARIOS[1].scenarioId,
    moveName: 'Octazooka',
    randomValues: [0.3, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [7],
  },
  {
    scenarioId: OCTAZOOKA_REG_018_SCENARIOS[2].scenarioId,
    moveName: 'Octazooka',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: OCTAZOOKA_REG_018_SCENARIOS[3].scenarioId,
    moveName: 'Octazooka',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -1 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: OCTAZOOKA_REG_018_SCENARIOS[4].scenarioId,
    moveName: 'Octazooka',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Keen Eye'] } },
    randomValues: [0.25, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [6],
    expectedLogFragments: ['Keen Eye'],
  },
  {
    scenarioId: OCTAZOOKA_REG_018_SCENARIOS[5].scenarioId,
    moveName: 'Octazooka',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: [0.25, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [6],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: OCTAZOOKA_REG_018_SCENARIOS[6].scenarioId,
    moveName: 'Octazooka',
    initialStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -6 }],
    randomValues: [0.25, 0, 0],
    expectedStages: [{ recipientId: TARGET_A_ID, key: 'acc', value: -6 }],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [6],
  },
  {
    scenarioId: ORIGIN_PULSE_REG_018_SCENARIOS[0].scenarioId,
    moveName: 'Origin Pulse',
    selectionKind: 'close-blast',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedAccuracyNaturalResults: [10, 1],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedSmiteMissTargetIds: [TARGET_B_ID],
  },
  {
    scenarioId: ORIGIN_PULSE_REG_018_SCENARIOS[1].scenarioId,
    moveName: 'Origin Pulse',
    selectionKind: 'close-blast',
    randomValues: [0.999, 0, 0, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: OVERDRIVE_REG_018_SCENARIOS[0].scenarioId,
    moveName: 'Overdrive',
    selectionKind: 'cone',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
    expectedAreaCandidateTargetIds: [TARGET_A_ID, TARGET_B_ID],
  },
  {
    scenarioId: OVERDRIVE_REG_018_SCENARIOS[1].scenarioId,
    moveName: 'Overdrive',
    selectionKind: 'cone',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: OVERDRIVE_REG_018_SCENARIOS[2].scenarioId,
    moveName: 'Overdrive',
    selectionKind: 'cone',
    targetProfiles: { [TARGET_A_ID]: { types: ['Ground'] } },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Electric immunity'],
  },
  {
    scenarioId: OVERDRIVE_REG_018_SCENARIOS[3].scenarioId,
    moveName: 'Overdrive',
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
    scenarioId: PECK_REG_018_SCENARIOS[0].scenarioId,
    moveName: 'Peck',
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: PECK_REG_018_SCENARIOS[1].scenarioId,
    moveName: 'Peck',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: PECK_REG_018_SCENARIOS[2].scenarioId,
    moveName: 'Peck',
    randomValues: [0.999, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
]

const recoveryScenarioFor = (moveName: RegisteredBatch018MoveName): ExecutionScenario => {
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

describe('REG-018 registered move conformance', () => {
  it('certifies exactly Night Daze through Peck with linked evidence', () => {
    expect(Object.keys(REG_018_SCENARIOS_BY_MOVE)).toEqual([...REG_018_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_018_SCENARIOS_BY_MOVE)) {
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
      'Night Daze': { ac: 3, damageBase: 9, damageClass: 'Special', range: '4, 1 Target' },
      'Night Slash': { ac: 2, damageBase: 7, damageClass: 'Physical', range: 'Melee, Pass' },
      'Noble Roar': { ac: 2, damageBase: 0, damageClass: 'Status', range: 'Burst 1, Sonic, Friendly, Social' },
      Nuzzle: { ac: 2, damageBase: 2, damageClass: 'Physical', range: 'Melee, 1 Target' },
      Octazooka: { ac: 3, damageBase: 7, damageClass: 'Special', range: '6, 1 Target' },
      'Origin Pulse': { ac: 5, damageBase: 12, damageClass: 'Special', range: 'Close Blast 3, Smite' },
      Overdrive: { ac: 2, damageBase: 8, damageClass: 'Special', range: 'Cone 2, Sonic' },
      Peck: { ac: 2, damageBase: 4, damageClass: 'Physical', range: 'Melee, 1 Target' },
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

    expect(explicitScriptForMove('Night Daze')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'acc',
      delta: -1,
      label: 'Night Daze lowers Accuracy on 13+: -1 Accuracy CS',
      threshold: '13+',
      optional: true,
    }])
    expect(explicitScriptForMove('Night Slash')).toMatchObject({
      keywords: expect.arrayContaining(['Pass']),
      criticalRange: 18,
      areaTemplates: [{ kind: 'pass', size: 4, label: 'Pass 4' }],
    })
    expect(explicitScriptForMove('Noble Roar')).toMatchObject({
      keywords: expect.arrayContaining(['Sonic', 'Friendly', 'Social']),
      areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
      stageSuggestions: [
        { recipient: 'target', key: 'atk', delta: -1 },
        { recipient: 'target', key: 'satk', delta: -1 },
      ],
    })
    expect(explicitScriptForMove('Nuzzle')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Paralysis',
      action: 'add',
      label: 'Paralysis',
    }])
    expect(explicitScriptForMove('Octazooka')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'acc',
      delta: -1,
      label: 'Octazooka lowers Accuracy on even roll: -1 Accuracy CS',
      threshold: 'even roll',
      optional: true,
    }])
    expect(explicitScriptForMove('Origin Pulse')).toMatchObject({
      keywords: expect.arrayContaining(['Smite']),
      areaTemplates: [{ kind: 'close-blast', size: 3, label: 'Close Blast 3' }],
    })
    expect(explicitScriptForMove('Overdrive')).toMatchObject({
      keywords: expect.arrayContaining(['Sonic']),
      areaTemplates: [{ kind: 'cone', size: 2, label: 'Cone 2' }],
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
        idFactory: () => 'reg-018-direct-id',
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
        idFactory: () => 'reg-018-plan-id',
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
        actions: {
          standard: { spent: 1 },
          ...(scenario.selectionKind === 'pass' ? { shift: { spent: 1 } } : {}),
        },
      })
      if (scenario.selectionKind === 'pass') {
        expect(persistedMap?.placements.find(candidate => candidate.id === ACTOR_ID)?.position)
          .toEqual(PASS_DESTINATION)
        expect(persistedMap?.encounterState?.turnResources[ACTOR_ID]?.movement)
          .toMatchObject({ budget: 6, spent: 4 })
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

  it.each(REG_018_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_018_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_018_MOVE_NAMES)(
    'rejects stale %s state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_018_SCENARIOS_BY_MOVE[moveName]
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
