import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type UseMoveLivePlayCommand,
} from '#shared/livePlayCommands'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { createAuthoritativeLivePlayCommandExecutor } from '~~/server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '~~/server/livePlay/mapWriteQueue'
import { createInMemoryLivePlayOpStore } from '~~/server/livePlay/opStore'
import { executeLivePlayUseMoveCommandUseCase } from '~~/server/useCases/applyLivePlayUseMoveCommand'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { SheetKind, TabletopMap } from '~/types/map'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_usemove01' as PlayerProfileId,
  displayName: 'Move Actor' as PlayerProfileDisplayName,
  linkedCharacters,
})

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
      id: 'linked-token',
      sheetKind: 'pokemon',
      sheetSlug: 'pikachu',
      position: { x: 1, y: 0, z: 1 },
      facing: 'south-east',
      turned: false,
    },
  ],
  lights: [],
  initiative: { activeId: 'linked-token', round: 2 },
  metadata: {},
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const pokemonSheet = (movelist: Array<{ name: string; frequency: string }>): PersistedSheet => ({
  kind: 'pokemon',
  slug: 'pikachu',
  revision: 2,
  updatedAt: 30,
  sheet: {
    slug: 'pikachu',
    nickname: 'Pika',
    species: 'Pikachu',
    movelist,
    updatedAt: 30,
    revision: 2,
  },
})

const keyForSheet = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

const useMoveCommand = (overrides: Partial<UseMoveLivePlayCommand> = {}): UseMoveLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_usemove001',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
  scopes: [{ kind: 'token', placementId: 'linked-token', field: 'moveUsage' }],
  payload: { placementId: 'linked-token', moveName: 'Custom EOT Move' },
  ...overrides,
})

const createHarness = (
  movelist: Array<{ name: string; frequency: string }>,
  initialMap: TabletopMap = baseMap(),
) => {
  let storedMap = initialMap
  const sheets = new Map<string, PersistedSheet>([
    [keyForSheet('pokemon', 'pikachu'), pokemonSheet(movelist)],
  ])
  const mapWrites: TabletopMap[] = []
  const sheetWrites: PersistedSheet[] = []
  const published: unknown[] = []
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore: createInMemoryLivePlayOpStore(),
    queue: createInProcessMapWriteQueue(),
  })
  const mapRepository = {
    getBySlug: vi.fn(async (slug: string) => (slug === 'arena' ? storedMap : null)),
    applyLivePlayUpdate: vi.fn(async (input: { slug: string; expectedRevision: number; nextMap: TabletopMap }) => {
      if (input.slug !== 'arena' || input.expectedRevision !== storedMap.revision) return 'stale' as const
      storedMap = { ...input.nextMap, revision: input.expectedRevision + 1 }
      mapWrites.push(storedMap)
      return 'applied' as const
    }),
  }
  const sheetRepository = {
    getByRef: vi.fn(async (kind: SheetKind, slug: string) => sheets.get(keyForSheet(kind, slug)) ?? null),
    applyLivePlayUpdate: vi.fn(async (input: {
      kind: SheetKind
      slug: string
      expectedRevision: number
      nextSheet: Record<string, unknown>
    }) => {
      const key = keyForSheet(input.kind, input.slug)
      const current = sheets.get(key)
      if (!current || current.revision !== input.expectedRevision) return 'stale' as const
      const revision = input.expectedRevision + 1
      const updatedAt = typeof input.nextSheet.updatedAt === 'number' ? input.nextSheet.updatedAt : current.updatedAt
      const sheet: PersistedSheet = {
        kind: input.kind,
        slug: input.slug,
        revision,
        updatedAt,
        sheet: { ...input.nextSheet, slug: input.slug, revision },
      }
      sheets.set(key, sheet)
      sheetWrites.push(sheet)
      return 'applied' as const
    }),
  }
  const deps = {
    commandExecutor: executor,
    mapRepository,
    sheetRepository,
    database: { withAsyncTransaction: async <T>(work: () => Promise<T>) => work() },
    publishRealtimeEvent: vi.fn((event) => published.push(event)),
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => 2_000),
  }

  return {
    deps,
    mapWrites,
    sheetWrites,
    published,
    get storedMap() {
      return storedMap
    },
    get storedSheet() {
      return sheets.get(keyForSheet('pokemon', 'pikachu'))
    },
  }
}

const execute = (harness: ReturnType<typeof createHarness>, command: UseMoveLivePlayCommand, role: 'gm' | 'player' = 'gm') =>
  executeLivePlayUseMoveCommandUseCase({
    role,
    command,
    clientId: `${role}-client`,
    playerProfile: role === 'player' ? playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]) : null,
    expectedType: LIVE_PLAY_COMMAND_TYPES.USE_MOVE,
  }, harness.deps)

describe('live-play useMove commands', () => {
  it('records EOT move usage on the authoritative map through the command executor', async () => {
    const harness = createHarness([{ name: 'Custom EOT Move', frequency: 'EOT' }])

    const response = await execute(harness, useMoveCommand())

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.mapWrites).toHaveLength(1)
    expect(harness.storedMap.moveUsage).toEqual({
      byPlacementId: {
        'linked-token': {
          'custom-eot-move': {
            moveName: 'Custom EOT Move',
            frequency: 'eot',
            uses: 1,
            lastUsedRound: 2,
            updatedAt: 2_000,
          },
        },
      },
    })
    expect(harness.storedMap.metadata?.moveLog).toEqual([
      {
        at: 2_000,
        userId: 'linked-token',
        userName: 'Pika',
        moveName: 'Custom EOT Move',
        lines: ['Pika used Custom EOT Move.', 'Frequency: EOT'],
      },
    ])
    expect(response.usage).toMatchObject({ tracking: 'map', frequencyKind: 'eot', uses: 1, available: false })
    expect(response.result.ok && !('duplicate' in response.result) ? response.result.patches : []).toEqual([
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE,
        revision: 5,
        payload: expect.objectContaining({
          placementId: 'linked-token',
          moveName: 'Custom EOT Move',
          tracking: 'map',
          moveLogEntry: expect.objectContaining({ moveName: 'Custom EOT Move', at: 2_000 }),
        }),
      }),
    ])
    expect(harness.published).toEqual([
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', opId: 'op_usemove001' }),
    ])
  })

  it('records Scene move usage on the map and returns remaining map-scoped usage', async () => {
    const harness = createHarness([{ name: 'Custom Scene Move', frequency: 'Scene x2' }])
    const command = useMoveCommand({
      opId: 'op_usemove_scene',
      payload: { placementId: 'linked-token', moveName: 'Custom Scene Move' },
    })

    const response = await execute(harness, command, 'player')

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.moveUsage).toEqual({
      byPlacementId: {
        'linked-token': {
          'custom-scene-move': {
            moveName: 'Custom Scene Move',
            frequency: 'scene',
            uses: 1,
            lastUsedRound: 2,
            updatedAt: 2_000,
          },
        },
      },
    })
    expect(response.usage).toMatchObject({
      tracking: 'map',
      frequencyKind: 'scene',
      uses: 1,
      maxUses: 2,
      remainingUses: 1,
      available: true,
    })
  })

  it('records untracked move usage as an ordered map action log event', async () => {
    const harness = createHarness(
      [{ name: 'Custom At-Will Move', frequency: 'At-Will' }],
      baseMap({
        metadata: {
          moveLog: [
            {
              at: 1_000,
              userId: 'linked-token',
              userName: 'Pika',
              moveName: 'Earlier Move',
              lines: ['Pika used Earlier Move.'],
            },
          ],
        },
      }),
    )
    const command = useMoveCommand({
      opId: 'op_usemove_untracked',
      scopes: [{ kind: 'token', placementId: 'linked-token', field: 'action' }],
      payload: { placementId: 'linked-token', moveName: 'Custom At-Will Move' },
    })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.storedMap.moveUsage).toBeUndefined()
    expect(harness.storedMap.metadata?.moveLog).toEqual([
      expect.objectContaining({ at: 1_000, moveName: 'Earlier Move' }),
      {
        at: 2_000,
        userId: 'linked-token',
        userName: 'Pika',
        moveName: 'Custom At-Will Move',
        lines: ['Pika used Custom At-Will Move.', 'Frequency: At-Will'],
      },
    ])
    expect(response.usage).toMatchObject({ tracking: 'none', frequencyKind: 'at-will', available: true })
    expect(response.result.ok && !('duplicate' in response.result) ? response.result.patches : []).toEqual([
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_ACTION,
        revision: 5,
        payload: expect.objectContaining({
          tracking: 'none',
          moveLogEntry: expect.objectContaining({ moveName: 'Custom At-Will Move', at: 2_000 }),
        }),
      }),
    ])
  })

  it('records Daily move usage on the sheet and returns map and sheet patch metadata', async () => {
    const harness = createHarness([{ name: 'Custom Daily Move', frequency: 'Daily x2' }])
    const command = useMoveCommand({
      opId: 'op_usemove_daily1',
      scopes: [
        { kind: 'token', placementId: 'linked-token', field: 'moveUsage' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'moveUsage' },
      ],
      payload: { placementId: 'linked-token', moveName: 'Custom Daily Move' },
    })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.mapWrites).toHaveLength(1)
    expect(harness.sheetWrites).toHaveLength(1)
    expect(harness.storedSheet?.sheet.moveUsage).toEqual({
      daily: {
        'custom-daily-move': {
          moveName: 'Custom Daily Move',
          uses: 1,
          updatedAt: 2_000,
        },
      },
    })
    expect(harness.storedMap.metadata?.moveLog).toEqual([
      expect.objectContaining({
        at: 2_000,
        userId: 'linked-token',
        userName: 'Pika',
        moveName: 'Custom Daily Move',
        lines: ['Pika used Custom Daily Move.', 'Frequency: Daily x2'],
      }),
    ])
    expect(response.usage).toMatchObject({
      tracking: 'sheet',
      frequencyKind: 'daily',
      uses: 1,
      maxUses: 2,
      remainingUses: 1,
      available: true,
    })
    expect(response.sheetUpdates).toEqual([
      {
        kind: 'pokemon',
        slug: 'pikachu',
        sheet: expect.objectContaining({
          slug: 'pikachu',
          revision: 3,
          moveUsage: {
            daily: {
              'custom-daily-move': {
                moveName: 'Custom Daily Move',
                uses: 1,
                updatedAt: 2_000,
              },
            },
          },
        }),
      },
    ])
    expect(response.result.ok && !('duplicate' in response.result) ? response.result.patches : []).toEqual([
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.TOKEN_MOVE_USAGE,
        revision: 5,
        payload: expect.objectContaining({
          placementId: 'linked-token',
          tracking: 'sheet',
          sheetRevision: 3,
          moveLogEntry: expect.objectContaining({ moveName: 'Custom Daily Move', at: 2_000 }),
        }),
      }),
      expect.objectContaining({
        type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD,
        revision: 5,
        scopes: [{ kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'moveUsage' }],
        payload: expect.objectContaining({
          field: 'moveUsage',
          tracking: 'sheet',
          sheetRevision: 3,
        }),
      }),
    ])
    expect(harness.published).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'sheet:pokemon:pikachu', type: 'updated', clientId: 'gm-client' }),
      expect.objectContaining({ channel: 'sheets', type: 'updated', clientId: 'gm-client' }),
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted', opId: 'op_usemove_daily1' }),
    ]))
  })

  it('returns the stored result and authoritative sheet data for duplicate Daily opIds', async () => {
    const harness = createHarness([{ name: 'Custom Daily Move', frequency: 'Daily x2' }])
    const command = useMoveCommand({
      opId: 'op_usemove_dailydup',
      scopes: [
        { kind: 'token', placementId: 'linked-token', field: 'moveUsage' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'moveUsage' },
      ],
      payload: { placementId: 'linked-token', moveName: 'Custom Daily Move' },
    })

    const first = await execute(harness, command)
    const second = await execute(harness, command)

    expect(second.result).toEqual(first.result)
    expect(harness.mapWrites).toHaveLength(1)
    expect(harness.sheetWrites).toHaveLength(1)
    expect(second.sheetUpdates).toEqual([
      expect.objectContaining({
        kind: 'pokemon',
        slug: 'pikachu',
        sheet: expect.objectContaining({
          revision: 3,
          moveUsage: {
            daily: {
              'custom-daily-move': expect.objectContaining({ uses: 1 }),
            },
          },
        }),
      }),
    ])
  })

  it('rejects stale same-token same-move Daily conflicts without overwriting sheet usage', async () => {
    const harness = createHarness([{ name: 'Custom Daily Move', frequency: 'Daily x2' }])
    const firstCommand = useMoveCommand({
      opId: 'op_usemove_dailyfirst',
      scopes: [
        { kind: 'token', placementId: 'linked-token', field: 'moveUsage' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'moveUsage' },
      ],
      payload: { placementId: 'linked-token', moveName: 'Custom Daily Move' },
    })
    const staleCommand = useMoveCommand({
      opId: 'op_usemove_dailystale',
      scopes: [
        { kind: 'token', placementId: 'linked-token', field: 'moveUsage' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'moveUsage' },
      ],
      payload: { placementId: 'linked-token', moveName: 'Custom Daily Move' },
      baseRevision: 4,
    })

    await execute(harness, firstCommand)
    const stale = await execute(harness, staleCommand)

    expect(stale.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 5,
    })
    expect(harness.mapWrites).toHaveLength(1)
    expect(harness.sheetWrites).toHaveLength(1)
    expect(harness.storedSheet?.sheet.moveUsage).toEqual({
      daily: {
        'custom-daily-move': expect.objectContaining({ uses: 1 }),
      },
    })
  })

  it('returns the stored result for duplicate opIds without applying map usage twice', async () => {
    const harness = createHarness([{ name: 'Custom Scene Move', frequency: 'Scene x2' }])
    const command = useMoveCommand({
      opId: 'op_usemove_dup01',
      payload: { placementId: 'linked-token', moveName: 'Custom Scene Move' },
    })

    const first = await execute(harness, command)
    const second = await execute(harness, command)

    expect(second.result).toEqual(first.result)
    expect(harness.mapWrites).toHaveLength(1)
    expect(harness.storedMap.moveUsage?.byPlacementId['linked-token']?.['custom-scene-move']?.uses).toBe(1)
  })

  it('rejects a stale same-token same-move map-resource conflict without overwriting accepted usage', async () => {
    const harness = createHarness([{ name: 'Custom Scene Move', frequency: 'Scene x2' }])
    const firstCommand = useMoveCommand({
      opId: 'op_usemove_first1',
      payload: { placementId: 'linked-token', moveName: 'Custom Scene Move' },
    })
    const staleCommand = useMoveCommand({
      opId: 'op_usemove_stale1',
      payload: { placementId: 'linked-token', moveName: 'Custom Scene Move' },
      baseRevision: 4,
    })

    await execute(harness, firstCommand)
    const stale = await execute(harness, staleCommand)

    expect(stale.result).toMatchObject({
      ok: false,
      reason: 'stale-revision',
      currentRevision: 5,
    })
    expect(harness.mapWrites).toHaveLength(1)
    expect(harness.storedMap.moveUsage?.byPlacementId['linked-token']?.['custom-scene-move']?.uses).toBe(1)
  })
})
