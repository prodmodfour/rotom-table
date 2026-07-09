import { afterEach, describe, expect, it } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayCommandAccepted,
  type ResolveMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  type ResolveMoveIntent,
} from '#shared/livePlayMoveResolution'
import { parseLivePlayMoveStatePatchPayload } from '#shared/livePlayMoveState'
import { planAuthoritativeMoveState } from '~~/server/domain/planAuthoritativeMoveState'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteLivePlayOpRepository } from '~~/server/storage/opRepository'
import { createSqliteSheetRepository, type SheetRepository } from '~~/server/storage/sheetRepository'
import {
  executeLivePlayResolveMoveCommandUseCase,
  type LivePlayResolveMoveCommandDependencies,
} from '~~/server/useCases/applyResolveMoveCommand'
import { buildResolveMoveScopes } from '~/utils/livePlayMoveCommandScopes'
import type { CharacterSheet, CharacterSheetMove } from '~/types/characterSheet'
import type { SheetPlacement, TabletopMap } from '~/types/map'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'

interface InvariantHarness {
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

const placement = (
  id: string,
  sheetSlug: string,
  position: { readonly x: number; readonly y: number; readonly z: number },
  sideId?: string,
): SheetPlacement => ({
  id,
  sheetKind: 'pokemon',
  sheetSlug,
  position,
  ...(sideId ? { sideId } : {}),
})

const mapFixture = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  slug: 'invariant-arena',
  name: 'Invariant Arena',
  folder: '',
  revision: 4,
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }),
    placement('target-token', 'target', { x: 1, y: 0, z: 0 }),
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  activeScene: { name: 'Scene A', startedAt: 100 },
  metadata: { note: 'before move' },
  createdAt: 1,
  updatedAt: 100,
  ...overrides,
})

const pokemonSheet = (
  slug: string,
  moves: readonly CharacterSheetMove[] = [],
  overrides: Partial<CharacterSheet> = {},
): CharacterSheet => ({
  slug,
  nickname: slug,
  species: 'Pikachu',
  level: 20,
  movelist: [...moves],
  revision: 2,
  combat: { currentHp: 80 },
  ...overrides,
})

const createHarness = (options: {
  readonly map?: TabletopMap
  readonly actorMoves?: readonly CharacterSheetMove[]
  readonly extraSheets?: readonly CharacterSheet[]
} = {}): InvariantHarness => {
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
  maps.save({
    slug: map.slug,
    document: map,
    revision: map.revision ?? 0,
    updatedAt: map.updatedAt ?? 100,
  })

  const seededSheets = [
    pokemonSheet('actor', options.actorMoves ?? [{ name: 'Tackle' }]),
    pokemonSheet('target'),
    ...(options.extraSheets ?? []),
  ]
  for (const sheet of seededSheets) {
    sheets.save({
      kind: 'pokemon',
      slug: sheet.slug,
      document: sheet as unknown as Record<string, unknown>,
      revision: sheet.revision ?? 0,
      updatedAt: 50,
    })
  }

  return { database, maps, sheets, ops, commandExecutor, events }
}

const intent = (overrides: Omit<ResolveMoveIntent, 'schemaVersion'>): ResolveMoveIntent => ({
  schemaVersion: LIVE_PLAY_MOVE_RESOLUTION_SCHEMA_VERSION,
  ...overrides,
})

const commandFor = (
  map: TabletopMap,
  payload: ResolveMoveIntent,
  opId: string,
): ResolveMoveLivePlayCommand => {
  const scopes = buildResolveMoveScopes({ map, intent: payload })
  if (!scopes.ok) throw new Error(scopes.message)
  return {
    schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
    opId,
    mapSlug: map.slug,
    baseRevision: map.revision ?? 0,
    type: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
    scopes: scopes.scopes,
    payload,
  }
}

const execute = (
  harness: InvariantHarness,
  command: ResolveMoveLivePlayCommand,
  overrides: Pick<
    LivePlayResolveMoveCommandDependencies,
    'planner' | 'random' | 'sheetRepository'
  > = {},
) => executeLivePlayResolveMoveCommandUseCase({
  role: 'gm',
  command,
  clientId: 'invariant-client',
  playerProfile: null,
  expectedType: LIVE_PLAY_COMMAND_TYPES.RESOLVE_MOVE,
}, {
  database: harness.database,
  mapRepository: harness.maps,
  sheetRepository: overrides.sheetRepository ?? harness.sheets,
  commandExecutor: harness.commandExecutor,
  planner: overrides.planner,
  random: overrides.random,
  now: () => 1_000,
  idFactory: () => 'invariant-feedback',
})

const accepted = (value: unknown): LivePlayCommandAccepted => {
  if (!value || typeof value !== 'object' || !('ok' in value) || value.ok !== true || 'duplicate' in value) {
    throw new Error('Expected an accepted command result')
  }
  return value as LivePlayCommandAccepted
}

const moveStatePayload = (result: LivePlayCommandAccepted) => {
  expect(result.patches).toHaveLength(1)
  expect(result.patches[0]?.type).toBe(LIVE_PLAY_PATCH_TYPES.MOVE_STATE)
  const parsed = parseLivePlayMoveStatePatchPayload(result.patches[0]?.payload)
  expect(parsed.valid).toBe(true)
  if (!parsed.valid) throw new Error('Expected a valid MOVE_STATE payload')
  return parsed.payload
}

const clone = <T>(value: T): T => structuredClone(value)

describe('authoritative move invariants', () => {
  it('rejects client-authored mechanics before planning or server RNG', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('invariant-arena')!
    const validIntent = intent({
      placementId: 'actor-token',
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    })
    const beforeMap = clone(map)
    const beforeSheets = clone(harness.sheets.list())
    const command = {
      ...commandFor(map, validIntent, 'op_invariantbad1'),
      payload: {
        ...validIntent,
        rolls: [20],
        damage: 999,
        script: { moveName: 'Client Tackle' },
        transaction: { hpUpdates: [] },
        targetIds: ['target-token'],
        fieldEffects: [{ kind: 'client-authored' }],
      },
    } as unknown as ResolveMoveLivePlayCommand

    const response = await execute(harness, command, {
      planner: () => { throw new Error('planner must not run for a forbidden payload') },
      random: () => { throw new Error('RNG must not run for a forbidden payload') },
    })

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      currentState: {
        code: 'invalid-resolve-move-intent',
        issues: expect.arrayContaining([
          expect.objectContaining({ path: 'rolls', code: 'forbidden-field' }),
          expect.objectContaining({ path: 'damage', code: 'forbidden-field' }),
          expect.objectContaining({ path: 'script', code: 'forbidden-field' }),
          expect.objectContaining({ path: 'transaction', code: 'forbidden-field' }),
          expect.objectContaining({ path: 'targetIds', code: 'forbidden-field' }),
          expect.objectContaining({ path: 'fieldEffects', code: 'forbidden-field' }),
        ]),
      },
    })
    expect(harness.maps.getBySlug('invariant-arena')).toEqual(beforeMap)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.events).toEqual([])
  })

  it('owns RNG, target identity, durable presentation, and duplicate replay on the server', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('invariant-arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    })
    const command = commandFor(map, moveIntent, 'op_invariantok01')
    const draws = [0.5, 0]
    let randomCalls = 0

    const first = await execute(harness, command, {
      random: () => {
        const draw = draws[randomCalls]
        randomCalls += 1
        if (draw === undefined) throw new Error('authoritative resolver requested an unexpected RNG draw')
        return draw
      },
    })
    const firstResult = accepted(first.result)
    const firstPayload = moveStatePayload(firstResult)
    const storedResult = accepted(harness.ops.getOpResult(map.slug, command.opId))
    const storedPayload = moveStatePayload(storedResult)
    const acceptedEvent = harness.events.find((event) => (
      (event as { readonly type?: string }).type === 'live-play-command-accepted'
    )) as { readonly patches?: LivePlayCommandAccepted['patches'] } | undefined
    if (!acceptedEvent?.patches) throw new Error('Expected the accepted realtime event')
    const realtimePayload = moveStatePayload({ ...firstResult, patches: acceptedEvent.patches })
    const expectedTargets = {
      attackedTargetIds: ['target-token'],
      hitTargetIds: ['target-token'],
    }

    expect(randomCalls).toBe(2)
    expect(first.move?.transaction).toMatchObject(expectedTargets)
    expect(firstPayload.move.transaction).toMatchObject(expectedTargets)
    expect(storedPayload.move.transaction).toMatchObject(expectedTargets)
    expect(realtimePayload.move.transaction).toMatchObject(expectedTargets)
    expect(firstPayload.presentation).toMatchObject({
      operationId: command.opId,
      actorPlacementId: 'actor-token',
      move: { name: 'Tackle' },
      ...expectedTargets,
      outcomeKind: 'hit',
    })
    expect(storedPayload.presentation).toEqual(firstPayload.presentation)
    expect(realtimePayload.presentation).toEqual(firstPayload.presentation)
    expect((harness.sheets.getByRef('pokemon', 'target')?.sheet.combat as { currentHp: number }).currentHp).toBeLessThan(80)

    const committedMap = clone(harness.maps.getBySlug(map.slug))
    const committedSheets = clone(harness.sheets.list())
    const eventCount = harness.events.length
    const duplicate = await execute(harness, command, {
      planner: () => { throw new Error('duplicate replay must not replan') },
      random: () => { throw new Error('duplicate replay must not reroll') },
    })

    expect(duplicate.result).toEqual(firstResult)
    expect(duplicate.move).toEqual(first.move)
    expect(harness.maps.getBySlug(map.slug)).toEqual(committedMap)
    expect(harness.sheets.list()).toEqual(committedSheets)
    expect(harness.events).toHaveLength(eventCount)
    expect(randomCalls).toBe(2)
  })

  it('validates the complete consulted read set before committing', async () => {
    const map = mapFixture({
      placements: [
        placement('actor-token', 'actor', { x: 0, y: 0, z: 0 }, 'red'),
        placement('target-token', 'target', { x: 0, y: 0, z: 0 }, 'blue'),
        placement('aura-token', 'aura', { x: 1, y: 0, z: 0 }, 'blue'),
      ],
    })
    const harness = createHarness({
      map,
      actorMoves: [{ name: 'Spore' }],
      extraSheets: [pokemonSheet('aura', [], { abilities: [{ name: 'Sweet Veil' }] })],
    })
    const storedMap = harness.maps.getBySlug(map.slug)!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Spore',
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    })
    const actorBefore = clone(harness.sheets.getByRef('pokemon', 'actor'))
    const targetBefore = clone(harness.sheets.getByRef('pokemon', 'target'))
    const planner: NonNullable<LivePlayResolveMoveCommandDependencies['planner']> = (input) => {
      const plan = planAuthoritativeMoveState(input)
      expect(plan.sheetReads).toEqual([
        { kind: 'pokemon', slug: 'actor', revision: 2 },
        { kind: 'pokemon', slug: 'target', revision: 2 },
        { kind: 'pokemon', slug: 'aura', revision: 2 },
      ])
      expect(plan.resolution.feedback?.conditions).toContainEqual(expect.objectContaining({
        condition: 'Sleep',
        applied: false,
        blockedBy: expect.stringContaining('Sweet Veil'),
      }))

      const aura = harness.sheets.getByRef('pokemon', 'aura')!
      harness.sheets.save({
        kind: 'pokemon',
        slug: 'aura',
        document: { ...aura.sheet, revision: 3, updatedAt: 51 },
        revision: 3,
        updatedAt: 51,
      })
      return plan
    }

    const response = await execute(
      harness,
      commandFor(storedMap, moveIntent, 'op_invariantread'),
      { planner, random: () => 0.99 },
    )

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'conflict',
      message: expect.stringContaining('consulted while resolving the move changed'),
    })
    expect(harness.maps.getBySlug(map.slug)).toEqual(storedMap)
    expect(harness.sheets.getByRef('pokemon', 'actor')).toEqual(actorBefore)
    expect(harness.sheets.getByRef('pokemon', 'target')).toEqual(targetBefore)
    expect(harness.sheets.getByRef('pokemon', 'aura')?.revision).toBe(3)
    expect(harness.ops.getOpResult(map.slug, 'op_invariantread')).toBeNull()
    expect(harness.events).toEqual([])
  })

  it('rolls back map, sheet, operation, and realtime state on persistence failure', async () => {
    const harness = createHarness()
    const map = harness.maps.getBySlug('invariant-arena')!
    const moveIntent = intent({
      placementId: 'actor-token',
      moveName: 'Tackle',
      selection: { kind: 'single-target', targetPlacementId: 'target-token' },
    })
    const beforeSheets = clone(harness.sheets.list())
    const failingSheets: Pick<
      SheetRepository<Record<string, unknown>>,
      'getByRef' | 'assertRevisions' | 'applyLivePlayUpdate'
    > = {
      getByRef: harness.sheets.getByRef,
      assertRevisions: harness.sheets.assertRevisions,
      applyLivePlayUpdate: () => 'stale',
    }

    const response = await execute(
      harness,
      commandFor(map, moveIntent, 'op_invariantfail'),
      { sheetRepository: failingSheets, random: (() => {
        const draws = [0.5, 0]
        let index = 0
        return () => draws[index++] ?? 0
      })() },
    )

    expect(response.result).toMatchObject({ ok: false, reason: 'persistence-failed' })
    expect(harness.maps.getBySlug(map.slug)).toEqual(map)
    expect(harness.sheets.list()).toEqual(beforeSheets)
    expect(harness.ops.getOpResult(map.slug, 'op_invariantfail')).toBeNull()
    expect(harness.events).toEqual([])
  })
})
