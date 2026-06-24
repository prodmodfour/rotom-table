import { describe, expect, it, vi } from 'vitest'
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
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore, type LivePlayOpStore } from '~~/server/livePlay/opStore'
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

const createHarness = (
  initialMap: TabletopMap = baseMap(),
  options: { readonly opStore?: LivePlayOpStore; readonly transactional?: boolean } = {},
) => {
  let storedMap = initialMap
  const writes: TabletopMap[] = []
  const published: unknown[] = []
  const opStore = options.opStore ?? createInMemoryLivePlayOpStore()
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore,
    queue: createInProcessMapWriteQueue(),
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
  const database = {
    withTransaction: <T>(work: () => T) => {
      const before = storedMap
      try {
        return work()
      } catch (error) {
        if (options.transactional) storedMap = before
        throw error
      }
    },
  }
  const deps = {
    commandExecutor: executor,
    mapRepository,
    database,
    publishRealtimeEvent: vi.fn((event) => published.push(event)),
    readSheet: vi.fn((_kind: 'pokemon' | 'trainer', _slug: string): { path: string; sheet: Record<string, unknown> } | null => null),
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => 2_000),
  }

  return {
    deps,
    writes,
    published,
    opStore,
    get storedMap() {
      return storedMap
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
