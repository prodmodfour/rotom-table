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
import { pokemonMoveEntriesForSheet } from '~/utils/mapTokenMoves'
import { deepCloneJson } from '~/utils/serialization'
import { isStruggleAttackMoveName } from '~/utils/struggleMoves'
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
  REG_027_CAPABILITY_STRUGGLE_MOVE_NAMES,
  REG_027_MOVE_NAMES,
  REG_027_SCENARIOS_BY_MOVE,
  REG_027_STRUGGLE_MOVE_NAMES,
  STONE_EDGE_REG_027_SCENARIOS,
  STRANGE_STEAM_REG_027_SCENARIOS,
  type RegisteredBatch027CapabilityStruggleMoveName,
  type RegisteredBatch027MoveName,
} from '../fixtures/moveAutomation/registeredBatch027'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

const ACTOR_ID = 'actor-token'
const TARGET_A_ID = 'target-a'
const TARGET_B_ID = 'target-b'
const TARGET_C_ID = 'target-c'
const NOW = 5_000

const LEGACY_MOVE_NAMES = REG_027_MOVE_NAMES

type TargetId = typeof TARGET_A_ID | typeof TARGET_B_ID | typeof TARGET_C_ID

type SelectionKind = 'single-target' | 'burst'

interface TokenProfile {
  readonly types?: readonly string[]
  readonly abilities?: readonly string[]
}

interface ScriptExpectation {
  readonly ac: number
  readonly damageBase: number
  readonly damageClass: 'Physical' | 'Special'
  readonly type: string
  readonly damageFormula: string
}

interface ExecutionScenario {
  readonly scenarioId: string
  readonly moveName: RegisteredBatch027MoveName
  readonly selectionKind?: SelectionKind
  readonly targetIds?: readonly TargetId[]
  readonly actorCapabilities?: readonly string[]
  readonly actorCombatSkill?: string
  readonly actorMoves?: readonly CharacterSheetMove[]
  readonly actorTypes?: readonly string[]
  readonly targetProfiles?: Readonly<Partial<Record<TargetId, TokenProfile>>>
  readonly randomValues: readonly number[]
  readonly expectedScript: ScriptExpectation
  readonly expectedConditions?: Readonly<Record<string, readonly string[]>>
  readonly expectedAttackedTargetIds: readonly string[]
  readonly expectedHitTargetIds: readonly string[]
  readonly expectedDamagedTargetIds: readonly string[]
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

const pokemonSheet = (options: {
  readonly slug: string
  readonly moves?: readonly CharacterSheetMove[]
  readonly profile?: TokenProfile
  readonly capabilities?: readonly string[]
  readonly combatSkill?: string
  readonly actor?: boolean
}): CharacterSheet => ({
  slug: options.slug,
  nickname: options.slug,
  species: options.actor ? 'Mew' : 'Clefairy',
  level: 20,
  revision: 3,
  types: [...(options.profile?.types ?? ['Normal'])],
  abilities: (options.profile?.abilities ?? []).map(name => ({ name })),
  capabilities: {
    overland: 6,
    ...(options.capabilities?.length ? { other: [...options.capabilities] } : {}),
  },
  skills: { combat: options.combatSkill ?? '4d6' },
  movelist: [...(options.moves ?? [])],
  stats: {
    hp: { added: 500 },
    atk: { added: options.actor ? 50 : 5, stage: 0 },
    def: { added: 5, stage: 0 },
    satk: { added: options.actor ? 5 : 5, stage: 0 },
    sdef: { added: 5, stage: 0 },
    spd: { added: 5, stage: 0 },
  },
  combatStages: { acc: 0 },
  combat: { currentHp: 500, conditions: [] },
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

const struggleCapabilityFor = (
  moveName: RegisteredBatch027MoveName,
): string | null => {
  const match = moveName.match(/^Struggle \(([^ ]+) /)
  return match?.[1] ?? null
}

const fixtureFor = (scenario: ExecutionScenario): MoveFixture => {
  const selectionKind = scenario.selectionKind ?? 'single-target'
  const targetIds = scenario.targetIds ?? [TARGET_A_ID]
  const emptyState = createEmptyEncounterState()
  const map: TabletopMap = {
    schemaVersion: 2,
    slug: `reg-027-${scenario.scenarioId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    name: `REG-027 ${scenario.moveName}`,
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
    activeScene: { name: 'REG-027 scene', startedAt: 100 },
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
  const struggle = isStruggleAttackMoveName(scenario.moveName)
  const actor = pokemonSheet({
    slug: 'actor',
    actor: true,
    moves: scenario.actorMoves ?? (struggle ? [] : [{ name: scenario.moveName }]),
    profile: { types: scenario.actorTypes },
    capabilities: scenario.actorCapabilities,
    combatSkill: scenario.actorCombatSkill,
  })
  const targets = targetIds.map((id) => [id, pokemonSheet({
    slug: id,
    profile: scenario.targetProfiles?.[id],
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
    candidateScopePlacementIds: targetIds,
  }
}

const accuracyNaturalResults = (
  resolution: AuthoritativeMoveResolution,
): readonly number[] => resolution.rollLedger
  .filter(entry => entry.formula.kind === 'dice' && entry.formula.sides === 20)
  .map(entry => entry.naturalResult)

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
  expect(resolution.script).toMatchObject({
    ac: scenario.expectedScript.ac,
    damageBase: scenario.expectedScript.damageBase,
    damageClass: scenario.expectedScript.damageClass,
    type: scenario.expectedScript.type,
  })
  expect(resolution.damageFormula).toBe(scenario.expectedScript.damageFormula)
  expect(resolution.transaction.attackedTargetIds).toEqual(scenario.expectedAttackedTargetIds)
  expect(resolution.transaction.hitTargetIds).toEqual(scenario.expectedHitTargetIds)
  expect(resolution.transaction.attackedTargetIds).not.toContain(ACTOR_ID)
  expect(resolution.transaction.hpUpdates.map(update => update.id).sort())
    .toEqual([...scenario.expectedDamagedTargetIds].sort())
  for (const update of resolution.transaction.hpUpdates) expect(update.currentHp).toBeLessThan(500)
  expect(conditionUpdatesByTarget(resolution.transaction))
    .toEqual(scenario.expectedConditions ?? {})
  expect(accuracyNaturalResults(resolution)).toEqual(scenario.expectedAccuracyNaturalResults)

  if ((scenario.selectionKind ?? 'single-target') === 'burst') {
    expect(resolution.area).toMatchObject({
      template: { kind: 'burst', size: 1 },
      candidateTargetIds: scenario.expectedAttackedTargetIds,
      excludedTargetIds: [],
    })
  }
  else {
    expect(resolution.area).toBeUndefined()
  }

  const searchableEvidence = [
    resolution.transaction.logLines.join('\n'),
    JSON.stringify(resolution.feedback ?? null),
    JSON.stringify(resolution.auditTrace),
  ].join('\n')
  for (const targetId of scenario.expectedCriticalTargetIds ?? []) {
    if (resolution.feedback?.targetId === targetId) expect(resolution.feedback.crit).toBe(true)
    else expect(searchableEvidence.toLowerCase()).toContain('critical')
  }
  assertReviewedNativeEvidenceFragments(searchableEvidence, scenario.expectedLogFragments ?? [])

  expect(resolution.auditTrace.events.filter(event => event.kind === 'roll'))
    .toHaveLength(resolution.rollLedger.length)
  expect(resolution.sheetReads.map(read => read.slug).sort())
    .toEqual(['actor', ...(scenario.targetIds ?? [TARGET_A_ID])].sort())
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
  clientId: 'reg-027-client',
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
    return () => `reg-027-id-${++sequence}`
  })(),
  relativePath: path => path,
})

const standardScript = (
  type: string,
  damageClass: 'Physical' | 'Special',
  expert = false,
): ScriptExpectation => ({
  ac: expert ? 3 : 4,
  damageBase: expert ? 5 : 4,
  damageClass,
  type,
  damageFormula: expert ? '1d8+8' : '1d8+6',
})

const struggleMechanics = Object.freeze({
  Struggle: { type: 'Normal', damageClass: 'Physical' as const, capability: null },
  'Struggle (Firestarter Physical)': { type: 'Fire', damageClass: 'Physical' as const, capability: 'Firestarter' },
  'Struggle (Firestarter Special)': { type: 'Fire', damageClass: 'Special' as const, capability: 'Firestarter' },
  'Struggle (Fountain Physical)': { type: 'Water', damageClass: 'Physical' as const, capability: 'Fountain' },
  'Struggle (Fountain Special)': { type: 'Water', damageClass: 'Special' as const, capability: 'Fountain' },
  'Struggle (Freezer Physical)': { type: 'Ice', damageClass: 'Physical' as const, capability: 'Freezer' },
} satisfies Readonly<Record<
  (typeof REG_027_STRUGGLE_MOVE_NAMES)[number],
  { readonly type: string; readonly damageClass: 'Physical' | 'Special'; readonly capability: string | null }
>>)

const struggleScenario = (
  moveName: (typeof REG_027_STRUGGLE_MOVE_NAMES)[number],
  scenarioId: string,
  naturalRoll: number,
  options: {
    readonly expert?: boolean
    readonly targetProfile?: TokenProfile
    readonly expectDamage?: boolean
  } = {},
): ExecutionScenario => {
  const mechanics = struggleMechanics[moveName]
  const hit = naturalRoll !== 1
  const expectDamage = options.expectDamage ?? hit
  return {
    scenarioId,
    moveName,
    actorCapabilities: mechanics.capability ? [mechanics.capability] : [],
    actorCombatSkill: options.expert ? '5d6' : '4d6',
    actorTypes: [mechanics.type],
    targetProfiles: options.targetProfile ? { [TARGET_A_ID]: options.targetProfile } : undefined,
    randomValues: randomValuesForNaturalRoll(naturalRoll),
    expectedScript: standardScript(mechanics.type, mechanics.damageClass, options.expert),
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: hit ? [TARGET_A_ID] : [],
    expectedDamagedTargetIds: expectDamage ? [TARGET_A_ID] : [],
    expectedAccuracyNaturalResults: [naturalRoll],
    expectedCriticalTargetIds: naturalRoll === 20 ? [TARGET_A_ID] : undefined,
    expectedLogFragments: !expectDamage && hit ? [`${mechanics.type} immunity`] : undefined,
  }
}

const normalScenarios: readonly ExecutionScenario[] = [
  {
    scenarioId: STONE_EDGE_REG_027_SCENARIOS[0].scenarioId,
    moveName: 'Stone Edge',
    randomValues: randomValuesForNaturalRoll(16),
    expectedScript: {
      ac: 5,
      damageBase: 10,
      damageClass: 'Physical',
      type: 'Rock',
      damageFormula: '3d8+10',
    },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [16],
  },
  {
    scenarioId: STONE_EDGE_REG_027_SCENARIOS[1].scenarioId,
    moveName: 'Stone Edge',
    randomValues: randomValuesForNaturalRoll(1),
    expectedScript: {
      ac: 5,
      damageBase: 10,
      damageClass: 'Physical',
      type: 'Rock',
      damageFormula: '3d8+10',
    },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [],
    expectedDamagedTargetIds: [],
    expectedAccuracyNaturalResults: [1],
  },
  {
    scenarioId: STONE_EDGE_REG_027_SCENARIOS[2].scenarioId,
    moveName: 'Stone Edge',
    randomValues: randomValuesForNaturalRoll(17),
    expectedScript: {
      ac: 5,
      damageBase: 10,
      damageClass: 'Physical',
      type: 'Rock',
      damageFormula: '3d8+10',
    },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: STRANGE_STEAM_REG_027_SCENARIOS[0].scenarioId,
    moveName: 'Strange Steam',
    selectionKind: 'burst',
    targetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    randomValues: [0.8, 0, 0.75],
    expectedScript: {
      ac: 3,
      damageBase: 9,
      damageClass: 'Special',
      type: 'Fairy',
      damageFormula: '2d10+10',
    },
    expectedConditions: { [TARGET_A_ID]: ['Confused'] },
    expectedAttackedTargetIds: [TARGET_A_ID, TARGET_B_ID, TARGET_C_ID],
    expectedHitTargetIds: [TARGET_A_ID, TARGET_C_ID],
    expectedDamagedTargetIds: [TARGET_A_ID, TARGET_C_ID],
    expectedAccuracyNaturalResults: [17, 1, 16],
  },
  {
    scenarioId: STRANGE_STEAM_REG_027_SCENARIOS[1].scenarioId,
    moveName: 'Strange Steam',
    selectionKind: 'burst',
    randomValues: randomValuesForNaturalRoll(20),
    expectedScript: {
      ac: 3,
      damageBase: 9,
      damageClass: 'Special',
      type: 'Fairy',
      damageFormula: '2d10+10',
    },
    expectedConditions: { [TARGET_A_ID]: ['Confused'] },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [20],
    expectedCriticalTargetIds: [TARGET_A_ID],
  },
  {
    scenarioId: STRANGE_STEAM_REG_027_SCENARIOS[2].scenarioId,
    moveName: 'Strange Steam',
    selectionKind: 'burst',
    targetProfiles: { [TARGET_A_ID]: { abilities: ['Shield Dust'] } },
    randomValues: randomValuesForNaturalRoll(17),
    expectedScript: {
      ac: 3,
      damageBase: 9,
      damageClass: 'Special',
      type: 'Fairy',
      damageFormula: '2d10+10',
    },
    expectedAttackedTargetIds: [TARGET_A_ID],
    expectedHitTargetIds: [TARGET_A_ID],
    expectedDamagedTargetIds: [TARGET_A_ID],
    expectedAccuracyNaturalResults: [17],
    expectedLogFragments: ['Shield Dust'],
  },
  ...REG_027_STRUGGLE_MOVE_NAMES.flatMap((moveName): ExecutionScenario[] => {
    const scenarios = REG_027_SCENARIOS_BY_MOVE[moveName]
    const ordinary = struggleScenario(moveName, scenarios[0]!.scenarioId, 10)
    const expert = struggleScenario(moveName, scenarios[1]!.scenarioId, 10, { expert: true })
    const miss = struggleScenario(moveName, scenarios[2]!.scenarioId, 1)
    const critical = struggleScenario(moveName, scenarios[3]!.scenarioId, 20)
    if (moveName !== 'Struggle') return [ordinary, expert, miss, critical]
    return [
      ordinary,
      expert,
      miss,
      critical,
      struggleScenario(moveName, scenarios[4]!.scenarioId, 10, {
        targetProfile: { types: ['Ghost'] },
        expectDamage: false,
      }),
    ]
  }),
]

const recoveryScenarioFor = (moveName: RegisteredBatch027MoveName): ExecutionScenario => {
  const matching = normalScenarios.find(scenario => (
    scenario.moveName === moveName
    && scenario.expectedHitTargetIds.includes(TARGET_A_ID)
    && scenario.expectedDamagedTargetIds.includes(TARGET_A_ID)
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

const hpLossFor = (scenario: ExecutionScenario): number => {
  const fixture = fixtureFor(scenario)
  const resolution = resolveAuthoritativeMove({
    ...fixture,
    random: randomSequence(scenario.randomValues),
    now: () => NOW,
  })
  if ('kind' in resolution) throw new Error(`${scenario.moveName} unexpectedly suspended.`)
  const update = resolution.transaction.hpUpdates.find(candidate => candidate.id === TARGET_A_ID)
  return update ? 500 - update.currentHp : 0
}

describe('REG-027 registered move conformance', () => {
  it('certifies exactly Stone Edge through Struggle (Freezer Physical) with linked evidence', () => {
    expect(Object.keys(REG_027_SCENARIOS_BY_MOVE)).toEqual([...REG_027_MOVE_NAMES])
    expect(EXPLICIT_MOVE_AUTOMATION_SCRIPTS).toHaveLength(258)

    for (const [canonicalId, scenarios] of Object.entries(REG_027_SCENARIOS_BY_MOVE)) {
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
    expect(explicitScriptForMove('Stone Edge')).toMatchObject({
      kind: 'explicit',
      version: 1,
      ac: 5,
      damageBase: 10,
      damageClass: 'Physical',
      type: 'Rock',
      range: '8, 1 Target',
      criticalRange: 17,
    })
    expect(explicitScriptForMove('Strange Steam')).toMatchObject({
      kind: 'explicit',
      version: 1,
      ac: 3,
      damageBase: 9,
      damageClass: 'Special',
      type: 'Fairy',
      range: 'Burst 1',
      areaTemplates: [{ kind: 'burst', size: 1 }],
      conditionSuggestions: [{
        recipient: 'target',
        condition: 'Confused',
        threshold: '17+',
      }],
    })

    for (const moveName of REG_027_STRUGGLE_MOVE_NAMES) {
      const mechanics = struggleMechanics[moveName]
      const script = explicitScriptForMove(moveName)
      expect(script, moveName).toMatchObject({
        kind: 'explicit',
        version: 1,
        targetMode: 'one-target',
        targetCount: 1,
        ac: 4,
        damageBase: 4,
        damageClass: mechanics.damageClass,
        type: mechanics.type,
        range: 'Melee, 1 Target',
      })
      expect(script?.automationNotes.join(' '), moveName)
        .not.toMatch(/verify|adjust .* manually|apply .* manually|manual tracking|operator/i)
    }
  })

  it('derives every Struggle record as an authoritative automatic attack with no learned move or STAB', () => {
    for (const moveName of REG_027_STRUGGLE_MOVE_NAMES) {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const actor = fixture.pokemonSheets.get('actor')
      if (!actor) throw new Error(`Missing ${moveName} actor sheet.`)
      expect(actor.movelist, moveName).toEqual([])
      expect(pokemonMoveEntriesForSheet(actor), moveName).toContainEqual({
        move: { name: moveName },
        automatic: true,
      })

      const resolution = resolveAuthoritativeMove({
        ...fixture,
        random: randomSequence(scenario.randomValues),
        now: () => NOW,
      })
      if ('kind' in resolution) throw new Error(`${moveName} unexpectedly suspended.`)
      expect(resolution.script.damageBase, moveName).toBe(4)
      expect(resolution.damageFormula, moveName).toBe('1d8+6')
      expect(resolution.transaction.logLines.join(' '), moveName).not.toContain('STAB')
    }
  })

  it('uses Attack for physical Struggles and Special Attack for special Struggles', () => {
    for (const [physicalName, specialName] of [
      ['Struggle (Firestarter Physical)', 'Struggle (Firestarter Special)'],
      ['Struggle (Fountain Physical)', 'Struggle (Fountain Special)'],
    ] as const) {
      expect(hpLossFor(recoveryScenarioFor(physicalName)), physicalName)
        .toBeGreaterThan(hpLossFor(recoveryScenarioFor(specialName)))
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
        idFactory: () => 'reg-027-direct-id',
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
        idFactory: () => 'reg-027-plan-id',
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

  it.each(REG_027_CAPABILITY_STRUGGLE_MOVE_NAMES)(
    'rejects %s without its authoritative capability before rolls, costs, or effects',
    async (moveName) => {
      const authorized = recoveryScenarioFor(moveName)
      const evidence = REG_027_SCENARIOS_BY_MOVE[moveName]
        .find(candidate => candidate.scenarioId.endsWith('-capability-required'))
      if (!evidence) throw new Error(`Missing capability evidence for ${moveName}.`)
      const scenario: ExecutionScenario = {
        ...authorized,
        scenarioId: evidence.scenarioId,
        actorCapabilities: [],
        actorMoves: [{ name: moveName }],
      }
      expect(struggleCapabilityFor(moveName)).not.toBeNull()
      const fixture = fixtureFor(scenario)
      const snapshot = deepCloneJson({ map: fixture.map, sheets: [...fixture.pokemonSheets] })

      expect(() => resolveAuthoritativeMove({
        ...fixture,
        random: () => { throw new Error('missing capability must not roll') },
      })).toThrowError(expect.objectContaining({ code: 'move-creature-rule-blocked' }))
      expect(() => planAuthoritativeMoveState({
        ...fixture,
        random: () => { throw new Error('missing capability must not roll') },
        operationId: `op_${scenario.scenarioId.replace(/[^A-Za-z0-9_-]+/g, '_')}`.slice(0, 99),
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
        message: expect.stringContaining('requires effective'),
        currentState: { code: 'move-creature-rule-blocked' },
      })
      expect(harness.maps.getBySlug(fixture.map.slug)?.revision).toBe(7)
      expect(harness.sheets.list().every(sheet => sheet.revision === 3)).toBe(true)
      expect(harness.ops.getOpResult(fixture.map.slug, command.opId)).toEqual(response.result)
      expect(harness.events).toEqual([])
    },
  )

  it.each(REG_027_MOVE_NAMES)(
    'replays accepted %s delivery without rerolling or mutating twice',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_027_SCENARIOS_BY_MOVE[moveName]
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

  it.each(REG_027_MOVE_NAMES)(
    'rejects stale %s state without a partial accepted result',
    async (moveName) => {
      const scenario = recoveryScenarioFor(moveName)
      const fixture = fixtureFor(scenario)
      const harness = openHarness(fixture)
      const evidence = REG_027_SCENARIOS_BY_MOVE[moveName]
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

  it('keeps every REG-027 definition on the audited v1 adapter', () => {
    for (const moveName of LEGACY_MOVE_NAMES) {
      expect(registeredMoveAutomationRuntimeFor(moveName)).toMatchObject({
        kind: 'movespec-v2',
        version: 2,
      })
    }
  })
})
