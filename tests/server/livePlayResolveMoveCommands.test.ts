import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteGroupInventoryRepository } from '~~/server/storage/groupInventoryRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createAuthoritativeLivePlayCommandExecutor, type AuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { executeLivePlayResolveMoveCommandUseCase, type LivePlayResolveMoveCommandDependencies } from '~~/server/useCases/applyResolveMoveCommand'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'
import {
  ALLY_AREA_SCENARIOS_BY_MOVE,
  type RegisteredAllyAreaMoveName,
} from '../fixtures/moveAutomation/allyAreaLegacyV1'
import { transformationEncounterEffectFixture } from '../fixtures/moveAutomation/encounterEffects'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  ENCOUNTER_EXHAUST_COMMAND_FLAG_ID,
  ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID,
  spendEncounterMoveResourceCosts,
} from '~~/server/domain/moveAutomation/reduceEncounterResources'
import { planAuthoritativeMoveState, type AuthoritativeMoveStatePlan } from '~~/server/domain/planAuthoritativeMoveState'
import { planMoveItemMutations } from '~~/server/domain/moveAutomation/planItemMutations'
import {
  createMoveStateChangePlan,
  type MoveStateChange,
  type MoveStateChangeInput,
} from '~~/server/domain/moveAutomation/plan'
import {
  MOVE_AUTOMATION_RUNTIME_REGISTRY,
  type MoveAutomationRuntimeRegistry,
  type MoveSpecV2Runtime,
} from '~~/server/domain/moveAutomation/registry'
import {
  validateMoveSpec,
  type ValidatedMoveSpecDefinition,
} from '~~/server/domain/moveAutomation/validateSpec'
import type { MoveSpecCostDeclaration } from '#shared/moveAutomation/spec'
import { LIVE_PLAY_COMMAND_SCHEMA_VERSION, LIVE_PLAY_COMMAND_TYPES, LIVE_PLAY_PATCH_TYPES, type LivePlayCommandAccepted, type ResolveMoveLivePlayCommand } from '#shared/livePlayCommands'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type LivePlayResolvedMoveResult,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { parseLivePlayMoveStatePatchPayload } from '#shared/livePlayMoveState'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import type { PlayerProfile } from '#shared/playerProfiles'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'
import { deepCloneJson } from '~/utils/serialization'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '~/utils/moveAutomation'
import { moveAutomationAreaTemplateId } from '~/utils/moveAutomationAreaTemplates'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'
import {
  createDefaultGroupInventoryDocument,
  type GroupInventoryDocument,
} from '~/types/groupInventory'

const LEGACY_ONLY_RUNTIME_REGISTRY: MoveAutomationRuntimeRegistry = Object.freeze({
  size: 0,
  handlerRegistry: MOVE_AUTOMATION_RUNTIME_REGISTRY.handlerRegistry,
  resolve: () => null,
  entries: () => Object.freeze([]),
})

let injectedRuntimeRegistry: MoveAutomationRuntimeRegistry | null = null

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
  readonly groupInventories: ReturnType<typeof createSqliteGroupInventoryRepository>
  readonly ops: ReturnType<typeof createSqliteLivePlayOpRepository>
  readonly commandExecutor: AuthoritativeLivePlayCommandExecutor
  readonly events: unknown[]
}

const openDatabases: RotomDatabase[] = []

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()?.close()
})

const randomSequence = (values: readonly number[]): (() => number) => {
  let index = 0
  return () => values[index++] ?? values[values.length - 1] ?? 0
}

const fiveStrikeAcceptedCommandCase = (
  moveName: 'Fury Attack' | 'Fury Swipes' | 'Pin Missile',
  slug: 'fury-attack' | 'fury-swipes' | 'pin-missile',
  opId: string,
) => ({
  moveName,
  opId,
  multiHitOperationId: `${slug}.multi-hit`,
  randomValues: [
    0.5,
    0.999,
    0, 0,
    0, 0,
    0.999, 0,
    0, 0,
    0, 0,
  ],
  expectedHitCount: 5,
  expectedRollIds: [
    `${slug}.accuracy-roll.t1`,
    `${slug}.hit-count-roll`,
    ...Array.from({ length: 5 }, (_, index) => [
      `${slug}.critical-roll.t1.h${index + 1}`,
      `${slug}.multi-hit.t1.h${index + 1}.roll`,
    ]).flat(),
  ],
} as const)

const placement = (id: string, sheetSlug = id, position = { x: 0, y: 0, z: 0 }): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position,
})

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'arena',
  name: 'Arena',
  folder: '',
  revision: 4,
  dimensions: { x: 12, y: 3, z: 12 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
    placement('target-a', 'target-a', { x: 1, y: 0, z: 0 }),
    placement('target-b', 'target-b', { x: 2, y: 0, z: 0 }),
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  activeScene: { name: 'Scene A', startedAt: 100 },
  metadata: { note: 'start' },
  createdAt: 1,
  updatedAt: 100,
  ...overrides,
})

const pokemonSheet = (slug: string, moves: CharacterSheetMove[] = [], overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  movelist: moves,
  revision: 2,
  ...overrides,
})

const targetSheet = (slug: string, overrides: Partial<CharacterSheet> = {}): CharacterSheet => pokemonSheet(slug, [], {
  species: 'Snorlax',
  level: 30,
  combat: { currentHp: 80 },
  ...overrides,
})

const groupInventoryWithPotion = (): GroupInventoryDocument => {
  const base = createDefaultGroupInventoryDocument({ slug: 'main', now: 10 })
  return {
    ...base,
    revision: 2,
    inventory: {
      ...base.inventory,
      medicalKit: [{ id: 'group-potion', name: 'Potion', qty: 2 }],
    },
  }
}

const sharedMedicalItemRequirementProvider: NonNullable<
  LivePlayResolveMoveCommandDependencies['itemResourceRequirementProvider']
> = () => [{
  id: 'test.shared-medical-items',
  source: {
    kind: 'group-inventory',
    slug: 'main',
    sections: ['medicalKit'],
  },
}]

const seedHarness = (options: {
  readonly map?: TabletopMap
  readonly actorMoves?: readonly CharacterSheetMove[]
  readonly actorSheet?: Partial<CharacterSheet>
  readonly targetASheet?: Partial<CharacterSheet>
  readonly extraSheets?: readonly CharacterSheet[]
} = {}): Harness => {
  const database = openRotomDatabase({ path: ':memory:', enableWal: false })
  openDatabases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
  const groupInventories = createSqliteGroupInventoryRepository(database)
  const ops = createSqliteLivePlayOpRepository({ database, clock: () => 1_700_000_000_000 })
  const modes = createSqliteMapInteractionModeRepository(database)
  const events: unknown[] = []
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: ops,
    queue: createInProcessMapWriteQueue(),
    readMapInteractionMode: (mapSlug) => modes.get(mapSlug).interactionMode,
    ...acceptedRealtimeTestHooks(events),
  })
  const map = options.map ?? mapFixture()
  maps.save({ slug: map.slug, document: map, revision: map.revision ?? 0, updatedAt: map.updatedAt ?? 100 })
  const actor = pokemonSheet(
    'actor',
    [...(options.actorMoves ?? [{ name: 'Pound' }])],
    options.actorSheet,
  )
  const targets = [
    targetSheet('target-a', options.targetASheet),
    targetSheet('target-b'),
    ...(options.extraSheets ?? []),
  ]
  for (const sheet of [actor, ...targets]) {
    sheets.save({ kind: 'pokemon', slug: sheet.slug, document: sheet as unknown as Record<string, unknown>, revision: sheet.revision ?? 0, updatedAt: (sheet as { readonly updatedAt?: number }).updatedAt ?? 50 })
  }
  return { database, maps, sheets, groupInventories, ops, commandExecutor, events }
}

const intent = (overrides: Omit<ResolveMoveIntent, 'schemaVersion'>): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  ...overrides,
})

const commandFor = (
  map: TabletopMap,
  moveIntent: ResolveMoveIntent,
  opId: string,
  candidateScopePlacementIds: readonly string[] = [],
  overrides: Partial<ResolveMoveLivePlayCommand> = {},
): ResolveMoveLivePlayCommand => {
  const scopes = buildResolveMoveScopes({ map, intent: moveIntent, candidateScopePlacementIds })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: map.slug,
    baseRevision: map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload: moveIntent,
    ...overrides,
  }
}

const withGroupInventoryScope = (
  command: ResolveMoveLivePlayCommand,
  slug = 'main',
): ResolveMoveLivePlayCommand => ({
  ...command,
  scopes: [
    ...command.scopes,
    { kind: 'groupInventory', slug, field: 'inventory' },
  ],
})

const execute = (
  harness: Harness,
  command: ResolveMoveLivePlayCommand,
  options: {
    readonly role?: 'gm' | 'player'
    readonly profile?: PlayerProfile | null
    readonly random?: () => number
    readonly now?: () => number
    readonly idFactory?: () => string
    readonly planner?: LivePlayResolveMoveCommandDependencies['planner']
    readonly itemResourceRequirementProvider?: LivePlayResolveMoveCommandDependencies['itemResourceRequirementProvider']
    readonly groupInventoryRepository?: LivePlayResolveMoveCommandDependencies['groupInventoryRepository']
  } = {},
) => executeLivePlayResolveMoveCommandUseCase({
  role: options.role ?? 'gm',
  command,
  clientId: 'client-test',
  playerProfile: options.profile ?? null,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: harness.sheets,
  groupInventoryRepository: options.groupInventoryRepository ?? harness.groupInventories,
  commandExecutor: harness.commandExecutor,
  planner: injectedRuntimeRegistry
    ? input => (options.planner ?? planAuthoritativeMoveState)({
        ...input,
        runtimeRegistry: injectedRuntimeRegistry!,
      })
    : options.planner,
  itemResourceRequirementProvider: options.itemResourceRequirementProvider,
  random: options.random ?? randomSequence([0.5, 0]),
  now: options.now ?? (() => 1000),
  idFactory: options.idFactory ?? (() => 'feedback-id'),
})

const raceConsultedSheetAfterPlanning = (
  harness: Harness,
  slug: string,
  assertPlan?: (plan: AuthoritativeMoveStatePlan) => void,
): {
  readonly planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']>
  readonly sheetsAfterRace: () => unknown
} => {
  let afterRace: unknown = null
  return {
    planner: (input) => {
      const plan = planAuthoritativeMoveState(input)
      if (!plan.sheetReads.some((read) => read.kind === 'pokemon' && read.slug === slug)) {
        throw new Error(`expected plan to consult pokemon/${slug}`)
      }
      assertPlan?.(plan)
      const current = harness.sheets.getByRef('pokemon', slug)
      if (!current) throw new Error(`expected pokemon/${slug} before race`)
      const revision = current.revision + 1
      const updatedAt = current.updatedAt + 1
      harness.sheets.save({
        kind: 'pokemon',
        slug,
        document: {
          ...current.sheet,
          revision,
          updatedAt,
        },
        revision,
        updatedAt,
      })
      afterRace = deepCloneJson(harness.sheets.list())
      return plan
    },
    sheetsAfterRace: () => afterRace,
  }
}

const accepted = (result: unknown): LivePlayCommandAccepted => {
  if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true || 'duplicate' in result) {
    throw new Error('expected accepted result')
  }
  return result as LivePlayCommandAccepted
}

const withoutStateChangeIdentity = (
  change: MoveStateChange,
): MoveStateChangeInput => {
  const { id: _id, order: _order, ...input } = change
  return input as MoveStateChangeInput
}

const planWithGroupInventoryTransfer = (
  input: Parameters<typeof planAuthoritativeMoveState>[0],
  groupInventory: GroupInventoryDocument,
): AuthoritativeMoveStatePlan => {
  const basePlan = planAuthoritativeMoveState(input)
  const source = input.itemResources?.candidates.find(candidate => (
    candidate.reference.kind === 'group-inventory-row'
  ))?.reference
  if (!source || source.kind !== 'group-inventory-row') {
    throw new Error('expected one authoritative group inventory item candidate')
  }
  const originOperationId = input.operationId
  if (!originOperationId) throw new Error('expected move operation ID')
  const itemPlan = planMoveItemMutations({
    map: input.map,
    pokemonSheets: input.pokemonSheets,
    trainerSheets: input.trainerSheets,
    groupInventories: new Map([[groupInventory.slug, groupInventory]]),
    originOperationId,
    plannedAt: basePlan.nextMap.updatedAt ?? 0,
    operations: [{
      id: 'item.transfer-potion-to-reserve',
      kind: 'transfer',
      reasonCode: 'item.transfer',
      source,
      destination: {
        kind: 'group-inventory-row',
        owner: source.owner,
        itemId: 'group-potion-reserve',
        section: 'pokemonItems',
      },
      quantity: 1,
    }],
  })
  return {
    ...basePlan,
    stateChanges: createMoveStateChangePlan([
      ...basePlan.stateChanges.changes.map(withoutStateChangeIdentity),
      ...itemPlan.stateChanges.changes.map(withoutStateChangeIdentity),
    ]),
  }
}

const moveStatePayloadFromPatches = (patches: LivePlayCommandAccepted['patches']) => {
  expect(patches).toHaveLength(1)
  expect(patches[0]?.type).toBe(LIVE_PLAY_PATCH_TYPES.MOVE_STATE)
  const parsed = parseLivePlayMoveStatePatchPayload(patches[0]?.payload)
  expect(parsed.valid).toBe(true)
  if (!parsed.valid) throw new Error('invalid move-state payload')
  return parsed.payload
}

const moveStatePatchPayload = (result: LivePlayCommandAccepted) => moveStatePayloadFromPatches(result.patches)

const moveTargetIdentity = (move: LivePlayResolvedMoveResult | undefined) => {
  if (!move) throw new Error('expected resolved move')
  return {
    attackedTargetIds: [...move.transaction.attackedTargetIds],
    hitTargetIds: [...move.transaction.hitTargetIds],
  }
}

const moveRollLedger = (move: LivePlayResolvedMoveResult | undefined) => {
  if (!move) throw new Error('expected resolved move')
  return deepCloneJson(move.rollLedger)
}

const playerProfile = (linkedSlug: string): PlayerProfile => ({
  schemaVersion: 1,
  id: 'profile_test0000' as PlayerProfile['id'],
  displayName: 'Player' as PlayerProfile['displayName'],
  linkedCharacters: [{ sheetKind: 'pokemon', sheetSlug: linkedSlug }],
})

const areaTemplate = { kind: 'burst' as const, size: 1, label: 'Burst 1' }
const passTemplate = { kind: 'pass' as const, size: 4, label: 'Pass 4' }

const ALLY_AREA_COMMAND_CASES = (Object.keys(ALLY_AREA_SCENARIOS_BY_MOVE) as RegisteredAllyAreaMoveName[])
  .map((moveName) => ({
    moveName,
    mixedScenarioId: ALLY_AREA_SCENARIOS_BY_MOVE[moveName][0].scenarioId,
    duplicateScenarioId: ALLY_AREA_SCENARIOS_BY_MOVE[moveName][1].scenarioId,
    staleScenarioId: ALLY_AREA_SCENARIOS_BY_MOVE[moveName][2].scenarioId,
  }))

const areaScript = (name: string): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: name,
  version: 1,
  targetMode: 'multi-target',
  targetCount: null,
  damaging: false,
  requiresAccuracy: false,
  damageBase: null,
  damageClass: 'Status',
  type: 'Normal',
  ac: null,
  range: 'Burst 1',
  effect: 'Resolve move command area test script.',
  keywords: ['Burst 1'],
  criticalRange: null,
  areaTemplates: [areaTemplate],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const mixedAreaTemplate = { kind: 'line' as const, size: 2, label: 'Line 2' }

const mistyConditionScript = (): MoveAutomationScript => ({
  ...areaScript('Pound'),
  targetMode: 'one-target',
  targetCount: 1,
  range: 'Melee, 1 Target',
  keywords: ['Melee', '1 Target'],
  areaTemplates: [],
  conditionSuggestions: [{
    recipient: 'target',
    condition: 'Burned',
    label: 'Burned',
  }],
})

const mixedOutcomeAreaScript = (): MoveAutomationScript => ({
  ...areaScript('Swift'),
  requiresAccuracy: true,
  ac: 2,
  range: mixedAreaTemplate.label,
  effect: 'Resolve move command mixed area outcome test script.',
  keywords: [mixedAreaTemplate.label],
  areaTemplates: [mixedAreaTemplate],
  stageSuggestions: [{ recipient: 'target', key: 'def', delta: -1, label: 'Defense down' }],
})

const passScript = (): MoveAutomationScript => ({
  kind: 'explicit',
  moveName: 'Scratch',
  version: 1,
  targetMode: 'multi-target',
  targetCount: null,
  damaging: true,
  requiresAccuracy: true,
  damageBase: 4,
  damageClass: 'Physical',
  type: 'Normal',
  ac: 2,
  range: 'Melee, Pass',
  effect: 'Resolve move command Pass test script.',
  keywords: ['Pass 4'],
  criticalRange: null,
  areaTemplates: [passTemplate],
  conditionSuggestions: [],
  stageSuggestions: [],
  hpSuggestions: [],
  fieldSuggestions: [],
  hazardSuggestions: [],
  automationNotes: [],
})

const withRegisteredScript = async <T>(script: MoveAutomationScript, run: () => T | Promise<T>): Promise<T> => {
  const scripts = EXPLICIT_MOVE_AUTOMATION_SCRIPTS as Map<string, MoveAutomationScript>
  const previous = scripts.get(script.moveName)
  const previousRegistry = injectedRuntimeRegistry
  scripts.set(script.moveName, script)
  injectedRuntimeRegistry = LEGACY_ONLY_RUNTIME_REGISTRY
  try {
    return await run()
  } finally {
    injectedRuntimeRegistry = previousRegistry
    if (previous) scripts.set(script.moveName, previous)
    else scripts.delete(script.moveName)
  }
}

const runtimeRegistryWithValidatedDefinition = (
  canonicalId: string,
  definition: ValidatedMoveSpecDefinition,
): MoveAutomationRuntimeRegistry => {
  const selected = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId)
  if (selected?.kind !== 'movespec-v2') {
    throw new Error(`expected native runtime for ${canonicalId}`)
  }
  const runtime: MoveSpecV2Runtime = Object.freeze({
    ...selected,
    version: definition.spec.version,
    definitionHash: definition.definitionHash,
    definition,
  })
  return Object.freeze({
    size: MOVE_AUTOMATION_RUNTIME_REGISTRY.size,
    handlerRegistry: MOVE_AUTOMATION_RUNTIME_REGISTRY.handlerRegistry,
    resolve: (candidateId: string) => candidateId === canonicalId
      ? runtime
      : MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve(candidateId),
    entries: () => Object.freeze(MOVE_AUTOMATION_RUNTIME_REGISTRY.entries().map(candidate => (
      candidate.canonicalId === canonicalId ? runtime : candidate
    ))),
  })
}

const runtimeRegistryWithReviewedCosts = (
  canonicalId: string,
  costs: readonly MoveSpecCostDeclaration[],
): MoveAutomationRuntimeRegistry => {
  const selected = MOVE_AUTOMATION_RUNTIME_REGISTRY.resolve(canonicalId)
  if (selected?.kind !== 'movespec-v2') {
    throw new Error(`expected native runtime for ${canonicalId}`)
  }
  const definition = validateMoveSpec({
    ...selected.definition.spec,
    costs,
  }, {
    capabilityIds: selected.definition.capabilityIds,
    rulesetVersion: selected.definition.rulesetVersion,
    handlerRegistry: MOVE_AUTOMATION_RUNTIME_REGISTRY.handlerRegistry,
  })
  return runtimeRegistryWithValidatedDefinition(canonicalId, definition)
}

describe('executeLivePlayResolveMoveCommandUseCase', () => {
  it('accepts self and single-target resolveMove commands and returns committed map, sheets, and one MOVE_STATE patch', async () => {
    const selfHarness = seedHarness({ actorMoves: [{ name: 'Swords Dance' }] })
    const selfMap = selfHarness.maps.getBySlug('arena')!
    const selfIntent = intent({ placementId: 'actor-token', moveName: 'Swords Dance', selection: { kind: 'self' } })
    const selfCommand = commandFor(selfMap, selfIntent, 'op_resolveself01')
    const selfResponse = await execute(selfHarness, selfCommand, { random: randomSequence([0]) })
    expect(selfResponse.result.ok).toBe(true)
    const selfAccepted = accepted(selfResponse.result)
    const selfPayload = moveStatePatchPayload(selfAccepted)
    expect(selfPayload.move.canonicalMoveName).toBe('Swords Dance')
    expect(selfPayload.presentation).toMatchObject({
      operationId: 'op_resolveself01',
      actorPlacementId: 'actor-token',
      move: { name: 'Swords Dance' },
      attackedTargetIds: [],
      hitTargetIds: [],
      outcomeKind: 'self',
    })
    expect(selfResponse.map?.revision).toBe(5)
    expect((selfResponse.map?.metadata?.moveLog as Array<Record<string, unknown>> | undefined)?.at(-1))
      .toMatchObject({ operationId: selfCommand.opId, moveName: 'Swords Dance' })
    expect(selfPayload.changes.encounterState?.current.turnResources['actor-token']).toMatchObject({
      actions: { standard: { spent: 1 } },
      oncePerTurnFlags: [
        { id: 'encounter.acted-since-entry', sourceOperationId: 'op_resolveself01' },
        { id: 'move.swords-dance', sourceOperationId: 'op_resolveself01' },
      ],
    })
    expect(selfResponse.sheetUpdates?.[0]).toMatchObject({
      kind: 'pokemon',
      slug: 'actor',
      sheet: { revision: 3, stats: { atk: { stage: 2 } } },
    })
    expect(selfPayload.move).toMatchObject({
      transaction: {
        attackedTargetIds: [],
        hitTargetIds: [],
        combatStageUpdates: [{
          id: 'actor-token',
          stages: { atk: 2, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
        }],
      },
      trace: {
        program: {
          canonicalId: 'Swords Dance',
          runtimeKind: 'movespec-v2',
          runtimeVersion: 2,
        },
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: 'operation',
            operationId: 'swords-dance.raise-attack',
            outcome: 'applied',
          }),
        ]),
      },
    })
    const privateCompensation = selfHarness.ops.getStoredOpRecord(
      'arena',
      selfCommand.opId,
    )?.moveCompensation
    expect(privateCompensation).toMatchObject({
      mapSlug: 'arena',
      originOperationId: selfCommand.opId,
      operations: expect.arrayContaining([
        expect.objectContaining({
          stateChangeKind: 'sheet-state',
          availability: 'available',
          inverse: expect.objectContaining({
            kind: 'restore-sheet-combat-stages',
            expectedCurrent: { atk: 2, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
            restore: { atk: 0, def: 0, satk: 0, sdef: 0, spd: 0, acc: 0 },
          }),
        }),
        expect.objectContaining({
          stateChangeKind: 'map-metadata',
          availability: 'unavailable',
          safety: 'externally-observed',
        }),
      ]),
    })
    expect(JSON.stringify(selfResponse.result)).not.toContain('moveCompensation')
    expect(JSON.stringify(selfHarness.events)).not.toContain('restore-sheet-combat-stages')

    const committedSelfMap = deepCloneJson(selfHarness.maps.getBySlug('arena'))
    const committedSelfSheet = deepCloneJson(selfHarness.sheets.getByRef('pokemon', 'actor'))
    const duplicateSelf = await execute(selfHarness, selfCommand, {
      random: () => { throw new Error('duplicate Swords Dance must not use RNG') },
      planner: () => { throw new Error('duplicate Swords Dance must not replan') },
    })
    expect(duplicateSelf.result).toEqual(selfAccepted)
    expect(duplicateSelf.move).toEqual(selfResponse.move)
    expect(selfHarness.maps.getBySlug('arena')).toEqual(committedSelfMap)
    expect(selfHarness.sheets.getByRef('pokemon', 'actor')).toEqual(committedSelfSheet)

    const targetHarness = seedHarness({ actorMoves: [{ name: 'Pound' }] })
    const targetMap = targetHarness.maps.getBySlug('arena')!
    const targetIntent = intent({ placementId: 'actor-token', moveName: 'Pound', selection: { kind: 'single-target', targetPlacementId: 'target-a' } })
    const beforeMap = deepCloneJson(targetMap)
    const targetResponse = await execute(targetHarness, commandFor(targetMap, targetIntent, 'op_resolvetarg1'), { random: randomSequence([0.5, 0]) })

    const targetResult = accepted(targetResponse.result)
    const targetPayload = moveStatePatchPayload(targetResult)
    expect(targetPayload.move).toEqual(targetResponse.move)
    expect(targetPayload.move.rollLedger.map((roll) => roll.parentEffectId)).toEqual([
      'pound.accuracy',
      'pound.damage',
    ])
    expect(targetPayload.move.trace).toMatchObject({
      schemaVersion: 1,
      program: {
        canonicalId: 'Pound',
        runtimeKind: 'movespec-v2',
        runtimeVersion: 2,
        definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      ruleset: {
        rulesetId: 'rotom-table-reference-moves-v1',
        sourceDataSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      truncated: false,
    })
    expect(targetPayload.move.trace?.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'target', targetId: 'target-a', outcome: 'included' }),
      expect.objectContaining({ kind: 'roll', rollId: 'pound.accuracy-roll.1' }),
      expect.objectContaining({ kind: 'operation', operationKind: 'damage', outcome: 'applied' }),
    ]))
    expect('auditTrace' in targetPayload.move).toBe(false)
    expect(JSON.stringify(targetPayload.move.trace)).not.toContain('absolute-hp-state')
    expect(targetPayload.sheets.map((sheet) => `${sheet.kind}:${sheet.slug}`)).toContain('pokemon:target-a')
    expect(targetResponse.map).toEqual(targetHarness.maps.getBySlug('arena'))
    expect((targetResponse.map?.metadata?.moveLog as Array<Record<string, unknown>> | undefined)?.at(-1))
      .toMatchObject({ operationId: 'op_resolvetarg1', moveName: 'Pound' })
    expect(targetResponse.sheetUpdates?.[0]?.sheet).toEqual(targetHarness.sheets.getByRef('pokemon', 'target-a')?.sheet)
    expect(targetHarness.events.map((event) => (event as { type?: string }).type)).toEqual(['updated', 'updated', 'live-play-command-accepted'])

    const patchedMap = deepCloneJson(beforeMap)
    const patchResult = applyLivePlayPatchesToMap({
      map: patchedMap,
      mapSlug: 'arena',
      previousRevision: beforeMap.revision,
      revision: targetResult.revision,
      patches: targetResult.patches,
    })
    expect(patchResult.ok).toBe(true)
    expect(patchedMap.placements).toEqual(targetResponse.map?.placements)
    expect(patchedMap.temporaryHitPoints).toEqual(targetResponse.map?.temporaryHitPoints)
    expect(patchedMap.moveUsage).toEqual(targetResponse.map?.moveUsage)
    expect(patchedMap.hazards).toEqual(targetResponse.map?.hazards)
    expect(patchedMap.fieldEffects).toEqual(targetResponse.map?.fieldEffects)
    expect(patchedMap.metadata).toEqual(targetResponse.map?.metadata)
    expect(patchedMap.encounterState).toEqual(targetResponse.map?.encounterState)
    expect(patchedMap.updatedAt).toBe(targetResponse.map?.updatedAt)
  })

  it.each([
    { moveName: 'Pound', runtime: 'legacy-v1' },
    { moveName: 'Swords Dance', runtime: 'movespec-v2' },
  ] as const)('rejects an unavailable $runtime action cost atomically and replays it without replanning', async ({ moveName }) => {
    const seeded = spendEncounterMoveResourceCosts({}, {
      placementId: 'actor-token',
      canonicalMoveId: 'Seed Standard',
      resolutionId: 'seed.standard.resolution',
      sourceOperationId: 'seed.standard.operation',
      costs: [{
        id: 'seed.cost.standard',
        phase: 'pay',
        cost: { kind: 'action-resource', resource: 'standard', amount: 1 },
      }],
      movementBudget: null,
      movementDistance: 0,
      round: 1,
      turn: null,
      actedThisRound: false,
    })
    const map = mapFixture({
      encounterState: {
        ...createEmptyEncounterState(),
        turnResources: seeded.resources,
      },
    })
    const harness = seedHarness({ map, actorMoves: [{ name: moveName }] })
    const moveIntent = moveName === 'Swords Dance'
      ? intent({ placementId: 'actor-token', moveName, selection: { kind: 'self' } })
      : intent({
          placementId: 'actor-token',
          moveName,
          selection: { kind: 'single-target', targetPlacementId: 'target-a' },
        })
    const command = commandFor(
      map,
      moveIntent,
      moveName === 'Pound' ? 'op_costrejectv1' : 'op_costrejectv2',
    )
    const beforeMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const beforeSheets = deepCloneJson(harness.sheets.list())

    const first = await execute(harness, command)
    const duplicate = await execute(harness, command, {
      planner: () => { throw new Error('stored resource rejection must not replan') },
      random: () => { throw new Error('stored resource rejection must not reroll') },
    })

    expect(first.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 4,
      message: expect.stringContaining('action-unavailable'),
    })
    expect(duplicate.result).toEqual(first.result)
    expect(harness.maps.getBySlug('arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.events).toEqual([])
  })

  it('applies adapted v1 Priority and Exhaust policies in the accepted move transaction', async () => {
    const pound = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get('Pound')
    if (!pound) throw new Error('expected registered Pound script')
    await withRegisteredScript({
      ...pound,
      range: 'Melee, 1 Target, Priority, Exhaust',
    }, async () => {
      const harness = seedHarness({ actorMoves: [{ name: 'Pound' }] })
      const map = harness.maps.getBySlug('arena')!
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName: 'Pound',
        selection: { kind: 'single-target', targetPlacementId: 'target-a' },
      })
      const response = await execute(
        harness,
        commandFor(map, moveIntent, 'op_specialcostv1'),
      )

      expect(response.result).toMatchObject({ ok: true, revision: 5 })
      const resources = response.map?.encounterState?.turnResources['actor-token']
      expect(resources).toMatchObject({
        actions: { standard: { spent: 1 } },
        oncePerTurnFlags: expect.arrayContaining([
          expect.objectContaining({ id: ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID }),
          expect.objectContaining({ id: ENCOUNTER_EXHAUST_COMMAND_FLAG_ID }),
        ]),
      })
    })
  })

  it('commits legacy Misty first-turn protection atomically and replays it once', async () => {
    await withRegisteredScript(mistyConditionScript(), async () => {
      const map = mapFixture({
        fieldEffects: {
          weather: [],
          terrains: [{ kind: 'misty', scope: 'field', rounds: 5 }],
          rooms: [],
        },
        encounterState: createEmptyEncounterState(),
      })
      const harness = seedHarness({ map, actorMoves: [{ name: 'Pound' }] })
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName: 'Pound',
        selection: { kind: 'single-target', targetPlacementId: 'target-a' },
      })
      const command = commandFor(map, moveIntent, 'op_mistycondition1')
      const first = await execute(harness, command, { random: randomSequence([]) })
      const acceptedResult = accepted(first.result)
      const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
      const committedSheet = deepCloneJson(harness.sheets.getByRef('pokemon', 'target-a'))
      const protection = committedMap?.encounterState?.effects.find(effect => (
        effect.kind === 'condition' && effect.payload.action === 'suppress'
      ))

      expect(first.move).toMatchObject({
        canonicalMoveName: 'Pound',
        transaction: {
          conditionUpdates: [{ id: 'target-a', conditions: ['Burned'] }],
        },
      })
      expect(first.move).not.toHaveProperty('terrainConditionProtectionEffects')
      expect(protection).toMatchObject({
        id: expect.stringMatching(/^condition-protection\.[0-9a-f]{32}$/),
        affected: { placementIds: ['target-a'] },
        payload: { conditionId: 'burned', action: 'suppress' },
      })
      expect((committedSheet?.sheet.combat as { conditions?: string[] }).conditions)
        .toEqual(['Burned'])

      const duplicate = await execute(harness, command, {
        planner: () => { throw new Error('duplicate Misty condition must not replan') },
        random: () => { throw new Error('duplicate Misty condition must not reroll') },
      })
      expect(duplicate.result).toEqual(acceptedResult)
      expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
      expect(harness.sheets.getByRef('pokemon', 'target-a')).toEqual(committedSheet)
    })
  })

  it('honors an immediate no-cost exception while recording the accepted opening action', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Swords Dance' }] })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Swords Dance',
      selection: { kind: 'self' },
    })
    const command = commandFor(map, moveIntent, 'op_nocostnative1')
    const runtimeRegistry = runtimeRegistryWithReviewedCosts('Swords Dance', [{
      id: 'test.cost.reviewed-trigger',
      phase: 'declare',
      cost: {
        kind: 'no-cost',
        reasonCode: 'move.reviewed-trigger',
      },
    }])
    let plannerCalls = 0
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      plannerCalls += 1
      return planAuthoritativeMoveState({ ...input, runtimeRegistry })
    }

    const response = await execute(harness, command, { planner })
    const acceptedResult = accepted(response.result)

    expect(response.map?.encounterState?.turnResources['actor-token']).toMatchObject({
      actions: { standard: { spent: 0 } },
      oncePerTurnFlags: [{
        id: 'encounter.acted-since-entry',
        sourceOperationId: 'op_nocostnative1',
        resetOn: ['scene-end', 'recall', 'send-out'],
      }],
    })
    expect(response.sheetUpdates?.[0]).toMatchObject({
      kind: 'pokemon',
      slug: 'actor',
      sheet: { revision: 3, stats: { atk: { stage: 2 } } },
    })
    expect(harness.events.map(event => (event as { readonly type?: string }).type)).toEqual([
      'updated',
      'updated',
      'live-play-command-accepted',
    ])

    const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const committedSheet = deepCloneJson(harness.sheets.getByRef('pokemon', 'actor'))
    const duplicate = await execute(harness, command, {
      planner: () => { throw new Error('duplicate no-cost move must not replan') },
      random: () => { throw new Error('duplicate no-cost move must not reroll') },
    })

    expect(duplicate.result).toEqual(acceptedResult)
    expect(plannerCalls).toBe(1)
    expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
    expect(harness.sheets.getByRef('pokemon', 'actor')).toEqual(committedSheet)
  })

  it('commits native Ember once and replays duplicate delivery without rerolling', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Ember' }] })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Ember',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const command = commandFor(map, moveIntent, 'op_resolveember1', ['target-a'])
    const response = await execute(harness, command, {
      random: randomSequence([0.85, 0]),
    })
    const acceptedResult = accepted(response.result)

    expect(response.move).toMatchObject({
      canonicalMoveName: 'Ember',
      selectedTargetIds: ['target-a'],
      transaction: {
        attackedTargetIds: ['target-a'],
        hitTargetIds: ['target-a'],
        hpUpdates: [{ id: 'target-a', currentHp: 79 }],
        conditionUpdates: [{ id: 'target-a', conditions: ['Burned'] }],
      },
      rollLedger: [
        { rollId: 'ember.accuracy-roll.1', naturalResult: 18 },
        { rollId: 'ember.damage.roll.1', naturalResult: 1 },
      ],
      trace: {
        program: { canonicalId: 'Ember', runtimeKind: 'movespec-v2', runtimeVersion: 2 },
      },
    })
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toMatchObject({
      revision: 3,
      combat: { currentHp: 79, conditions: ['Burned'] },
    })

    const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const committedSheet = deepCloneJson(harness.sheets.getByRef('pokemon', 'target-a'))
    const duplicate = await execute(harness, command, {
      random: () => { throw new Error('duplicate Ember must not reroll') },
      planner: () => { throw new Error('duplicate Ember must not replan') },
    })

    expect(duplicate.result).toEqual(acceptedResult)
    expect(duplicate.move).toEqual(response.move)
    expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
    expect(harness.sheets.getByRef('pokemon', 'target-a')).toEqual(committedSheet)
  })

  it('commits native Dragon Rage once and replays its fixed loss without rerolling', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Dragon Rage' }] })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Dragon Rage',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const command = commandFor(map, moveIntent, 'op_resolvedragon1', ['target-a'])
    const response = await execute(harness, command, {
      random: randomSequence([0.999]),
    })
    const acceptedResult = accepted(response.result)

    expect(response.move).toMatchObject({
      canonicalMoveName: 'Dragon Rage',
      selectedTargetIds: ['target-a'],
      transaction: {
        attackedTargetIds: ['target-a'],
        hitTargetIds: ['target-a'],
        hpUpdates: [{ id: 'target-a', currentHp: 65 }],
      },
      rollLedger: [{
        rollId: 'dragon-rage.accuracy-roll.1',
        parentEffectId: 'dragon-rage.accuracy',
        naturalResult: 20,
      }],
      trace: {
        program: {
          canonicalId: 'Dragon Rage',
          runtimeKind: 'movespec-v2',
          runtimeVersion: 2,
        },
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: 'operation',
            operationId: 'dragon-rage.fixed-hp-loss',
            operationKind: 'direct-hp',
            outcome: 'applied',
          }),
        ]),
      },
    })
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toMatchObject({
      revision: 3,
      combat: { currentHp: 65 },
    })

    const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const committedSheet = deepCloneJson(harness.sheets.getByRef('pokemon', 'target-a'))
    const duplicate = await execute(harness, command, {
      random: () => { throw new Error('duplicate Dragon Rage must not reroll') },
      planner: () => { throw new Error('duplicate Dragon Rage must not replan') },
    })

    expect(duplicate.result).toEqual(acceptedResult)
    expect(duplicate.move).toEqual(response.move)
    expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
    expect(harness.sheets.getByRef('pokemon', 'target-a')).toEqual(committedSheet)
  })

  it('commits native Absorb damage and drain once across duplicate delivery', async () => {
    const harness = seedHarness({
      actorMoves: [{ name: 'Absorb' }],
      actorSheet: {
        species: 'Bulbasaur',
        types: ['Grass'],
        stats: { hp: { added: 18 }, satk: { added: 10 } },
        combat: { currentHp: 10, conditions: [] },
      },
      targetASheet: {
        types: ['Normal'],
        stats: { hp: { added: 20 } },
        combat: { currentHp: 50, conditions: [] },
      },
    })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Absorb',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const command = commandFor(map, moveIntent, 'op_resolveabsorb1', ['target-a'])
    const response = await execute(harness, command, {
      random: randomSequence([0.5, 0]),
      now: () => 5_000,
    })
    const acceptedResult = accepted(response.result)

    expect(response.move).toMatchObject({
      canonicalMoveName: 'Absorb',
      selectedTargetIds: ['target-a'],
      transaction: {
        attackedTargetIds: ['target-a'],
        hitTargetIds: ['target-a'],
        hpUpdates: [
          { id: 'target-a', currentHp: 37 },
          { id: 'actor-token', currentHp: 17 },
        ],
      },
      rollLedger: [
        { rollId: 'absorb.accuracy-roll.1', naturalResult: 11 },
        { rollId: 'absorb.damage.roll.1', naturalResult: 1 },
      ],
      trace: {
        program: {
          canonicalId: 'Absorb',
          runtimeKind: 'movespec-v2',
          runtimeVersion: 2,
        },
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: 'operation',
            operationId: 'absorb.damage',
            operationKind: 'damage',
            outcome: 'applied',
          }),
          expect.objectContaining({
            kind: 'operation',
            operationId: 'absorb.drain',
            operationKind: 'heal',
            outcome: 'applied',
          }),
        ]),
      },
    })
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toMatchObject({
      revision: 3,
      combat: { currentHp: 37, conditions: [] },
    })
    expect(harness.sheets.getByRef('pokemon', 'actor')?.sheet).toMatchObject({
      revision: 3,
      combat: { currentHp: 17, conditions: [] },
    })

    const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const committedSheets = deepCloneJson(harness.sheets.list())
    const duplicate = await execute(harness, command, {
      random: () => { throw new Error('duplicate Absorb must not reroll') },
      planner: () => { throw new Error('duplicate Absorb must not replan') },
    })

    expect(duplicate.result).toEqual(acceptedResult)
    expect(duplicate.move).toEqual(response.move)
    expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(committedSheets)
  })

  it('rolls back both Absorb HP writes when the actor changes after planning', async () => {
    const harness = seedHarness({
      actorMoves: [{ name: 'Absorb' }],
      actorSheet: {
        species: 'Bulbasaur',
        types: ['Grass'],
        stats: { hp: { added: 18 }, satk: { added: 10 } },
        combat: { currentHp: 10, conditions: [] },
      },
      targetASheet: {
        types: ['Normal'],
        stats: { hp: { added: 20 } },
        combat: { currentHp: 50, conditions: [] },
      },
    })
    const map = harness.maps.getBySlug('arena')!
    const targetBefore = deepCloneJson(harness.sheets.getByRef('pokemon', 'target-a'))
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Absorb',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const opId = 'op_absorbatomic01'
    const race = raceConsultedSheetAfterPlanning(harness, 'actor', (plan) => {
      expect(plan.sheetWrites.map(write => write.slug)).toEqual(['target-a', 'actor'])
      expect(plan.resolution.transaction.hpUpdates).toEqual([
        expect.objectContaining({ id: 'target-a', currentHp: 37 }),
        expect.objectContaining({ id: 'actor-token', currentHp: 17 }),
      ])
    })
    const response = await execute(
      harness,
      commandFor(map, moveIntent, opId, ['target-a']),
      { planner: race.planner, random: randomSequence([0.5, 0]) },
    )

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('consulted while resolving the move changed'),
    })
    expect(harness.maps.getBySlug('arena')).toEqual(map)
    expect(harness.sheets.getByRef('pokemon', 'target-a')).toEqual(targetBefore)
    expect(harness.sheets.list()).toEqual(race.sheetsAfterRace())
    expect(harness.ops.getOpResult('arena', opId)).toBeNull()
    expect(harness.events).toEqual([])
  })

  it('commits native Power Trip contextual damage once across duplicate delivery', async () => {
    const harness = seedHarness({
      actorMoves: [{ name: 'Power Trip' }],
      actorSheet: {
        species: 'Zorua',
        types: ['Dark'],
        stats: {
          hp: { added: 20 },
          atk: { added: 10, stage: 0 },
          def: { stage: 6 },
          satk: { stage: 4 },
          sdef: { stage: 0 },
          spd: { stage: 0 },
        },
        combatStages: { acc: 0 },
        combat: { currentHp: 100, conditions: [] },
      },
      targetASheet: {
        types: ['Normal'],
        stats: { hp: { added: 500 } },
        combat: { currentHp: 1_000, conditions: [] },
      },
    })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Power Trip',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const command = commandFor(map, moveIntent, 'op_resolvepowertrip1', ['target-a'])
    const response = await execute(harness, command, {
      random: randomSequence([0.5, 0, 0, 0, 0, 0, 0]),
      now: () => 5_000,
    })
    const acceptedResult = accepted(response.result)

    expect(response.move).toMatchObject({
      canonicalMoveName: 'Power Trip',
      selectedTargetIds: ['target-a'],
      transaction: {
        attackedTargetIds: ['target-a'],
        hitTargetIds: ['target-a'],
        hpUpdates: [{ id: 'target-a', currentHp: 939 }],
      },
      rollLedger: [
        { rollId: 'power-trip.accuracy-roll.1', naturalResult: 11 },
        {
          rollId: 'power-trip.damage.roll.1',
          formula: { kind: 'dice', count: 6, sides: 12, modifier: 45 },
          naturalResult: 6,
        },
      ],
      trace: {
        program: {
          canonicalId: 'Power Trip',
          runtimeKind: 'movespec-v2',
          runtimeVersion: 2,
        },
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: 'operation',
            operationId: 'power-trip.damage',
            operationKind: 'damage',
            outcome: 'applied',
          }),
        ]),
      },
    })
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toMatchObject({
      revision: 3,
      combat: { currentHp: 939, conditions: [] },
    })

    const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const committedSheets = deepCloneJson(harness.sheets.list())
    const duplicate = await execute(harness, command, {
      random: () => { throw new Error('duplicate Power Trip must not reroll') },
      planner: () => { throw new Error('duplicate Power Trip must not replan') },
    })

    expect(duplicate.result).toEqual(acceptedResult)
    expect(duplicate.move).toEqual(response.move)
    expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(committedSheets)
  })

  it.each([{
    moveName: 'Double Kick',
    opId: 'op_resolvedoublekick1',
    multiHitOperationId: 'double-kick.multi-hit',
    randomValues: [0.5, 0, 0.999, 0],
    expectedHitCount: 2,
    expectedRollIds: [
      'double-kick.accuracy-roll.t1.h1',
      'double-kick.multi-hit.t1.h1.roll',
      'double-kick.accuracy-roll.t1.h2',
      'double-kick.multi-hit.t1.h2.roll',
    ],
  },
  fiveStrikeAcceptedCommandCase('Fury Attack', 'fury-attack', 'op_resolvefuryattack1'),
  fiveStrikeAcceptedCommandCase('Fury Swipes', 'fury-swipes', 'op_resolvefuryswipes1'),
  fiveStrikeAcceptedCommandCase('Pin Missile', 'pin-missile', 'op_resolvepinmissile1'),
  ] as const)(
    'commits native $moveName strike rolls once across duplicate delivery',
    async ({
      moveName,
      opId,
      multiHitOperationId,
      randomValues,
      expectedHitCount,
      expectedRollIds,
    }) => {
      const harness = seedHarness({
        actorMoves: [{ name: moveName }],
        targetASheet: {
          types: ['Normal'],
          stats: { hp: { added: 500 }, def: { added: 10 } },
          combat: { currentHp: 1_000, conditions: [] },
        },
      })
      const map = harness.maps.getBySlug('arena')!
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName,
        selection: { kind: 'single-target', targetPlacementId: 'target-a' },
      })
      const command = commandFor(map, moveIntent, opId, ['target-a'])
      const response = await execute(harness, command, {
        random: randomSequence(randomValues),
        now: () => 5_000,
      })
      const acceptedResult = accepted(response.result)

      expect(response.move).toMatchObject({
        canonicalMoveName: moveName,
        selectedTargetIds: ['target-a'],
        transaction: {
          attackedTargetIds: ['target-a'],
          hitTargetIds: ['target-a'],
          hpUpdates: [{ id: 'target-a' }],
        },
        trace: {
          program: {
            canonicalId: moveName,
            runtimeKind: 'movespec-v2',
            runtimeVersion: 2,
          },
          events: expect.arrayContaining([
            expect.objectContaining({
              kind: 'operation',
              operationId: multiHitOperationId,
              operationKind: 'multi-hit',
              outcome: 'applied',
            }),
          ]),
        },
      })
      expect(response.move?.rollLedger.map(roll => roll.rollId)).toEqual(expectedRollIds)
      expect(response.move?.transaction.logLines).toEqual(expect.arrayContaining([
        expect.stringContaining(`${expectedHitCount} hit, 0 missed`),
      ]))
      const targetHp = response.move?.transaction.hpUpdates[0]?.currentHp
      expect(targetHp).toBeLessThan(1_000)
      expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toMatchObject({
        revision: 3,
        combat: { currentHp: targetHp, conditions: [] },
      })

      const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
      const committedSheets = deepCloneJson(harness.sheets.list())
      const committedEvents = deepCloneJson(harness.events)
      const duplicate = await execute(harness, command, {
        random: () => { throw new Error(`duplicate ${moveName} must not reroll`) },
        planner: () => { throw new Error(`duplicate ${moveName} must not replan`) },
      })

      expect(duplicate.result).toEqual(acceptedResult)
      expect(duplicate.move).toEqual(response.move)
      expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
      expect(harness.sheets.list()).toEqual(committedSheets)
      expect(harness.events).toEqual(committedEvents)
    },
  )

  it('commits native Synthesis healing and Daily usage once across duplicate delivery', async () => {
    const harness = seedHarness({
      map: mapFixture({ fieldEffects: { weather: [{ kind: 'sunny' }], terrains: [], rooms: [] } }),
      actorMoves: [{ name: 'Synthesis' }],
      actorSheet: {
        species: 'Bulbasaur',
        stats: { hp: { added: 18 } },
        combat: { currentHp: 1, conditions: [] },
      },
    })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Synthesis',
      selection: { kind: 'self' },
    })
    const command = commandFor(map, moveIntent, 'op_resolvesynthesis1')
    const response = await execute(harness, command, {
      random: () => { throw new Error('Synthesis must not draw randomness') },
      now: () => 5_000,
    })
    const acceptedResult = accepted(response.result)

    expect(response.move).toMatchObject({
      canonicalMoveName: 'Synthesis',
      selectedTargetIds: [],
      transaction: {
        attackedTargetIds: [],
        hitTargetIds: [],
        hpUpdates: [{ id: 'actor-token', currentHp: 67 }],
      },
      rollLedger: [],
      trace: {
        program: {
          canonicalId: 'Synthesis',
          runtimeKind: 'movespec-v2',
          runtimeVersion: 2,
        },
        events: expect.arrayContaining([
          expect.objectContaining({
            kind: 'operation',
            operationId: 'synthesis.heal-sunny',
            operationKind: 'heal',
            outcome: 'applied',
          }),
        ]),
      },
    })
    expect(harness.sheets.getByRef('pokemon', 'actor')?.sheet).toMatchObject({
      revision: 3,
      combat: { currentHp: 67, conditions: [] },
      moveUsage: {
        daily: {
          synthesis: { moveName: 'Synthesis', uses: 1, updatedAt: 5_000 },
        },
      },
    })

    const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const committedSheet = deepCloneJson(harness.sheets.getByRef('pokemon', 'actor'))
    const duplicate = await execute(harness, command, {
      random: () => { throw new Error('duplicate Synthesis must not use RNG') },
      planner: () => { throw new Error('duplicate Synthesis must not replan') },
    })

    expect(duplicate.result).toEqual(acceptedResult)
    expect(duplicate.move).toEqual(response.move)
    expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
    expect(harness.sheets.getByRef('pokemon', 'actor')).toEqual(committedSheet)
  })

  it('accepts area and Pass resolveMove commands with conservative candidate scopes', async () => {
    await withRegisteredScript(areaScript('Tail Whip'), async () => {
      const areaMap = mapFixture({ placements: [
        placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
        placement('target-a', 'target-a', { x: 1, y: 0, z: 0 }),
        placement('target-b', 'target-b', { x: 0, y: 0, z: 1 }),
      ] })
      const harness = seedHarness({ map: areaMap, actorMoves: [{ name: 'Tail Whip' }] })
      const map = harness.maps.getBySlug('arena')!
      const moveIntent = intent({ placementId: 'actor-token', moveName: 'Tail Whip', selection: { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId(areaTemplate) } })
      const response = await execute(harness, commandFor(map, moveIntent, 'op_resolvearea1', ['target-a', 'target-b']), { random: randomSequence([0.5, 0, 0.5, 0]) })
      expect(response.result.ok).toBe(true)
      const payload = moveStatePatchPayload(accepted(response.result))
      expect(payload.move.area?.candidateTargetIds).toEqual(['target-a', 'target-b'])
      expect(payload.presentation).toMatchObject({
        operationId: 'op_resolvearea1',
        actorPlacementId: 'actor-token',
        move: { name: 'Tail Whip', type: 'Normal' },
        area: { templateKind: 'burst' },
      })
      expect(payload.presentation.area?.cells).toEqual(payload.move.area?.cells)
      expect(accepted(response.result).patches[0]?.scopes.every((scope) => !(scope.kind === 'token' && scope.placementId === 'target-b' && scope.field === 'hp'))).toBe(true)
    })

    {
      const map = mapFixture({ dimensions: { x: 8, y: 3, z: 4 }, placements: [
        placement('actor-token', 'actor', { x: 1, y: 0, z: 1 }),
        placement('target-a', 'target-a', { x: 2, y: 0, z: 1 }),
        placement('target-b', 'target-b', { x: 3, y: 0, z: 1 }),
      ] })
      const harness = seedHarness({ map, actorMoves: [{ name: 'Scratch' }] })
      const moveIntent = intent({ placementId: 'actor-token', moveName: 'Scratch', selection: { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId(passTemplate), direction: 'east' } })
      const passCommand = commandFor(map, moveIntent, 'op_resolvepass1', ['target-a', 'target-b'])
      const response = await execute(harness, passCommand, { random: randomSequence([0.5, 0]) })
      expect(response.result.ok).toBe(true)
      const acceptedResult = accepted(response.result)
      const payload = moveStatePatchPayload(acceptedResult)
      expect(payload.move.movement?.kind).toBe('pass')
      expect(payload.move.trace?.program).toMatchObject({
        canonicalId: 'Scratch',
        runtimeKind: 'movespec-v2',
        runtimeVersion: 2,
      })
      expect(payload.move.rollLedger.map(roll => roll.rollId)).toEqual([
        'scratch.accuracy-roll.1',
        'scratch.accuracy-roll.2',
        'scratch.damage.roll.1',
      ])
      expect(payload.presentation).toMatchObject({
        operationId: 'op_resolvepass1',
        area: { templateKind: 'pass', direction: 'east' },
        pass: { direction: 'east' },
      })
      expect(payload.presentation.pass?.pathCells).toEqual(payload.move.movement?.pathCells)
      expect(response.map?.placements.find((item) => item.id === 'actor-token')?.position).toEqual(payload.move.movement?.destination)
      expect(payload.changes.encounterState?.current.turnResources['actor-token']).toMatchObject({
        actions: {
          standard: { spent: 1 },
          shift: { spent: 1 },
        },
        movement: { budget: 7, spent: 4 },
        oncePerTurnFlags: [
          { id: 'encounter.acted-since-entry', sourceOperationId: 'op_resolvepass1' },
          { id: 'move.scratch', sourceOperationId: 'op_resolvepass1' },
        ],
      })

      const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
      const duplicate = await execute(harness, passCommand, {
        random: () => { throw new Error('duplicate Scratch must not reroll') },
        planner: () => { throw new Error('duplicate Scratch must not replan') },
      })
      expect(duplicate.result).toEqual(acceptedResult)
      expect(duplicate.move).toEqual(response.move)
      expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
    }
  })

  it('keeps predicate-excluded area identities in server audit evidence only', async () => {
    await withRegisteredScript({
      ...areaScript('Howl'),
      areaTargetRelationship: 'ally',
    }, async () => {
      const map = mapFixture({
        placements: [
          { ...placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }), sideId: 'red' },
          { ...placement('target-a', 'target-a', { x: 1, y: 0, z: 0 }), sideId: 'red' },
          { ...placement('target-b', 'target-b', { x: 0, y: 0, z: 1 }), sideId: 'blue' },
        ],
        encounterState: redBlueEncounterStateFixture(),
      })
      const harness = seedHarness({ map, actorMoves: [{ name: 'Howl' }] })
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName: 'Howl',
        selection: { kind: 'area', areaTemplateId: moveAutomationAreaTemplateId(areaTemplate) },
      })
      const response = await execute(
        harness,
        commandFor(map, moveIntent, 'op_areaprivacy1', ['target-a', 'target-b']),
      )
      const payload = moveStatePatchPayload(accepted(response.result))
      const serialized = JSON.stringify(payload.move)

      expect(payload.move.selectedTargetIds).toEqual(['target-a'])
      expect(payload.move.area?.candidateTargetIds).toEqual(['target-a'])
      expect(payload.move.transaction.attackedTargetIds).toEqual(['target-a'])
      expect(payload.move.trace).toMatchObject({ truncated: false })
      expect(serialized).not.toContain('target-b')
      expect(serialized).not.toContain('target-excluded-not-ally')
      expect(payload.move.transaction.logLines).toContain(
        'Howl: ally-only area recipients are derived from explicit encounter sides; enemy and unaffiliated placements are ineligible.',
      )
      expect(payload.move.transaction.logLines.join('\n')).not.toMatch(/assisted ally targeting|prepare map/i)
      expect(JSON.stringify(response)).not.toContain('target-excluded-not-ally')
    })
  })

  it.each(ALLY_AREA_COMMAND_CASES)(
    '$mixedScenarioId and $duplicateScenarioId apply only server-derived allies exactly once',
    async ({ moveName, mixedScenarioId, duplicateScenarioId }) => {
      const map = mapFixture({
        placements: [
          { ...placement('actor-token', 'actor', { x: 2, y: 0, z: 2 }), sideId: 'red' },
          { ...placement('target-a', 'target-a', { x: 3, y: 0, z: 2 }), sideId: 'red' },
          { ...placement('target-b', 'target-b', { x: 2, y: 0, z: 1 }), sideId: 'blue' },
          placement('target-c', 'target-c', { x: 1, y: 0, z: 2 }),
        ],
        encounterState: redBlueEncounterStateFixture(),
      })
      const harness = seedHarness({
        map,
        actorMoves: [{ name: moveName }],
        extraSheets: [pokemonSheet('target-c')],
      })
      const storedMap = harness.maps.getBySlug('arena')!
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName,
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId(areaTemplate),
        },
      })
      const command = commandFor(
        storedMap,
        moveIntent,
        `op_${moveName.toLowerCase().replace(/[^a-z]+/g, '')}_allyarea`,
        ['target-a', 'target-b', 'target-c'],
      )
      const response = await execute(harness, command, {
        random: () => { throw new Error(`${moveName} must not draw RNG`) },
      })
      const acceptedResult = accepted(response.result)
      const payload = moveStatePatchPayload(acceptedResult)
      const persistedStage = (slug: string, stage: 'atk' | 'def' | 'sdef'): number => {
        const persisted = harness.sheets.getByRef('pokemon', slug)?.sheet as CharacterSheet | undefined
        return persisted?.stats?.[stage]?.stage ?? 0
      }
      const expectedActorAttack = moveName === 'Howl' || moveName === 'Coaching' ? 1 : 0
      const expectedActorDefense = moveName === 'Coaching' ? 1 : 0
      const expectedAllySpecialDefense = moveName === 'Aromatic Mist' ? 1 : 0
      const expectedAllyAttack = moveName === 'Howl' || moveName === 'Coaching' ? 1 : 0
      const expectedAllyDefense = moveName === 'Coaching' ? 1 : 0

      expect([mixedScenarioId, duplicateScenarioId]).toEqual([
        ALLY_AREA_SCENARIOS_BY_MOVE[moveName][0].scenarioId,
        ALLY_AREA_SCENARIOS_BY_MOVE[moveName][1].scenarioId,
      ])
      expect(payload.move.selectedTargetIds).toEqual(['target-a'])
      expect(payload.move.area?.candidateTargetIds).toEqual(['target-a'])
      expect(payload.move.transaction.attackedTargetIds).toEqual(['target-a'])
      expect(payload.move.transaction.hitTargetIds).toEqual(['target-a'])
      expect(JSON.stringify(payload.move)).not.toContain('target-b')
      expect(JSON.stringify(payload.move)).not.toContain('target-c')
      expect(payload.move.transaction.logLines.join('\n')).not.toMatch(/assisted|prepare map|manual/i)
      expect(persistedStage('actor', 'atk')).toBe(expectedActorAttack)
      expect(persistedStage('actor', 'def')).toBe(expectedActorDefense)
      expect(persistedStage('target-a', 'atk')).toBe(expectedAllyAttack)
      expect(persistedStage('target-a', 'def')).toBe(expectedAllyDefense)
      expect(persistedStage('target-a', 'sdef')).toBe(expectedAllySpecialDefense)
      for (const excludedSlug of ['target-b', 'target-c']) {
        expect(persistedStage(excludedSlug, 'atk')).toBe(0)
        expect(persistedStage(excludedSlug, 'def')).toBe(0)
        expect(persistedStage(excludedSlug, 'sdef')).toBe(0)
      }

      const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
      const committedSheets = deepCloneJson(harness.sheets.list())
      const committedEvents = deepCloneJson(harness.events)
      const duplicate = await execute(harness, command, {
        random: () => { throw new Error(`duplicate ${moveName} must not draw RNG`) },
        planner: () => { throw new Error(`duplicate ${moveName} must not replan`) },
      })

      expect(duplicate.result).toEqual(acceptedResult)
      expect(duplicate.move).toEqual(response.move)
      expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
      expect(harness.sheets.list()).toEqual(committedSheets)
      expect(harness.events).toEqual(committedEvents)
    },
  )

  it.each(ALLY_AREA_COMMAND_CASES)(
    '$staleScenarioId rejects a stale rule-excluded candidate without partial effects',
    async ({ moveName, staleScenarioId }) => {
      const map = mapFixture({
        placements: [
          { ...placement('actor-token', 'actor', { x: 2, y: 0, z: 2 }), sideId: 'red' },
          { ...placement('target-a', 'target-a', { x: 3, y: 0, z: 2 }), sideId: 'red' },
          { ...placement('target-b', 'target-b', { x: 2, y: 0, z: 1 }), sideId: 'blue' },
          placement('target-c', 'target-c', { x: 1, y: 0, z: 2 }),
        ],
        encounterState: redBlueEncounterStateFixture(),
      })
      const harness = seedHarness({
        map,
        actorMoves: [{ name: moveName }],
        extraSheets: [pokemonSheet('target-c')],
      })
      const storedMap = harness.maps.getBySlug('arena')!
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName,
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId(areaTemplate),
        },
      })
      const opId = `op_${moveName.toLowerCase().replace(/[^a-z]+/g, '')}_stalearea`
      const race = raceConsultedSheetAfterPlanning(harness, 'target-b', (plan) => {
        expect(staleScenarioId).toBe(ALLY_AREA_SCENARIOS_BY_MOVE[moveName][2].scenarioId)
        expect(plan.resolution.selectedTargetIds).toEqual(['target-a'])
        expect(plan.resolution.area?.targetEvaluations).toContainEqual(expect.objectContaining({
          targetPlacementId: 'target-b',
          outcome: 'excluded',
          reasonCode: 'target-excluded-not-ally',
        }))
        expect(plan.sheetReads).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: 'pokemon', slug: 'target-b' }),
          expect.objectContaining({ kind: 'pokemon', slug: 'target-c' }),
        ]))
      })
      const response = await execute(
        harness,
        commandFor(
          storedMap,
          moveIntent,
          opId,
          ['target-a', 'target-b', 'target-c'],
        ),
        {
          planner: race.planner,
          random: () => { throw new Error(`${moveName} must not draw RNG`) },
        },
      )

      expect(response.result).toMatchObject({
        ok: false,
        reason: 'conflict',
        message: expect.stringContaining('consulted while resolving the move changed'),
      })
      expect(harness.maps.getBySlug('arena')).toEqual(storedMap)
      expect(harness.sheets.list()).toEqual(race.sheetsAfterRace())
      expect(harness.ops.getOpResult('arena', opId)).toBeNull()
      expect(harness.events).toEqual([])
    },
  )

  it('retains legal Friendly exclusions for the authorized command requester', async () => {
    await withRegisteredScript({
      ...areaScript('Swift'),
      keywords: ['Burst 1', 'Friendly'],
    }, async () => {
      const map = mapFixture({
        placements: [
          placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
          placement('target-a', 'target-a', { x: 1, y: 0, z: 0 }),
          placement('target-b', 'target-b', { x: 0, y: 0, z: 1 }),
        ],
      })
      const harness = seedHarness({ map, actorMoves: [{ name: 'Swift' }] })
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName: 'Swift',
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId(areaTemplate),
          excludedTargetPlacementIds: ['target-b'],
        },
      })
      const response = await execute(
        harness,
        commandFor(map, moveIntent, 'op_arearequester1', ['target-a', 'target-b']),
        { role: 'player', profile: playerProfile('actor') },
      )
      const payload = moveStatePatchPayload(accepted(response.result))

      expect(response.move?.area).toMatchObject({
        candidateTargetIds: ['target-a', 'target-b'],
        excludedTargetIds: ['target-b'],
      })
      expect(payload.move.area).toMatchObject({
        candidateTargetIds: ['target-a', 'target-b'],
        excludedTargetIds: ['target-b'],
      })
      expect(payload.move.selectedTargetIds).toEqual(['target-a'])
      expect(payload.move.transaction.attackedTargetIds).toEqual(['target-a'])
    })
  })

  it('reveals only the accepted ground item while keeping inaccessible target inventory private', async () => {
    const harness = seedHarness({
      actorMoves: [{ name: 'Knock Off' }],
      targetASheet: {
        player: false,
        items: { held: 'Leftovers', itemDescription: 'Private held-item note' },
      },
    })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Knock Off',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    let privateCandidates: unknown = null
    const response = await execute(
      harness,
      commandFor(map, moveIntent, 'op_privateitems1'),
      {
        role: 'player',
        profile: playerProfile('actor'),
        random: randomSequence([0.5, 0]),
        planner: (input) => {
          privateCandidates = deepCloneJson(input.itemResources?.candidates ?? [])
          return planAuthoritativeMoveState(input)
        },
      },
    )

    expect(response.result.ok).toBe(true)
    expect(privateCandidates).toEqual([
      expect.objectContaining({
        requirementId: 'knock-off.target-equipped',
        reference: expect.objectContaining({
          kind: 'pokemon-held',
          canonicalItemId: 'leftovers',
          owner: expect.objectContaining({ slug: 'target-a', revision: 2 }),
        }),
      }),
    ])
    expect(response.sheetUpdates ?? []).not.toContainEqual(
      expect.objectContaining({ slug: 'target-a' }),
    )
    expect(response.map?.encounterState?.groundItems).toEqual([
      expect.objectContaining({
        canonicalItemId: 'leftovers',
        canonicalItemName: 'Leftovers',
        sourceOperationId: 'op_privateitems1',
      }),
    ])
    expect(JSON.stringify(response)).toContain('leftovers')
    expect(JSON.stringify(response)).not.toContain('Private held-item note')
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toMatchObject({
      items: { itemDescription: 'Private held-item note' },
    })
  })

  it('enforces command type, intent shape, map mode, visibility, token control, and exact base revisions', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Pound' }] })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({ placementId: 'actor-token', moveName: 'Pound', selection: { kind: 'single-target', targetPlacementId: 'target-a' } })

    const invalidIntent = await execute(harness, {
      ...commandFor(map, moveIntent, 'op_badintent01'),
      payload: {
        placementId: 'actor-token',
        moveName: 'Pound',
        selection: { kind: 'self' },
        rolls: [20],
        resourceCosts: [{ kind: 'no-cost', reasonCode: 'client-forged' }],
      } as never,
    })
    expect(invalidIntent.result).toMatchObject({ ok: false, reason: 'invalid' })

    createSqliteMapInteractionModeRepository(harness.database).set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 1 })
    const prepareMode = await execute(harness, commandFor(map, moveIntent, 'op_preparemode1'))
    expect(prepareMode.result).toMatchObject({ ok: false, reason: 'conflict' })
    createSqliteMapInteractionModeRepository(harness.database).set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 2 })

    const hiddenHarness = seedHarness({ map: mapFixture({ playerVisible: false }), actorMoves: [{ name: 'Pound' }] })
    const hidden = await execute(hiddenHarness, commandFor(hiddenHarness.maps.getBySlug('arena')!, moveIntent, 'op_hiddenmap01'), { role: 'player', profile: playerProfile('actor') })
    expect(hidden.result).toMatchObject({ ok: false, reason: 'unauthorized' })

    const noProfile = await execute(harness, commandFor(map, moveIntent, 'op_noprofile01'), { role: 'player', profile: null })
    expect(noProfile.result).toMatchObject({ ok: false, reason: 'unauthorized', message: expect.stringContaining('Select a player profile') })

    const controlled = await execute(harness, commandFor(map, moveIntent, 'op_playerok001'), { role: 'player', profile: playerProfile('actor'), random: randomSequence([0.5, 0]) })
    expect(controlled.result.ok).toBe(true)

    const staleMap = harness.maps.getBySlug('arena')!
    const stale = await execute(harness, commandFor(staleMap, moveIntent, 'op_stalerev01', [], { baseRevision: (staleMap.revision ?? 0) - 1 }))
    expect(stale.result).toMatchObject({ ok: false, reason: 'stale-revision', currentRevision: staleMap.revision })
  })

  it('validates submitted scopes against actual writes and emits actual scopes only', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Pound' }] })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({ placementId: 'actor-token', moveName: 'Pound', selection: { kind: 'single-target', targetPlacementId: 'target-a' } })
    const valid = commandFor(map, moveIntent, 'op_scopevalid1')

    const duplicate = await execute(harness, { ...valid, opId: 'op_scopedupe01', scopes: [...valid.scopes, valid.scopes[0]!] })
    expect(duplicate.result).toMatchObject({ ok: false, reason: 'invalid', message: expect.stringContaining('more than once') })

    const missingHpScope = await execute(harness, { ...valid, opId: 'op_scopemiss1', scopes: valid.scopes.filter((scope) => !(scope.kind === 'token' && scope.placementId === 'target-a' && scope.field === 'hp')) })
    expect(missingHpScope.result).toMatchObject({ ok: false, reason: 'invalid', message: expect.stringContaining('missing required write scope') })

    const unrelated = await execute(harness, { ...valid, opId: 'op_scopeunrel1', scopes: [...valid.scopes, { kind: 'token', placementId: 'target-b', field: 'hp' }] })
    expect(unrelated.result).toMatchObject({ ok: false, reason: 'invalid', message: expect.stringContaining('not related') })

    const unreviewedGroup = await execute(harness, {
      ...valid,
      opId: 'op_scopegroup1',
      scopes: [
        ...valid.scopes,
        { kind: 'groupInventory', slug: 'main', field: 'inventory' },
      ],
    })
    expect(unreviewedGroup.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('not covered by reviewed authoritative item resources'),
    })

    const acceptedResponse = await execute(harness, valid, { random: randomSequence([0.5, 0]) })
    const scopes = accepted(acceptedResponse.result).patches[0]!.scopes
    expect(scopes).toContainEqual({ kind: 'token', placementId: 'actor-token', field: 'action' })
    expect(scopes).toContainEqual({ kind: 'map', lane: 'metadata' })
    expect(scopes).toContainEqual({ kind: 'token', placementId: 'target-a', field: 'hp' })
    expect(scopes).not.toContainEqual({ kind: 'map', lane: 'hazards' })
    expect(scopes).not.toContainEqual({ kind: 'token', placementId: 'target-b', field: 'hp' })
  })

  it('commits damage, a group inventory item transfer, realtime, and its op result exactly once', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Pound' }] })
    const initialGroup = groupInventoryWithPotion()
    harness.groupInventories.save({
      slug: initialGroup.slug,
      revision: initialGroup.revision,
      updatedAt: initialGroup.updatedAt,
      document: initialGroup,
    })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Pound',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const missingScopeCommand = commandFor(map, moveIntent, 'op_itemnoscope1')
    const missingScope = await execute(harness, missingScopeCommand, {
      planner: input => planWithGroupInventoryTransfer(input, initialGroup),
      itemResourceRequirementProvider: sharedMedicalItemRequirementProvider,
    })
    expect(missingScope.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('missing required write scope groupInventory:main:inventory'),
    })
    expect(harness.maps.getBySlug('arena')?.revision).toBe(4)
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.revision).toBe(2)
    expect(harness.groupInventories.get('main')?.document).toEqual(initialGroup)

    const command = withGroupInventoryScope(
      commandFor(map, moveIntent, 'op_itemcommit01'),
    )
    let plannerCalls = 0
    const response = await execute(harness, command, {
      planner: (input) => {
        plannerCalls += 1
        return planWithGroupInventoryTransfer(input, initialGroup)
      },
      itemResourceRequirementProvider: sharedMedicalItemRequirementProvider,
    })
    const acceptedResult = accepted(response.result)
    const committedGroup = harness.groupInventories.get('main')?.document

    expect(committedGroup).toMatchObject({
      revision: 3,
      updatedAt: 1_000,
      inventory: {
        medicalKit: [{ id: 'group-potion', name: 'Potion', qty: 1 }],
        pokemonItems: [{ id: 'group-potion-reserve', name: 'Potion', qty: 1 }],
      },
    })
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toMatchObject({
      revision: 3,
      combat: { currentHp: expect.any(Number) },
    })
    expect(
      (harness.sheets.getByRef('pokemon', 'target-a')?.sheet.combat as { readonly currentHp?: number })?.currentHp,
    ).toBeLessThan(80)
    expect(acceptedResult.patches[0]?.scopes).toContainEqual({
      kind: 'groupInventory',
      slug: 'main',
      field: 'inventory',
    })
    expect(harness.ops.getOpResult('arena', command.opId)).toEqual(acceptedResult)
    expect(harness.ops.getStoredOpRecord('arena', command.opId)?.moveCompensation?.operations)
      .toContainEqual(expect.objectContaining({
        stateChangeKind: 'group-inventory-state',
        availability: 'unavailable',
        resource: {
          kind: 'external-resource',
          resourceKind: 'group-inventory',
          resourceId: 'main',
          beforeRevision: 2,
          afterRevision: 3,
        },
      }))
    const groupEventIndex = harness.events.findIndex(event => (
      (event as { readonly channel?: string }).channel === 'group-inventory:main'
    ))
    const acceptedEventIndex = harness.events.findIndex(event => (
      (event as { readonly type?: string }).type === 'live-play-command-accepted'
    ))
    expect(groupEventIndex).toBeGreaterThanOrEqual(0)
    expect(groupEventIndex).toBeLessThan(acceptedEventIndex)
    expect(harness.events[groupEventIndex]).toMatchObject({
      channel: 'group-inventory:main',
      type: 'updated',
      revision: 3,
      clientId: 'client-test',
      data: { slug: 'main', document: committedGroup },
    })

    const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const committedSheets = deepCloneJson(harness.sheets.list())
    const committedEvents = deepCloneJson(harness.events)
    const duplicate = await execute(harness, command, {
      random: () => { throw new Error('duplicate group item move must not reroll') },
      planner: () => { throw new Error('duplicate group item move must not replan') },
    })

    expect(duplicate.result).toEqual(acceptedResult)
    expect(plannerCalls).toBe(1)
    expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(committedSheets)
    expect(harness.groupInventories.get('main')?.document).toEqual(committedGroup)
    expect(harness.events).toEqual(committedEvents)
  })

  it('rolls map and damage writes back when group inventory CAS persistence fails', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Pound' }] })
    const initialGroup = groupInventoryWithPotion()
    harness.groupInventories.save({
      slug: initialGroup.slug,
      revision: initialGroup.revision,
      updatedAt: initialGroup.updatedAt,
      document: initialGroup,
    })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Pound',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const command = withGroupInventoryScope(
      commandFor(map, moveIntent, 'op_itemcasfail1'),
    )
    const response = await execute(harness, command, {
      planner: input => planWithGroupInventoryTransfer(input, initialGroup),
      itemResourceRequirementProvider: sharedMedicalItemRequirementProvider,
      groupInventoryRepository: {
        ...harness.groupInventories,
        applyLivePlayUpdate: () => ({
          status: 'stale' as const,
          current: initialGroup,
        }),
      },
    })

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'persistence-failed',
      message: expect.stringContaining('Group inventory main changed'),
    })
    expect(harness.maps.getBySlug('arena')).toEqual(map)
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.revision).toBe(2)
    expect(harness.groupInventories.get('main')?.document).toEqual(initialGroup)
    expect(harness.ops.getOpResult('arena', command.opId)).toBeNull()
    expect(harness.events).toEqual([])
  })

  it('conflicts atomically when a planned group inventory write becomes stale', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Pound' }] })
    const initialGroup = groupInventoryWithPotion()
    harness.groupInventories.save({
      slug: 'main',
      revision: initialGroup.revision,
      updatedAt: initialGroup.updatedAt,
      document: initialGroup,
    })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Pound',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const command = withGroupInventoryScope(
      commandFor(map, moveIntent, 'op_itemreadrace1'),
    )
    const beforeMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const beforeSheets = deepCloneJson(harness.sheets.list())
    let observedCandidates: unknown = null
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      observedCandidates = deepCloneJson(input.itemResources?.candidates ?? [])
      const plan = planWithGroupInventoryTransfer(input, initialGroup)
      expect(plan.groupInventoryReads).toEqual([{ slug: 'main', revision: 2 }])
      expect(plan.stateChanges.changes).toContainEqual(expect.objectContaining({
        kind: 'group-inventory-state',
        expectedRevision: 2,
      }))
      const current = harness.groupInventories.get('main')
      if (!current) throw new Error('expected group inventory before race')
      harness.groupInventories.save({
        slug: 'main',
        revision: 3,
        updatedAt: 11,
        document: {
          ...current.document,
          revision: 3,
          updatedAt: 11,
          inventory: {
            ...current.document.inventory,
            medicalKit: [{ id: 'group-potion', name: 'Potion', qty: 1 }],
          },
        },
      })
      return plan
    }

    const response = await execute(harness, command, {
      planner,
      itemResourceRequirementProvider: sharedMedicalItemRequirementProvider,
    })

    expect(observedCandidates).toEqual([
      expect.objectContaining({
        requirementId: 'test.shared-medical-items',
        reference: expect.objectContaining({
          kind: 'group-inventory-row',
          itemId: 'group-potion',
          canonicalItemId: 'potion',
          quantity: 2,
          owner: { kind: 'group-inventory', slug: 'main', revision: 2 },
        }),
      }),
    ])
    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      currentRevision: 4,
      message: expect.stringContaining('item or sheet resource'),
    })
    expect(harness.maps.getBySlug('arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.groupInventories.get('main')).toMatchObject({
      revision: 3,
      document: {
        inventory: {
          medicalKit: [{ id: 'group-potion', name: 'Potion', qty: 1 }],
          pokemonItems: [],
        },
      },
    })
    expect(harness.ops.getOpResult('arena', command.opId)).toBeNull()
    expect(harness.events).toEqual([])
  })

  it('rejects a permanent move-list CAS race without committing the move or duplicating a learned move', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Synthesis' }] })
    const map = harness.maps.getBySlug('arena')!
    const targetBefore = deepCloneJson(harness.sheets.getByRef('pokemon', 'target-a'))
    const definition = validateMoveSpec({
      schemaVersion: 2,
      canonicalId: 'Synthesis',
      version: 166,
      targeting: {
        kind: 'self',
        minTargets: 1,
        maxTargets: 1,
        selector: { kind: 'actor' },
      },
      preconditions: [],
      costs: [],
      phases: [{
        phase: 'hit',
        operations: [{
          id: 'recovery.replace-synthesis',
          kind: 'permanent-move-list',
          source: { kind: 'move', id: 'move.synthesis' },
          recipients: { kind: 'actor' },
          phase: 'hit',
          reasonCode: 'recovery.permanent-move-list-cas',
          payload: {
            action: 'replace',
            replacedMoveId: 'Synthesis',
            moveId: 'Pound',
            acquisition: { kind: 'reviewed-rule' },
          },
        }],
      }, {
        phase: 'usage',
        operations: [{
          id: 'synthesis.usage',
          kind: 'usage',
          source: { kind: 'move', id: 'move.synthesis' },
          recipients: { kind: 'actor' },
          phase: 'usage',
          reasonCode: 'synthesis.frequency-use',
          payload: {
            action: 'spend',
            resourceId: 'synthesis.frequency-use',
            amount: 1,
          },
        }],
      }],
      registeredHandlerId: null,
      presentation: {
        displayName: 'Synthesis',
        vfxKey: null,
        tags: ['recovery-test'],
      },
    })
    const runtimeRegistry = runtimeRegistryWithValidatedDefinition('Synthesis', definition)
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Synthesis',
      selection: { kind: 'self' },
    })
    const command = commandFor(map, moveIntent, 'op_movelistcas01')
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      const plan = planAuthoritativeMoveState({ ...input, runtimeRegistry })
      expect(plan.sheetWrites).toEqual([
        expect.objectContaining({
          kind: 'pokemon',
          slug: 'actor',
          expectedRevision: 2,
          changedFields: ['moveUsage', 'movelist'],
          nextSheet: expect.objectContaining({
            movelist: [expect.objectContaining({ name: 'Pound' })],
          }),
        }),
      ])
      const current = harness.sheets.getByRef('pokemon', 'actor')!
      harness.sheets.save({
        kind: current.kind,
        slug: current.slug,
        revision: current.revision + 1,
        updatedAt: current.updatedAt + 1,
        document: {
          ...current.sheet,
          revision: current.revision + 1,
          updatedAt: current.updatedAt + 1,
        },
      })
      return plan
    }

    const response = await execute(harness, command, {
      planner,
      random: () => { throw new Error('permanent move-list fixture does not use randomness') },
    })

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(harness.maps.getBySlug('arena')).toEqual(map)
    expect(harness.sheets.getByRef('pokemon', 'actor')).toMatchObject({
      revision: 3,
      sheet: { movelist: [{ name: 'Synthesis' }] },
    })
    expect(harness.sheets.getByRef('pokemon', 'target-a')).toEqual(targetBefore)
    expect(harness.ops.getOpResult('arena', command.opId)).toBeNull()
    expect(harness.events).toEqual([])
  })

  it('commits transformation cleanup with a knockout exactly once across duplicate delivery', async () => {
    const baseTransformation = transformationEncounterEffectFixture()
    const transformation = parseEncounterEffect({
      ...baseTransformation,
      id: 'effect.transformation.target-a',
      source: { ...baseTransformation.source, placementId: 'target-a' },
      affected: { placementIds: ['target-a'], sideIds: [], cells: [] },
      payload: { ...baseTransformation.payload, copiedFromPlacementId: 'actor-token' },
    })
    const map = mapFixture({
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [transformation],
      },
    })
    const harness = seedHarness({
      map,
      actorMoves: [{ name: 'Pound' }],
      targetASheet: { combat: { currentHp: 1 } },
    })
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Pound',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const command = commandFor(map, moveIntent, 'op_transformko01')
    const response = await execute(harness, command, {
      random: randomSequence([0.5, 0.5]),
    })
    const acceptedResult = accepted(response.result)

    expect(response.move?.transaction.hpUpdates).toEqual([
      expect.objectContaining({ id: 'target-a' }),
    ])
    expect(response.move?.transaction.hpUpdates[0]?.currentHp).toBeLessThanOrEqual(0)
    expect(response.map?.encounterState?.effects).toEqual([])
    expect(moveStatePatchPayload(acceptedResult).changes.encounterState).toMatchObject({
      previous: { effects: [expect.objectContaining({ id: transformation.id })] },
      current: { effects: [] },
    })
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.sheet).toMatchObject({
      species: 'Snorlax',
      combat: { currentHp: response.move?.transaction.hpUpdates[0]?.currentHp },
    })
    const committedMap = deepCloneJson(harness.maps.getBySlug('arena'))
    const committedSheets = deepCloneJson(harness.sheets.list())
    const committedEvents = deepCloneJson(harness.events)

    const duplicate = await execute(harness, command, {
      planner: () => { throw new Error('duplicate transformation cleanup must not replan') },
      random: () => { throw new Error('duplicate transformation cleanup must not reroll') },
    })

    expect(duplicate.result).toEqual(acceptedResult)
    expect(harness.maps.getBySlug('arena')).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(committedSheets)
    expect(harness.events).toEqual(committedEvents)
  })

  it('commits map, sheets, and op result atomically and rolls back on sheet persistence failure', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Pound' }] })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({ placementId: 'actor-token', moveName: 'Pound', selection: { kind: 'single-target', targetPlacementId: 'target-a' } })
    const response = await execute(harness, commandFor(map, moveIntent, 'op_atomicok01'), { random: randomSequence([0.5, 0]) })
    expect(response.result.ok).toBe(true)
    expect(harness.ops.getOpResult('arena', 'op_atomicok01')).toEqual(response.result)
    expect(harness.maps.getBySlug('arena')?.revision).toBe(5)
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.revision).toBe(3)

    const failingHarness = seedHarness({ actorMoves: [{ name: 'Pound' }] })
    const failingMap = failingHarness.maps.getBySlug('arena')!
    const failingSheetRepo = {
      ...failingHarness.sheets,
      applyLivePlayUpdate: () => 'stale' as const,
    }
    const failing = await executeLivePlayResolveMoveCommandUseCase({
      role: 'gm',
      command: commandFor(failingMap, moveIntent, 'op_atomicfail1'),
      clientId: 'client-test',
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    }, {
      database: failingHarness.database,
      mapRepository: failingHarness.maps,
      sheetRepository: failingSheetRepo,
      random: randomSequence([0.5, 0]),
      now: () => 1000,
      idFactory: () => 'feedback-id',
    })
    expect(failing.result).toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(failingHarness.maps.getBySlug('arena')?.revision).toBe(4)
    expect(failingHarness.maps.getBySlug('arena')?.encounterState?.turnResources ?? {})
      .toEqual({})
    expect(failingHarness.sheets.getByRef('pokemon', 'target-a')?.revision).toBe(2)
    expect(failingHarness.ops.getOpResult('arena', 'op_atomicfail1')).toBeNull()
  })

  it('rejects stale consulted sheets for misses and immune targets without partial persistence', async () => {
    const assertConflictRolledBack = (
      harness: Harness,
      response: Awaited<ReturnType<typeof execute>>,
      opId: string,
      expectedMap: TabletopMap,
      sheetsAfterRace: unknown,
    ): void => {
      expect(response.result).toMatchObject({
        ok: false,
        reason: 'conflict',
        message: expect.stringContaining('consulted while resolving the move changed'),
      })
      expect(harness.maps.getBySlug('arena')).toEqual(expectedMap)
      expect(harness.sheets.list()).toEqual(sheetsAfterRace)
      expect(harness.ops.getOpResult('arena', opId)).toBeNull()
      expect(harness.events).toEqual([])
    }

    await withRegisteredScript(mixedOutcomeAreaScript(), async () => {
      const harness = seedHarness({ actorMoves: [{ name: 'Swift' }] })
      const map = harness.maps.getBySlug('arena')!
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName: 'Swift',
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId(mixedAreaTemplate),
          direction: 'east',
        },
      })
      const opId = 'op_readmiss001'
      const race = raceConsultedSheetAfterPlanning(harness, 'target-b', (plan) => {
        expect(plan.resolution.transaction.attackedTargetIds).toContain('target-b')
        expect(plan.resolution.transaction.hitTargetIds).not.toContain('target-b')
      })
      const response = await execute(
        harness,
        commandFor(map, moveIntent, opId, ['target-a', 'target-b']),
        { planner: race.planner, random: randomSequence([0.5, 0]) },
      )

      assertConflictRolledBack(harness, response, opId, map, race.sheetsAfterRace())
    })

    const immuneMap = mapFixture({ placements: [
      placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
      placement('immune-token', 'immune', { x: 1, y: 0, z: 0 }),
    ] })
    const immuneHarness = seedHarness({
      map: immuneMap,
      actorMoves: [{ name: 'Spore' }],
      extraSheets: [pokemonSheet('immune', [], { abilities: [{ name: 'Sweet Veil' }] })],
    })
    const storedImmuneMap = immuneHarness.maps.getBySlug('arena')!
    const immuneIntent = intent({
      placementId: 'actor-token',
      moveName: 'Spore',
      selection: { kind: 'single-target', targetPlacementId: 'immune-token' },
    })
    const immuneOpId = 'op_readimmune1'
    const immuneRace = raceConsultedSheetAfterPlanning(immuneHarness, 'immune', (plan) => {
      expect(plan.resolution.feedback).toBeUndefined()
      expect(plan.resolution.auditTrace.events).toContainEqual(expect.objectContaining({
        kind: 'operation',
        operationKind: 'condition',
        outcome: 'prevented',
      }))
      expect(JSON.stringify(plan.resolution.auditTrace.events)).toContain('Sweet Veil')
      expect(plan.resolution.transaction.conditionUpdates).toEqual([])
    })
    const immuneResponse = await execute(
      immuneHarness,
      commandFor(storedImmuneMap, immuneIntent, immuneOpId),
      { planner: immuneRace.planner, random: randomSequence([0.99]) },
    )
    assertConflictRolledBack(
      immuneHarness,
      immuneResponse,
      immuneOpId,
      storedImmuneMap,
      immuneRace.sheetsAfterRace(),
    )
  })

  it('does not accept unknown-side Sweet Veil providers while freezing the complete map-sheet directory', async () => {
    const map = mapFixture({ placements: [
      placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
      placement('target-a', 'target-a', { x: 1, y: 0, z: 0 }),
      placement('aura-token', 'aura', { x: 2, y: 0, z: 0 }),
    ] })
    const harness = seedHarness({
      map,
      actorMoves: [{ name: 'Spore' }],
      extraSheets: [pokemonSheet('aura', [], { abilities: [{ name: 'Sweet Veil' }] })],
    })
    const storedMap = harness.maps.getBySlug('arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Spore',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const race = raceConsultedSheetAfterPlanning(harness, 'aura', (plan) => {
      expect(plan.resolution.feedback).toBeUndefined()
      expect(plan.resolution.transaction.conditionUpdates).toEqual([{ id: 'target-a', conditions: ['Sleep'] }])
      expect(JSON.stringify(plan.resolution.auditTrace.events)).not.toContain('Sweet Veil')
    })

    const response = await execute(
      harness,
      commandFor(storedMap, moveIntent, 'op_unknownaura1'),
      { planner: race.planner, random: randomSequence([0.99]) },
    )

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('consulted while resolving the move changed'),
    })
    expect(harness.maps.getBySlug('arena')).toEqual(storedMap)
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.revision).toBe(2)
    expect(harness.sheets.getByRef('pokemon', 'aura')?.revision).toBe(3)
    expect(harness.ops.getOpResult('arena', 'op_unknownaura1')).toBeNull()
    expect(harness.events).toEqual([])
  })

  it('preserves mixed area target identities in the response, stored result, realtime event, and duplicate replay', async () => {
    await withRegisteredScript(mixedOutcomeAreaScript(), async () => {
      const harness = seedHarness({ actorMoves: [{ name: 'Swift' }] })
      const map = harness.maps.getBySlug('arena')!
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName: 'Swift',
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId(mixedAreaTemplate),
          direction: 'east',
        },
      })
      let plannerCalls = 0
      let randomCalls = 0
      const countingPlanner: typeof planAuthoritativeMoveState = (input) => {
        plannerCalls += 1
        return planAuthoritativeMoveState(input)
      }
      const random = () => {
        randomCalls += 1
        return randomCalls === 1 ? 0.5 : 0
      }

      const command = commandFor(map, moveIntent, 'op_duplicate01', ['target-a', 'target-b'])
      const first = await execute(harness, command, { random, planner: countingPlanner })
      const firstResult = accepted(first.result)
      const firstPayload = moveStatePatchPayload(firstResult)
      const storedResult = accepted(harness.ops.getOpResult('arena', command.opId))
      const storedPayload = moveStatePatchPayload(storedResult)
      const acceptedEvent = harness.events.find((event) => (
        (event as { readonly type?: string }).type === 'live-play-command-accepted'
      )) as { readonly patches?: LivePlayCommandAccepted['patches'] } | undefined
      if (!acceptedEvent?.patches) throw new Error('expected accepted realtime event patches')
      const realtimePayload = moveStatePayloadFromPatches(acceptedEvent.patches)
      const expectedTargetIdentity = {
        attackedTargetIds: ['target-a', 'target-b'],
        hitTargetIds: ['target-a'],
      }
      const expectedPresentation = {
        operationId: command.opId,
        actorPlacementId: 'actor-token',
        move: { name: 'Swift', type: 'Normal' },
        attackedTargetIds: ['target-a', 'target-b'],
        hitTargetIds: ['target-a'],
        outcomeKind: 'mixed',
        area: expect.objectContaining({ templateKind: 'line', direction: 'east' }),
      }

      expect([
        moveTargetIdentity(first.move),
        moveTargetIdentity(firstPayload.move),
        moveTargetIdentity(storedPayload.move),
        moveTargetIdentity(realtimePayload.move),
      ]).toEqual([
        expectedTargetIdentity,
        expectedTargetIdentity,
        expectedTargetIdentity,
        expectedTargetIdentity,
      ])
      expect([
        firstPayload.presentation,
        storedPayload.presentation,
        realtimePayload.presentation,
      ]).toEqual([
        expect.objectContaining(expectedPresentation),
        expect.objectContaining(expectedPresentation),
        expect.objectContaining(expectedPresentation),
      ])
      expect(storedResult).toEqual(firstResult)
      const expectedRollLedger = moveRollLedger(first.move)
      const expectedTrace = deepCloneJson(first.move?.trace)
      expect(expectedTrace).toBeDefined()
      expect(expectedRollLedger).toEqual([
        expect.objectContaining({
          rollId: 'legacy-v1.accuracy.1',
          parentEffectId: 'legacy-v1.accuracy',
          naturalResult: 11,
          finalValue: 11,
        }),
        expect.objectContaining({
          rollId: 'legacy-v1.accuracy.2',
          parentEffectId: 'legacy-v1.accuracy',
          naturalResult: 1,
          finalValue: -1,
          modifiers: expect.arrayContaining([
            expect.objectContaining({
              sourceId: 'target-a',
              reason: 'Rough Terrain cover',
              value: -2,
            }),
          ]),
        }),
      ])
      expect([
        moveRollLedger(firstPayload.move),
        moveRollLedger(storedPayload.move),
        moveRollLedger(realtimePayload.move),
      ]).toEqual([
        expectedRollLedger,
        expectedRollLedger,
        expectedRollLedger,
      ])
      expect([
        firstPayload.move.trace,
        storedPayload.move.trace,
        realtimePayload.move.trace,
      ]).toEqual([
        expectedTrace,
        expectedTrace,
        expectedTrace,
      ])

      const firstEventCount = harness.events.length
      const firstCommittedMap = deepCloneJson(harness.maps.getBySlug('arena'))
      const firstMapRevision = firstCommittedMap?.revision
      const firstHitSheetRevision = harness.sheets.getByRef('pokemon', 'target-a')?.revision
      const firstMissSheetRevision = harness.sheets.getByRef('pokemon', 'target-b')?.revision

      const duplicate = await execute(harness, command, {
        random: () => { throw new Error('random should not run') },
        planner: () => { throw new Error('planner should not run') },
      })
      const duplicateResult = accepted(duplicate.result)
      const duplicatePayload = moveStatePatchPayload(duplicateResult)
      expect(duplicate.result).toEqual(firstResult)
      expect(duplicate.move).toEqual(first.move)
      expect(moveTargetIdentity(duplicate.move)).toEqual(expectedTargetIdentity)
      expect(moveTargetIdentity(duplicatePayload.move)).toEqual(expectedTargetIdentity)
      expect(moveRollLedger(duplicate.move)).toEqual(expectedRollLedger)
      expect(moveRollLedger(duplicatePayload.move)).toEqual(expectedRollLedger)
      expect(duplicate.move?.trace).toEqual(expectedTrace)
      expect(duplicatePayload.move.trace).toEqual(expectedTrace)
      expect(plannerCalls).toBe(1)
      expect(randomCalls).toBe(2)
      expect(harness.events).toHaveLength(firstEventCount)
      expect(harness.maps.getBySlug('arena')).toEqual(firstCommittedMap)
      expect(harness.maps.getBySlug('arena')?.revision).toBe(firstMapRevision)
      expect(harness.sheets.getByRef('pokemon', 'target-a')?.revision).toBe(firstHitSheetRevision)
      expect(harness.sheets.getByRef('pokemon', 'target-b')?.revision).toBe(firstMissSheetRevision)

      const differentIntent = intent({
        placementId: 'actor-token',
        moveName: 'Swift',
        selection: {
          kind: 'area',
          areaTemplateId: moveAutomationAreaTemplateId(mixedAreaTemplate),
          direction: 'east',
          excludedTargetPlacementIds: ['target-b'],
        },
      })
      const violation = await execute(harness, {
        ...commandFor(harness.maps.getBySlug('arena')!, differentIntent, command.opId, ['target-a', 'target-b']),
        baseRevision: command.baseRevision,
      })
      expect(violation.result).toMatchObject({ ok: false, reason: 'conflict', message: expect.stringContaining('already recorded') })
    })
  })
})
