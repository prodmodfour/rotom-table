import { afterEach, describe, expect, it, vi } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'
import menuStatusJson from '../../data/move-automation/menu-status.json'
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
import { createEncounterTurnResourceLedger } from '#shared/moveAutomation/encounterResources'
import { isPendingMoveDeclarationResult } from '#shared/moveAutomation/pendingResolution'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import {
  FIERY_WRATH_DARK_BRANCH_ID,
  FIERY_WRATH_FIRE_BRANCH_ID,
  FREEZING_GLARE_ICE_BRANCH_ID,
  FREEZING_GLARE_PSYCHIC_BRANCH_ID,
} from '#shared/moveAutomation/canonicalMoveBranches'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { deepCloneJson } from '~/utils/serialization'
import {
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  CHATTER_MOVE_SPEC,
  DYNAMIC_PUNCH_MOVE_SPEC,
  FIERY_WRATH_MOVE_SPEC,
  FIRE_FANG_MOVE_SPEC,
  FREEZE_DRY_MOVE_SPEC,
  FREEZING_GLARE_MOVE_SPEC,
  ICE_FANG_MOVE_SPEC,
  SHELL_SIDE_ARM_MOVE_SPEC,
} from '~~/server/domain/moveAutomation/specs/secondaryConditions203'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { parsePendingMoveResponseCommand } from '~~/server/livePlay/moveResponseCommandParser'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqlitePendingMoveResolutionRepository } from '~~/server/storage/pendingMoveResolutionRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandDependencies,
} from '~~/server/useCases/applyResolveMoveCommand'
import { listPendingMoveResponsesUseCase } from '~~/server/useCases/listPendingMoveResponses'
import {
  resumePendingMoveResolutionUseCase,
  type ResumePendingMoveResolutionInput,
} from '~~/server/useCases/resumePendingMoveResolution'
import {
  MA_203_MOVE_NAMES,
  MA_203_SCENARIOS_BY_MOVE,
  type SecondaryConditions203MoveName,
  type SecondaryConditions203ScenarioEvidence,
} from '../fixtures/moveAutomation/secondaryConditions203'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_ID = 'target-token'
const FLANKER_ID = 'flanker-token'
const NOW = 5_000

interface StatProfile {
  readonly atk?: number
  readonly def?: number
  readonly satk?: number
  readonly sdef?: number
  readonly spd?: number
}

interface TokenProfile {
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly conditions?: readonly string[]
  readonly stats?: StatProfile
  readonly size?: string
}

interface CohortFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly candidateScopePlacementIds: readonly string[]
  readonly randomValues: readonly number[]
}

interface FixtureOptions {
  readonly moveName: SecondaryConditions203MoveName
  readonly naturalResult?: number
  readonly randomValues?: readonly number[]
  readonly targetBranchId?: string
  readonly actor?: TokenProfile
  readonly target?: TokenProfile
  readonly includeFlanker?: boolean
}

interface CommandHarness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly pending: ReturnType<typeof createSqlitePendingMoveResolutionRepository>
  readonly realtime: ReturnType<typeof createSqliteRealtimeEventRepository>
  readonly commandExecutor: ReturnType<typeof createAuthoritativeLivePlayCommandExecutor>
  readonly events: unknown[]
}

const openDatabases: RotomDatabase[] = []

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const d20 = (naturalResult: number): number => (naturalResult - 0.5) / 20

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values.at(-1) ?? 0
}

const placement = (
  id: string,
  slug: string,
  position: { readonly x: number; readonly y: number; readonly z: number },
  sideId: 'heroes' | 'foes',
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: slug,
  sideId,
  position: { ...position },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly moveName?: string
  readonly profile?: TokenProfile
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: 'Mew',
  types: [...(options.profile?.types ?? ['Normal'])],
  level: 20,
  revision: 3,
  capabilities: {
    overland: 6,
    size: options.profile?.size ?? 'Medium',
  },
  movelist: options.moveName ? [{ name: options.moveName }] : [],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 200 },
    atk: { added: options.profile?.stats?.atk ?? 20, stage: 0 },
    def: { added: options.profile?.stats?.def ?? 20, stage: 0 },
    satk: { added: options.profile?.stats?.satk ?? 20, stage: 0 },
    sdef: { added: options.profile?.stats?.sdef ?? 20, stage: 0 },
    spd: { added: options.profile?.stats?.spd ?? 20, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: {
    currentHp: 500,
    conditions: [...(options.profile?.conditions ?? [])],
  },
})

const baseBranchFor = (moveName: SecondaryConditions203MoveName): string | undefined => {
  if (moveName === 'Fiery Wrath') return FIERY_WRATH_DARK_BRANCH_ID
  if (moveName === 'Freezing Glare') return FREEZING_GLARE_PSYCHIC_BRANCH_ID
  return undefined
}

const fixture = (options: FixtureOptions): CohortFixture => {
  const encounter = createEmptyEncounterState()
  const includeFlanker = options.includeFlanker === true
  const placements: SheetPlacement[] = [
    placement(ACTOR_ID, 'actor', { x: 4, y: 0, z: 5 }, 'heroes'),
    placement(TARGET_ID, 'target', { x: 5, y: 0, z: 5 }, 'foes'),
    ...(includeFlanker
      ? [placement(FLANKER_ID, 'flanker', { x: 6, y: 0, z: 5 }, 'heroes')]
      : []),
  ]
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `ma203-${options.moveName.toLowerCase().replaceAll(' ', '-').replaceAll('’', '')}`,
    name: `MA-203 ${options.moveName}`,
    revision: 7,
    dimensions: { x: 14, y: 3, z: 12 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements,
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'MA-203 scene', startedAt: 100 },
    encounterState: {
      ...encounter,
      history: { ...encounter.history, sceneId: 'ma203-scene' },
      turnResources: Object.fromEntries(placements.map(current => [
        current.id,
        createEncounterTurnResourceLedger({ placementId: current.id, round: 1 }),
      ])),
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
    },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  const sheets = new Map<string, CharacterSheet>([
    ['actor', pokemonSheet({ slug: 'actor', moveName: options.moveName, profile: options.actor })],
    ['target', pokemonSheet({ slug: 'target', profile: options.target })],
  ])
  if (includeFlanker) sheets.set('flanker', pokemonSheet({ slug: 'flanker' }))
  const targetBranchId = options.targetBranchId ?? baseBranchFor(options.moveName)
  return {
    map,
    pokemonSheets: sheets,
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: ACTOR_ID,
      moveName: options.moveName,
      ...(targetBranchId ? { targetBranchId } : {}),
      selection: { kind: 'single-target', targetPlacementId: TARGET_ID },
    },
    candidateScopePlacementIds: [TARGET_ID, ...(includeFlanker ? [FLANKER_ID] : [])],
    randomValues: options.randomValues ?? [d20(options.naturalResult ?? 10), 0, 0, 0, 0, 0],
  }
}

const plan = (input: CohortFixture, operationId = 'op_ma203_plan'): AuthoritativeMoveStatePlan => (
  planAuthoritativeMoveState({
    ...input,
    random: randomSequence(input.randomValues),
    now: () => NOW,
    operationId,
    idFactory: (() => {
      let sequence = 0
      return () => `ma203-plan-id-${++sequence}`
    })(),
  })
)

const conditionsFor = (result: AuthoritativeMoveStatePlan): readonly string[] => (
  result.resolution.transaction.conditionUpdates
    .find(update => update.id === TARGET_ID)?.conditions ?? []
)

const operationEvent = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
) => result.resolution.auditTrace.events.findLast(event => (
  event.kind === 'operation' && event.operationId === operationId
))

const damageCalculation = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
): Readonly<Record<string, unknown>> | null => {
  const event = operationEvent(result, operationId)
  if (!event || event.kind !== 'operation' || typeof event.result !== 'object' || event.result === null) {
    return null
  }
  const recipients = 'recipients' in event.result && Array.isArray(event.result.recipients)
    ? event.result.recipients
    : []
  const first = recipients[0]
  if (typeof first !== 'object' || first === null || !('details' in first)) return null
  const details = first.details
  if (typeof details !== 'object' || details === null || !('calculation' in details)) return null
  return typeof details.calculation === 'object' && details.calculation !== null
    ? details.calculation as Readonly<Record<string, unknown>>
    : null
}

const normalizedEvidence = (
  scenarios: readonly SecondaryConditions203ScenarioEvidence[],
) => scenarios.map(scenario => ({
  scenarioId: scenario.scenarioId,
  evidenceClasses: [...scenario.evidenceClasses].sort(),
})).sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const openHarness = (input: CohortFixture): CommandHarness => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => NOW })
  const pending = createSqlitePendingMoveResolutionRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => NOW })
  const modes = createSqliteMapInteractionModeRepository(database)
  const events: unknown[] = []
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: mapSlug => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks(events, { clock: () => NOW }),
  })
  maps.save({
    slug: input.map.slug,
    document: deepCloneJson(input.map),
    revision: input.map.revision ?? 0,
    updatedAt: input.map.updatedAt ?? 100,
  })
  for (const [slug, sheet] of input.pokemonSheets) {
    sheets.save({
      kind: 'pokemon',
      slug,
      document: deepCloneJson(sheet) as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: input.map.updatedAt ?? 100,
    })
  }
  return { database, maps, sheets, ops, pending, realtime, commandExecutor, events }
}

const commandFor = (input: CohortFixture, opId: string): ResolveMoveLivePlayCommand => {
  const scopes = buildResolveMoveScopes({
    map: input.map,
    intent: input.intent,
    candidateScopePlacementIds: input.candidateScopePlacementIds,
  })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: input.map.slug,
    baseRevision: input.map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload: deepCloneJson(input.intent),
  }
}

const executeCommand = (
  harness: CommandHarness,
  command: ResolveMoveLivePlayCommand,
  options: {
    readonly random?: LivePlayResolveMoveCommandDependencies['random']
    readonly planner?: LivePlayResolveMoveCommandDependencies['planner']
  } = {},
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  command,
  clientId: 'ma203-test-client',
  playerProfile: null,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  pendingResolutionRepository: harness.pending,
  commandExecutor: harness.commandExecutor,
  random: options.random,
  planner: options.planner,
  now: () => NOW,
  idFactory: (() => {
    let sequence = 0
    return () => `ma203-command-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const responseCommand = (input: {
  readonly mapSlug: string
  readonly resolutionId: string
  readonly windowId: string
  readonly baseRevision: number
  readonly opId: string
  readonly pass?: boolean
}): MoveResponseCommand => input.pass
  ? {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: input.mapSlug,
      baseRevision: input.baseRevision,
      type: MOVE_RESPONSE_COMMAND_TYPES.PASS,
      payload: {
        resolutionId: input.resolutionId,
        windowId: input.windowId,
      },
    }
  : {
      schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
      opId: input.opId,
      mapSlug: input.mapSlug,
      baseRevision: input.baseRevision,
      type: MOVE_RESPONSE_COMMAND_TYPES.REACT,
      payload: {
        resolutionId: input.resolutionId,
        windowId: input.windowId,
        optionId: 'ability.drown-out.use',
      },
    }

const gmResponseAuthorization: ResumePendingMoveResolutionInput['authorization'] = {
  source: 'gm-authority',
  chosenBy: { kind: 'gm', id: null },
}

const respond = (
  harness: CommandHarness,
  command: MoveResponseCommand,
  random: () => number,
) => {
  const parsed = parsePendingMoveResponseCommand(command, {
    pendingResolutionRepository: harness.pending,
  })
  return () => resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: gmResponseAuthorization,
    clientId: 'ma203-response-client',
  }, {
    database: harness.database,
    mapRepository: harness.maps,
    sheetRepository: harness.sheets,
    pendingResolutionRepository: harness.pending,
    opRepository: harness.ops,
    realtimeEventRepository: harness.realtime,
    random,
    now: () => NOW,
    publishPersistedRealtimeEvent: vi.fn(),
  })
}

const storedConditions = (
  harness: CommandHarness,
  slug = 'target',
): readonly string[] => {
  const sheet = harness.sheets.getByRef('pokemon', slug)?.sheet
  const combat = sheet?.combat as { readonly conditions?: unknown } | undefined
  return Array.isArray(combat?.conditions) ? combat.conditions as readonly string[] : []
}

const recoveryFixture = (moveName: SecondaryConditions203MoveName): CohortFixture => fixture({
  moveName,
  naturalResult: moveName === 'Dynamic Punch' ? 15 : 10,
})

const safeOperationId = (value: string): string => `op_${value
  .replace(/[^A-Za-z0-9_-]+/g, '_')
  .slice(0, 90)}`

const damageOperationIdFor = (moveName: SecondaryConditions203MoveName): string => (
  `${moveName.toLowerCase().replaceAll(' ', '-')}.damage`
)

describe('MA-203 secondary-condition and alternate-damage cohort', () => {
  it('selects exactly eight complete reviewed native runtimes with linked evidence', () => {
    const expectedSpecs = new Map([
      ['Chatter', CHATTER_MOVE_SPEC],
      ['Dynamic Punch', DYNAMIC_PUNCH_MOVE_SPEC],
      ['Fiery Wrath', FIERY_WRATH_MOVE_SPEC],
      ['Fire Fang', FIRE_FANG_MOVE_SPEC],
      ['Freeze-Dry', FREEZE_DRY_MOVE_SPEC],
      ['Freezing Glare', FREEZING_GLARE_MOVE_SPEC],
      ['Ice Fang', ICE_FANG_MOVE_SPEC],
      ['Shell Side Arm', SHELL_SIDE_ARM_MOVE_SPEC],
    ])
    for (const moveName of MA_203_MOVE_NAMES) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === moveName)!
      expect(row).toMatchObject({
        baseStatus: 'complete',
        interactionStatus: 'unassessed',
        runtime: {
          kind: 'movespec-v2',
          version: 2,
          sourceModule: 'server/domain/moveAutomation/specs/secondaryConditions203.ts',
          definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
        suggestedCapabilityTags: [],
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: '2026-07-19',
        rolloutCohortId: 'ma-203',
      })
      expect(row.scenarioIds).toEqual(
        MA_203_SCENARIOS_BY_MOVE[moveName].map(({ scenarioId }) => scenarioId),
      )
      expect(normalizedEvidence(row.conformanceEvidence.scenarios))
        .toEqual(normalizedEvidence(MA_203_SCENARIOS_BY_MOVE[moveName]))
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        definition: { spec: { canonicalId: expectedSpecs.get(moveName)?.canonicalId } },
        definitionHash: row.runtime.definitionHash,
      })
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(entry => entry.canonicalId === moveName))
        .toHaveLength(1)
      expect(menuStatusJson.moves.find(candidate => candidate.canonicalId === moveName)).toMatchObject({
        baseStatus: 'complete',
        runtimeKind: 'movespec-v2',
        blockerCodes: [],
      })
      expect(nativeMoveAutomationPresentationScriptForMove(moveName)).toMatchObject({
        moveName,
        targetMode: 'one-target',
        targetCount: 1,
        automationNotes: [],
      })
    }
  })

  it('encodes the reviewed alternate type branches as server-owned intent IDs', () => {
    expect(nativeMoveAutomationPresentationScriptForMove('Fiery Wrath')?.targetBranches)
      .toMatchObject([
        { id: FIERY_WRATH_DARK_BRANCH_ID, label: 'Dark Type' },
        { id: FIERY_WRATH_FIRE_BRANCH_ID, label: expect.stringContaining('Once per Scene') },
      ])
    expect(nativeMoveAutomationPresentationScriptForMove('Freezing Glare')?.targetBranches)
      .toMatchObject([
        { id: FREEZING_GLARE_PSYCHIC_BRANCH_ID, label: 'Psychic Type' },
        { id: FREEZING_GLARE_ICE_BRANCH_ID, label: expect.stringContaining('Once per Scene') },
      ])
  })

  it('persists an enemy-owned Drown Out window and cancels Chatter exactly once before RNG', async () => {
    const input = fixture({
      moveName: 'Chatter',
      naturalResult: 16,
      target: { abilities: ['Drown Out'] },
    })
    const pure = planAuthoritativeMoveStateExecution({
      ...input,
      operationId: 'op_chatter_drown_out_pure',
      pendingResolutionId: 'resolution-chatter-drown-out-pure',
      random: () => { throw new Error('Drown Out declaration must suspend before RNG') },
      now: () => NOW,
    })
    expect(pure).toMatchObject({
      kind: 'pending',
      execution: {
        canonicalMoveName: 'Chatter',
        execution: {
          request: {
            kind: 'reaction',
            timing: 'declare',
            options: [{ id: 'ability.drown-out.use' }],
          },
        },
      },
    })

    const harness = openHarness(input)
    const command = commandFor(input, 'op_chatter_drown_out_declare')
    let draws = 0
    const random = () => {
      draws += 1
      throw new Error('A cancelled Chatter must not draw RNG')
    }
    const declaration = await executeCommand(harness, command, {
      random,
      planner: planAuthoritativeMoveStateExecution,
    })
    const duplicateDeclaration = await executeCommand(harness, command, {
      random,
      planner: () => { throw new Error('duplicate Drown Out declaration must not replan') },
    })
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    expect(duplicateDeclaration).toEqual(declaration)
    expect(draws).toBe(0)
    if (!isPendingMoveDeclarationResult(declaration.result)) return
    expect(storedConditions(harness)).toEqual([])
    expect(harness.sheets.getByRef('pokemon', 'target')?.sheet)
      .toMatchObject({ combat: { currentHp: 500 } })

    const listed = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: input.map.slug,
      playerProfile: null,
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    expect(listed.windows).toMatchObject([{
      resolution: { resolutionId: declaration.result.pendingResolution.resolutionId },
      window: {
        kind: 'reaction',
        timing: 'declare',
        options: [{ id: 'ability.drown-out.use' }],
        allowPass: true,
      },
    }])
    const storedPending = harness.pending.getById(
      declaration.result.pendingResolution.resolutionId,
    )!
    const window = storedPending.resolution.outstandingWindows[0]!
    expect(window.ownership).toEqual([{ kind: 'target', id: TARGET_ID }])

    const response = responseCommand({
      mapSlug: input.map.slug,
      resolutionId: storedPending.resolution.resolutionId,
      windowId: window.windowId,
      baseRevision: harness.maps.getBySlug(input.map.slug)?.revision ?? 0,
      opId: 'op_chatter_drown_out_react',
    })
    const invoke = respond(harness, response, random)
    const accepted = invoke()
    const duplicate = invoke()
    expect(accepted.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    expect(duplicate.result).toEqual(accepted.result)
    expect(draws).toBe(0)
    expect(storedConditions(harness)).toEqual([])
    expect(harness.sheets.getByRef('pokemon', 'target')?.sheet)
      .toMatchObject({ combat: { currentHp: 500 } })
    const committedUsage = JSON.stringify(
      harness.maps.getBySlug(input.map.slug)?.encounterState?.abilityUsage,
    )
    expect(committedUsage).toContain('Drown Out')
    expect(harness.maps.getBySlug(input.map.slug)?.encounterState
      ?.turnResources[ACTOR_ID]?.actions.standard.spent).toBe(1)
    expect(harness.pending.getById(storedPending.resolution.resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: response.opId,
    })
  })

  it('resumes a reconnected Drown Out pass into one ordinary Chatter result', async () => {
    const input = fixture({
      moveName: 'Chatter',
      randomValues: [d20(16), 0, 0],
      target: { abilities: ['Drown Out'] },
    })
    const harness = openHarness(input)
    const command = commandFor(input, 'op_chatter_drown_out_pass_declare')
    let draws = 0
    const values = [...input.randomValues]
    const random = () => {
      const value = values[draws]
      if (value === undefined) throw new Error(`Unexpected Chatter draw ${draws + 1}.`)
      draws += 1
      return value
    }
    const declaration = await executeCommand(harness, command, {
      random,
      planner: planAuthoritativeMoveStateExecution,
    })
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    expect(draws).toBe(0)
    if (!isPendingMoveDeclarationResult(declaration.result)) return

    const restored = listPendingMoveResponsesUseCase({
      role: 'gm',
      mapSlug: input.map.slug,
      playerProfile: null,
    }, {
      database: harness.database,
      mapRepository: harness.maps,
      sheetRepository: harness.sheets,
      pendingResolutionRepository: harness.pending,
    })
    expect(restored.windows).toHaveLength(1)
    const window = harness.pending.getById(declaration.result.pendingResolution.resolutionId)!
      .resolution.outstandingWindows[0]!
    const response = responseCommand({
      mapSlug: input.map.slug,
      resolutionId: declaration.result.pendingResolution.resolutionId,
      windowId: window.windowId,
      baseRevision: harness.maps.getBySlug(input.map.slug)?.revision ?? 0,
      opId: 'op_chatter_drown_out_pass_response',
      pass: true,
    })
    const invoke = respond(harness, response, random)
    const accepted = invoke()
    const drawsAfterCommit = draws
    const duplicate = invoke()
    expect(accepted.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    expect(duplicate.result).toEqual(accepted.result)
    expect(draws).toBe(drawsAfterCommit)
    expect(drawsAfterCommit).toBe(3)
    expect(storedConditions(harness)).toContain('Confused')
    expect((harness.sheets.getByRef('pokemon', 'target')?.sheet.combat as { currentHp: number }).currentHp)
      .toBeLessThan(500)
    expect(JSON.stringify(harness.sheets.getByRef('pokemon', 'target')?.sheet.moveUsage ?? null))
      .not.toContain('Drown Out')
  })

  it.each([
    ['Chatter', 16, 'chatter.confusion', 'Confused'],
    ['Fiery Wrath', 17, 'fiery-wrath.flinch', 'Flinch'],
    ['Freezing Glare', 19, 'freezing-glare.freeze', 'Frozen'],
    ['Shell Side Arm', 17, 'shell-side-arm.poison', 'Poisoned'],
  ] as const)(
    'applies %s threshold effects from the natural server-owned accuracy roll only',
    (moveName, threshold, operationId, condition) => {
      const passed = plan(fixture({ moveName, naturalResult: threshold }))
      const failed = plan(fixture({ moveName, naturalResult: threshold - 1 }))
      expect(passed.resolution.transaction.hitTargetIds).toEqual([TARGET_ID])
      expect(conditionsFor(passed)).toContain(condition)
      expect(conditionsFor(failed)).not.toContain(condition)
      expect(operationEvent(failed, operationId)).toMatchObject({
        outcome: 'no-op',
        result: {
          recipients: [{ reasonCode: 'condition-accuracy-roll-trigger-not-met' }],
        },
      })
      expect(passed.resolution.rollLedger.filter(entry => entry.reason.includes('accuracy')))
        .toHaveLength(1)
    },
  )

  it('always confuses a Dynamic Punch hit and ignores Evasion only when authoritatively flanked', () => {
    const unflanked = plan(fixture({
      moveName: 'Dynamic Punch',
      naturalResult: 9,
      target: { stats: { def: 100, sdef: 100, spd: 100 } },
    }))
    const flanked = plan(fixture({
      moveName: 'Dynamic Punch',
      naturalResult: 9,
      target: { stats: { def: 100, sdef: 100, spd: 100 } },
      includeFlanker: true,
    }))
    expect(unflanked.resolution.transaction.hitTargetIds).toEqual([])
    expect(conditionsFor(unflanked)).not.toContain('Confused')
    expect(flanked.resolution.transaction.hitTargetIds).toEqual([TARGET_ID])
    expect(conditionsFor(flanked)).toContain('Confused')
    expect(flanked.sheetReads.map(read => read.slug).sort())
      .toEqual(['actor', 'flanker', 'target'])
    expect(flanked.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'dynamic-punch.accuracy.evasion-rule.target-token',
      outcome: true,
      reasonCode: 'dynamic-punch.ignore-flanked-evasion',
    }))
    expect(unflanked.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      outcome: false,
      reasonCode: 'target-not-flanked',
    }))
  })

  it.each([
    ['Fire Fang', 'Burned', 0],
    ['Fire Fang', 'Flinch', 0.99],
    ['Ice Fang', 'Frozen', 0],
    ['Ice Fang', 'Flinch', 0.99],
  ] as const)(
    '%s chooses exactly the reviewed %s coin branch on natural 18-19',
    (moveName, expectedCondition, coin) => {
      const result = plan(fixture({
        moveName,
        randomValues: [d20(18), 0, 0, coin],
      }))
      const alternative = moveName === 'Fire Fang'
        ? expectedCondition === 'Burned' ? 'Flinch' : 'Burned'
        : expectedCondition === 'Frozen' ? 'Flinch' : 'Frozen'
      expect(conditionsFor(result)).toContain(expectedCondition)
      expect(conditionsFor(result)).not.toContain(alternative)
      expect(result.resolution.rollLedger.map(entry => entry.rollId))
        .toContain(`${moveName.toLowerCase().replaceAll(' ', '-')}.secondary-coin-roll`)
    },
  )

  it.each(['Fire Fang', 'Ice Fang'] as const)(
    '%s applies both canonical conditions on natural 20 and neither below 18',
    (moveName) => {
      const critical = plan(fixture({
        moveName,
        randomValues: [d20(20), 0, 0, 0, 0, 0],
      }))
      const failed = plan(fixture({
        moveName,
        randomValues: [d20(17), 0, 0, 0],
      }))
      const typed = moveName === 'Fire Fang' ? 'Burned' : 'Frozen'
      expect(conditionsFor(critical)).toEqual(expect.arrayContaining([typed, 'Flinch']))
      expect(damageCalculation(critical, damageOperationIdFor(moveName)))
        .toMatchObject({ criticalHit: { critical: true } })
      expect(critical.resolution.rollLedger.map(entry => entry.rollId))
        .not.toContain(`${moveName.toLowerCase().replaceAll(' ', '-')}.secondary-coin-roll`)
      expect(conditionsFor(failed)).not.toEqual(expect.arrayContaining([typed, 'Flinch']))
      expect(conditionsFor(failed)).not.toContain(typed)
      expect(conditionsFor(failed)).not.toContain('Flinch')
      expect(failed.resolution.rollLedger.map(entry => entry.rollId))
        .not.toContain(`${moveName.toLowerCase().replaceAll(' ', '-')}.secondary-coin-roll`)
    },
  )

  it('overrides Water to Ice weakness for Freeze-Dry without changing other type relations', () => {
    const water = plan(fixture({
      moveName: 'Freeze-Dry',
      naturalResult: 10,
      target: { types: ['Water'] },
    }))
    const normal = plan(fixture({
      moveName: 'Freeze-Dry',
      naturalResult: 10,
      target: { types: ['Normal'] },
    }))
    expect(damageCalculation(water, 'freeze-dry.damage')).toMatchObject({
      moveType: {
        moveType: 'Ice',
        finalRelation: 'weak',
        finalMultiplier: 1.5,
        defenderTypeEvaluations: [{
          defenderType: 'Water',
          relation: 'weak',
          source: 'move-override',
        }],
      },
    })
    expect(damageCalculation(normal, 'freeze-dry.damage')).toMatchObject({
      moveType: { moveType: 'Ice', finalRelation: 'neutral', finalMultiplier: 1 },
    })
  })

  it.each([
    ['Fiery Wrath', FIERY_WRATH_DARK_BRANCH_ID, 'Dark'],
    ['Fiery Wrath', FIERY_WRATH_FIRE_BRANCH_ID, 'Fire'],
    ['Freezing Glare', FREEZING_GLARE_PSYCHIC_BRANCH_ID, 'Psychic'],
    ['Freezing Glare', FREEZING_GLARE_ICE_BRANCH_ID, 'Ice'],
  ] as const)(
    '%s resolves its %s branch to authoritative %s damage',
    (moveName, targetBranchId, expectedType) => {
      const result = plan(fixture({ moveName, targetBranchId, naturalResult: 10 }))
      const slug = moveName === 'Fiery Wrath' ? 'fiery-wrath' : 'freezing-glare'
      expect(damageCalculation(result, `${slug}.damage`)).toMatchObject({
        moveType: { moveType: expectedType },
      })
      expect(result.resolution.script.type).toBe(expectedType)
      const alternate = targetBranchId === FIERY_WRATH_FIRE_BRANCH_ID
        || targetBranchId === FREEZING_GLARE_ICE_BRANCH_ID
      expect(operationEvent(result, `${slug}.alternate-type-usage`) !== undefined)
        .toBe(alternate)
    },
  )

  it.each([
    ['Fiery Wrath', FIERY_WRATH_FIRE_BRANCH_ID],
    ['Freezing Glare', FREEZING_GLARE_ICE_BRANCH_ID],
  ] as const)(
    'enforces %s alternate typing as an independent once-per-scene resource',
    (moveName, targetBranchId) => {
      const input = fixture({ moveName, targetBranchId, naturalResult: 10 })
      const first = plan(input, safeOperationId(`${moveName}_alternate_first`))
      const nextSheets = new Map(input.pokemonSheets)
      for (const write of first.sheetWrites) {
        if (write.kind === 'pokemon') nextSheets.set(write.slug, write.nextSheet as CharacterSheet)
      }
      const laterRoundMap: TabletopMap = {
        ...deepCloneJson(first.nextMap),
        initiative: { ...first.nextMap.initiative!, round: 3 },
        encounterState: {
          ...first.nextMap.encounterState!,
          turnResources: {},
        },
      }
      expect(() => planAuthoritativeMoveState({
        map: laterRoundMap,
        pokemonSheets: nextSheets,
        trainerSheets: input.trainerSheets,
        intent: input.intent,
        random: randomSequence(input.randomValues),
        now: () => NOW + 1,
        operationId: safeOperationId(`${moveName}_alternate_second`),
      })).toThrowError(expect.objectContaining({
        code: 'move-usage-unavailable',
        message: expect.stringContaining('no remaining Scene uses'),
      }))
    },
  )

  it('uses the higher actor offense while selecting Shell Side Arm class per target Defense', () => {
    const physical = plan(fixture({
      moveName: 'Shell Side Arm',
      naturalResult: 10,
      actor: { stats: { atk: 100, satk: 0 } },
      target: { stats: { def: 0, sdef: 100 } },
    }))
    const special = plan(fixture({
      moveName: 'Shell Side Arm',
      naturalResult: 10,
      actor: { stats: { atk: 100, satk: 0 } },
      target: { stats: { def: 100, sdef: 0 } },
    }))
    const tie = plan(fixture({
      moveName: 'Shell Side Arm',
      naturalResult: 10,
      actor: { stats: { atk: 100, satk: 0 } },
      target: { stats: { def: 50, sdef: 50 } },
    }))
    expect(damageCalculation(physical, 'shell-side-arm.damage')).toMatchObject({
      damageClass: {
        damageClass: 'physical',
        source: 'stat-comparison',
        comparison: { operator: 'less-than', matched: true },
      },
      attackStat: { label: 'Higher Stat' },
    })
    expect(damageCalculation(special, 'shell-side-arm.damage')).toMatchObject({
      damageClass: { damageClass: 'special', comparison: { matched: false } },
      attackStat: { label: 'Higher Stat' },
    })
    expect(damageCalculation(tie, 'shell-side-arm.damage')).toMatchObject({
      damageClass: {
        damageClass: 'special',
        comparison: { left: expect.any(Number), right: expect.any(Number), matched: false },
      },
    })
    const tieCalculation = damageCalculation(tie, 'shell-side-arm.damage') as {
      readonly damageClass?: { readonly comparison?: { readonly left?: number; readonly right?: number } }
    }
    expect(tieCalculation.damageClass?.comparison?.left)
      .toBe(tieCalculation.damageClass?.comparison?.right)
  })

  it.each([
    ['Chatter', { abilities: ['Own Tempo'] }, 'chatter.confusion', 'Own Tempo'],
    ['Dynamic Punch', { abilities: ['Own Tempo'] }, 'dynamic-punch.confusion', 'Own Tempo'],
    ['Fiery Wrath', { abilities: ['Inner Focus'] }, 'fiery-wrath.flinch', 'Inner Focus'],
    ['Fire Fang', { types: ['Fire'] }, 'fire-fang.coin-burned', 'Fire type'],
    ['Freezing Glare', { types: ['Ice'] }, 'freezing-glare.freeze', 'Ice type'],
    ['Ice Fang', { types: ['Ice'] }, 'ice-fang.coin-frozen', 'Ice type'],
    ['Shell Side Arm', { types: ['Poison'] }, 'shell-side-arm.poison', 'Poison type'],
  ] as const)(
    '%s preserves damage while tracing authoritative secondary-condition immunity',
    (moveName, target, operationId, blocker) => {
      const threshold = moveName === 'Freezing Glare' ? 19
        : moveName === 'Fire Fang' || moveName === 'Ice Fang' ? 18
          : moveName === 'Fiery Wrath' || moveName === 'Shell Side Arm' ? 17
            : moveName === 'Chatter' ? 16
              : 15
      const randomValues = moveName === 'Fire Fang' || moveName === 'Ice Fang'
        ? [d20(threshold), 0, 0, 0]
        : undefined
      const result = plan(fixture({ moveName, target, naturalResult: threshold, randomValues }))
      expect(result.resolution.transaction.hpUpdates.map(update => update.id)).toEqual([TARGET_ID])
      expect(operationEvent(result, operationId)).toMatchObject({
        outcome: 'prevented',
        result: {
          recipients: [{
            reasonCode: 'condition-immunity',
            blockers: [{ source: blocker }],
          }],
        },
      })
    },
  )

  it.each([
    ['Chatter', { abilities: ['Soundproof'] }],
    ['Dynamic Punch', { types: ['Ghost'] }],
    ['Freezing Glare', { types: ['Dark'] }],
    ['Shell Side Arm', { types: ['Steel'] }],
  ] as const)(
    '%s honors whole-move or type immunity without applying damage or conditions',
    (moveName, target) => {
      const result = plan(fixture({ moveName, naturalResult: 20, target }))
      expect(result.resolution.transaction.hitTargetIds).toEqual([TARGET_ID])
      expect(result.resolution.transaction.hpUpdates).toEqual([])
      expect(conditionsFor(result)).toEqual([])
      expect(JSON.stringify(result.resolution.auditTrace)).toMatch(/immun|Soundproof/i)
    },
  )

  it.each(MA_203_MOVE_NAMES)(
    'resolves %s hit, miss, critical, usage, and trace through the immediate planner',
    (moveName) => {
      const hitNatural = moveName === 'Dynamic Punch' ? 15 : 10
      const hit = plan(
        fixture({ moveName, naturalResult: hitNatural }),
        safeOperationId(`${moveName}_hit`),
      )
      const miss = plan(
        fixture({ moveName, naturalResult: 1 }),
        safeOperationId(`${moveName}_miss`),
      )
      const critical = plan(
        fixture({ moveName, naturalResult: 20 }),
        safeOperationId(`${moveName}_crit`),
      )
      expect(hit.resolution.transaction.attackedTargetIds).toEqual([TARGET_ID])
      expect(hit.resolution.transaction.hitTargetIds).toEqual([TARGET_ID])
      expect(hit.resolution.transaction.hpUpdates.map(update => update.id)).toEqual([TARGET_ID])
      expect(miss.resolution.transaction.attackedTargetIds).toEqual([TARGET_ID])
      expect(miss.resolution.transaction.hitTargetIds).toEqual([])
      expect(miss.resolution.transaction.hpUpdates).toEqual([])
      expect(damageCalculation(critical, damageOperationIdFor(moveName)))
        .toMatchObject({ criticalHit: { critical: true } })
      expect(hit.resolution.auditTrace.program).toMatchObject({
        canonicalId: moveName,
        runtimeKind: 'movespec-v2',
        runtimeVersion: 2,
      })
      expect(hit.nextMap.encounterState?.turnResources[ACTOR_ID]?.actions.standard.spent).toBe(1)
      expect(hit.resolution.rollLedger.every(entry => entry.parentEffectId.length > 0)).toBe(true)
    },
  )

  it.each(MA_203_MOVE_NAMES)(
    'commits %s once and replays an exact duplicate without rerolling',
    async (moveName) => {
      const input = recoveryFixture(moveName)
      const harness = openHarness(input)
      const evidence = MA_203_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('retry'))!
      const command = commandFor(input, safeOperationId(evidence.scenarioId))
      const first = await executeCommand(harness, command, {
        random: randomSequence(input.randomValues),
      })
      expect(first.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
      const committedMap = deepCloneJson(harness.maps.getBySlug(input.map.slug))
      const committedSheets = deepCloneJson(harness.sheets.list())
      const committedEvents = deepCloneJson(harness.events)
      const duplicate = await executeCommand(harness, command, {
        random: () => { throw new Error(`duplicate ${moveName} must not reroll`) },
        planner: () => { throw new Error(`duplicate ${moveName} must not replan`) },
      })
      expect(duplicate).toEqual(first)
      expect(harness.maps.getBySlug(input.map.slug)).toEqual(committedMap)
      expect(harness.sheets.list()).toEqual(committedSheets)
      expect(harness.events).toEqual(committedEvents)
    },
  )

  it.each(MA_203_MOVE_NAMES)(
    'rejects stale %s target reads without partial map, op, or realtime mutation',
    async (moveName) => {
      const input = recoveryFixture(moveName)
      const harness = openHarness(input)
      const evidence = MA_203_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.evidenceClasses.includes('multi-resource-conflict'))!
      const command = commandFor(input, safeOperationId(evidence.scenarioId))
      const mapBefore = deepCloneJson(harness.maps.getBySlug(input.map.slug))
      let racedSheet: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (plannerInput) => {
        const result = planAuthoritativeMoveState({
          ...plannerInput,
          random: randomSequence(input.randomValues),
        })
        expect(result.sheetReads).toContainEqual(expect.objectContaining({ slug: 'target' }))
        const current = harness.sheets.getByRef('pokemon', 'target')
        if (!current) throw new Error(`Missing ${moveName} raced target sheet.`)
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
        return result
      }
      const response = await executeCommand(harness, command, { planner })
      expect(response.result).toMatchObject({
        ok: false,
        reason: 'conflict',
        message: expect.stringContaining('consulted while resolving the move changed'),
      })
      expect(harness.maps.getBySlug(input.map.slug)).toEqual(mapBefore)
      expect(harness.sheets.getByRef('pokemon', 'target')?.sheet).toEqual(racedSheet)
      expect(harness.ops.getOpResult(input.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )
})
