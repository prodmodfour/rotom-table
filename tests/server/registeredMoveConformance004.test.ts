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
  BOOMBURST_REG_004_SCENARIOS,
  BRANCH_POKE_REG_004_SCENARIOS,
  BREAKING_SWIPE_REG_004_SCENARIOS,
  BRUTAL_SWING_REG_004_SCENARIOS,
  BUBBLE_BEAM_REG_004_SCENARIOS,
  BUBBLE_REG_004_SCENARIOS,
  BULLDOZE_REG_004_SCENARIOS,
  BULLET_PUNCH_REG_004_SCENARIOS,
  REG_004_MOVE_NAMES,
  REG_004_SCENARIOS_BY_MOVE,
  type RegisteredBatch004MoveName,
} from '../fixtures/moveAutomation/registeredBatch004'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const NOW = 5_000

type SelectionKind = 'single-target' | 'burst' | 'close-blast'

interface StageExpectation {
  readonly recipientId: string
  readonly key: CombatStageKey
  readonly value: number
}

interface LegacyExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch004MoveName
  readonly selectionKind: SelectionKind
  readonly targetIds?: readonly string[]
  readonly randomValues: readonly number[]
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly initialStage?: StageExpectation
  readonly expectedStage?: StageExpectation
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedLogFragment?: string
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
      atk: { added: 30, stage: valueFor('atk') },
      def: { added: 5, stage: valueFor('def') },
      satk: { added: 30, stage: valueFor('satk') },
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
  species: options.slug === 'actor' ? 'Audino' : 'Snorlax',
  level: 20,
  revision: 3,
  types: [...(options.types ?? ['Normal'])],
  abilities: (options.abilities ?? []).map(name => ({ name })),
  movelist: [...(options.moves ?? [])],
  ...stageMap(options.initialStage, options.placementId),
  combat: { currentHp: 500, conditions: [] },
})

const targetPosition = (
  selectionKind: SelectionKind,
  id: string,
): { readonly x: number; readonly y: number; readonly z: number } => {
  if (id === TARGET_A_ID) return { x: 6, y: 0, z: 5 }
  return selectionKind === 'close-blast'
    ? { x: 6, y: 0, z: 4 }
    : { x: 5, y: 0, z: 4 }
}

const fixtureFor = (
  scenario: LegacyExecutionScenario,
  mapOverrides: Partial<TabletopMap> = {},
): LegacyFixture => {
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-004-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-004 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 5, y: 0, z: 5 }),
      ...targetIds.map(id => placement(id, id, targetPosition(scenario.selectionKind, id))),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-004 scene', startedAt: 100 },
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
  if (scenario.selectionKind === 'single-target') {
    selection = { kind: 'single-target', targetPlacementId: TARGET_A_ID }
  }
  else {
    const templateKind = scenario.selectionKind === 'burst' ? 'burst' : 'close-blast'
    const template = script.areaTemplates?.find(candidate => candidate.kind === templateKind)
    if (!template) throw new Error(`${scenario.moveName} must retain its reviewed ${templateKind} template.`)
    selection = {
      kind: 'area',
      areaTemplateId: moveAutomationAreaTemplateId(template),
      ...(scenario.selectionKind === 'close-blast'
        ? { aimCell: { x: 6, y: 0, z: 5 } }
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

const assertScenarioResolution = (
  scenario: LegacyExecutionScenario,
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

  if (scenario.expectedStage) {
    expect(stageValue(resolution.transaction, scenario.expectedStage))
      .toBe(scenario.expectedStage.value)
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
    expect(resolution.area?.candidateTargetIds).toEqual(scenario.expectedAttackedTargetIds)
  }

  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(JSON.stringify(resolution.auditTrace.events)).toContain('"critical":true')
  }

  if (scenario.expectedLogFragment) {
    assertReviewedNativeEvidenceFragments([
      resolution.transaction.logLines.join('\n'),
      JSON.stringify(resolution.auditTrace),
    ].join('\n'), [scenario.expectedLogFragment])
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
  clientId: 'reg-004-client',
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
    return () => `reg-004-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const normalScenarios: readonly LegacyExecutionScenario[] = [
  {
    scenarioId: BOOMBURST_REG_004_SCENARIOS[0].scenarioId,
    moveName: 'Boomburst',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: BOOMBURST_REG_004_SCENARIOS[1].scenarioId,
    moveName: 'Boomburst',
    selectionKind: 'burst',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: BOOMBURST_REG_004_SCENARIOS[2].scenarioId,
    moveName: 'Boomburst',
    selectionKind: 'burst',
    randomValues: [0.45],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: BOOMBURST_REG_004_SCENARIOS[3].scenarioId,
    moveName: 'Boomburst',
    selectionKind: 'burst',
    randomValues: [0.45],
    targetAbilities: ['Soundproof'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: BRANCH_POKE_REG_004_SCENARIOS[0].scenarioId,
    moveName: 'Branch Poke',
    selectionKind: 'single-target',
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: BRANCH_POKE_REG_004_SCENARIOS[1].scenarioId,
    moveName: 'Branch Poke',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: BRANCH_POKE_REG_004_SCENARIOS[2].scenarioId,
    moveName: 'Branch Poke',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: BRANCH_POKE_REG_004_SCENARIOS[3].scenarioId,
    moveName: 'Branch Poke',
    selectionKind: 'single-target',
    randomValues: [0.45],
    targetAbilities: ['Sap Sipper'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: BREAKING_SWIPE_REG_004_SCENARIOS[0].scenarioId,
    moveName: 'Breaking Swipe',
    selectionKind: 'close-blast',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'atk', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: BREAKING_SWIPE_REG_004_SCENARIOS[1].scenarioId,
    moveName: 'Breaking Swipe',
    selectionKind: 'close-blast',
    randomValues: [0.999, 0, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'atk', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: BREAKING_SWIPE_REG_004_SCENARIOS[2].scenarioId,
    moveName: 'Breaking Swipe',
    selectionKind: 'close-blast',
    randomValues: [0.45],
    targetTypes: ['Fairy'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragment: 'immune',
  },
  {
    scenarioId: BREAKING_SWIPE_REG_004_SCENARIOS[3].scenarioId,
    moveName: 'Breaking Swipe',
    selectionKind: 'close-blast',
    randomValues: [0.45, 0, 0],
    initialStage: { recipientId: TARGET_A_ID, key: 'atk', value: -6 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'atk', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: BRUTAL_SWING_REG_004_SCENARIOS[0].scenarioId,
    moveName: 'Brutal Swing',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: BRUTAL_SWING_REG_004_SCENARIOS[1].scenarioId,
    moveName: 'Brutal Swing',
    selectionKind: 'burst',
    randomValues: [0.999, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: BUBBLE_REG_004_SCENARIOS[0].scenarioId,
    moveName: 'Bubble',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.75, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16, 1],
  },
  {
    scenarioId: BUBBLE_REG_004_SCENARIOS[1].scenarioId,
    moveName: 'Bubble',
    selectionKind: 'burst',
    randomValues: [0.7, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [15],
  },
  {
    scenarioId: BUBBLE_REG_004_SCENARIOS[2].scenarioId,
    moveName: 'Bubble',
    selectionKind: 'burst',
    randomValues: [0.999, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: BUBBLE_REG_004_SCENARIOS[3].scenarioId,
    moveName: 'Bubble',
    selectionKind: 'burst',
    randomValues: [0.75, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
    expectedLogFragment: 'Shield Dust',
  },
  {
    scenarioId: BUBBLE_REG_004_SCENARIOS[4].scenarioId,
    moveName: 'Bubble',
    selectionKind: 'burst',
    randomValues: [0.75, 0],
    initialStage: { recipientId: TARGET_A_ID, key: 'spd', value: -6 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: BUBBLE_BEAM_REG_004_SCENARIOS[0].scenarioId,
    moveName: 'Bubble Beam',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: BUBBLE_BEAM_REG_004_SCENARIOS[1].scenarioId,
    moveName: 'Bubble Beam',
    selectionKind: 'single-target',
    randomValues: [0.8, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: BUBBLE_BEAM_REG_004_SCENARIOS[2].scenarioId,
    moveName: 'Bubble Beam',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: BUBBLE_BEAM_REG_004_SCENARIOS[3].scenarioId,
    moveName: 'Bubble Beam',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: BUBBLE_BEAM_REG_004_SCENARIOS[4].scenarioId,
    moveName: 'Bubble Beam',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
    expectedLogFragment: 'Shield Dust',
  },
  {
    scenarioId: BUBBLE_BEAM_REG_004_SCENARIOS[5].scenarioId,
    moveName: 'Bubble Beam',
    selectionKind: 'single-target',
    randomValues: [0.85, 0, 0, 0],
    initialStage: { recipientId: TARGET_A_ID, key: 'spd', value: -6 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: BULLDOZE_REG_004_SCENARIOS[0].scenarioId,
    moveName: 'Bulldoze',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID],
    randomValues: [0.45, 0, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10, 1],
  },
  {
    scenarioId: BULLDOZE_REG_004_SCENARIOS[1].scenarioId,
    moveName: 'Bulldoze',
    selectionKind: 'burst',
    randomValues: [0.999, 0, 0, 0],
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -1 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: BULLDOZE_REG_004_SCENARIOS[2].scenarioId,
    moveName: 'Bulldoze',
    selectionKind: 'burst',
    randomValues: [0.45, 0, 0],
    initialStage: { recipientId: TARGET_A_ID, key: 'spd', value: -6 },
    expectedStage: { recipientId: TARGET_A_ID, key: 'spd', value: -6 },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: BULLET_PUNCH_REG_004_SCENARIOS[0].scenarioId,
    moveName: 'Bullet Punch',
    selectionKind: 'single-target',
    randomValues: [0.45, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: BULLET_PUNCH_REG_004_SCENARIOS[1].scenarioId,
    moveName: 'Bullet Punch',
    selectionKind: 'single-target',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: BULLET_PUNCH_REG_004_SCENARIOS[2].scenarioId,
    moveName: 'Bullet Punch',
    selectionKind: 'single-target',
    randomValues: [0.999, 0, 0],
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
]

const recoveryScenarioFor = (
  moveName: RegisteredBatch004MoveName,
): LegacyExecutionScenario => {
  const matching = normalScenarios.find(scenario => scenario.moveName === moveName
    && scenario.expectedHitTargetIds.includes(TARGET_A_ID)
    && scenario.expectedDamagedTargetIds.includes(TARGET_A_ID))
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

describe('REG-004 registered move conformance', () => {
  it('certifies exactly Boomburst through Bullet Punch with linked evidence', () => {
    expect(Object.keys(REG_004_SCENARIOS_BY_MOVE)).toEqual([...REG_004_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_004_SCENARIOS_BY_MOVE)) {
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

  it('retains the reviewed canonical mechanics without unresolved rule instructions', () => {
    const expected = {
      Boomburst: { ac: 2, damageBase: 14, damageClass: 'Special', range: 'Burst 1, Sonic' },
      'Branch Poke': { ac: 2, damageBase: 4, damageClass: 'Physical', range: '2, 1 Target' },
      'Breaking Swipe': { ac: 2, damageBase: 6, damageClass: 'Physical', range: 'Close Blast 2' },
      'Brutal Swing': { ac: 2, damageBase: 6, damageClass: 'Physical', range: 'Burst 1' },
      Bubble: { ac: 2, damageBase: 4, damageClass: 'Special', range: 'Burst 1' },
      'Bubble Beam': { ac: 2, damageBase: 8, damageClass: 'Special', range: '4, 1 Target' },
      Bulldoze: { ac: 2, damageBase: 6, damageClass: 'Physical', range: 'Burst 1' },
      'Bullet Punch': { ac: 2, damageBase: 4, damageClass: 'Physical', range: 'Melee, 1 Target, Priority' },
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
    expect(explicitScriptForMove('Boomburst')?.keywords).toContain('Sonic')
    expect(explicitScriptForMove('Boomburst')?.areaTemplates).toEqual([
      { kind: 'burst', size: 1, label: 'Burst 1' },
    ])
    expect(explicitScriptForMove('Breaking Swipe')?.areaTemplates).toEqual([
      { kind: 'close-blast', size: 2, label: 'Close Blast 2' },
    ])
    expect(explicitScriptForMove('Breaking Swipe')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'atk',
      delta: -1,
      label: 'Breaking Swipe lowers Attack: -1 Attack CS',
    }])
    expect(explicitScriptForMove('Bubble')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'spd',
      delta: -1,
      label: 'Bubble lowers Speed on 16+: -1 Speed CS',
      threshold: '16+',
      optional: true,
    }])
    expect(explicitScriptForMove('Bubble Beam')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'spd',
      delta: -1,
      label: 'Bubble Beam lowers Speed on 18+: -1 Speed CS',
      threshold: '18+',
      optional: true,
    }])
    expect(explicitScriptForMove('Bulldoze')?.stageSuggestions).toEqual([{
      recipient: 'target',
      key: 'spd',
      delta: -1,
      label: 'Bulldoze lowers Speed: -1 Speed CS',
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
        idFactory: () => 'reg-004-direct-id',
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
        idFactory: () => 'reg-004-plan-id',
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

  it('rejects Bullet Punch Priority after the actor has acted without partial mutation', async () => {
    const scenario = recoveryScenarioFor('Bullet Punch')
    const fixture = fixtureFor(scenario, {
      encounterState: {
        ...createEmptyEncounterState(),
        history: {
          ...createEmptyEncounterState().history,
          actedThisRoundPlacementIds: [ACTOR_ID],
        },
      },
    })
    const inputSnapshot = deepCloneJson({
      map: fixture.map,
      pokemonSheets: [...fixture.pokemonSheets],
      trainerSheets: [...fixture.trainerSheets],
    })
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: randomSequence(scenario.randomValues),
      now: () => NOW,
      operationId: `op_${BULLET_PUNCH_REG_004_SCENARIOS[3].scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
    })).toThrowError(expect.objectContaining({
      code: 'move-resource-unavailable',
      message: expect.stringContaining('priority-unavailable'),
    }))
    expect({
      map: fixture.map,
      pokemonSheets: [...fixture.pokemonSheets],
      trainerSheets: [...fixture.trainerSheets],
    }).toEqual(inputSnapshot)

    const harness = openHarness(fixture)
    const command = commandFor(fixture, `${BULLET_PUNCH_REG_004_SCENARIOS[3].scenarioId}.command`)
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

  it.each(REG_004_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_004_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_004_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_004_SCENARIOS_BY_MOVE[moveName]
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
