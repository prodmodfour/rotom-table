import { afterEach, describe, expect, it } from 'vitest'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createAuthoritativeLivePlayCommandExecutor, type AuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { executeLivePlayResolveMoveCommandUseCase, type LivePlayResolveMoveCommandDependencies } from '~~/server/useCases/applyResolveMoveCommand'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { redBlueEncounterStateFixture } from '../fixtures/moveAutomation/encounterSides'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import {
  ENCOUNTER_EXHAUST_COMMAND_FLAG_ID,
  ENCOUNTER_EXHAUST_NEXT_TURN_FLAG_ID,
  spendEncounterMoveResourceCosts,
} from '~~/server/domain/moveAutomation/reduceEncounterResources'
import { planAuthoritativeMoveState, type AuthoritativeMoveStatePlan } from '~~/server/domain/planAuthoritativeMoveState'
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

interface Harness {
  readonly database: RotomDatabase
  readonly maps: ReturnType<typeof createSqliteMapRepository<TabletopMap>>
  readonly sheets: ReturnType<typeof createSqliteSheetRepository<Record<string, unknown>>>
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
    [...(options.actorMoves ?? [{ name: 'Tackle' }])],
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
  return { database, maps, sheets, ops, commandExecutor, events }
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
  commandExecutor: harness.commandExecutor,
  planner: options.planner,
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
  scripts.set(script.moveName, script)
  try {
    return await run()
  } finally {
    if (previous) scripts.set(script.moveName, previous)
    else scripts.delete(script.moveName)
  }
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
      oncePerTurnFlags: [{ id: 'move.swords-dance', sourceOperationId: 'op_resolveself01' }],
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

    const targetHarness = seedHarness({ actorMoves: [{ name: 'Tackle' }] })
    const targetMap = targetHarness.maps.getBySlug('arena')!
    const targetIntent = intent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target-a' } })
    const beforeMap = deepCloneJson(targetMap)
    const targetResponse = await execute(targetHarness, commandFor(targetMap, targetIntent, 'op_resolvetarg1'), { random: randomSequence([0.5, 0]) })

    const targetResult = accepted(targetResponse.result)
    const targetPayload = moveStatePatchPayload(targetResult)
    expect(targetPayload.move).toEqual(targetResponse.move)
    expect(targetPayload.move.rollLedger.map((roll) => roll.parentEffectId)).toEqual([
      'legacy-v1.accuracy',
      'legacy-v1.damage',
    ])
    expect(targetPayload.move.trace).toMatchObject({
      schemaVersion: 1,
      program: {
        canonicalId: 'Tackle',
        runtimeKind: 'legacy-v1',
        runtimeVersion: 1,
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
      expect.objectContaining({ kind: 'roll', rollId: 'legacy-v1.accuracy.1' }),
      expect.objectContaining({ kind: 'operation', operationKind: 'direct-hp', outcome: 'applied' }),
    ]))
    expect('auditTrace' in targetPayload.move).toBe(false)
    expect(JSON.stringify(targetPayload.move.trace)).not.toContain('absolute-hp-state')
    expect(targetPayload.sheets.map((sheet) => `${sheet.kind}:${sheet.slug}`)).toContain('pokemon:target-a')
    expect(targetResponse.map).toEqual(targetHarness.maps.getBySlug('arena'))
    expect((targetResponse.map?.metadata?.moveLog as Array<Record<string, unknown>> | undefined)?.at(-1))
      .toMatchObject({ operationId: 'op_resolvetarg1', moveName: 'Tackle' })
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
    { moveName: 'Tackle', runtime: 'legacy-v1' },
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
      moveName === 'Tackle' ? 'op_costrejectv1' : 'op_costrejectv2',
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
    const tackle = EXPLICIT_MOVE_AUTOMATION_SCRIPTS.get('Tackle')
    if (!tackle) throw new Error('expected registered Tackle script')
    await withRegisteredScript({
      ...tackle,
      range: 'Melee, 1 Target, Priority, Exhaust',
    }, async () => {
      const harness = seedHarness({ actorMoves: [{ name: 'Tackle' }] })
      const map = harness.maps.getBySlug('arena')!
      const moveIntent = intent({
        placementId: 'actor-token',
        moveName: 'Tackle',
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
  }, {
    moveName: 'Fury Attack',
    opId: 'op_resolvefuryattack1',
    multiHitOperationId: 'fury-attack.multi-hit',
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
      'fury-attack.accuracy-roll.t1',
      'fury-attack.hit-count-roll',
      'fury-attack.critical-roll.t1.h1',
      'fury-attack.multi-hit.t1.h1.roll',
      'fury-attack.critical-roll.t1.h2',
      'fury-attack.multi-hit.t1.h2.roll',
      'fury-attack.critical-roll.t1.h3',
      'fury-attack.multi-hit.t1.h3.roll',
      'fury-attack.critical-roll.t1.h4',
      'fury-attack.multi-hit.t1.h4.roll',
      'fury-attack.critical-roll.t1.h5',
      'fury-attack.multi-hit.t1.h5.roll',
    ],
  }] as const)(
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
        oncePerTurnFlags: [{ id: 'move.scratch', sourceOperationId: 'op_resolvepass1' }],
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
      expect(payload.move.transaction.logLines).toContainEqual(
        'Assisted ally targeting: Howl checks explicit encounter sides; unknown allegiance is not eligible. Review side assignments in Prepare Map.',
      )
      expect(JSON.stringify(response)).not.toContain('target-excluded-not-ally')
    })
  })

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

  it('enforces command type, intent shape, map mode, visibility, token control, and exact base revisions', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Tackle' }] })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target-a' } })

    const invalidIntent = await execute(harness, { ...commandFor(map, moveIntent, 'op_badintent01'), payload: { placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'self' }, rolls: [20] } as never })
    expect(invalidIntent.result).toMatchObject({ ok: false, reason: 'invalid' })

    createSqliteMapInteractionModeRepository(harness.database).set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 1 })
    const prepareMode = await execute(harness, commandFor(map, moveIntent, 'op_preparemode1'))
    expect(prepareMode.result).toMatchObject({ ok: false, reason: 'conflict' })
    createSqliteMapInteractionModeRepository(harness.database).set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 2 })

    const hiddenHarness = seedHarness({ map: mapFixture({ playerVisible: false }), actorMoves: [{ name: 'Tackle' }] })
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
    const harness = seedHarness({ actorMoves: [{ name: 'Tackle' }] })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target-a' } })
    const valid = commandFor(map, moveIntent, 'op_scopevalid1')

    const duplicate = await execute(harness, { ...valid, opId: 'op_scopedupe01', scopes: [...valid.scopes, valid.scopes[0]!] })
    expect(duplicate.result).toMatchObject({ ok: false, reason: 'invalid', message: expect.stringContaining('more than once') })

    const missingHpScope = await execute(harness, { ...valid, opId: 'op_scopemiss1', scopes: valid.scopes.filter((scope) => !(scope.kind === 'token' && scope.placementId === 'target-a' && scope.field === 'hp')) })
    expect(missingHpScope.result).toMatchObject({ ok: false, reason: 'invalid', message: expect.stringContaining('missing required write scope') })

    const unrelated = await execute(harness, { ...valid, opId: 'op_scopeunrel1', scopes: [...valid.scopes, { kind: 'token', placementId: 'target-b', field: 'hp' }] })
    expect(unrelated.result).toMatchObject({ ok: false, reason: 'invalid', message: expect.stringContaining('not related') })

    const acceptedResponse = await execute(harness, valid, { random: randomSequence([0.5, 0]) })
    const scopes = accepted(acceptedResponse.result).patches[0]!.scopes
    expect(scopes).toContainEqual({ kind: 'token', placementId: 'actor-token', field: 'action' })
    expect(scopes).toContainEqual({ kind: 'map', lane: 'metadata' })
    expect(scopes).toContainEqual({ kind: 'token', placementId: 'target-a', field: 'hp' })
    expect(scopes).not.toContainEqual({ kind: 'map', lane: 'hazards' })
    expect(scopes).not.toContainEqual({ kind: 'token', placementId: 'target-b', field: 'hp' })
  })

  it('commits map, sheets, and op result atomically and rolls back on sheet persistence failure', async () => {
    const harness = seedHarness({ actorMoves: [{ name: 'Tackle' }] })
    const map = harness.maps.getBySlug('arena')!
    const moveIntent = intent({ placementId: 'actor-token', moveName: 'Tackle', selection: { kind: 'single-target', targetPlacementId: 'target-a' } })
    const response = await execute(harness, commandFor(map, moveIntent, 'op_atomicok01'), { random: randomSequence([0.5, 0]) })
    expect(response.result.ok).toBe(true)
    expect(harness.ops.getOpResult('arena', 'op_atomicok01')).toEqual(response.result)
    expect(harness.maps.getBySlug('arena')?.revision).toBe(5)
    expect(harness.sheets.getByRef('pokemon', 'target-a')?.revision).toBe(3)

    const failingHarness = seedHarness({ actorMoves: [{ name: 'Tackle' }] })
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
      expect(plan.resolution.feedback?.conditions).toContainEqual(expect.objectContaining({
        condition: 'Sleep',
        applied: false,
        blockedBy: 'Sweet Veil',
      }))
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

  it('does not consult or accept unknown-side Sweet Veil tokens as allied providers', async () => {
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
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Spore',
      selection: { kind: 'single-target', targetPlacementId: 'target-a' },
    })
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      const plan = planAuthoritativeMoveState(input)
      expect(plan.sheetReads).not.toContainEqual(expect.objectContaining({ slug: 'aura' }))
      expect(plan.resolution.feedback?.conditions).toContainEqual({ condition: 'Sleep', applied: true })
      expect(plan.resolution.transaction.conditionUpdates).toEqual([{ id: 'target-a', conditions: ['Sleep'] }])

      const aura = harness.sheets.getByRef('pokemon', 'aura')!
      harness.sheets.save({
        kind: 'pokemon',
        slug: 'aura',
        document: { ...aura.sheet, revision: aura.revision + 1, updatedAt: aura.updatedAt + 1 },
        revision: aura.revision + 1,
        updatedAt: aura.updatedAt + 1,
      })
      return plan
    }

    const response = await execute(
      harness,
      commandFor(map, moveIntent, 'op_unknownaura1'),
      { planner, random: randomSequence([0.99]) },
    )

    expect(response.result.ok).toBe(true)
    expect(harness.sheets.getByRef('pokemon', 'aura')?.revision).toBe(3)
    expect(harness.ops.getOpResult('arena', 'op_unknownaura1')).toEqual(response.result)
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
          finalValue: 1,
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
