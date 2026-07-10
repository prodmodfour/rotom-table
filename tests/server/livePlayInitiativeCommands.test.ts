import { describe, expect, it, vi } from 'vitest'
import type { EncounterEventKind } from '#shared/moveAutomation/events'
import {
  createEmptyEncounterState,
  type EncounterState,
} from '#shared/moveAutomation/encounterState'
import {
  parseEncounterEffect,
  type EncounterEffect,
  type EncounterEffectDuration,
} from '#shared/moveAutomation/encounterEffects'
import type {
  MoveDirectHpEffectOperation,
  MoveHealEffectOperation,
} from '#shared/moveAutomation/effects'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayInitiativeCommand,
  type NextInitiativeLivePlayCommand,
  type PreviousInitiativeLivePlayCommand,
  type SetInitiativeLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  readAttackOfOpportunityState,
  writeAttackOfOpportunityState,
} from '#shared/attackOfOpportunityState'
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore, type LivePlayOpStore } from '~~/server/livePlay/opStore'
import type { EncounterLifecycleTriggerHandler } from '~~/server/domain/moveAutomation/reduceLifecycle'
import {
  SheetRevisionConflictError,
  type PersistedSheet,
} from '~~/server/storage/sheetRepository'
import { executeLivePlayInitiativeCommandUseCase } from '~~/server/useCases/applyLivePlayInitiativeCommand'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import { applyLivePlayPatchesToMap } from '~/utils/livePlayPatches'
import type { ActiveOrderEffect } from '~/utils/activeOrderEffects'
import type { TabletopMap } from '~/types/map'

const pokemonInitiativeSheet = (
  slug: string,
  speed: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  slug,
  nickname: slug,
  species: '',
  level: 1,
  stats: { spd: { base: speed } },
  combat: { conditions: [] },
  ...overrides,
})

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const initiativeScope = { kind: 'map' as const, lane: 'initiative' as const }
const metadataScope = { kind: 'map' as const, lane: 'metadata' as const }

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 4,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 6, y: 3, z: 6 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    {
      id: 'fast-token',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      initiative: 20,
    },
    {
      id: 'slow-token',
      sheetKind: 'trainer',
      sheetSlug: 'brock',
      position: { x: 2, y: 0, z: 2 },
      initiative: 10,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {},
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const threeCombatantMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => baseMap({
  placements: [
    { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'a', position: { x: 1, y: 0, z: 1 }, initiative: 30 },
    { id: 'token-b', sheetKind: 'pokemon', sheetSlug: 'b', position: { x: 2, y: 0, z: 1 }, initiative: 20 },
    { id: 'token-c', sheetKind: 'pokemon', sheetSlug: 'c', position: { x: 3, y: 0, z: 1 }, initiative: 10 },
  ],
  initiative: { activeId: 'token-c', round: 1, manualOrderIds: ['token-c', 'token-a', 'token-b'] },
  ...overrides,
})

const setInitiativeCommand = (
  overrides: Partial<SetInitiativeLivePlayCommand> = {},
): SetInitiativeLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_setinit001',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
  scopes: [initiativeScope],
  payload: { tokenId: 'slow-token', initiative: 25 },
  ...overrides,
})

const nextInitiativeCommand = (
  overrides: Partial<NextInitiativeLivePlayCommand> = {},
): NextInitiativeLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_nextinit01',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
  scopes: [initiativeScope, metadataScope],
  payload: { orderIds: ['fast-token', 'slow-token'], activeId: 'fast-token', round: 1 },
  ...overrides,
})

const previousInitiativeCommand = (
  overrides: Partial<PreviousInitiativeLivePlayCommand> = {},
): PreviousInitiativeLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_previnit01',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
  scopes: [initiativeScope, metadataScope],
  payload: { orderIds: ['fast-token', 'slow-token'], activeId: 'fast-token', round: 1 },
  ...overrides,
})

const activeOrderEffect = (
  id: string,
  expiration: ActiveOrderEffect['expiration'],
  overrides: Partial<ActiveOrderEffect> = {},
): ActiveOrderEffect => ({
  id,
  orderName: id,
  userId: 'trainer-token',
  userName: 'Trainer',
  targetId: 'slow-token',
  targetName: 'Slowpoke',
  startedRound: 1,
  startedActiveId: 'fast-token',
  expiration,
  ...overrides,
})

const initiativeEncounterEffect = (input: {
  readonly id: string
  readonly sourcePlacementId: string
  readonly affectedPlacementIds: readonly string[]
  readonly duration: EncounterEffectDuration
  readonly initiativeModifier?: number
}): EncounterEffect => parseEncounterEffect({
  id: input.id,
  kind: 'numeric-modifier',
  source: {
    operationId: `operation.${input.id}`,
    moveId: `move.${input.id}`,
    placementId: input.sourcePlacementId,
  },
  affected: {
    placementIds: [...input.affectedPlacementIds],
    sideIds: [],
    cells: [],
  },
  createdRound: 1,
  createdTurn: 0,
  duration: input.duration,
  stacks: 1,
  charges: null,
  stackPolicy: { kind: 'replace', maxStacks: null },
  chargePolicy: { kind: 'none', amount: null },
  tags: ['initiative-test'],
  payload: {
    attribute: input.initiativeModifier === undefined ? 'damage' : 'initiative',
    operation: 'add',
    value: input.initiativeModifier ?? 1,
    rounding: 'none',
  },
  dispel: { policy: 'none', tags: [] },
  suppression: { sources: [] },
})

const encounterStateWithEffects = (
  effects: readonly EncounterEffect[],
): EncounterState => ({
  ...createEmptyEncounterState(),
  effects,
})

const lifecyclePokemonSheet = (
  slug: string,
  species: string,
  currentHp: number,
): PersistedSheet => ({
  kind: 'pokemon',
  slug,
  revision: 3,
  updatedAt: 1_000,
  sheet: {
    slug,
    nickname: species,
    species,
    level: 20,
    revision: 3,
    updatedAt: 1_000,
    movelist: [],
    combat: { currentHp, injuries: 0, conditions: [] },
  },
})

const lifecycleCoreHandler = (input: {
  readonly damageEffectId: string
  readonly healEffectId: string
}): EncounterLifecycleTriggerHandler => ({
  id: 'handler.initiative-core-test',
  resolve: ({ event }) => {
    if (event.kind !== 'turn-end' || event.placementId !== 'actor-token') return []
    const damage: MoveDirectHpEffectOperation = {
      id: 'operation.lifecycle.damage',
      kind: 'direct-hp',
      source: { kind: 'encounter-effect', id: input.damageEffectId },
      recipients: { kind: 'selected-targets' },
      phase: 'cleanup',
      reasonCode: 'lifecycle.test-damage',
      payload: {
        mode: 'lose',
        pool: 'hit-points',
        amount: 10,
        minimumRemaining: null,
        applyTypeImmunity: false,
      },
    }
    const heal: MoveHealEffectOperation = {
      id: 'operation.lifecycle.heal',
      kind: 'heal',
      source: { kind: 'encounter-effect', id: input.healEffectId },
      recipients: { kind: 'selected-targets' },
      phase: 'cleanup',
      reasonCode: 'lifecycle.test-heal',
      payload: {
        mode: 'fixed',
        pool: 'hit-points',
        amount: 5,
        rounding: 'floor',
      },
    }
    return [
      {
        effectId: input.damageEffectId,
        reasonCode: 'lifecycle.test-damage-trigger',
        operations: [damage],
        emittedEvents: [],
      },
      {
        effectId: input.healEffectId,
        reasonCode: 'lifecycle.test-heal-trigger',
        operations: [heal],
        emittedEvents: [],
      },
    ]
  },
})

const createHarness = (
  initialMap: TabletopMap = baseMap(),
  options: {
    readonly opStore?: LivePlayOpStore
    readonly transactional?: boolean
    readonly sheets?: readonly PersistedSheet[]
    readonly lifecycleHandlers?: readonly EncounterLifecycleTriggerHandler[]
  } = {},
) => {
  let storedMap = initialMap
  let storedSheets = new Map((options.sheets ?? []).map(sheet => [
    `${sheet.kind}:${sheet.slug}`,
    cloneJson(sheet),
  ]))
  const writes: TabletopMap[] = []
  const published: unknown[] = []
  const opStore = options.opStore ?? createInMemoryLivePlayOpStore()
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore,
    queue: createInProcessMapWriteQueue(),
    ...acceptedRealtimeTestHooks(published),
  })
  const mapRepository = {
    getBySlug: vi.fn((slug: string) => (slug === 'arena' ? storedMap : null)),
    applyLivePlayUpdate: vi.fn((input: { slug: string; expectedRevision: number; nextMap: TabletopMap }) => {
      if (input.slug !== 'arena' || input.expectedRevision !== storedMap.revision) return 'stale' as const
      storedMap = {
        ...input.nextMap,
        revision: input.expectedRevision + 1,
      }
      writes.push(storedMap)
      return 'applied' as const
    }),
  }
  const sheetRepository = {
    get: vi.fn((kind: 'pokemon' | 'trainer', slug: string) => {
      const stored = storedSheets.get(`${kind}:${slug}`)
      return stored
        ? {
            kind: stored.kind,
            slug: stored.slug,
            document: cloneJson(stored.sheet),
            revision: stored.revision,
            updatedAt: stored.updatedAt,
          }
        : null
    }),
    getByRef: vi.fn((kind: 'pokemon' | 'trainer', slug: string) => {
      const stored = storedSheets.get(`${kind}:${slug}`)
      return stored ? cloneJson(stored) : null
    }),
    assertRevisions: vi.fn((reads: readonly { kind: 'pokemon' | 'trainer'; slug: string; revision: number }[]) => {
      const mismatches = reads.flatMap((read) => {
        const current = storedSheets.get(`${read.kind}:${read.slug}`)
        return current?.revision === read.revision ? [] : [{
          kind: read.kind,
          slug: read.slug,
          expectedRevision: read.revision,
          currentRevision: current?.revision ?? null,
        }]
      })
      if (mismatches.length > 0) throw new SheetRevisionConflictError(mismatches)
    }),
    applyLivePlayUpdate: vi.fn((input: {
      kind: 'pokemon' | 'trainer'
      slug: string
      expectedRevision: number
      nextSheet: Record<string, unknown>
    }) => {
      const key = `${input.kind}:${input.slug}`
      const current = storedSheets.get(key)
      if (!current || current.revision !== input.expectedRevision) return 'stale' as const
      const revision = input.expectedRevision + 1
      const updatedAt = Number(input.nextSheet.updatedAt)
      storedSheets.set(key, {
        kind: input.kind,
        slug: input.slug,
        revision,
        updatedAt,
        sheet: {
          ...cloneJson(input.nextSheet),
          slug: input.slug,
          revision,
          updatedAt,
        },
      })
      return 'applied' as const
    }),
  }
  const database = {
    withTransaction: <T>(work: () => T) => {
      const before = storedMap
      const sheetsBefore = new Map([...storedSheets].map(([key, sheet]) => [key, cloneJson(sheet)]))
      try {
        return work()
      } catch (error) {
        if (options.transactional) {
          storedMap = before
          storedSheets = sheetsBefore
        }
        throw error
      }
    },
  }
  const deps = {
    commandExecutor: executor,
    mapRepository,
    database,
    sheetRepository,
    readSheet: vi.fn((_kind: 'pokemon' | 'trainer', _slug: string): { path: string; sheet: Record<string, unknown> } | null => null),
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => 2_000),
    lifecycleHandlers: options.lifecycleHandlers ?? [],
  }

  return {
    deps,
    writes,
    published,
    opStore,
    get storedMap() {
      return storedMap
    },
    sheet(kind: 'pokemon' | 'trainer', slug: string) {
      const stored = storedSheets.get(`${kind}:${slug}`)
      return stored ? cloneJson(stored) : null
    },
  }
}

const execute = (harness: ReturnType<typeof createHarness>, command: LivePlayInitiativeCommand, role: 'gm' | 'player' = 'gm') =>
  executeLivePlayInitiativeCommandUseCase({
    role,
    command,
    clientId: `${role}-client`,
    expectedType: command.type,
  }, harness.deps)

describe('live-play initiative commands', () => {
  it('sets token initiative through the authoritative executor and returns previous/current lane patches', async () => {
    const harness = createHarness()

    const response = await execute(harness, setInitiativeCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.revision).toBe(5)
    expect(harness.storedMap.placements.find((placement) => placement.id === 'slow-token')).toMatchObject({
      initiative: 25,
    })
    expect(response.initiative).toEqual({
      activeId: null,
      round: 1,
      entries: [
        { tokenId: 'fast-token', initiative: 20 },
        { tokenId: 'slow-token', initiative: 25 },
      ],
    })
    expect(response.result.ok && !('duplicate' in response.result) ? response.result.patches : []).toEqual([
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE,
        revision: 5,
        scopes: [{ kind: 'map', lane: 'initiative' }],
        payload: {
          command: LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
          previous: {
            activeId: null,
            round: 1,
            entries: [
              { tokenId: 'fast-token', initiative: 20 },
              { tokenId: 'slow-token', initiative: 10 },
            ],
          },
          current: {
            activeId: null,
            round: 1,
            entries: [
              { tokenId: 'fast-token', initiative: 20 },
              { tokenId: 'slow-token', initiative: 25 },
            ],
          },
          changedTokenIds: ['slow-token'],
        },
      }),
    ])
    expect(harness.published).toEqual([
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', opId: 'op_setinit001', revision: 5 }),
    ])
  })

  it('persists manual initiative order through setInitiative and publishes it in lane patches', async () => {
    const harness = createHarness()

    const response = await execute(harness, setInitiativeCommand({
      opId: 'op_manualord1',
      payload: { manualOrderIds: ['slow-token', 'fast-token'] },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({
      activeId: null,
      round: 1,
      manualOrderIds: ['slow-token', 'fast-token'],
    })
    expect(response.initiative).toEqual({
      activeId: null,
      round: 1,
      entries: [
        { tokenId: 'fast-token', initiative: 20 },
        { tokenId: 'slow-token', initiative: 10 },
      ],
      manualOrderIds: ['slow-token', 'fast-token'],
    })
    expect(response.result.ok && !('duplicate' in response.result) ? response.result.patches[0]?.payload : {}).toMatchObject({
      command: LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
      previous: expect.not.objectContaining({ manualOrderIds: expect.anything() }),
      current: expect.objectContaining({ manualOrderIds: ['slow-token', 'fast-token'] }),
      changedTokenIds: [],
    })
  })

  it('advances next initiative according to manual order instead of calculated score order', async () => {
    const manualOrderIds = ['token-c', 'token-a', 'token-b']
    const initialMap = threeCombatantMap({
      initiative: { activeId: 'token-c', round: 1, manualOrderIds },
    })
    const harness = createHarness(cloneJson(initialMap))

    const response = await execute(harness, nextInitiativeCommand({
      opId: 'op_nextmanual',
      payload: { orderIds: manualOrderIds, activeId: 'token-c', round: 1 },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({
      activeId: 'token-a',
      round: 1,
      manualOrderIds,
    })

    const patches = response.result.ok && !('duplicate' in response.result) ? response.result.patches : []
    const remote = cloneJson(initialMap)
    const applied = applyLivePlayPatchesToMap({
      map: remote,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches,
    })

    expect(applied).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(remote.initiative).toEqual({
      activeId: 'token-a',
      round: 1,
      manualOrderIds,
    })
  })

  it('advances previous initiative according to manual order instead of calculated score order', async () => {
    const manualOrderIds = ['token-c', 'token-a', 'token-b']
    const harness = createHarness(threeCombatantMap({
      initiative: { activeId: 'token-c', round: 2, manualOrderIds },
    }))

    const response = await execute(harness, previousInitiativeCommand({
      opId: 'op_prevmanual',
      payload: { orderIds: manualOrderIds, activeId: 'token-c', round: 2 },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({
      activeId: 'token-b',
      round: 1,
      manualOrderIds,
    })
  })

  it('rejects manual initiative orders with unknown placement ids', async () => {
    const harness = createHarness()

    const response = await execute(harness, setInitiativeCommand({
      opId: 'op_badmanual1',
      payload: { manualOrderIds: ['slow-token', 'missing-token'] },
    }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'not-found',
      currentRevision: 4,
    })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.initiative).toEqual({ activeId: null, round: 1 })
  })

  it('rejects partial manual initiative orders so stale visible orders cannot persist', async () => {
    const harness = createHarness(threeCombatantMap({ initiative: { activeId: null, round: 1 } }))

    const response = await execute(harness, setInitiativeCommand({
      opId: 'op_badmanual2',
      payload: { manualOrderIds: ['token-c', 'token-a'] },
    }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      currentRevision: 4,
    })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.initiative).toEqual({ activeId: null, round: 1 })
  })

  it('clears manual initiative order and returns advancement to calculated order', async () => {
    const manualOrderIds = ['token-c', 'token-a', 'token-b']
    const harness = createHarness(threeCombatantMap({
      initiative: { activeId: 'token-c', round: 1, manualOrderIds },
    }))

    const clearResponse = await execute(harness, setInitiativeCommand({
      opId: 'op_clearman1',
      payload: { manualOrderIds: null },
    }))

    expect(clearResponse.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'token-c', round: 1 })
    expect(clearResponse.result.ok && !('duplicate' in clearResponse.result) ? clearResponse.result.patches[0]?.payload : {}).toMatchObject({
      command: LIVE_PLAY_COMMAND_TYPES.SET_INITIATIVE,
      previous: expect.objectContaining({ manualOrderIds }),
      current: expect.not.objectContaining({ manualOrderIds: expect.anything() }),
    })

    const nextResponse = await execute(harness, nextInitiativeCommand({
      opId: 'op_nextcalc2',
      baseRevision: 5,
      payload: { orderIds: ['token-a', 'token-b', 'token-c'], activeId: 'token-c', round: 1 },
    }))

    expect(nextResponse.result).toMatchObject({ ok: true, previousRevision: 5, revision: 6 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'token-a', round: 2 })
  })

  it('advances initiative to the next token and records an initiative log entry', async () => {
    const harness = createHarness(baseMap({ initiative: { activeId: 'fast-token', round: 1 } }))

    const response = await execute(harness, nextInitiativeCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'slow-token', round: 1 })
    expect(harness.storedMap.metadata?.initiativeLog).toEqual([
      {
        at: 2_000,
        userId: 'slow-token',
        userName: 'brock',
        actionName: 'Initiative',
        lines: ['brock has gained initiative!'],
      },
    ])
    expect(response.result.ok && !('duplicate' in response.result) ? response.result.patches[0]?.payload : {}).toMatchObject({
      command: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      previous: expect.objectContaining({ activeId: 'fast-token', round: 1 }),
      current: expect.objectContaining({ activeId: 'slow-token', round: 1 }),
      logEntry: expect.objectContaining({ userId: 'slow-token' }),
    })
  })

  it('applies next-initiative AoO clearing and Order side effects atomically with metadata patches', async () => {
    const expiringOrder = activeOrderEffect('order-expire', {
      kind: 'turn-start',
      tokenId: 'slow-token',
      tokenName: 'Slowpoke',
      description: 'until Slowpoke starts a turn',
    })
    const progressingOrder = activeOrderEffect('order-progress', {
      kind: 'turn-end',
      tokenId: 'slow-token',
      tokenName: 'Slowpoke',
      description: 'until Slowpoke ends a turn',
    })
    const initialMap = baseMap({
      initiative: { activeId: 'fast-token', round: 1 },
      metadata: writeAttackOfOpportunityState({
        activeOrderEffects: [expiringOrder, progressingOrder],
        custom: 'keep',
      }, {
        schemaVersion: 1,
        prompts: [
          {
            id: 'aao-one',
            attackerId: 'fast-token',
            attackerName: 'Fast',
            provokerId: 'slow-token',
            provokerName: 'Slow',
            reason: 'movement',
            round: 1,
          },
          {
            id: 'aao-two',
            attackerId: 'slow-token',
            attackerName: 'Slow',
            provokerId: 'fast-token',
            provokerName: 'Fast',
            reason: 'ranged-attack',
            round: 1,
          },
        ],
        usedRoundByAttackerId: { 'fast-token': 1 },
      }),
    })
    const harness = createHarness(cloneJson(initialMap))

    const response = await execute(harness, nextInitiativeCommand({ opId: 'op_nextmeta01' }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'slow-token', round: 1 })
    expect(readAttackOfOpportunityState(harness.storedMap.metadata)).toMatchObject({
      prompts: [],
      usedRoundByAttackerId: { 'fast-token': 1 },
    })
    expect(harness.storedMap.metadata?.activeOrderEffects).toEqual([
      expect.objectContaining({
        id: 'order-progress',
        expiration: expect.objectContaining({ kind: 'turn-end', seenTurnStart: true }),
      }),
    ])
    expect(harness.storedMap.metadata?.orderLog).toEqual([
      {
        at: 2_000,
        userId: 'trainer-token',
        userName: 'Trainer',
        orderName: 'order-expire',
        lines: ['order-expire on Slowpoke wore off.'],
      },
    ])

    const patches = response.result.ok && !('duplicate' in response.result) ? response.result.patches : []
    expect(patches.map((patch) => patch.type)).toEqual([
      LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE,
      LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
    ])
    expect(patches.every((patch) => patch.revision === 5)).toBe(true)
    expect(patches[1]).toMatchObject({
      type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
      scopes: [metadataScope],
      payload: {
        command: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
        clearedAttackOfOpportunityPromptIds: ['aao-one', 'aao-two'],
        expiredOrderEffectIds: ['order-expire'],
        progressedOrderEffectIds: ['order-progress'],
        previous: initialMap.metadata,
        current: harness.storedMap.metadata,
      },
    })

    const remote = cloneJson(initialMap)
    const applied = applyLivePlayPatchesToMap({
      map: remote,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches,
    })
    expect(applied).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(remote.initiative).toEqual(response.map?.initiative)
    expect(remote.metadata).toEqual(response.map?.metadata)

    const remoteReversed = cloneJson(initialMap)
    const reversed = applyLivePlayPatchesToMap({
      map: remoteReversed,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches: [...patches].reverse(),
    })
    expect(reversed).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(remoteReversed.initiative).toEqual(response.map?.initiative)
    expect(remoteReversed.metadata).toEqual(response.map?.metadata)

    const duplicate = applyLivePlayPatchesToMap({
      map: remote,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches,
    })
    expect(duplicate).toMatchObject({ ok: true, applied: false, reason: 'stale-revision' })
    expect(remote.metadata).toEqual(response.map?.metadata)
  })

  it('omits metadata patches when next initiative has no AoO or Order side effects', async () => {
    const harness = createHarness(baseMap({ initiative: { activeId: 'fast-token', round: 1 } }))

    const response = await execute(harness, nextInitiativeCommand({ opId: 'op_nextnometa' }))

    const patches = response.result.ok && !('duplicate' in response.result) ? response.result.patches : []
    expect(patches.map((patch) => patch.type)).toEqual([LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE])
    expect(harness.storedMap.metadata?.initiativeLog).toHaveLength(1)
  })

  it('rejects next and previous initiative commands without required metadata scopes', async () => {
    const nextHarness = createHarness(baseMap({ initiative: { activeId: 'fast-token', round: 1 } }))
    const nextResponse = await execute(nextHarness, nextInitiativeCommand({
      opId: 'op_missingmd1',
      scopes: [initiativeScope],
    }))

    expect(nextResponse.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: 'nextInitiative scopes must include the map metadata scope',
    })
    expect(nextHarness.writes).toEqual([])

    const previousHarness = createHarness(baseMap({ initiative: { activeId: 'fast-token', round: 1 } }))
    const previousResponse = await execute(previousHarness, previousInitiativeCommand({
      opId: 'op_missingmd2',
      scopes: [initiativeScope, metadataScope, { kind: 'map', lane: 'hazards' }],
    }))

    expect(previousResponse.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: 'previousInitiative scopes include unsupported map hazards scope',
    })
    expect(previousHarness.writes).toEqual([])
  })

  it('rejects NEXT_INITIATIVE when the submitted visible order is stale', async () => {
    const harness = createHarness(baseMap({
      placements: [
        { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'a', position: { x: 1, y: 0, z: 1 } },
        { id: 'token-b', sheetKind: 'pokemon', sheetSlug: 'b', position: { x: 2, y: 0, z: 1 } },
        { id: 'token-c', sheetKind: 'pokemon', sheetSlug: 'c', position: { x: 3, y: 0, z: 1 } },
      ],
      initiative: { activeId: 'token-a', round: 1 },
    }))
    harness.deps.readSheet.mockImplementation((_kind, slug) => ({
      path: `/tmp/${slug}.json`,
      sheet: pokemonInitiativeSheet(slug, slug === 'a' ? 30 : slug === 'c' ? 20 : 10),
    }))

    const response = await execute(harness, nextInitiativeCommand({
      opId: 'op_staleordn1',
      payload: { orderIds: ['token-a', 'token-b', 'token-c'], activeId: 'token-a', round: 1 },
    }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 4,
    })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'token-a', round: 1 })
    expect(harness.storedMap.metadata?.initiativeLog).toBeUndefined()
    expect(harness.writes).toEqual([])
    expect(harness.published).toEqual([])
  })

  it('rejects PREVIOUS_INITIATIVE when the submitted visible order is stale', async () => {
    const harness = createHarness(baseMap({
      placements: [
        { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'a', position: { x: 1, y: 0, z: 1 } },
        { id: 'token-b', sheetKind: 'pokemon', sheetSlug: 'b', position: { x: 2, y: 0, z: 1 } },
        { id: 'token-c', sheetKind: 'pokemon', sheetSlug: 'c', position: { x: 3, y: 0, z: 1 } },
      ],
      initiative: { activeId: 'token-a', round: 1 },
    }))
    harness.deps.readSheet.mockImplementation((_kind, slug) => ({
      path: `/tmp/${slug}.json`,
      sheet: pokemonInitiativeSheet(slug, slug === 'a' ? 30 : slug === 'c' ? 20 : 10),
    }))

    const response = await execute(harness, previousInitiativeCommand({
      opId: 'op_staleordp1',
      payload: { orderIds: ['token-a', 'token-b', 'token-c'], activeId: 'token-a', round: 1 },
    }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 4,
    })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'token-a', round: 1 })
    expect(harness.storedMap.metadata?.initiativeLog).toBeUndefined()
    expect(harness.writes).toEqual([])
    expect(harness.published).toEqual([])
  })

  it('rejects initiative advance when the visible order omits a server fallback participant', async () => {
    const harness = createHarness(baseMap({
      placements: [
        { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'a', position: { x: 1, y: 0, z: 1 }, initiative: 30 },
        { id: 'token-b', sheetKind: 'pokemon', sheetSlug: 'missing', position: { x: 2, y: 0, z: 1 }, initiative: 20 },
        { id: 'token-c', sheetKind: 'pokemon', sheetSlug: 'c', position: { x: 3, y: 0, z: 1 }, initiative: 10 },
      ],
      initiative: { activeId: 'token-a', round: 1 },
    }))

    const response = await execute(harness, nextInitiativeCommand({
      opId: 'op_hiddenfb1',
      payload: { orderIds: ['token-a', 'token-c'], activeId: 'token-a', round: 1 },
    }))

    expect(response.result).toMatchObject({ ok: false, reason: 'stale-revision', currentRevision: 4 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'token-a', round: 1 })
    expect(harness.writes).toEqual([])
    expect(harness.published).toEqual([])
  })

  it('advances to a server fallback participant when that participant is included in the visible order', async () => {
    const harness = createHarness(baseMap({
      placements: [
        { id: 'token-a', sheetKind: 'pokemon', sheetSlug: 'a', position: { x: 1, y: 0, z: 1 }, initiative: 30 },
        { id: 'token-b', sheetKind: 'pokemon', sheetSlug: 'missing', position: { x: 2, y: 0, z: 1 }, initiative: 20 },
        { id: 'token-c', sheetKind: 'pokemon', sheetSlug: 'c', position: { x: 3, y: 0, z: 1 }, initiative: 10 },
      ],
      initiative: { activeId: 'token-a', round: 1 },
    }))

    const response = await execute(harness, nextInitiativeCommand({
      opId: 'op_visiblefb1',
      payload: { orderIds: ['token-a', 'token-b', 'token-c'], activeId: 'token-a', round: 1 },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'token-b', round: 1 })
  })

  it('increments the round when NEXT_INITIATIVE advances from the final visible combatant', async () => {
    const harness = createHarness(baseMap({ initiative: { activeId: 'slow-token', round: 1 } }))

    const response = await execute(harness, nextInitiativeCommand({
      opId: 'op_nextround01',
      payload: { orderIds: ['fast-token', 'slow-token'], activeId: 'slow-token', round: 1 },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'fast-token', round: 2 })
  })

  it('emits ordered turn and round lifecycle boundaries and expires every matching effect', async () => {
    const effects = [
      initiativeEncounterEffect({
        id: 'effect.turn-end',
        sourcePlacementId: 'slow-token',
        affectedPlacementIds: ['slow-token'],
        duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
      }),
      initiativeEncounterEffect({
        id: 'effect.round-end',
        sourcePlacementId: 'fast-token',
        affectedPlacementIds: ['fast-token'],
        duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
      }),
      initiativeEncounterEffect({
        id: 'effect.round-start',
        sourcePlacementId: 'fast-token',
        affectedPlacementIds: ['fast-token'],
        duration: { kind: 'rounds', boundary: 'start', remaining: 1 },
      }),
      initiativeEncounterEffect({
        id: 'effect.turn-start',
        sourcePlacementId: 'fast-token',
        affectedPlacementIds: ['fast-token'],
        duration: { kind: 'turns', subject: 'source', boundary: 'start', remaining: 1 },
      }),
    ]
    const initialMap = baseMap({
      initiative: { activeId: 'slow-token', round: 1 },
      encounterState: encounterStateWithEffects(effects),
    })
    const harness = createHarness(cloneJson(initialMap))

    const response = await execute(harness, nextInitiativeCommand({
      opId: 'op_lifebounds1',
      payload: { orderIds: ['fast-token', 'slow-token'], activeId: 'slow-token', round: 1 },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'fast-token', round: 2 })
    expect(harness.storedMap.encounterState?.effects).toEqual([])
    expect(harness.storedMap.encounterState?.turnResources['fast-token']).toMatchObject({
      round: 2,
      turn: 2,
      actions: { standard: { spent: 0 } },
      reaction: { available: true },
      movement: { spent: 0 },
    })
    const patches = response.result.ok && !('duplicate' in response.result)
      ? response.result.patches
      : []
    const initiativePatch = patches.find(patch => patch.type === LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE)
    expect((initiativePatch?.payload as { lifecycle?: { events?: Array<{ kind: EncounterEventKind }> } }).lifecycle?.events?.map(event => event.kind)).toEqual([
      'turn-end',
      'round-end',
      'round-start',
      'turn-start',
    ])
    expect((initiativePatch?.payload as { lifecycle?: { effectTransitions?: unknown[] } }).lifecycle?.effectTransitions).toHaveLength(4)

    const remote = cloneJson(initialMap)
    expect(applyLivePlayPatchesToMap({
      map: remote,
      mapSlug: 'arena',
      previousRevision: 4,
      revision: 5,
      patches,
    })).toMatchObject({ ok: true, applied: true, revision: 5 })
    expect(remote.encounterState).toEqual(harness.storedMap.encounterState)
  })

  it('applies due lifecycle damage, healing, expiry, sheets, and the op result atomically once', async () => {
    const damageEffect = initiativeEncounterEffect({
      id: 'effect.due-damage',
      sourcePlacementId: 'actor-token',
      affectedPlacementIds: ['target-token'],
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    })
    const healEffect = initiativeEncounterEffect({
      id: 'effect.due-heal',
      sourcePlacementId: 'actor-token',
      affectedPlacementIds: ['actor-token'],
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    })
    const initialMap = baseMap({
      placements: [
        { id: 'actor-token', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 }, initiative: 20 },
        { id: 'target-token', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 }, initiative: 10 },
      ],
      initiative: { activeId: 'actor-token', round: 1 },
      encounterState: encounterStateWithEffects([damageEffect, healEffect]),
    })
    const handler = lifecycleCoreHandler({
      damageEffectId: damageEffect.id,
      healEffectId: healEffect.id,
    })
    const harness = createHarness(cloneJson(initialMap), {
      transactional: true,
      lifecycleHandlers: [handler],
      sheets: [
        lifecyclePokemonSheet('actor', 'Pikachu', 20),
        lifecyclePokemonSheet('target', 'Eevee', 40),
      ],
    })
    const command = nextInitiativeCommand({
      opId: 'op_lifecore01',
      payload: {
        orderIds: ['actor-token', 'target-token'],
        activeId: 'actor-token',
        round: 1,
      },
    })

    const first = await execute(harness, command)
    const duplicate = await execute(harness, command)

    expect(first.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(duplicate.result).toEqual(first.result)
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.initiative).toEqual({ activeId: 'target-token', round: 1 })
    expect(harness.storedMap.encounterState?.effects).toEqual([])
    expect((harness.sheet('pokemon', 'actor')?.sheet.combat as { currentHp: number }).currentHp).toBe(25)
    expect((harness.sheet('pokemon', 'target')?.sheet.combat as { currentHp: number }).currentHp).toBe(30)
    expect(harness.sheet('pokemon', 'actor')?.revision).toBe(4)
    expect(harness.sheet('pokemon', 'target')?.revision).toBe(4)
    expect(first.sheetUpdates?.map(update => `${update.kind}:${update.slug}`)).toEqual([
      'pokemon:target',
      'pokemon:actor',
    ])

    const patches = first.result.ok && !('duplicate' in first.result)
      ? first.result.patches
      : []
    const initiativePatch = patches.find(patch => patch.type === LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE)
    expect(initiativePatch?.payload).toMatchObject({
      lifecycle: {
        operationIds: ['operation.lifecycle.damage', 'operation.lifecycle.heal'],
        sheetChanges: [
          expect.objectContaining({ slug: 'target', expectedRevision: 3, revision: 4 }),
          expect.objectContaining({ slug: 'actor', expectedRevision: 3, revision: 4 }),
        ],
      },
    })
  })

  it('rolls back due lifecycle map and sheet work when the terminal op result cannot persist', async () => {
    const damageEffect = initiativeEncounterEffect({
      id: 'effect.rollback-damage',
      sourcePlacementId: 'actor-token',
      affectedPlacementIds: ['target-token'],
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    })
    const healEffect = initiativeEncounterEffect({
      id: 'effect.rollback-heal',
      sourcePlacementId: 'actor-token',
      affectedPlacementIds: ['actor-token'],
      duration: { kind: 'turns', subject: 'source', boundary: 'end', remaining: 1 },
    })
    const initialMap = baseMap({
      placements: [
        { id: 'actor-token', sheetKind: 'pokemon', sheetSlug: 'actor', position: { x: 1, y: 0, z: 1 }, initiative: 20 },
        { id: 'target-token', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 1 }, initiative: 10 },
      ],
      initiative: { activeId: 'actor-token', round: 1 },
      encounterState: encounterStateWithEffects([damageEffect, healEffect]),
    })
    const failingOpStore: LivePlayOpStore = {
      getOpRecord: vi.fn(() => null),
      getOpResult: vi.fn(() => null),
      saveOpResult: vi.fn(() => {
        throw new Error('op history unavailable')
      }),
    }
    const harness = createHarness(cloneJson(initialMap), {
      opStore: failingOpStore,
      transactional: true,
      lifecycleHandlers: [lifecycleCoreHandler({
        damageEffectId: damageEffect.id,
        healEffectId: healEffect.id,
      })],
      sheets: [
        lifecyclePokemonSheet('actor', 'Pikachu', 20),
        lifecyclePokemonSheet('target', 'Eevee', 40),
      ],
    })

    const response = await execute(harness, nextInitiativeCommand({
      opId: 'op_liferoll01',
      payload: {
        orderIds: ['actor-token', 'target-token'],
        activeId: 'actor-token',
        round: 1,
      },
    }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'persistence-failed',
      currentRevision: 4,
    })
    expect(harness.storedMap).toEqual(initialMap)
    expect((harness.sheet('pokemon', 'actor')?.sheet.combat as { currentHp: number }).currentHp).toBe(20)
    expect((harness.sheet('pokemon', 'target')?.sheet.combat as { currentHp: number }).currentHp).toBe(40)
    expect(harness.published).toEqual([])
  })

  it('queries encounter initiative modifiers only for calculated order and preserves manual order', async () => {
    const modifier = initiativeEncounterEffect({
      id: 'effect.slow-first',
      sourcePlacementId: 'slow-token',
      affectedPlacementIds: ['slow-token'],
      duration: { kind: 'permanent', remaining: null },
      initiativeModifier: 20,
    })
    const calculatedHarness = createHarness(baseMap({
      initiative: { activeId: 'fast-token', round: 1 },
      encounterState: encounterStateWithEffects([modifier]),
    }))

    const calculated = await execute(calculatedHarness, nextInitiativeCommand({
      opId: 'op_calcmodify1',
      payload: {
        orderIds: ['slow-token', 'fast-token'],
        activeId: 'fast-token',
        round: 1,
      },
    }))

    expect(calculated.result).toMatchObject({ ok: true })
    expect(calculatedHarness.storedMap.initiative).toEqual({ activeId: 'slow-token', round: 2 })

    const manualOrderIds = ['fast-token', 'slow-token']
    const manualHarness = createHarness(baseMap({
      initiative: { activeId: 'fast-token', round: 1, manualOrderIds },
      encounterState: encounterStateWithEffects([modifier]),
    }))
    const manual = await execute(manualHarness, nextInitiativeCommand({
      opId: 'op_manualmod1',
      payload: { orderIds: manualOrderIds, activeId: 'fast-token', round: 1 },
    }))

    expect(manual.result).toMatchObject({ ok: true })
    expect(manualHarness.storedMap.initiative).toEqual({
      activeId: 'slow-token',
      round: 1,
      manualOrderIds,
    })
    expect(manualHarness.deps.readSheet).not.toHaveBeenCalled()
  })

  it('uses condition-adjusted Speed-derived effective order for live-play NEXT_INITIATIVE', async () => {
    const harness = createHarness(baseMap({
      placements: [
        {
          id: 'token-alpha',
          sheetKind: 'pokemon',
          sheetSlug: 'alpha',
          position: { x: 1, y: 0, z: 1 },
        },
        {
          id: 'token-bravo',
          sheetKind: 'pokemon',
          sheetSlug: 'bravo',
          position: { x: 2, y: 0, z: 1 },
        },
        {
          id: 'token-zulu',
          sheetKind: 'pokemon',
          sheetSlug: 'zulu',
          position: { x: 3, y: 0, z: 1 },
        },
      ],
      initiative: { activeId: 'token-alpha', round: 1 },
    }))
    harness.deps.readSheet.mockImplementation((_kind, slug) => ({
      path: `/tmp/${slug}.json`,
      sheet: slug === 'alpha'
        ? pokemonInitiativeSheet(slug, 30, { combat: { conditions: ['Paralysis'] } })
        : pokemonInitiativeSheet(slug, slug === 'bravo' ? 20 : 10),
    }))

    const response = await execute(harness, nextInitiativeCommand({
      payload: { orderIds: ['token-bravo', 'token-alpha', 'token-zulu'], activeId: 'token-alpha', round: 1 },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'token-zulu', round: 1 })
    expect(response.result.ok && !('duplicate' in response.result) ? response.result.patches[0]?.payload : {}).toMatchObject({
      command: LIVE_PLAY_COMMAND_TYPES.NEXT_INITIATIVE,
      previous: expect.objectContaining({ activeId: 'token-alpha', round: 1 }),
      current: expect.objectContaining({ activeId: 'token-zulu', round: 1 }),
    })
  })

  it('uses the same effective order for live-play PREVIOUS_INITIATIVE', async () => {
    const harness = createHarness(baseMap({
      placements: [
        {
          id: 'token-alpha',
          sheetKind: 'pokemon',
          sheetSlug: 'alpha',
          position: { x: 1, y: 0, z: 1 },
        },
        {
          id: 'token-bravo',
          sheetKind: 'pokemon',
          sheetSlug: 'bravo',
          position: { x: 2, y: 0, z: 1 },
        },
        {
          id: 'token-zulu',
          sheetKind: 'pokemon',
          sheetSlug: 'zulu',
          position: { x: 3, y: 0, z: 1 },
        },
      ],
      initiative: { activeId: 'token-alpha', round: 2 },
    }))
    harness.deps.readSheet.mockImplementation((_kind, slug) => ({
      path: `/tmp/${slug}.json`,
      sheet: slug === 'alpha'
        ? pokemonInitiativeSheet(slug, 30, { combat: { conditions: ['Paralysis'] } })
        : pokemonInitiativeSheet(slug, slug === 'bravo' ? 20 : 10),
    }))

    const response = await execute(harness, previousInitiativeCommand({
      payload: { orderIds: ['token-bravo', 'token-alpha', 'token-zulu'], activeId: 'token-alpha', round: 2 },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'token-bravo', round: 2 })
    expect(response.result.ok && !('duplicate' in response.result) ? response.result.patches[0]?.payload : {}).toMatchObject({
      command: LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
      previous: expect.objectContaining({ activeId: 'token-alpha', round: 2 }),
      current: expect.objectContaining({ activeId: 'token-bravo', round: 2 }),
    })
  })

  it('moves initiative to the previous token and clamps the round at one', async () => {
    const harness = createHarness(baseMap({ initiative: { activeId: 'fast-token', round: 1 } }))

    const response = await execute(harness, previousInitiativeCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'slow-token', round: 1 })
    expect(response.result.ok && !('duplicate' in response.result) ? response.result.patches[0]?.payload : {}).toMatchObject({
      command: LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
      previous: expect.objectContaining({ activeId: 'fast-token', round: 1 }),
      current: expect.objectContaining({ activeId: 'slow-token', round: 1 }),
    })
  })

  it('previous initiative clears AoO prompts while preserving active and expired Order metadata', async () => {
    const activeOrder = activeOrderEffect('order-still-active', {
      kind: 'turn-start',
      tokenId: 'slow-token',
      tokenName: 'Slowpoke',
      description: 'until Slowpoke starts a turn',
    })
    const orderLog = [{ at: 1_000, orderName: 'old-order', lines: ['old-order wore off.'] }]
    const initialMap = baseMap({
      initiative: { activeId: 'fast-token', round: 1 },
      metadata: writeAttackOfOpportunityState({
        activeOrderEffects: [activeOrder],
        orderLog,
      }, {
        schemaVersion: 1,
        prompts: [{
          id: 'aao-previous',
          attackerId: 'fast-token',
          attackerName: 'Fast',
          provokerId: 'slow-token',
          provokerName: 'Slow',
          reason: 'movement',
          round: 1,
        }],
        usedRoundByAttackerId: { 'slow-token': 1 },
      }),
    })
    const harness = createHarness(cloneJson(initialMap))

    const response = await execute(harness, previousInitiativeCommand({ opId: 'op_prevmeta01' }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.initiative).toEqual({ activeId: 'slow-token', round: 1 })
    expect(readAttackOfOpportunityState(harness.storedMap.metadata)).toMatchObject({
      prompts: [],
      usedRoundByAttackerId: { 'slow-token': 1 },
    })
    expect(harness.storedMap.metadata?.activeOrderEffects).toEqual([activeOrder])
    expect(harness.storedMap.metadata?.orderLog).toEqual(orderLog)

    const patches = response.result.ok && !('duplicate' in response.result) ? response.result.patches : []
    expect(patches.map((patch) => patch.type)).toEqual([
      LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE,
      LIVE_PLAY_PATCH_TYPES.MAP_METADATA,
    ])
    expect(patches[1]?.payload).toMatchObject({
      command: LIVE_PLAY_COMMAND_TYPES.PREVIOUS_INITIATIVE,
      clearedAttackOfOpportunityPromptIds: ['aao-previous'],
      expiredOrderEffectIds: [],
      progressedOrderEffectIds: [],
    })
  })

  it('setInitiative does not clear AoO prompts or expire active Orders', async () => {
    const activeOrder = activeOrderEffect('order-admin-preserved', {
      kind: 'turn-start',
      tokenId: 'slow-token',
      tokenName: 'Slowpoke',
      description: 'until Slowpoke starts a turn',
    })
    const initialMetadata = writeAttackOfOpportunityState({
      activeOrderEffects: [activeOrder],
    }, {
      schemaVersion: 1,
      prompts: [{
        id: 'aao-admin',
        attackerId: 'fast-token',
        attackerName: 'Fast',
        provokerId: 'slow-token',
        provokerName: 'Slow',
        reason: 'movement',
        round: 1,
      }],
      usedRoundByAttackerId: {},
    })
    const harness = createHarness(baseMap({ metadata: initialMetadata }))

    const response = await execute(harness, setInitiativeCommand({
      opId: 'op_setactive1',
      payload: { activeId: 'slow-token' },
    }))

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(readAttackOfOpportunityState(harness.storedMap.metadata).prompts).toHaveLength(1)
    expect(harness.storedMap.metadata?.activeOrderEffects).toEqual([activeOrder])
    const patches = response.result.ok && !('duplicate' in response.result) ? response.result.patches : []
    expect(patches.map((patch) => patch.type)).toEqual([LIVE_PLAY_PATCH_TYPES.MAP_INITIATIVE])
  })

  it('rejects malformed advance precondition payloads without writing', async () => {
    const harness = createHarness(baseMap({ initiative: { activeId: 'fast-token', round: 1 } }))

    const response = await execute(harness, nextInitiativeCommand({
      opId: 'op_badadvpay',
      payload: { orderIds: ['fast-token', 'fast-token'], activeId: 'fast-token', round: 1 },
    }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      currentRevision: 4,
    })
    expect(harness.writes).toEqual([])
    expect(harness.published).toEqual([])
  })

  it('rejects invalid initiative token targets without writing', async () => {
    const harness = createHarness()

    const response = await execute(harness, setInitiativeCommand({
      opId: 'op_badinit001',
      payload: { tokenId: 'missing-token', initiative: 12 },
    }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'not-found',
      currentRevision: 4,
      message: 'Placement missing-token not found',
    })
    expect(harness.writes).toEqual([])
    expect(harness.storedMap.revision).toBe(4)
  })

  it('rejects player initiative commands as unauthorized', async () => {
    const harness = createHarness()

    const response = await execute(harness, setInitiativeCommand({ opId: 'op_playerinit1' }), 'player')

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'unauthorized',
      currentRevision: 4,
      message: 'Only GMs can manage initiative',
    })
    expect(harness.writes).toEqual([])
    expect(harness.published).toEqual([])
  })

  it('returns the stored result for duplicate opIds without applying initiative twice', async () => {
    const harness = createHarness()
    const command = setInitiativeCommand({ opId: 'op_dupinit001' })

    const first = await execute(harness, command)
    const second = await execute(harness, command)

    expect(second.result).toEqual(first.result)
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.revision).toBe(5)
    expect(harness.storedMap.placements.find((placement) => placement.id === 'slow-token')?.initiative).toBe(25)
  })

  it('returns original next-initiative result for duplicate opIds without replaying metadata side effects', async () => {
    const expiringOrder = activeOrderEffect('order-duplicate', {
      kind: 'turn-start',
      tokenId: 'slow-token',
      tokenName: 'Slowpoke',
      description: 'until Slowpoke starts a turn',
    })
    const harness = createHarness(baseMap({
      initiative: { activeId: 'fast-token', round: 1 },
      metadata: writeAttackOfOpportunityState({ activeOrderEffects: [expiringOrder] }, {
        schemaVersion: 1,
        prompts: [{
          id: 'aao-duplicate',
          attackerId: 'fast-token',
          attackerName: 'Fast',
          provokerId: 'slow-token',
          provokerName: 'Slow',
          reason: 'movement',
          round: 1,
        }],
        usedRoundByAttackerId: {},
      }),
    }))
    const command = nextInitiativeCommand({ opId: 'op_dupnext001' })

    const first = await execute(harness, command)
    const second = await execute(harness, command)

    expect(second.result).toEqual(first.result)
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.revision).toBe(5)
    expect(harness.storedMap.initiative).toEqual({ activeId: 'slow-token', round: 1 })
    expect(harness.storedMap.metadata?.orderLog).toHaveLength(1)
    expect(readAttackOfOpportunityState(harness.storedMap.metadata).prompts).toEqual([])
  })

  it('rolls back initiative, metadata, and publication when accepted-result persistence fails', async () => {
    const expiringOrder = activeOrderEffect('order-rollback', {
      kind: 'turn-start',
      tokenId: 'slow-token',
      tokenName: 'Slowpoke',
      description: 'until Slowpoke starts a turn',
    })
    const initialMap = baseMap({
      initiative: { activeId: 'fast-token', round: 1 },
      metadata: writeAttackOfOpportunityState({ activeOrderEffects: [expiringOrder] }, {
        schemaVersion: 1,
        prompts: [{
          id: 'aao-rollback',
          attackerId: 'fast-token',
          attackerName: 'Fast',
          provokerId: 'slow-token',
          provokerName: 'Slow',
          reason: 'movement',
          round: 1,
        }],
        usedRoundByAttackerId: { 'fast-token': 1 },
      }),
    })
    const failingOpStore: LivePlayOpStore = {
      getOpRecord: vi.fn(() => null),
      getOpResult: vi.fn(() => null),
      saveOpResult: vi.fn(() => {
        throw new Error('op history unavailable')
      }),
    }
    const harness = createHarness(cloneJson(initialMap), {
      opStore: failingOpStore,
      transactional: true,
    })

    const response = await execute(harness, nextInitiativeCommand({ opId: 'op_persistfail' }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'persistence-failed',
      currentRevision: 4,
    })
    expect(harness.storedMap).toEqual(initialMap)
    expect(failingOpStore.saveOpResult).toHaveBeenCalledTimes(1)
    expect(harness.published).toEqual([])
  })

  it('rejects stale same-lane initiative conflicts without overwriting accepted state', async () => {
    const harness = createHarness()
    await execute(harness, setInitiativeCommand({ opId: 'op_initfirst1' }))

    const stale = await execute(harness, setInitiativeCommand({
      opId: 'op_initstale1',
      baseRevision: 4,
      payload: { tokenId: 'fast-token', initiative: 30 },
    }))

    expect(stale.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 5,
    })
    expect(harness.writes).toHaveLength(1)
    expect(harness.storedMap.placements.find((placement) => placement.id === 'fast-token')?.initiative).toBe(20)
    expect(harness.storedMap.placements.find((placement) => placement.id === 'slow-token')?.initiative).toBe(25)
  })
})
