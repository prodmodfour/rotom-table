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
import { FURY_ATTACK_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/furyAttack'
import { FURY_CUTTER_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/furyCutter'
import { FURY_SWIPES_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/furySwipes'
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
  FLATTER_REG_011_SCENARIOS,
  FOCUS_BLAST_REG_011_SCENARIOS,
  FORCE_PALM_REG_011_SCENARIOS,
  FRUSTRATION_REG_011_SCENARIOS,
  FURY_ATTACK_REG_011_SCENARIOS,
  FURY_CUTTER_REG_011_SCENARIOS,
  FURY_SWIPES_REG_011_SCENARIOS,
  GLARE_REG_011_SCENARIOS,
  REG_011_MOVE_NAMES,
  REG_011_SCENARIOS_BY_MOVE,
  type RegisteredBatch011MoveName,
} from '../fixtures/moveAutomation/registeredBatch011'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_ID = 'target-token'
const NOW = 5_000

type LegacyMoveName = Exclude<
  RegisteredBatch011MoveName,
  'Fury Attack' | 'Fury Cutter' | 'Fury Swipes'
>

interface StageExpectation {
  readonly recipientId: string
  readonly key: CombatStageKey
  readonly value: number
}

interface ExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch011MoveName
  readonly randomValues: readonly number[]
  readonly actorLoyalty?: number
  readonly targetTypes?: readonly string[]
  readonly targetAbilities?: readonly string[]
  readonly initialStages?: readonly StageExpectation[]
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedConditions?: readonly string[]
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults?: readonly number[]
  readonly expectedCriticalTargetIds?: readonly string[]
  readonly expectedLogFragments?: readonly string[]
  readonly expectedSmiteMissTargetIds?: readonly string[]
  readonly expectedDamageBase?: number
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

const placement = (id: string, sheetSlug: string, x: number): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position: { x, y: 0, z: 3 },
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
  readonly loyalty?: number
  readonly initialStages?: readonly StageExpectation[]
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.slug === 'actor' ? 'Audino' : 'Snorlax',
  level: 20,
  revision: 3,
  types: [...(options.types ?? ['Psychic'])],
  abilities: (options.abilities ?? []).map(name => ({ name })),
  capabilities: { overland: 6 },
  movelist: [...(options.moves ?? [])],
  ...(options.loyalty !== undefined ? { loyalty: options.loyalty } : {}),
  ...stageMap(options.initialStages, options.placementId),
  combat: { currentHp: 500, conditions: [] },
})

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-011-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-011 ${scenario.moveName}`,
    revision: 7,
    dimensions: { x: 8, y: 3, z: 8 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', 3),
      placement(TARGET_ID, 'target', 4),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-011 scene', startedAt: 100 },
    encounterState: createEmptyEncounterState(),
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  const actor = pokemonSheet({
    slug: 'actor',
    placementId: ACTOR_ID,
    moves: [{ name: scenario.moveName }],
    loyalty: scenario.actorLoyalty,
    initialStages: scenario.initialStages,
  })
  const target = pokemonSheet({
    slug: 'target',
    placementId: TARGET_ID,
    types: scenario.targetTypes ?? ['Normal'],
    abilities: scenario.targetAbilities,
    initialStages: scenario.initialStages,
  })
  if (!explicitScriptForMove(scenario.moveName)) {
    throw new Error(`Missing reviewed script for ${scenario.moveName}.`)
  }

  return {
    map,
    pokemonSheets: new Map([
      ['actor', actor],
      ['target', target],
    ]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: ACTOR_ID,
      moveName: scenario.moveName,
      selection: { kind: 'single-target', targetPlacementId: TARGET_ID },
    },
    candidateScopePlacementIds: [TARGET_ID],
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
  expect(resolution.transaction.conditionUpdates).toEqual(
    scenario.expectedConditions
      ? [{ id: TARGET_ID, conditions: scenario.expectedConditions }]
      : [],
  )
  expect(accuracyNaturalResults(resolution))
    .toEqual(scenario.expectedAccuracyNaturalResults ?? [])
  expect(resolution.area).toBeUndefined()

  if (scenario.expectedDamageBase !== undefined) {
    expect(resolution.script.damageBase).toBe(scenario.expectedDamageBase)
  }
  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) {
      expect(resolution.feedback.crit).toBe(true)
    }
    else {
      expect(resolution.transaction.logLines.join('\n')).toContain('critical')
    }
  }

  const searchableEvidence = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  for (const fragment of scenario.expectedLogFragments ?? []) {
    expect(searchableEvidence).toContain(fragment)
  }
  for (const targetId of scenario.expectedSmiteMissTargetIds ?? []) {
    expect(resolution.transaction.hitTargetIds).not.toContain(targetId)
    expect(resolution.transaction.hpUpdates.map(update => update.id)).toContain(targetId)
    expect(resolution.transaction.logLines.join('\n')).toContain('Smite miss dealt damage')
    expect(resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      recipientIds: [targetId],
      reasonCode: 'legacy-smite-miss-damage',
    }))
  }

  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort()).toEqual(['actor', 'target'])
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
  clientId: 'reg-011-client',
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
    return () => `reg-011-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: FLATTER_REG_011_SCENARIOS[0].scenarioId,
    moveName: 'Flatter',
    randomValues: [0.45],
    expectedStages: [{ recipientId: TARGET_ID, key: 'satk', value: 1 }],
    expectedConditions: ['Confused'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: FLATTER_REG_011_SCENARIOS[1].scenarioId,
    moveName: 'Flatter',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: FLATTER_REG_011_SCENARIOS[2].scenarioId,
    moveName: 'Flatter',
    randomValues: [0.45],
    initialStages: [{ recipientId: TARGET_ID, key: 'satk', value: 6 }],
    expectedStages: [{ recipientId: TARGET_ID, key: 'satk', value: 6 }],
    expectedConditions: ['Confused'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: FOCUS_BLAST_REG_011_SCENARIOS[0].scenarioId,
    moveName: 'Focus Blast',
    randomValues: [0.85, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_ID, key: 'sdef', value: -1 }],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: FOCUS_BLAST_REG_011_SCENARIOS[1].scenarioId,
    moveName: 'Focus Blast',
    randomValues: [0.8, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: FOCUS_BLAST_REG_011_SCENARIOS[2].scenarioId,
    moveName: 'Focus Blast',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [1],
    expectedSmiteMissTargetIds: [TARGET_ID],
  },
  {
    scenarioId: FOCUS_BLAST_REG_011_SCENARIOS[3].scenarioId,
    moveName: 'Focus Blast',
    randomValues: [0.999, 0, 0, 0, 0],
    expectedStages: [{ recipientId: TARGET_ID, key: 'sdef', value: -1 }],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_ID],
  },
  {
    scenarioId: FOCUS_BLAST_REG_011_SCENARIOS[4].scenarioId,
    moveName: 'Focus Blast',
    randomValues: [0.85],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: FOCUS_BLAST_REG_011_SCENARIOS[5].scenarioId,
    moveName: 'Focus Blast',
    randomValues: [0.85, 0, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [18],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: FOCUS_BLAST_REG_011_SCENARIOS[6].scenarioId,
    moveName: 'Focus Blast',
    randomValues: [0.85, 0, 0, 0],
    initialStages: [{ recipientId: TARGET_ID, key: 'sdef', value: -6 }],
    expectedStages: [{ recipientId: TARGET_ID, key: 'sdef', value: -6 }],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: FORCE_PALM_REG_011_SCENARIOS[0].scenarioId,
    moveName: 'Force Palm',
    randomValues: [0.85, 0, 0],
    expectedConditions: ['Paralysis'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: FORCE_PALM_REG_011_SCENARIOS[1].scenarioId,
    moveName: 'Force Palm',
    randomValues: [0.8, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [17],
  },
  {
    scenarioId: FORCE_PALM_REG_011_SCENARIOS[2].scenarioId,
    moveName: 'Force Palm',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: FORCE_PALM_REG_011_SCENARIOS[3].scenarioId,
    moveName: 'Force Palm',
    randomValues: [0.999, 0, 0, 0],
    expectedConditions: ['Paralysis'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_ID],
  },
  {
    scenarioId: FORCE_PALM_REG_011_SCENARIOS[4].scenarioId,
    moveName: 'Force Palm',
    randomValues: [0.85],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: FORCE_PALM_REG_011_SCENARIOS[5].scenarioId,
    moveName: 'Force Palm',
    randomValues: [0.85, 0, 0],
    targetTypes: ['Electric'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [18],
    expectedLogFragments: ['Electric type'],
  },
  {
    scenarioId: FORCE_PALM_REG_011_SCENARIOS[6].scenarioId,
    moveName: 'Force Palm',
    randomValues: [0.85, 0, 0],
    targetAbilities: ['Shield Dust'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [18],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: FRUSTRATION_REG_011_SCENARIOS[0].scenarioId,
    moveName: 'Frustration',
    actorLoyalty: 0,
    randomValues: [0.45, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [10],
    expectedDamageBase: 9,
  },
  {
    scenarioId: FRUSTRATION_REG_011_SCENARIOS[1].scenarioId,
    moveName: 'Frustration',
    actorLoyalty: 6,
    randomValues: [0.45, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [10],
    expectedDamageBase: 3,
  },
  {
    scenarioId: FRUSTRATION_REG_011_SCENARIOS[2].scenarioId,
    moveName: 'Frustration',
    actorLoyalty: 3,
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
    expectedDamageBase: 6,
  },
  {
    scenarioId: FRUSTRATION_REG_011_SCENARIOS[3].scenarioId,
    moveName: 'Frustration',
    actorLoyalty: 3,
    randomValues: [0.999, 0, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_ID],
    expectedDamageBase: 6,
  },
  {
    scenarioId: FRUSTRATION_REG_011_SCENARIOS[4].scenarioId,
    moveName: 'Frustration',
    actorLoyalty: 3,
    randomValues: [0.45],
    targetTypes: ['Ghost'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedDamageBase: 6,
  },
  {
    scenarioId: GLARE_REG_011_SCENARIOS[0].scenarioId,
    moveName: 'Glare',
    randomValues: [0.45],
    expectedConditions: ['Paralysis'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: GLARE_REG_011_SCENARIOS[1].scenarioId,
    moveName: 'Glare',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: GLARE_REG_011_SCENARIOS[2].scenarioId,
    moveName: 'Glare',
    randomValues: [0.45],
    targetTypes: ['Electric'],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Electric type'],
  },
]

const recoveryScenarioFor = (moveName: RegisteredBatch011MoveName): ExecutionScenario => {
  const legacy = normalScenarios.find(scenario => (
    scenario.moveName === moveName && scenario.expectedHitTargetIds.includes(TARGET_ID)
  ))
  if (legacy) return legacy

  const v2Scenarios: Readonly<Record<
    'Fury Attack' | 'Fury Cutter' | 'Fury Swipes',
    ExecutionScenario
  >> = {
    'Fury Attack': {
      scenarioId: FURY_ATTACK_REG_011_SCENARIOS[5].scenarioId,
      moveName: 'Fury Attack',
      randomValues: [0.5, 0, 0, 0],
      expectedAttackedTargetIds: [TARGET_ID],
      expectedHitTargetIds: [TARGET_ID],
      expectedDamagedTargetIds: [TARGET_ID],
    },
    'Fury Cutter': {
      scenarioId: FURY_CUTTER_REG_011_SCENARIOS[0].scenarioId,
      moveName: 'Fury Cutter',
      randomValues: [0.5, 0, 0],
      expectedAttackedTargetIds: [TARGET_ID],
      expectedHitTargetIds: [TARGET_ID],
      expectedDamagedTargetIds: [TARGET_ID],
    },
    'Fury Swipes': {
      scenarioId: FURY_SWIPES_REG_011_SCENARIOS[5].scenarioId,
      moveName: 'Fury Swipes',
      randomValues: [0.5, 0, 0, 0],
      expectedAttackedTargetIds: [TARGET_ID],
      expectedHitTargetIds: [TARGET_ID],
      expectedDamagedTargetIds: [TARGET_ID],
    },
  }
  if (moveName in v2Scenarios) {
    return v2Scenarios[moveName as keyof typeof v2Scenarios]
  }
  throw new Error(`Missing accepted recovery scenario for ${moveName}.`)
}

const normalizedEvidence = (
  scenarios: readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[],
): readonly { readonly scenarioId: string; readonly evidenceClasses: readonly string[] }[] => scenarios
  .map(scenario => ({
    scenarioId: scenario.scenarioId,
    evidenceClasses: [...scenario.evidenceClasses].sort(),
  }))
  .sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

describe('REG-011 registered move conformance', () => {
  it('certifies exactly Flatter through Glare with linked evidence', () => {
    expect(Object.keys(REG_011_SCENARIOS_BY_MOVE)).toEqual([...REG_011_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_011_SCENARIOS_BY_MOVE)) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === canonicalId)
      expect(row, canonicalId).toMatchObject({
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: '2026-07-19',
      })
      if (!row) continue
      expect([...row.scenarioIds].sort()).toEqual(
        scenarios.map(scenario => scenario.scenarioId).sort(),
      )
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
    const expectedLegacy: Readonly<Record<LegacyMoveName, Readonly<Record<string, unknown>>>> = {
      Flatter: { ac: 2, damageBase: 0, damageClass: 'Status', range: '6, 1 Target, Social' },
      'Focus Blast': { ac: 7, damageBase: 12, damageClass: 'Special', range: '6, 1 Target, Smite, Aura' },
      'Force Palm': { ac: 2, damageBase: 6, damageClass: 'Physical', range: 'Melee, 1 Target, Aura' },
      Frustration: { ac: 2, damageBase: 0, damageClass: 'Physical', range: 'Melee, 1 Target' },
      Glare: { ac: 2, damageBase: 0, damageClass: 'Status', range: '4, 1 Target, Social' },
    }

    for (const [moveName, mechanics] of Object.entries(expectedLegacy)) {
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

    expect(explicitScriptForMove('Flatter')).toMatchObject({
      conditionSuggestions: [{ recipient: 'target', condition: 'Confused', action: 'add' }],
      stageSuggestions: [{ recipient: 'target', key: 'satk', delta: 1 }],
    })
    expect(explicitScriptForMove('Focus Blast')).toMatchObject({
      keywords: expect.arrayContaining(['Smite', 'Aura']),
      stageSuggestions: [{ recipient: 'target', key: 'sdef', delta: -1, threshold: '18+' }],
    })
    expect(explicitScriptForMove('Force Palm')).toMatchObject({
      keywords: expect.arrayContaining(['Aura']),
      conditionSuggestions: [{ recipient: 'target', condition: 'Paralysis', threshold: '18+' }],
    })
    expect(explicitScriptForMove('Glare')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Paralysis',
      action: 'add',
      label: 'Paralysis',
      threshold: undefined,
      optional: false,
    }])

    expect(registeredMoveAutomationRuntimeFor('Fury Attack')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: FURY_ATTACK_MOVE_SPEC },
    })
    expect(FURY_ATTACK_MOVE_SPEC.phases[0]?.operations[0]).toMatchObject({
      kind: 'multi-hit',
      payload: { count: { kind: 'table' }, accuracy: { kind: 'once' }, critical: { kind: 'per-hit' } },
    })
    expect(registeredMoveAutomationRuntimeFor('Fury Cutter')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: FURY_CUTTER_MOVE_SPEC },
    })
    expect(FURY_CUTTER_MOVE_SPEC.phases[1]?.operations[0]).toMatchObject({
      kind: 'damage',
      payload: { damageBase: { kind: 'expression', minimum: 4, maximum: 16 } },
    })
    expect(registeredMoveAutomationRuntimeFor('Fury Swipes')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: FURY_SWIPES_MOVE_SPEC },
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
        idFactory: () => 'reg-011-direct-id',
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
        idFactory: () => 'reg-011-plan-id',
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

  it('rejects Frustration without authoritative Loyalty before rolls or mutation', async () => {
    const scenario: ExecutionScenario = {
      ...recoveryScenarioFor('Frustration'),
      scenarioId: FRUSTRATION_REG_011_SCENARIOS[5].scenarioId,
      actorLoyalty: undefined,
    }
    const fixture = fixtureFor(scenario)
    const snapshot = deepCloneJson({ map: fixture.map, sheets: [...fixture.pokemonSheets] })
    expect(() => resolveAuthoritativeMove({
      ...fixture,
      random: () => { throw new Error('missing Loyalty must not roll') },
    })).toThrowError(expect.objectContaining({ code: 'move-absent' }))
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: () => { throw new Error('missing Loyalty must not roll') },
      operationId: scenario.scenarioId,
    })).toThrowError(expect.objectContaining({ code: 'move-absent' }))
    expect({ map: fixture.map, sheets: [...fixture.pokemonSheets] }).toEqual(snapshot)

    const harness = openHarness(fixture)
    const command = commandFor(fixture, `${scenario.scenarioId}.command`)
    const response = await executeCommand(harness, command, {
      random: () => { throw new Error('missing Loyalty command must not roll') },
    })
    expect(response.result).toMatchObject({ ok: false, reason: 'not-found' })
    expect(harness.maps.getBySlug(fixture.map.slug)?.revision).toBe(7)
    expect(harness.sheets.list().every(sheet => sheet.revision === 3)).toBe(true)
    expect(harness.events).toEqual([])
  })

  it.each(REG_011_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_011_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_011_MOVE_NAMES)(
    'rejects stale %s target state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_011_SCENARIOS_BY_MOVE[moveName]
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
        const current = harness.sheets.getByRef('pokemon', 'target')
        if (!current) throw new Error('Missing race sheet target.')
        racedSheet = {
          ...deepCloneJson(current.sheet),
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        }
        harness.sheets.save({
          kind: 'pokemon',
          slug: 'target',
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
      expect(harness.sheets.getByRef('pokemon', 'target')?.sheet).toEqual(racedSheet)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )
})
