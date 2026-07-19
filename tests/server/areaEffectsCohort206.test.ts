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
  type ResolveMoveSelection,
} from '#shared/livePlayMoveResolution'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { MoveBranchEffectOperation } from '#shared/moveAutomation/effects'
import { isPendingMoveDeclarationResult } from '#shared/moveAutomation/pendingResolution'
import {
  MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  MOVE_RESPONSE_COMMAND_TYPES,
  type MoveResponseCommand,
} from '#shared/moveAutomation/responseCommands'
import type { CharacterSheet } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { MoveAutomationAreaTemplate } from '~/types/moveAutomation'
import type { TrainerSheet } from '~/types/trainerSheet'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { nativeMoveAutomationPresentationScriptForMove } from '~/utils/move-automation/nativePresentation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import { deepCloneJson } from '~/utils/serialization'
import {
  planAuthoritativeMoveState,
  planAuthoritativeMoveStateExecution,
  type AuthoritativeMoveStatePlan,
} from '~~/server/domain/planAuthoritativeMoveState'
import {
  recordDigestionBuffTrade,
} from '~~/server/domain/moveAutomation/digestionBuffTrade'
import {
  registeredMoveAutomationRuntimeFor,
  REVIEWED_MOVE_SPEC_V2_REGISTRATIONS,
} from '~~/server/domain/moveAutomation/registry'
import {
  AEROBLAST_MOVE_SPEC,
  AROMATHERAPY_MOVE_SPEC,
  BELCH_MOVE_SPEC,
  BUG_BUZZ_MOVE_SPEC,
  CAPTIVATE_MOVE_SPEC,
  DIAMOND_STORM_MOVE_SPEC,
  DRACO_METEOR_MOVE_SPEC,
  FLEUR_CANNON_MOVE_SPEC,
  MA_206_MOVE_NAMES,
  type AreaEffects206MoveName,
} from '~~/server/domain/moveAutomation/specs/areaEffects206'
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
  MA_206_SCENARIOS_BY_MOVE,
  type AreaEffects206ScenarioEvidence,
} from '../fixtures/moveAutomation/areaEffects206'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const NOW = 8_000
const SOURCE_MODULE = 'server/domain/moveAutomation/specs/areaEffects206.ts'

const LINE_6: MoveAutomationAreaTemplate = { kind: 'line', size: 6, label: 'Line 6' }
const BURST_1: MoveAutomationAreaTemplate = { kind: 'burst', size: 1, label: 'Burst 1' }
const CONE_2: MoveAutomationAreaTemplate = { kind: 'cone', size: 2, label: 'Cone 2' }
const CLOSE_BLAST_2: MoveAutomationAreaTemplate = {
  kind: 'close-blast',
  size: 2,
  label: 'Close Blast 2',
}
const CLOSE_BLAST_3: MoveAutomationAreaTemplate = {
  kind: 'close-blast',
  size: 3,
  label: 'Close Blast 3',
}
const RANGED_BLAST_3: MoveAutomationAreaTemplate = {
  kind: 'ranged-blast',
  range: 8,
  size: 3,
  label: 'Ranged 8 Blast 3',
}
const LINE_9: MoveAutomationAreaTemplate = { kind: 'line', size: 9, label: 'Line 9' }

interface MoveDefinition {
  readonly slug: string
  readonly ac: number | null
  readonly damageBase: number | null
  readonly damageClass: 'Physical' | 'Special' | 'Status'
  readonly moveType: string
  readonly frequency: string
  readonly templates: readonly MoveAutomationAreaTemplate[]
  readonly smite: boolean
}

const MOVE_DEFINITIONS: Readonly<Record<AreaEffects206MoveName, MoveDefinition>> = {
  Aeroblast: {
    slug: 'aeroblast',
    ac: 3,
    damageBase: 10,
    damageClass: 'Special',
    moveType: 'Flying',
    frequency: 'Daily',
    templates: [LINE_6],
    smite: false,
  },
  Aromatherapy: {
    slug: 'aromatherapy',
    ac: null,
    damageBase: null,
    damageClass: 'Status',
    moveType: 'Grass',
    frequency: 'Scene',
    templates: [BURST_1],
    smite: false,
  },
  Belch: {
    slug: 'belch',
    ac: 4,
    damageBase: 12,
    damageClass: 'Special',
    moveType: 'Poison',
    frequency: 'Scene x2',
    templates: [CONE_2],
    smite: false,
  },
  'Bug Buzz': {
    slug: 'bug-buzz',
    ac: 2,
    damageBase: 9,
    damageClass: 'Special',
    moveType: 'Bug',
    frequency: 'Scene x2',
    templates: [CONE_2, CLOSE_BLAST_2],
    smite: true,
  },
  Captivate: {
    slug: 'captivate',
    ac: 2,
    damageBase: null,
    damageClass: 'Status',
    moveType: 'Normal',
    frequency: 'Scene',
    templates: [CONE_2],
    smite: false,
  },
  'Diamond Storm': {
    slug: 'diamond-storm',
    ac: 3,
    damageBase: 10,
    damageClass: 'Physical',
    moveType: 'Rock',
    frequency: 'Scene',
    templates: [CLOSE_BLAST_3],
    smite: true,
  },
  'Draco Meteor': {
    slug: 'draco-meteor',
    ac: 4,
    damageBase: 13,
    damageClass: 'Special',
    moveType: 'Dragon',
    frequency: 'Scene',
    templates: [RANGED_BLAST_3],
    smite: true,
  },
  'Fleur Cannon': {
    slug: 'fleur-cannon',
    ac: 4,
    damageBase: 13,
    damageClass: 'Special',
    moveType: 'Fairy',
    frequency: 'Scene',
    templates: [LINE_9],
    smite: true,
  },
}

const MOVE_SPECS = new Map([
  ['Aeroblast', AEROBLAST_MOVE_SPEC],
  ['Aromatherapy', AROMATHERAPY_MOVE_SPEC],
  ['Belch', BELCH_MOVE_SPEC],
  ['Bug Buzz', BUG_BUZZ_MOVE_SPEC],
  ['Captivate', CAPTIVATE_MOVE_SPEC],
  ['Diamond Storm', DIAMOND_STORM_MOVE_SPEC],
  ['Draco Meteor', DRACO_METEOR_MOVE_SPEC],
  ['Fleur Cannon', FLEUR_CANNON_MOVE_SPEC],
] as const)

const IMMEDIATE_MOVE_NAMES = MA_206_MOVE_NAMES.filter(
  (moveName): moveName is Exclude<AreaEffects206MoveName, 'Aromatherapy'> => (
    moveName !== 'Aromatherapy'
  ),
)
const DAMAGING_MOVE_NAMES = IMMEDIATE_MOVE_NAMES.filter(moveName => (
  MOVE_DEFINITIONS[moveName].damageBase !== null
))

interface TargetProfile {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
  readonly sideId?: 'heroes' | 'foes' | null
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
  readonly conditions?: readonly string[]
  readonly gender?: string
  readonly stages?: Readonly<Partial<Record<'atk' | 'def' | 'satk' | 'sdef' | 'spd', number>>>
}

interface CohortFixture {
  readonly map: TabletopMap
  readonly pokemonSheets: ReadonlyMap<string, CharacterSheet>
  readonly trainerSheets: ReadonlyMap<string, TrainerSheet>
  readonly intent: ResolveMoveIntent
  readonly candidateScopePlacementIds: readonly string[]
  readonly randomValues: readonly number[]
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
  position: TargetProfile['position'],
  sideId: TargetProfile['sideId'] = 'foes',
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug: slug,
  ...(sideId ? { sideId } : {}),
  position: { ...position },
})

const pokemonSheet = (options: {
  readonly slug: string
  readonly moveName?: AreaEffects206MoveName
  readonly profile?: Omit<TargetProfile, 'id' | 'position' | 'sideId'>
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: 'Mew',
  types: [...(options.profile?.types ?? ['Normal'])],
  gender: options.profile?.gender ?? 'Genderless',
  level: 30,
  revision: 3,
  capabilities: { overland: 6, size: 'Medium' },
  movelist: options.moveName ? [{ name: options.moveName }] : [],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  stats: {
    hp: { added: 500 },
    atk: { added: 20, stage: options.profile?.stages?.atk ?? 0 },
    def: { added: 10, stage: options.profile?.stages?.def ?? 0 },
    satk: { added: 20, stage: options.profile?.stages?.satk ?? 0 },
    sdef: { added: 10, stage: options.profile?.stages?.sdef ?? 0 },
    spd: { added: 10, stage: options.profile?.stages?.spd ?? 0 },
  },
  combatStages: { acc: 0 },
  combat: {
    currentHp: 500,
    conditions: [...(options.profile?.conditions ?? [])],
  },
})

const defaultTargets = (): readonly TargetProfile[] => [{
  id: 'target-a',
  position: { x: 5, y: 0, z: 5 },
  gender: 'Female',
}, {
  id: 'target-b',
  position: { x: 6, y: 0, z: 5 },
  gender: 'Female',
}]

const selectionFor = (input: {
  readonly moveName: AreaEffects206MoveName
  readonly targets: readonly TargetProfile[]
  readonly template?: MoveAutomationAreaTemplate
  readonly excludedTargetPlacementIds?: readonly string[]
}): ResolveMoveSelection => {
  const template = input.template ?? MOVE_DEFINITIONS[input.moveName].templates[0]!
  const common = {
    kind: 'area' as const,
    areaTemplateId: moveAutomationAreaTemplateId(template),
    ...(input.excludedTargetPlacementIds?.length
      ? { excludedTargetPlacementIds: [...input.excludedTargetPlacementIds] }
      : {}),
  }
  if (template.kind === 'line' || template.kind === 'cone') {
    return { ...common, direction: 'east' }
  }
  if (template.kind === 'close-blast' || template.kind === 'ranged-blast') {
    return {
      ...common,
      aimCell: { ...(input.targets[0]?.position ?? { x: 6, y: 0, z: 5 }) },
    }
  }
  return common
}

const fixture = (options: {
  readonly moveName: AreaEffects206MoveName
  readonly targets?: readonly TargetProfile[]
  readonly naturalResults?: readonly number[]
  readonly template?: MoveAutomationAreaTemplate
  readonly actorGender?: string
  readonly actorStages?: TargetProfile['stages']
  readonly digestionBuffTraded?: boolean
  readonly excludedTargetPlacementIds?: readonly string[]
}): CohortFixture => {
  const definition = MOVE_DEFINITIONS[options.moveName]
  const targets = options.targets ?? defaultTargets()
  const encounter = createEmptyEncounterState()
  let map: TabletopMap = {
    schemaVersion: 2,
    slug: `ma206-${definition.slug}`,
    name: `MA-206 ${options.moveName}`,
    revision: 7,
    dimensions: { x: 20, y: 3, z: 15 },
    groundLevelY: 0,
    playerVisible: true,
    voxels: [],
    hazards: [],
    fieldEffects: { weather: [], terrains: [], rooms: [] },
    placements: [
      placement(ACTOR_ID, 'actor', { x: 4, y: 0, z: 5 }, 'heroes'),
      ...targets.map(target => placement(
        target.id,
        target.id,
        target.position,
        target.sideId === undefined ? 'foes' : target.sideId,
      )),
    ],
    lights: [],
    initiative: { activeId: ACTOR_ID, round: 1 },
    activeScene: { name: 'MA-206 scene', startedAt: 100 },
    encounterState: {
      ...encounter,
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
        foes: { id: 'foes', label: 'Foes', status: 'active' },
      },
    },
    metadata: { note: 'preserved' },
    createdAt: 1,
    updatedAt: 100,
  }
  if (options.digestionBuffTraded) {
    map = recordDigestionBuffTrade({
      map,
      placement: map.placements[0]!,
      operationId: 'item.trade-digestion-buff',
      moveId: 'item.snack',
    })
  }

  const sheets = new Map<string, CharacterSheet>([[
    'actor',
    pokemonSheet({
      slug: 'actor',
      moveName: options.moveName,
      profile: {
        types: [definition.moveType],
        gender: options.actorGender ?? 'Male',
        stages: options.actorStages,
      },
    }),
  ]])
  for (const target of targets) {
    sheets.set(target.id, pokemonSheet({
      slug: target.id,
      profile: {
        types: target.types,
        abilities: target.abilities,
        conditions: target.conditions,
        gender: target.gender,
        stages: target.stages,
      },
    }))
  }

  return {
    map,
    pokemonSheets: sheets,
    trainerSheets: new Map<string, TrainerSheet>(),
    intent: {
      schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
      placementId: ACTOR_ID,
      moveName: options.moveName,
      selection: selectionFor({
        moveName: options.moveName,
        targets,
        template: options.template,
        excludedTargetPlacementIds: options.excludedTargetPlacementIds,
      }),
    },
    candidateScopePlacementIds: targets.map(target => target.id),
    randomValues: [
      ...(options.naturalResults ?? targets.map((_, index) => index === 0 ? 10 : 1)).map(d20),
      ...Array.from({ length: 96 }, () => 0),
    ],
  }
}

const plan = (
  input: CohortFixture,
  operationId = 'op_ma206_plan',
): AuthoritativeMoveStatePlan => planAuthoritativeMoveState({
  ...input,
  random: randomSequence(input.randomValues),
  now: () => NOW,
  operationId,
  idFactory: (() => {
    let sequence = 0
    return () => `ma206-plan-id-${++sequence}`
  })(),
})

const operationEvent = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
) => result.resolution.auditTrace.events.findLast(event => (
  event.kind === 'operation' && event.operationId === operationId
))

const operationRecipient = (
  result: AuthoritativeMoveStatePlan,
  operationId: string,
  recipientId: string,
): Readonly<Record<string, unknown>> | null => {
  const event = operationEvent(result, operationId)
  if (!event || event.kind !== 'operation' || typeof event.result !== 'object' || !event.result) {
    return null
  }
  const recipients = 'recipients' in event.result && Array.isArray(event.result.recipients)
    ? event.result.recipients
    : []
  return recipients.find((recipient): recipient is Readonly<Record<string, unknown>> => (
    typeof recipient === 'object'
    && recipient !== null
    && 'recipientId' in recipient
    && recipient.recipientId === recipientId
  )) ?? null
}

const normalizedEvidence = (
  scenarios: readonly AreaEffects206ScenarioEvidence[],
) => scenarios.map(scenario => ({
  scenarioId: scenario.scenarioId,
  evidenceClasses: [...scenario.evidenceClasses].sort(),
})).sort((left, right) => left.scenarioId.localeCompare(right.scenarioId))

const safeOperationId = (moveName: AreaEffects206MoveName, suffix: string): string => (
  `op_ma206_${moveName.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')}_${suffix}`
)

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
  clientId: 'ma206-test-client',
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
    return () => `ma206-command-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const choiceCommand = (input: {
  readonly mapSlug: string
  readonly resolutionId: string
  readonly windowId: string
  readonly optionId: string
  readonly baseRevision: number
  readonly opId: string
}): MoveResponseCommand => ({
  schemaVersion: MOVE_RESPONSE_COMMAND_SCHEMA_VERSION,
  opId: input.opId,
  mapSlug: input.mapSlug,
  baseRevision: input.baseRevision,
  type: MOVE_RESPONSE_COMMAND_TYPES.CHOOSE,
  payload: {
    resolutionId: input.resolutionId,
    windowId: input.windowId,
    optionId: input.optionId,
  },
})

const gmResponseAuthorization: ResumePendingMoveResolutionInput['authorization'] = {
  source: 'gm-authority',
  chosenBy: { kind: 'gm', id: null },
}

const respond = (
  harness: CommandHarness,
  command: MoveResponseCommand,
  random: () => number = () => 0,
) => {
  const parsed = parsePendingMoveResponseCommand(command, {
    pendingResolutionRepository: harness.pending,
  })
  return () => resumePendingMoveResolutionUseCase({
    ...parsed,
    role: 'gm',
    playerProfile: null,
    authorization: gmResponseAuthorization,
    clientId: 'ma206-response-client',
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
  slug: string,
): readonly string[] => {
  const combat = harness.sheets.getByRef('pokemon', slug)?.sheet.combat as {
    readonly conditions?: unknown
  } | undefined
  return Array.isArray(combat?.conditions) ? combat.conditions as readonly string[] : []
}

const acceptedEventCount = (events: readonly unknown[]): number => events.filter(event => (
  typeof event === 'object'
  && event !== null
  && (event as { readonly type?: string }).type === 'live-play-command-accepted'
)).length

const aromatherapyFixture = (): CohortFixture => fixture({
  moveName: 'Aromatherapy',
  targets: [{
    id: 'ally-a',
    position: { x: 5, y: 0, z: 5 },
    sideId: 'heroes',
    conditions: ['Burned', 'Poisoned'],
    gender: 'Female',
  }, {
    id: 'ally-b',
    position: { x: 4, y: 0, z: 4 },
    sideId: 'heroes',
    conditions: ['Frozen', 'Confused'],
    gender: 'Male',
  }, {
    id: 'enemy',
    position: { x: 3, y: 0, z: 5 },
    sideId: 'foes',
    conditions: ['Burned'],
    gender: 'Female',
  }, {
    id: 'unknown-side',
    position: { x: 4, y: 0, z: 6 },
    sideId: null,
    conditions: ['Burned'],
    gender: 'Female',
  }],
})

const pendingWindows = (harness: CommandHarness, mapSlug: string) => (
  listPendingMoveResponsesUseCase({
    role: 'gm',
    mapSlug,
    playerProfile: null,
  }, {
    database: harness.database,
    mapRepository: harness.maps,
    sheetRepository: harness.sheets,
    pendingResolutionRepository: harness.pending,
  }).windows
)

describe('MA-206 area filters, cleanse, critical, and stage cohort', () => {
  it('selects exactly eight complete reviewed native runtimes with linked evidence', () => {
    for (const moveName of MA_206_MOVE_NAMES) {
      const row = manifestJson.moves.find(candidate => candidate.canonicalId === moveName)!
      expect(row).toMatchObject({
        baseStatus: 'complete',
        interactionStatus: 'unassessed',
        runtime: {
          kind: 'movespec-v2',
          version: 2,
          definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          sourceModule: SOURCE_MODULE,
        },
        suggestedCapabilityTags: [],
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        reviewedAt: '2026-07-19',
        rolloutCohortId: 'ma-206',
      })
      expect(row.scenarioIds).toEqual(
        MA_206_SCENARIOS_BY_MOVE[moveName].map(({ scenarioId }) => scenarioId),
      )
      expect(normalizedEvidence(row.conformanceEvidence.scenarios))
        .toEqual(normalizedEvidence(MA_206_SCENARIOS_BY_MOVE[moveName]))
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        definition: { spec: { canonicalId: moveName } },
        definitionHash: row.runtime.definitionHash,
      })
      expect(REVIEWED_MOVE_SPEC_V2_REGISTRATIONS.filter(entry => entry.canonicalId === moveName))
        .toHaveLength(1)
      expect(menuStatusJson.moves.find(candidate => candidate.canonicalId === moveName))
        .toMatchObject({ baseStatus: 'complete', runtimeKind: 'movespec-v2', blockerCodes: [] })

      const presentation = nativeMoveAutomationPresentationScriptForMove(moveName)
      const definition = MOVE_DEFINITIONS[moveName]
      expect(presentation).toMatchObject({
        moveName,
        damaging: definition.damageBase !== null,
        damageBase: definition.damageBase ?? 0,
        damageClass: definition.damageClass,
        ac: definition.ac,
        automationNotes: [],
      })
      expect(presentation?.areaTemplates).toEqual(definition.templates)
    }
  })

  it('encodes only server-owned reviewed mechanics for every cohort member', () => {
    for (const moveName of MA_206_MOVE_NAMES) {
      const definition = MOVE_DEFINITIONS[moveName]
      const spec = MOVE_SPECS.get(moveName)!
      expect(spec).toMatchObject({
        canonicalId: moveName,
        version: 2,
        targeting: { kind: 'area', minTargets: 0, maxTargets: 32 },
        costs: [{
          id: `${definition.slug}.cost.standard-action`,
          phase: 'pay',
          cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
        }],
        registeredHandlerId: null,
      })
      expect(JSON.stringify(spec)).not.toMatch(/manual|client|script/i)
    }

    expect(AEROBLAST_MOVE_SPEC.phases.flatMap(block => block.operations))
      .toContainEqual(expect.objectContaining({
        id: 'aeroblast.damage',
        payload: expect.objectContaining({
          criticalHit: {
            trigger: { kind: 'natural-rolls', values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20] },
            prevention: 'honor',
          },
        }),
      }))
    expect(AROMATHERAPY_MOVE_SPEC).toMatchObject({
      targeting: { predicate: { relationship: 'ally', excludeActor: true } },
    })
    const aromatherapyBranch = AROMATHERAPY_MOVE_SPEC.phases
      .flatMap(block => block.operations)
      .find(operation => operation.id === 'aromatherapy.choose-condition') as unknown as
      MoveBranchEffectOperation | undefined
    expect(aromatherapyBranch?.kind).toBe('branch')
    if (!aromatherapyBranch || aromatherapyBranch.payload.kind !== 'choice') {
      throw new Error('Aromatherapy must retain its reviewed condition-choice branch.')
    }
    expect(aromatherapyBranch.payload.options.map(option => option.id)).toEqual([
      'cure.paralysis',
      'cure.flinch',
      'cure.infatuation',
      'cure.confused',
      'cure.suppressed',
      'cure.burned',
      'cure.frozen',
      'cure.poisoned',
      'cure.badly-poisoned',
      'cure.bad-sleep',
      'cure.cursed',
      'cure.disabled',
      'cure.rage',
      'cure.sleep',
      'cure.none',
    ])
    expect(aromatherapyBranch.payload.options.every(option => option.predicate !== undefined))
      .toBe(true)
    expect(BELCH_MOVE_SPEC.preconditions).toMatchObject([{
      failureReasonCode: 'belch.digestion-buff-required',
      predicate: {
        left: { kind: 'capability', capabilityId: 'digestion-buff-traded-this-scene' },
      },
    }])
    expect(BUG_BUZZ_MOVE_SPEC.phases.flatMap(block => block.operations))
      .toContainEqual(expect.objectContaining({
        id: 'bug-buzz.lower-special-defense',
        payload: expect.objectContaining({
          trigger: {
            kind: 'accuracy-roll',
            rollId: 'bug-buzz.accuracy-roll',
            trigger: { kind: 'range', minimum: 19 },
            scope: 'recipient',
            application: 'once',
          },
        }),
      }))
    expect(CAPTIVATE_MOVE_SPEC).toMatchObject({
      targeting: { predicate: { statePredicates: [{ kind: 'opposite-gender' }] } },
    })
    expect(DIAMOND_STORM_MOVE_SPEC.phases.flatMap(block => block.operations))
      .toContainEqual(expect.objectContaining({
        id: 'diamond-storm.raise-defense',
        recipients: { kind: 'actor' },
        payload: expect.objectContaining({
          trigger: expect.objectContaining({ scope: 'resolution', application: 'per-match' }),
        }),
      }))
    for (const spec of [DRACO_METEOR_MOVE_SPEC, FLEUR_CANNON_MOVE_SPEC]) {
      const slug = spec.canonicalId === 'Draco Meteor' ? 'draco-meteor' : 'fleur-cannon'
      expect(spec.phases.flatMap(block => block.operations)).toContainEqual(expect.objectContaining({
        id: `${slug}.lower-special-attack`,
        recipients: { kind: 'actor' },
        payload: expect.objectContaining({
          trigger: { kind: 'operation-outcome', operationId: `${slug}.damage`, outcome: 'applied' },
        }),
      }))
    }
  })

  it.each(IMMEDIATE_MOVE_NAMES)(
    '%s resolves geometric recipients, accuracy, costs, usage, and effects in one plan',
    (moveName) => {
      const input = fixture({
        moveName,
        naturalResults: [10, 1],
        digestionBuffTraded: moveName === 'Belch',
      })
      const result = plan(input, safeOperationId(moveName, 'baseline'))
      const definition = MOVE_DEFINITIONS[moveName]
      const targetIds = input.candidateScopePlacementIds

      expect(result.resolution.selectedTargetIds).toEqual(targetIds)
      expect(result.resolution.transaction.attackedTargetIds).toEqual(targetIds)
      expect(result.resolution.transaction.hitTargetIds).toEqual([targetIds[0]])
      expect(result.resolution.area).toMatchObject({
        template: definition.templates[0],
        candidateTargetIds: targetIds,
      })
      expect(result.resolution.rollLedger.filter(entry => (
        entry.parentEffectId === `${definition.slug}.accuracy`
      )).map(entry => entry.naturalResult)).toEqual([10, 1])
      expect(result.nextMap.encounterState?.turnResources[ACTOR_ID]?.actions.standard.spent).toBe(1)
      expect(result.usage).toMatchObject({ moveName, frequency: definition.frequency, uses: 1 })

      if (definition.damageBase !== null) {
        expect(operationEvent(result, `${definition.slug}.damage`)).toMatchObject({
          outcome: 'applied',
          recipientIds: definition.smite ? targetIds : [targetIds[0]],
        })
        expect(result.resolution.transaction.hpUpdates.map(update => update.id)).toEqual(
          definition.smite ? targetIds : [targetIds[0]],
        )
      }
      else {
        expect(result.resolution.transaction.hpUpdates).toEqual([])
        expect(result.resolution.transaction.combatStageUpdates).toEqual([
          expect.objectContaining({ id: 'target-a' }),
        ])
      }
    },
  )

  it.each(DAMAGING_MOVE_NAMES)(
    '%s reuses its authoritative natural twenty for critical damage',
    (moveName) => {
      const input = fixture({
        moveName,
        targets: [defaultTargets()[0]!],
        naturalResults: [20],
        digestionBuffTraded: moveName === 'Belch',
      })
      const definition = MOVE_DEFINITIONS[moveName]
      const result = plan(input, safeOperationId(moveName, 'critical'))
      expect(operationRecipient(result, `${definition.slug}.damage`, 'target-a')).toMatchObject({
        outcome: 'applied',
        details: { calculation: { criticalHit: { naturalRoll: 20, critical: true } } },
      })
      expect(result.resolution.rollLedger.filter(entry => (
        entry.parentEffectId === `${definition.slug}.accuracy`
      ))).toHaveLength(1)
    },
  )

  it('uses Aeroblast even-roll criticals without a second roll', () => {
    const even = plan(fixture({
      moveName: 'Aeroblast',
      targets: [defaultTargets()[0]!],
      naturalResults: [10],
    }), 'op_ma206_aeroblast_even')
    const odd = plan(fixture({
      moveName: 'Aeroblast',
      targets: [defaultTargets()[0]!],
      naturalResults: [19],
    }), 'op_ma206_aeroblast_odd')
    expect(operationRecipient(even, 'aeroblast.damage', 'target-a'))
      .toMatchObject({ details: { calculation: { criticalHit: { naturalRoll: 10, critical: true } } } })
    expect(operationRecipient(odd, 'aeroblast.damage', 'target-a'))
      .toMatchObject({ details: { calculation: { criticalHit: { naturalRoll: 19, critical: false } } } })
    expect(even.resolution.rollLedger.filter(entry => entry.reason.includes('accuracy'))).toHaveLength(1)
  })

  it('requires a scene-local Digestion Buff trade before Belch and preserves the marker across placement IDs', () => {
    const blocked = fixture({
      moveName: 'Belch',
      targets: [defaultTargets()[0]!],
      naturalResults: [10],
    })
    let draws = 0
    expect(() => planAuthoritativeMoveState({
      ...blocked,
      random: () => {
        draws += 1
        return 0
      },
      now: () => NOW,
      operationId: 'op_ma206_belch_blocked',
    })).toThrowError(expect.objectContaining({
      code: 'execution-rejected',
      message: expect.stringContaining('belch.digestion-buff-required'),
    }))
    expect(draws).toBe(0)

    const traded = fixture({
      moveName: 'Belch',
      targets: [defaultTargets()[0]!],
      naturalResults: [10],
      digestionBuffTraded: true,
    })
    const replacedPlacementMap: TabletopMap = {
      ...traded.map,
      placements: traded.map.placements.map(placement => placement.id === ACTOR_ID
        ? { ...placement, id: 'replacement-actor-token' }
        : placement),
      initiative: { activeId: 'replacement-actor-token', round: 1 },
    }
    const replacedIntent: ResolveMoveIntent = {
      ...traded.intent,
      placementId: 'replacement-actor-token',
    }
    const accepted = plan({
      ...traded,
      map: replacedPlacementMap,
      intent: replacedIntent,
    }, 'op_ma206_belch_replacement')
    expect(accepted.resolution.transaction.hitTargetIds).toEqual(['target-a'])
    expect(accepted.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
      kind: 'predicate',
      predicateId: 'belch.digestion-buff-traded',
      outcome: true,
    }))
  })

  it('applies Bug Buzz threshold stages only to hit recipients and honors Soundproof and Shield Dust', () => {
    const passed = plan(fixture({
      moveName: 'Bug Buzz',
      targets: [defaultTargets()[0]!],
      naturalResults: [19],
    }), 'op_ma206_bug_buzz_pass')
    const failed = plan(fixture({
      moveName: 'Bug Buzz',
      targets: [defaultTargets()[0]!],
      naturalResults: [18],
    }), 'op_ma206_bug_buzz_fail')
    expect(passed.resolution.transaction.combatStageUpdates).toEqual([
      expect.objectContaining({ id: 'target-a', stages: expect.objectContaining({ sdef: -1 }) }),
    ])
    expect(failed.resolution.transaction.combatStageUpdates).toEqual([])
    expect(operationRecipient(failed, 'bug-buzz.lower-special-defense', 'target-a'))
      .toMatchObject({ outcome: 'no-op', reasonCode: 'combat-stage-trigger-not-met' })

    const soundproof = plan(fixture({
      moveName: 'Bug Buzz',
      targets: [{ ...defaultTargets()[0]!, abilities: ['Soundproof'] }],
      naturalResults: [19],
    }), 'op_ma206_bug_buzz_soundproof')
    expect(soundproof.resolution.transaction.hpUpdates).toEqual([])
    expect(soundproof.resolution.transaction.combatStageUpdates).toEqual([])
    expect(operationRecipient(soundproof, 'bug-buzz.damage', 'target-a'))
      .toMatchObject({ outcome: 'prevented', reasonCode: 'damage-immunity' })

    const shieldDust = plan(fixture({
      moveName: 'Bug Buzz',
      targets: [{ ...defaultTargets()[0]!, abilities: ['Shield Dust'] }],
      naturalResults: [19],
    }), 'op_ma206_bug_buzz_shield_dust')
    expect(shieldDust.resolution.transaction.hpUpdates).toHaveLength(1)
    expect(shieldDust.resolution.transaction.combatStageUpdates).toEqual([])
    expect(operationRecipient(shieldDust, 'bug-buzz.lower-special-defense', 'target-a'))
      .toMatchObject({
        outcome: 'prevented',
        reasonCode: 'combat-stage-immunity',
        blockers: [expect.objectContaining({ source: 'Shield Dust' })],
      })
  })

  it('supports both reviewed Bug Buzz area forms with the same mechanics', () => {
    const cone = plan(fixture({
      moveName: 'Bug Buzz',
      targets: [defaultTargets()[0]!],
      naturalResults: [19],
    }), 'op_ma206_bug_buzz_cone')
    const blast = plan(fixture({
      moveName: 'Bug Buzz',
      targets: [defaultTargets()[0]!],
      naturalResults: [19],
      template: CLOSE_BLAST_2,
    }), 'op_ma206_bug_buzz_blast')
    expect(cone.resolution.area?.template).toEqual(CONE_2)
    expect(blast.resolution.area?.template).toEqual(CLOSE_BLAST_2)
    expect(cone.resolution.transaction.combatStageUpdates)
      .toEqual(blast.resolution.transaction.combatStageUpdates)
  })

  it('filters Captivate by authoritative actor/target gender before rolls and honors Friendly exclusions', () => {
    const targets: readonly TargetProfile[] = [{
      id: 'female-a',
      position: { x: 5, y: 0, z: 5 },
      gender: 'Female',
    }, {
      id: 'female-b',
      position: { x: 6, y: 0, z: 4 },
      gender: 'Female',
    }, {
      id: 'same-gender',
      position: { x: 6, y: 0, z: 5 },
      gender: 'Male',
    }, {
      id: 'genderless',
      position: { x: 6, y: 0, z: 6 },
      gender: 'Genderless',
    }]
    const result = plan(fixture({
      moveName: 'Captivate',
      targets,
      naturalResults: [10],
      excludedTargetPlacementIds: ['female-b'],
    }), 'op_ma206_captivate_filter')
    expect(result.resolution.selectedTargetIds).toEqual(['female-a'])
    expect(result.resolution.transaction.attackedTargetIds).toEqual(['female-a'])
    expect(result.resolution.transaction.combatStageUpdates).toEqual([
      expect.objectContaining({ id: 'female-a', stages: expect.objectContaining({ satk: -2 }) }),
    ])
    expect(result.resolution.rollLedger.filter(entry => entry.reason.includes('accuracy')))
      .toHaveLength(1)
    expect(result.resolution.area?.targetEvaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetPlacementId: 'female-b', outcome: 'excluded' }),
      expect.objectContaining({
        targetPlacementId: 'same-gender',
        outcome: 'excluded',
        reasonCode: 'target-excluded-gender',
      }),
      expect.objectContaining({
        targetPlacementId: 'genderless',
        outcome: 'excluded',
        reasonCode: 'target-excluded-gender',
      }),
    ]))

    const row = manifestJson.moves.find(candidate => candidate.canonicalId === 'Captivate')!
    expect(row.conformanceEvidence.requirementTags).not.toContain('branch.immunity')
    expect(row.conformanceEvidence.notApplicable).toEqual([])
  })

  it('stacks Diamond Storm Defense once per even authoritative target roll and traces odd no-op', () => {
    const stacked = plan(fixture({
      moveName: 'Diamond Storm',
      naturalResults: [4, 6],
    }), 'op_ma206_diamond_even')
    expect(stacked.resolution.transaction.combatStageUpdates).toEqual([
      expect.objectContaining({ id: ACTOR_ID, stages: expect.objectContaining({ def: 2 }) }),
    ])
    expect(operationRecipient(stacked, 'diamond-storm.raise-defense', ACTOR_ID))
      .toMatchObject({
        outcome: 'applied',
        details: { trigger: { matched: true, applicationCount: 2, naturalResults: [4, 6] } },
      })

    const odd = plan(fixture({
      moveName: 'Diamond Storm',
      targets: [defaultTargets()[0]!],
      naturalResults: [5],
    }), 'op_ma206_diamond_odd')
    expect(odd.resolution.transaction.combatStageUpdates).toEqual([])
    expect(operationRecipient(odd, 'diamond-storm.raise-defense', ACTOR_ID))
      .toMatchObject({ outcome: 'no-op', reasonCode: 'combat-stage-trigger-not-met' })
  })

  it.each([
    ['Draco Meteor', 'Fairy'],
    ['Fleur Cannon', null],
  ] as const)(
    '%s lowers Special Attack only after an applied damage operation',
    (moveName, immuneType) => {
      const applied = plan(fixture({
        moveName,
        targets: [defaultTargets()[0]!],
        naturalResults: [10],
      }), safeOperationId(moveName, 'self_drop'))
      expect(applied.resolution.transaction.combatStageUpdates).toEqual([
        expect.objectContaining({ id: ACTOR_ID, stages: expect.objectContaining({ satk: -2 }) }),
      ])

      const prevented = plan(fixture({
        moveName,
        targets: immuneType
          ? [{ ...defaultTargets()[0]!, types: [immuneType] }]
          : [],
        naturalResults: immuneType ? [10] : [],
      }), safeOperationId(moveName, 'no_damage'))
      expect(prevented.resolution.transaction.hpUpdates).toEqual([])
      expect(prevented.resolution.transaction.combatStageUpdates).toEqual([])
      expect(operationRecipient(
        prevented,
        `${MOVE_DEFINITIONS[moveName].slug}.lower-special-attack`,
        ACTOR_ID,
      )).toMatchObject({ outcome: 'no-op', reasonCode: 'combat-stage-trigger-not-met' })
    },
  )

  it('suspends Aromatherapy per afflicted ally, restores private choices, and commits each selected cleanse once', async () => {
    const input = aromatherapyFixture()
    const pure = planAuthoritativeMoveStateExecution({
      ...input,
      operationId: 'op_ma206_aromatherapy_pure',
      pendingResolutionId: 'resolution-ma206-aromatherapy-pure',
      random: () => { throw new Error('Aromatherapy must not draw randomness') },
      now: () => NOW,
    })
    expect(pure).toMatchObject({
      kind: 'pending',
      execution: {
        selectedTargetIds: ['ally-a', 'ally-b'],
        execution: {
          request: {
            kind: 'branch-choice',
            recipientIds: ['ally-a'],
            options: [{ id: 'cure.burned' }, { id: 'cure.poisoned' }],
          },
        },
      },
    })

    const harness = openHarness(input)
    const command = commandFor(input, 'op_ma206_aromatherapy_declare')
    const declaration = await executeCommand(harness, command, {
      random: () => { throw new Error('Aromatherapy declaration must not draw randomness') },
      planner: planAuthoritativeMoveStateExecution,
    })
    const duplicateDeclaration = await executeCommand(harness, command, {
      random: () => { throw new Error('duplicate declaration must not draw randomness') },
      planner: () => { throw new Error('duplicate declaration must not replan') },
    })
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    expect(duplicateDeclaration).toEqual(declaration)
    if (!isPendingMoveDeclarationResult(declaration.result)) return
    expect(storedConditions(harness, 'ally-a')).toEqual(['Burned', 'Poisoned'])
    expect(storedConditions(harness, 'ally-b')).toEqual(['Frozen', 'Confused'])
    expect(storedConditions(harness, 'enemy')).toEqual(['Burned'])
    expect(pendingWindows(harness, input.map.slug)).toMatchObject([{
      window: {
        kind: 'choice',
        options: [{ id: 'cure.burned' }, { id: 'cure.poisoned' }],
      },
    }])

    const resolutionId = declaration.result.pendingResolution.resolutionId
    const firstStored = harness.pending.getById(resolutionId)!
    expect(firstStored.resolution.outstandingWindows[0]?.ownership)
      .toEqual([{ kind: 'target', id: 'ally-a' }])
    const firstWindow = firstStored.resolution.outstandingWindows[0]!
    const firstCommand = choiceCommand({
      mapSlug: input.map.slug,
      resolutionId,
      windowId: firstWindow.windowId,
      optionId: 'cure.burned',
      baseRevision: harness.maps.getBySlug(input.map.slug)?.revision ?? 0,
      opId: 'op_ma206_aromatherapy_choose_a',
    })
    const firstInvoke = respond(harness, firstCommand)
    const first = firstInvoke()
    const duplicateFirst = firstInvoke()
    expect(first.result).toMatchObject({ ok: true, previousRevision: 8, revision: 9 })
    expect(duplicateFirst.result).toEqual(first.result)
    expect(harness.pending.getById(resolutionId)).toMatchObject({ status: 'pending' })
    expect(storedConditions(harness, 'ally-a')).toEqual(['Burned', 'Poisoned'])
    expect(pendingWindows(harness, input.map.slug)).toMatchObject([{
      window: {
        kind: 'choice',
        options: [{ id: 'cure.confused' }, { id: 'cure.frozen' }],
      },
    }])

    const secondStored = harness.pending.getById(resolutionId)!
    expect(secondStored.resolution.outstandingWindows[0]?.ownership)
      .toEqual([{ kind: 'target', id: 'ally-b' }])
    const secondWindow = secondStored.resolution.outstandingWindows[0]!
    const secondCommand = choiceCommand({
      mapSlug: input.map.slug,
      resolutionId,
      windowId: secondWindow.windowId,
      optionId: 'cure.frozen',
      baseRevision: harness.maps.getBySlug(input.map.slug)?.revision ?? 0,
      opId: 'op_ma206_aromatherapy_choose_b',
    })
    const secondInvoke = respond(harness, secondCommand)
    const accepted = secondInvoke()
    const duplicateSecond = secondInvoke()
    expect(accepted.result).toMatchObject({ ok: true })
    expect(duplicateSecond.result).toEqual(accepted.result)
    expect(storedConditions(harness, 'ally-a')).toEqual(['Poisoned'])
    expect(storedConditions(harness, 'ally-b')).toEqual(['Confused'])
    expect(storedConditions(harness, 'enemy')).toEqual(['Burned'])
    expect(storedConditions(harness, 'unknown-side')).toEqual(['Burned'])
    expect(harness.pending.getById(resolutionId)).toMatchObject({
      status: 'committed',
      terminalOpId: secondCommand.opId,
    })
    expect(pendingWindows(harness, input.map.slug)).toEqual([])
  })

  it('rejects forged or stale Aromatherapy responses without applying a partial cleanse', async () => {
    const input = aromatherapyFixture()
    const harness = openHarness(input)
    const declaration = await executeCommand(
      harness,
      commandFor(input, 'op_ma206_aromatherapy_guard_declare'),
      {
        random: () => { throw new Error('Aromatherapy must not draw randomness') },
        planner: planAuthoritativeMoveStateExecution,
      },
    )
    expect(isPendingMoveDeclarationResult(declaration.result)).toBe(true)
    if (!isPendingMoveDeclarationResult(declaration.result)) return
    const resolutionId = declaration.result.pendingResolution.resolutionId
    const stored = harness.pending.getById(resolutionId)!
    const window = stored.resolution.outstandingWindows[0]!

    const forged = choiceCommand({
      mapSlug: input.map.slug,
      resolutionId,
      windowId: window.windowId,
      optionId: 'cure.client-forged',
      baseRevision: harness.maps.getBySlug(input.map.slug)?.revision ?? 0,
      opId: 'op_ma206_aromatherapy_forged',
    })
    expect(() => parsePendingMoveResponseCommand(forged, {
      pendingResolutionRepository: harness.pending,
    })).toThrowError(expect.objectContaining({ code: 'unknown-option' }))
    expect(storedConditions(harness, 'ally-a')).toEqual(['Burned', 'Poisoned'])

    const ally = harness.sheets.getByRef('pokemon', 'ally-a')!
    harness.sheets.save({
      kind: 'pokemon',
      slug: ally.slug,
      document: deepCloneJson(ally.sheet),
      revision: ally.revision + 1,
      updatedAt: NOW + 1,
    })
    const staleCommand = choiceCommand({
      mapSlug: input.map.slug,
      resolutionId,
      windowId: window.windowId,
      optionId: 'cure.burned',
      baseRevision: harness.maps.getBySlug(input.map.slug)?.revision ?? 0,
      opId: 'op_ma206_aromatherapy_stale',
    })
    const stale = respond(harness, staleCommand)()
    expect(stale.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(harness.pending.getById(resolutionId)).toMatchObject({
      status: 'conflicted',
      terminalOpId: staleCommand.opId,
    })
    expect(storedConditions(harness, 'ally-a')).toEqual(['Burned', 'Poisoned'])
    expect(storedConditions(harness, 'ally-b')).toEqual(['Frozen', 'Confused'])
    expect(storedConditions(harness, 'enemy')).toEqual(['Burned'])
  })

  it('resolves healthy Aromatherapy allies as a traced no-op without opening a response window', () => {
    const result = plan(fixture({
      moveName: 'Aromatherapy',
      targets: [{
        id: 'healthy-ally',
        position: { x: 5, y: 0, z: 5 },
        sideId: 'heroes',
        conditions: [],
      }, {
        id: 'enemy',
        position: { x: 4, y: 0, z: 4 },
        sideId: 'foes',
        conditions: ['Burned'],
      }],
    }), 'op_ma206_aromatherapy_healthy')
    expect(result.resolution.selectedTargetIds).toEqual(['healthy-ally'])
    expect(result.resolution.transaction.conditionUpdates).toEqual([])
    expect(operationEvent(result, 'aromatherapy.no-condition')).toMatchObject({
      recipientIds: ['healthy-ally'],
      outcome: 'applied',
    })
  })

  it.each(IMMEDIATE_MOVE_NAMES)(
    '%s replays an accepted duplicate without rerolling, spending, mutating, or publishing twice',
    async (moveName) => {
      const input = fixture({
        moveName,
        targets: [defaultTargets()[0]!],
        naturalResults: [10],
        digestionBuffTraded: moveName === 'Belch',
      })
      const harness = openHarness(input)
      const command = commandFor(input, safeOperationId(moveName, 'duplicate'))
      const first = await executeCommand(harness, command, {
        random: randomSequence(input.randomValues),
      })
      expect(first.result).toMatchObject({ ok: true, previousRevision: 7, revision: 8 })
      const committedMap = deepCloneJson(harness.maps.getBySlug(input.map.slug))
      const committedSheets = deepCloneJson(harness.sheets.list())
      const committedEvents = deepCloneJson(harness.events)

      const duplicate = await executeCommand(harness, command, {
        random: () => { throw new Error('duplicate MA-206 command must not reroll') },
        planner: () => { throw new Error('duplicate MA-206 command must not replan') },
      })
      expect(duplicate).toEqual(first)
      expect(harness.maps.getBySlug(input.map.slug)).toEqual(committedMap)
      expect(harness.sheets.list()).toEqual(committedSheets)
      expect(harness.events).toEqual(committedEvents)
      expect(acceptedEventCount(harness.events)).toBe(1)
    },
  )

  it.each(IMMEDIATE_MOVE_NAMES)(
    '%s rejects a raced target revision without partial map, sheet, op, or realtime mutation',
    async (moveName) => {
      const input = fixture({
        moveName,
        targets: [defaultTargets()[0]!],
        naturalResults: [10],
        digestionBuffTraded: moveName === 'Belch',
      })
      const harness = openHarness(input)
      const command = commandFor(input, safeOperationId(moveName, 'stale'))
      const mapBefore = deepCloneJson(harness.maps.getBySlug(input.map.slug))
      const actorBefore = deepCloneJson(harness.sheets.getByRef('pokemon', 'actor'))
      let racedTarget: Record<string, unknown> | null = null
      const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (plannerInput) => {
        const result = planAuthoritativeMoveState({
          ...plannerInput,
          random: randomSequence(input.randomValues),
        })
        expect(result.sheetReads).toContainEqual(expect.objectContaining({ slug: 'target-a' }))
        const current = harness.sheets.getByRef('pokemon', 'target-a')!
        racedTarget = {
          ...deepCloneJson(current.sheet),
          revision: current.revision + 1,
          updatedAt: NOW + 1,
        }
        harness.sheets.save({
          kind: 'pokemon',
          slug: 'target-a',
          document: racedTarget,
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
      expect(harness.sheets.getByRef('pokemon', 'actor')).toEqual(actorBefore)
      expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toEqual(racedTarget)
      expect(harness.ops.getOpResult(input.map.slug, command.opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )
})
