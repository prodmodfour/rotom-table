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
import { deepCloneJson } from '~/utils/serialization'
import {
  resolveAuthoritativeMove,
  type AuthoritativeMoveResolution,
} from '~~/server/domain/resolveAuthoritativeMove'
import {
  planAuthoritativeMoveState,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import { isHelpingHandBonusEffect } from '~~/server/domain/moveAutomation/helpingHand'
import { registeredMoveAutomationRuntimeFor } from '~~/server/domain/moveAutomation/registry'
import { HELPING_HAND_MOVE_SPEC } from '~~/server/domain/moveAutomation/specs/helpingHand'
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
  HELPING_HAND_REG_013_SCENARIOS,
  HONE_CLAWS_REG_013_SCENARIOS,
  HORN_ATTACK_REG_013_SCENARIOS,
  HYPER_FANG_REG_013_SCENARIOS,
  HYPNOSIS_REG_013_SCENARIOS,
  ICE_BEAM_REG_013_SCENARIOS,
  ICE_PUNCH_REG_013_SCENARIOS,
  REG_013_MOVE_NAMES,
  REG_013_SCENARIOS_BY_MOVE,
  type RegisteredBatch013MoveName,
} from '../fixtures/moveAutomation/registeredBatch013'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_ID = 'target-a'
const NOW = 5_000

type LegacyExecutionMoveName = Exclude<
  RegisteredBatch013MoveName,
  'Helping Hand' | 'Howl'
>
type SelectionKind = 'self' | 'single-target'

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
  readonly moveName: LegacyExecutionMoveName
  readonly selectionKind?: SelectionKind
  readonly actorProfile?: TokenProfile
  readonly targetProfile?: TokenProfile
  readonly initialStages?: readonly StageExpectation[]
  readonly randomValues: readonly number[]
  readonly expectedStages?: readonly StageExpectation[]
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
  readonly expectedAccuracyNaturalResults: readonly number[]
  readonly expectedCritical?: boolean
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
  species: options.slug === 'actor' ? 'Audino' : 'Snorlax',
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

const fixtureForMove = (options: {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch013MoveName
  readonly selectionKind: SelectionKind
  readonly actorProfile?: TokenProfile
  readonly targetProfile?: TokenProfile
  readonly initialStages?: readonly StageExpectation[]
  readonly encounterState?: TabletopMap['encounterState']
}): MoveFixture => {
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-013-${options.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-013 ${options.moveName}`,
    revision: 7,
    dimensions: { x: 12, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 5, y: 0, z: 5 }),
      placement(TARGET_ID, TARGET_ID, { x: 6, y: 0, z: 5 }),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'REG-013 scene', startedAt: 100 },
    encounterState: options.encounterState ?? {
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
    moves: [{ name: options.moveName }],
    profile: options.actorProfile,
    initialStages: options.initialStages,
  })
  const target = pokemonSheet({
    slug: TARGET_ID,
    placementId: TARGET_ID,
    profile: options.targetProfile,
    initialStages: options.initialStages,
  })
  const selection: ResolveMoveSelection = options.selectionKind === 'self'
    ? { kind: 'self' }
    : { kind: 'single-target', targetPlacementId: TARGET_ID }

  return {
    map,
    pokemonSheets: new Map([['actor', actor], [TARGET_ID, target]]),
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: ACTOR_ID,
      moveName: options.moveName,
      selection,
    },
    candidateScopePlacementIds: options.selectionKind === 'self' ? [] : [TARGET_ID],
  }
}

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => fixtureForMove({
  scenarioId: scenario.scenarioId,
  moveName: scenario.moveName,
  selectionKind: scenario.selectionKind ?? 'single-target',
  actorProfile: scenario.actorProfile,
  targetProfile: scenario.targetProfile,
  initialStages: scenario.initialStages,
})

const helpingHandFixture = (options: {
  readonly scenarioId?: string
  readonly encounterState?: TabletopMap['encounterState']
} = {}): MoveFixture => fixtureForMove({
  scenarioId: options.scenarioId ?? 'helping-hand.v2-apply-bonus',
  moveName: 'Helping Hand',
  selectionKind: 'single-target',
  encounterState: options.encounterState,
})

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
  if (scenario.expectedCritical) expect(resolution.feedback?.crit).toBe(true)

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
  const expectedReadSlugs = (scenario.selectionKind ?? 'single-target') === 'self'
    ? ['actor']
    : ['actor', TARGET_ID]
  expect(resolution.sheetReads.map(read => read.slug).sort()).toEqual(expectedReadSlugs.sort())
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
  clientId: 'reg-013-client',
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
    return () => `reg-013-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const flinched = { [TARGET_ID]: ['Flinch', 'Vulnerable'] } as const
const frozen = { [TARGET_ID]: ['Frozen'] } as const
const sleeping = { [TARGET_ID]: ['Sleep'] } as const

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: HONE_CLAWS_REG_013_SCENARIOS[0].scenarioId,
    moveName: 'Hone Claws',
    selectionKind: 'self',
    randomValues: [],
    expectedStages: [
      { recipientId: ACTOR_ID, key: 'acc', value: 1 },
      { recipientId: ACTOR_ID, key: 'atk', value: 1 },
    ],
    expectedAttackedTargetIds: [],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: HONE_CLAWS_REG_013_SCENARIOS[1].scenarioId,
    moveName: 'Hone Claws',
    selectionKind: 'self',
    initialStages: [
      { recipientId: ACTOR_ID, key: 'acc', value: 6 },
      { recipientId: ACTOR_ID, key: 'atk', value: 6 },
    ],
    randomValues: [],
    expectedStages: [
      { recipientId: ACTOR_ID, key: 'acc', value: 6 },
      { recipientId: ACTOR_ID, key: 'atk', value: 6 },
    ],
    expectedAttackedTargetIds: [],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [],
  },
  {
    scenarioId: HORN_ATTACK_REG_013_SCENARIOS[0].scenarioId,
    moveName: 'Horn Attack',
    randomValues: [0.45, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: HORN_ATTACK_REG_013_SCENARIOS[1].scenarioId,
    moveName: 'Horn Attack',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: HORN_ATTACK_REG_013_SCENARIOS[2].scenarioId,
    moveName: 'Horn Attack',
    randomValues: [0.999, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCritical: true,
  },
  {
    scenarioId: HORN_ATTACK_REG_013_SCENARIOS[3].scenarioId,
    moveName: 'Horn Attack',
    targetProfile: { types: ['Ghost'] },
    randomValues: [0.45, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Normal immunity'],
  },
  {
    scenarioId: HYPER_FANG_REG_013_SCENARIOS[0].scenarioId,
    moveName: 'Hyper Fang',
    randomValues: [0.9, 0, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [19],
  },
  {
    scenarioId: HYPER_FANG_REG_013_SCENARIOS[1].scenarioId,
    moveName: 'Hyper Fang',
    randomValues: [0.85, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [18],
  },
  {
    scenarioId: HYPER_FANG_REG_013_SCENARIOS[2].scenarioId,
    moveName: 'Hyper Fang',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: HYPER_FANG_REG_013_SCENARIOS[3].scenarioId,
    moveName: 'Hyper Fang',
    randomValues: [0.999, 0, 0],
    expectedConditions: flinched,
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCritical: true,
  },
  {
    scenarioId: HYPER_FANG_REG_013_SCENARIOS[4].scenarioId,
    moveName: 'Hyper Fang',
    targetProfile: { types: ['Ghost'] },
    randomValues: [0.9, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragments: ['Normal immunity'],
  },
  {
    scenarioId: HYPER_FANG_REG_013_SCENARIOS[5].scenarioId,
    moveName: 'Hyper Fang',
    targetProfile: { abilities: ['Shield Dust'] },
    randomValues: [0.9, 0, 0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [TARGET_ID],
    expectedAccuracyNaturalResults: [19],
    expectedLogFragments: ['Shield Dust'],
  },
  {
    scenarioId: HYPNOSIS_REG_013_SCENARIOS[0].scenarioId,
    moveName: 'Hypnosis',
    randomValues: [0.45],
    expectedConditions: sleeping,
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
  },
  {
    scenarioId: HYPNOSIS_REG_013_SCENARIOS[1].scenarioId,
    moveName: 'Hypnosis',
    randomValues: [0],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: HYPNOSIS_REG_013_SCENARIOS[2].scenarioId,
    moveName: 'Hypnosis',
    targetProfile: { abilities: ['Sweet Veil'] },
    randomValues: [0.45],
    expectedAttackedTargetIds: [TARGET_ID],
    expectedHitTargetIds: [TARGET_ID],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [10],
    expectedLogFragments: ['Sweet Veil'],
  },
  ...(['Ice Beam', 'Ice Punch'] as const).flatMap((moveName): readonly ExecutionScenario[] => {
    const moveScenarios = moveName === 'Ice Beam'
      ? ICE_BEAM_REG_013_SCENARIOS
      : ICE_PUNCH_REG_013_SCENARIOS
    return [
      {
        scenarioId: moveScenarios[0].scenarioId,
        moveName,
        randomValues: [0.9, 0, 0],
        expectedConditions: frozen,
        expectedAttackedTargetIds: [TARGET_ID],
        expectedHitTargetIds: [TARGET_ID],
        expectedDamagedTargetIds: [TARGET_ID],
        expectedAccuracyNaturalResults: [19],
      },
      {
        scenarioId: moveScenarios[1].scenarioId,
        moveName,
        randomValues: [0.85, 0, 0],
        expectedAttackedTargetIds: [TARGET_ID],
        expectedHitTargetIds: [TARGET_ID],
        expectedDamagedTargetIds: [TARGET_ID],
        expectedAccuracyNaturalResults: [18],
      },
      {
        scenarioId: moveScenarios[2].scenarioId,
        moveName,
        randomValues: [0],
        expectedAttackedTargetIds: [TARGET_ID],
        expectedHitTargetIds: [],
        expectedDamagedTargetIds: [],
        expectedAccuracyNaturalResults: [1],
      },
      {
        scenarioId: moveScenarios[3].scenarioId,
        moveName,
        randomValues: [0.999, 0, 0],
        expectedConditions: frozen,
        expectedAttackedTargetIds: [TARGET_ID],
        expectedHitTargetIds: [TARGET_ID],
        expectedDamagedTargetIds: [TARGET_ID],
        expectedAccuracyNaturalResults: [20],
        expectedCritical: true,
      },
      {
        scenarioId: moveScenarios[4].scenarioId,
        moveName,
        targetProfile: { types: ['Ice'] },
        randomValues: [0.9, 0, 0],
        expectedAttackedTargetIds: [TARGET_ID],
        expectedHitTargetIds: [TARGET_ID],
        expectedDamagedTargetIds: [TARGET_ID],
        expectedAccuracyNaturalResults: [19],
        expectedLogFragments: ['Ice type'],
      },
      {
        scenarioId: moveScenarios[5].scenarioId,
        moveName,
        targetProfile: { abilities: ['Shield Dust'] },
        randomValues: [0.9, 0, 0],
        expectedAttackedTargetIds: [TARGET_ID],
        expectedHitTargetIds: [TARGET_ID],
        expectedDamagedTargetIds: [TARGET_ID],
        expectedAccuracyNaturalResults: [19],
        expectedLogFragments: ['Shield Dust'],
      },
    ]
  }),
]

const recoveryScenarioFor = (moveName: LegacyExecutionMoveName): ExecutionScenario => {
  const matching = normalScenarios.find(scenario => scenario.moveName === moveName && (
    scenario.selectionKind === 'self' || scenario.expectedHitTargetIds.includes(TARGET_ID)
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

const LEGACY_RECOVERY_MOVE_NAMES = Object.freeze([
  'Hone Claws',
  'Horn Attack',
  'Hyper Fang',
  'Hypnosis',
  'Ice Beam',
  'Ice Punch',
] as const satisfies readonly LegacyExecutionMoveName[])

describe('REG-013 registered move conformance', () => {
  it('certifies exactly Helping Hand through Ice Punch with linked evidence', () => {
    expect(Object.keys(REG_013_SCENARIOS_BY_MOVE)).toEqual([...REG_013_MOVE_NAMES])

    for (const [canonicalId, scenarios] of Object.entries(REG_013_SCENARIOS_BY_MOVE)) {
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
      'Hone Claws': { version: 1, ac: null, damageBase: 0, damageClass: 'Status', range: 'Self', requiresAccuracy: false },
      'Horn Attack': { version: 1, ac: 2, damageBase: 7, damageClass: 'Physical', range: 'Melee, 1 Target, Dash' },
      Howl: { version: 3, ac: null, damageBase: 0, damageClass: 'Status', range: 'Burst 1', requiresAccuracy: false },
      'Hyper Fang': { version: 1, ac: 4, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target' },
      Hypnosis: { version: 1, ac: 6, damageBase: 0, damageClass: 'Status', range: '4, 1 Target' },
      'Ice Beam': { version: 1, ac: 2, damageBase: 9, damageClass: 'Special', range: '4, 1 Target' },
      'Ice Punch': { version: 1, ac: 2, damageBase: 8, damageClass: 'Physical', range: 'Melee, 1 Target' },
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

    expect(registeredMoveAutomationRuntimeFor('Helping Hand')).toMatchObject({
      kind: 'movespec-v2',
      definition: { spec: HELPING_HAND_MOVE_SPEC },
    })
    expect(HELPING_HAND_MOVE_SPEC.targeting).toMatchObject({
      kind: 'single-target',
      minTargets: 1,
      maxTargets: 1,
    })
    expect(HELPING_HAND_MOVE_SPEC.phases[0]?.operations[0]).toMatchObject({
      kind: 'condition',
      reasonCode: 'helping-hand.apply-bonus',
      payload: {
        duration: {
          duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
          charges: 1,
        },
      },
    })
    expect(explicitScriptForMove('Hone Claws')?.stageSuggestions).toEqual([
      { recipient: 'user', key: 'acc', delta: 1, label: 'Hone Claws raises Accuracy: +1 Accuracy CS' },
      { recipient: 'user', key: 'atk', delta: 1, label: 'Hone Claws raises Attack: +1 Attack CS' },
    ])
    expect(explicitScriptForMove('Horn Attack')?.keywords).toContain('Dash')
    expect(explicitScriptForMove('Howl')).toMatchObject({
      areaTargetRelationship: 'ally',
      areaTemplates: [{ kind: 'burst', size: 1, label: 'Burst 1' }],
      stageSuggestions: [
        { recipient: 'user', key: 'atk', delta: 1 },
        { recipient: 'target', key: 'atk', delta: 1 },
      ],
    })
    expect(explicitScriptForMove('Hyper Fang')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Flinch',
      action: 'add',
      label: 'Flinch on 19+',
      threshold: '19+',
      optional: true,
    }])
    expect(explicitScriptForMove('Hypnosis')?.conditionSuggestions).toEqual([{
      recipient: 'target',
      condition: 'Sleep',
      action: 'add',
      label: 'Sleep',
      optional: false,
    }])
    for (const moveName of ['Ice Beam', 'Ice Punch']) {
      expect(explicitScriptForMove(moveName)?.conditionSuggestions, moveName).toEqual([{
        recipient: 'target',
        condition: 'Frozen',
        action: 'add',
        label: 'Frozen on 19+',
        threshold: '19+',
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
        idFactory: () => 'reg-013-direct-id',
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
        idFactory: () => 'reg-013-plan-id',
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

  it('applies Helping Hand natively through resolver, planner, and accepted command', async () => {
    const directFixture = helpingHandFixture()
    const directSnapshot = deepCloneJson({
      map: directFixture.map,
      sheets: [...directFixture.pokemonSheets],
    })
    const direct = resolveAuthoritativeMove({
      ...directFixture,
      random: () => { throw new Error('Helping Hand must not draw RNG') },
      now: () => NOW,
      resolutionId: 'helping-hand.v2-apply-bonus.direct',
    })
    expect('kind' in direct).toBe(false)
    if ('kind' in direct) throw new Error('Helping Hand unexpectedly suspended.')
    expect(direct.auditTrace.program).toMatchObject({
      canonicalId: 'Helping Hand',
      runtimeKind: 'movespec-v2',
      runtimeVersion: 2,
    })
    expect(direct.transaction).toMatchObject({
      attackedTargetIds: [TARGET_ID],
      hitTargetIds: [TARGET_ID],
      hpUpdates: [],
      conditionUpdates: [],
    })
    expect(direct.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'operation',
      operationId: 'helping-hand.apply-bonus',
      outcome: 'applied',
    }))
    expect({ map: directFixture.map, sheets: [...directFixture.pokemonSheets] })
      .toEqual(directSnapshot)

    const plannerFixture = helpingHandFixture()
    const plan = planAuthoritativeMoveState({
      ...plannerFixture,
      random: () => { throw new Error('Helping Hand must not draw RNG') },
      now: () => NOW,
      operationId: 'op_helping_hand_v2_apply_plan',
    })
    expect(plan.nextMap.encounterState?.effects.filter(isHelpingHandBonusEffect)).toEqual([
      expect.objectContaining({
        affected: expect.objectContaining({ placementIds: [TARGET_ID] }),
        charges: 1,
        duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      }),
    ])

    const commandFixture = helpingHandFixture()
    const harness = openHarness(commandFixture)
    const command = commandFor(commandFixture, 'helping-hand.v2-apply-bonus')
    const response = await executeCommand(harness, command, {
      random: () => { throw new Error('Helping Hand must not draw RNG') },
    })
    expect(response.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
    expect(response.move?.trace).toMatchObject({
      program: { canonicalId: 'Helping Hand', runtimeKind: 'movespec-v2' },
    })
    expect(harness.maps.getBySlug(command.mapSlug)?.encounterState?.effects
      .filter(isHelpingHandBonusEffect)).toHaveLength(1)
  })

  it('rejects Horn Attack while Stuck before rolls, costs, or effects', async () => {
    const scenario: ExecutionScenario = {
      ...recoveryScenarioFor('Horn Attack'),
      scenarioId: HORN_ATTACK_REG_013_SCENARIOS[4].scenarioId,
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

  it('rejects Helping Hand Priority after the actor has acted without partial mutation', async () => {
    const empty = createEmptyEncounterState()
    const fixture = helpingHandFixture({
      scenarioId: HELPING_HAND_REG_013_SCENARIOS[2].scenarioId,
      encounterState: {
        ...empty,
        sides: {
          heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
          foes: { id: 'foes', label: 'Foes', status: 'active' },
        },
        history: {
          ...empty.history,
          actedThisRoundPlacementIds: [ACTOR_ID],
        },
      },
    })
    const mapBefore = deepCloneJson(fixture.map)
    expect(() => planAuthoritativeMoveState({
      ...fixture,
      random: () => { throw new Error('blocked Priority must not roll') },
      operationId: 'op_helping_hand_priority_rejected',
    })).toThrowError(expect.objectContaining({
      code: 'move-resource-unavailable',
      message: expect.stringContaining('priority-unavailable'),
    }))
    expect(fixture.map).toEqual(mapBefore)

    const harness = openHarness(fixture)
    const persistedMapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const command = commandFor(fixture, `${HELPING_HAND_REG_013_SCENARIOS[2].scenarioId}.command`)
    const response = await executeCommand(harness, command, {
      random: () => { throw new Error('blocked Priority command must not roll') },
    })
    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('priority-unavailable'),
    })
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(persistedMapBefore)
    expect(harness.sheets.list().every(sheet => sheet.revision === 3)).toBe(true)
    expect(harness.events).toEqual([])
  })

  it.each(LEGACY_RECOVERY_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_013_SCENARIOS_BY_MOVE[moveName]
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

  it('replays accepted Helping Hand delivery without reopening or duplicating its effect', async () => {
    const fixture = helpingHandFixture({
      scenarioId: HELPING_HAND_REG_013_SCENARIOS[0].scenarioId,
    })
    const harness = openHarness(fixture)
    const command = commandFor(fixture, HELPING_HAND_REG_013_SCENARIOS[0].scenarioId)
    const first = await executeCommand(harness, command, {
      random: () => { throw new Error('Helping Hand must not draw RNG') },
    })
    expect(first.result.ok).toBe(true)
    const committedMap = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    const committedEvents = deepCloneJson(harness.events)

    const duplicate = await executeCommand(harness, command, {
      random: () => { throw new Error('duplicate Helping Hand must not draw RNG') },
      planner: () => { throw new Error('duplicate Helping Hand must not replan') },
    })
    expect(duplicate).toEqual(first)
    expect(harness.maps.getBySlug(fixture.map.slug)).toEqual(committedMap)
    expect(harness.maps.getBySlug(fixture.map.slug)?.encounterState?.effects
      .filter(isHelpingHandBonusEffect)).toHaveLength(1)
    expect(harness.events).toEqual(committedEvents)
  })

  it.each(LEGACY_RECOVERY_MOVE_NAMES)(
    'rejects stale %s state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_013_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))
      if (!evidence) throw new Error(`Missing conflict evidence for ${moveName}.`)
      const command = commandFor(fixture, evidence.scenarioId)
      const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
      const racedSlug = moveName === 'Hone Claws' ? 'actor' : TARGET_ID
      let racedSheet: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
        const plan: AuthoritativeMoveStatePlan = planAuthoritativeMoveState({
          ...input,
          random: randomSequence(scenario.randomValues),
        })
        expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: racedSlug }))
        const current = harness.sheets.getByRef('pokemon', racedSlug)
        if (!current) throw new Error(`Missing race sheet ${racedSlug}.`)
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

  it('rejects a stale Helping Hand target before persisting its effect or operation', async () => {
    const fixture = helpingHandFixture({
      scenarioId: HELPING_HAND_REG_013_SCENARIOS[5].scenarioId,
    })
    const harness = openHarness(fixture)
    const command = commandFor(fixture, HELPING_HAND_REG_013_SCENARIOS[5].scenarioId)
    const mapBefore = deepCloneJson(harness.maps.getBySlug(fixture.map.slug))
    let racedTarget: Record<string, unknown> | null = null
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      const plan = planAuthoritativeMoveState({
        ...input,
        random: () => { throw new Error('Helping Hand must not draw RNG') },
      })
      expect(plan.sheetReads).toContainEqual(expect.objectContaining({ slug: TARGET_ID }))
      const current = harness.sheets.getByRef('pokemon', TARGET_ID)
      if (!current) throw new Error('Missing Helping Hand target sheet.')
      racedTarget = {
        ...deepCloneJson(current.sheet),
        revision: current.revision + 1,
        updatedAt: NOW + 1,
      }
      harness.sheets.save({
        kind: 'pokemon',
        slug: TARGET_ID,
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
    expect(harness.sheets.getByRef('pokemon', TARGET_ID)?.sheet).toEqual(racedTarget)
    expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toBeNull()
    expect(harness.events).toEqual([])
  })
})
