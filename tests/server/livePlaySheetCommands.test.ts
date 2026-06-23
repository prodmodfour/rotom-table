import { describe, expect, it, vi } from 'vitest'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type GrantExperienceLivePlayCommand,
  type LivePlaySheetCommand,
  type ModifyCombatStagesLivePlayCommand,
  type ModifyConditionsLivePlayCommand,
  type ModifyHpLivePlayCommand,
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
import { executeLivePlaySheetCommandUseCase } from '~~/server/useCases/applyLivePlaySheetCommand'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import type { PersistedSheet } from '~~/server/storage/sheetRepository'
import type { SheetKind, TabletopMap } from '~/types/map'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_sheetactor' as PlayerProfileId,
  displayName: 'Sheet Actor' as PlayerProfileDisplayName,
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
    {
      id: 'unlinked-token',
      sheetKind: 'trainer',
      sheetSlug: 'giovanni',
      position: { x: 2, y: 0, z: 2 },
      facing: 'north-west',
      turned: true,
    },
  ],
  lights: [],
  initiative: { activeId: null, round: 1 },
  metadata: {},
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const pokemonSheet = (): PersistedSheet => ({
  kind: 'pokemon',
  slug: 'pikachu',
  revision: 2,
  updatedAt: 30,
  sheet: {
    slug: 'pikachu',
    species: 'Pikachu',
    level: 20,
    totalExp: 500,
    combat: { currentHp: 30, injuries: 0, conditions: [] },
    stats: {
      atk: { stage: 0 },
      def: { stage: 0 },
      satk: { stage: 0 },
      sdef: { stage: 0 },
      spd: { stage: 0 },
    },
    combatStages: { acc: 0 },
    updatedAt: 30,
    revision: 2,
  },
})

const trainerSheet = (): PersistedSheet => ({
  kind: 'trainer',
  slug: 'giovanni',
  revision: 5,
  updatedAt: 40,
  sheet: {
    slug: 'giovanni',
    name: 'Giovanni',
    level: 20,
    currentHp: 42,
    currentInjuries: 0,
    conditions: [],
    stats: {
      hp: { base: 10 },
      atk: { stage: 0 },
      def: { stage: 0 },
      satk: { stage: 0 },
      sdef: { stage: 0 },
      spd: { stage: 0 },
    },
    combatStages: { acc: 0 },
    updatedAt: 40,
    revision: 5,
  },
})

const hpCommand = (overrides: Partial<ModifyHpLivePlayCommand> = {}): ModifyHpLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_sheet_hp_001',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
  scopes: [
    { kind: 'token', placementId: 'linked-token', field: 'hp' },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'hp' },
  ],
  payload: { placementId: 'linked-token', currentHp: 12, injuries: 2 },
  ...overrides,
})

const stagesCommand = (overrides: Partial<ModifyCombatStagesLivePlayCommand> = {}): ModifyCombatStagesLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_sheet_stages1',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MODIFY_COMBAT_STAGES,
  scopes: [
    { kind: 'token', placementId: 'linked-token', field: 'combatStages' },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'combatStages' },
  ],
  payload: {
    placementId: 'linked-token',
    stages: { atk: 2, def: -1, satk: 0, sdef: 0, spd: 1, acc: 3 },
  },
  ...overrides,
})

const conditionsCommand = (overrides: Partial<ModifyConditionsLivePlayCommand> = {}): ModifyConditionsLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_sheet_cond001',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.MODIFY_CONDITIONS,
  scopes: [
    { kind: 'token', placementId: 'linked-token', field: 'conditions' },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'conditions' },
  ],
  payload: { placementId: 'linked-token', action: 'add', conditions: ['Burned'] },
  ...overrides,
})

const grantExperienceCommand = (overrides: Partial<GrantExperienceLivePlayCommand> = {}): GrantExperienceLivePlayCommand => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId: 'op_sheet_xp_001',
  mapSlug: 'arena',
  baseRevision: 4,
  type: LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
  scopes: [
    { kind: 'token', placementId: 'linked-token', field: 'experience' },
    { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: 'pikachu', field: 'experience' },
  ],
  payload: { placementId: 'linked-token', amount: 120 },
  ...overrides,
})

const keyForSheet = (kind: SheetKind, slug: string): string => `${kind}:${slug}`

const createHarness = (initialMap: TabletopMap = baseMap()) => {
  let storedMap = initialMap
  const sheets = new Map<string, PersistedSheet>([
    [keyForSheet('pokemon', 'pikachu'), pokemonSheet()],
    [keyForSheet('trainer', 'giovanni'), trainerSheet()],
  ])
  const mapWrites: TabletopMap[] = []
  const sheetWrites: PersistedSheet[] = []
  const published: unknown[] = []
  const executor = createAuthoritativeLivePlayCommandExecutor({
    opStore: createInMemoryLivePlayOpStore(),
    queue: createInProcessMapWriteQueue(),
  })
  const mapRepository = {
    getBySlug: vi.fn((slug: string) => (slug === 'arena' ? storedMap : null)),
    applyLivePlayUpdate: vi.fn((input: { slug: string; expectedRevision: number; nextMap: TabletopMap }) => {
      if (input.slug !== 'arena' || input.expectedRevision !== storedMap.revision) return 'stale' as const
      storedMap = { ...input.nextMap, revision: input.expectedRevision + 1 }
      mapWrites.push(storedMap)
      return 'applied' as const
    }),
  }
  const sheetRepository = {
    getByRef: vi.fn((kind: SheetKind, slug: string) => sheets.get(keyForSheet(kind, slug)) ?? null),
    applyLivePlayUpdate: vi.fn((input: {
      kind: SheetKind
      slug: string
      expectedRevision: number
      nextSheet: Record<string, unknown>
    }) => {
      const key = keyForSheet(input.kind, input.slug)
      const current = sheets.get(key)
      if (!current || current.revision !== input.expectedRevision) return 'stale' as const
      const next: PersistedSheet = {
        kind: input.kind,
        slug: input.slug,
        revision: input.expectedRevision + 1,
        updatedAt: typeof input.nextSheet.updatedAt === 'number' ? input.nextSheet.updatedAt : current.updatedAt,
        sheet: { ...input.nextSheet, revision: input.expectedRevision + 1 },
      }
      sheets.set(key, next)
      sheetWrites.push(next)
      return 'applied' as const
    }),
  }
  const deps = {
    commandExecutor: executor,
    mapRepository,
    sheetRepository,
    database: { withTransaction: <T>(work: () => T) => work() },
    publishRealtimeEvent: vi.fn((event) => published.push(event)),
    relativePath: vi.fn((filePath: string) => filePath.replace(`${MAPS_ROOT}/`, 'data/maps/')),
    now: vi.fn(() => 2_000),
  }

  return {
    deps,
    sheets,
    mapWrites,
    sheetWrites,
    published,
    get storedMap() {
      return storedMap
    },
  }
}

const execute = (harness: ReturnType<typeof createHarness>, command: LivePlaySheetCommand, role: 'gm' | 'player' = 'gm') =>
  executeLivePlaySheetCommandUseCase({
    role,
    command,
    clientId: `${role}-client`,
    playerProfile: role === 'player' ? playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'pikachu' }]) : null,
    expectedType: command.type,
  }, harness.deps)

describe('live-play sheet commands', () => {
  it('allows a GM to modify any placed token HP through the authoritative executor', async () => {
    const harness = createHarness(baseMap({ playerVisible: false }))
    const command = hpCommand({
      payload: { placementId: 'unlinked-token', currentHp: 11, injuries: 1 },
      scopes: [
        { kind: 'token', placementId: 'unlinked-token', field: 'hp' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'giovanni', field: 'hp' },
      ],
    })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.mapWrites).toHaveLength(1)
    expect(harness.sheetWrites).toHaveLength(1)
    expect(harness.storedMap.revision).toBe(5)
    expect(harness.sheets.get('trainer:giovanni')).toMatchObject({
      revision: 6,
      sheet: { currentHp: 11, currentInjuries: 1, revision: 6 },
    })
    expect(response.sheetUpdates?.[0]).toMatchObject({
      kind: 'trainer',
      slug: 'giovanni',
      sheet: { currentHp: 11, currentInjuries: 1, revision: 6 },
    })
    expect(harness.published).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'sheet:trainer:giovanni', type: 'updated', clientId: 'gm-client' }),
      expect.objectContaining({
        channel: 'map:arena',
        type: 'live-play-command-accepted',
        opId: 'op_sheet_hp_001',
        patches: expect.arrayContaining([
          expect.objectContaining({ type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP, revision: 5 }),
          expect.objectContaining({ type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD, revision: 5 }),
        ]),
      }),
    ]))
  })

  it('allows a selected player profile to modify a linked token condition', async () => {
    const harness = createHarness()

    const response = await execute(harness, conditionsCommand(), 'player')

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.sheets.get('pokemon:pikachu')).toMatchObject({
      revision: 3,
      sheet: { combat: { conditions: ['Burned'] }, revision: 3 },
    })
    expect(response.sheetUpdates?.[0]?.sheet).toMatchObject({ combat: { conditions: ['Burned'] }, revision: 3 })
  })

  it('allows a selected player profile to grant experience to a linked Pokémon token', async () => {
    const harness = createHarness()

    const response = await execute(harness, grantExperienceCommand(), 'player')

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.sheets.get('pokemon:pikachu')).toMatchObject({
      revision: 3,
      sheet: { totalExp: 620, level: 23, revision: 3 },
    })
    expect(response.sheetUpdates?.[0]?.sheet).toMatchObject({ totalExp: 620, level: 23, revision: 3 })
    expect(harness.published).toEqual(expect.arrayContaining([
      expect.objectContaining({
        channel: 'map:arena',
        type: 'live-play-command-accepted',
        patches: expect.arrayContaining([
          expect.objectContaining({ type: LIVE_PLAY_PATCH_TYPES.TOKEN_EXPERIENCE, revision: 5 }),
          expect.objectContaining({ type: LIVE_PLAY_PATCH_TYPES.SHEET_FIELD, revision: 5 }),
        ]),
      }),
    ]))
  })

  it('rejects player sheet commands for tokens outside the selected profile', async () => {
    const harness = createHarness()
    const command = conditionsCommand({
      payload: { placementId: 'unlinked-token', action: 'add', conditions: ['Poisoned'] },
      scopes: [
        { kind: 'token', placementId: 'unlinked-token', field: 'conditions' },
        { kind: 'sheet', sheetKind: 'trainer', sheetSlug: 'giovanni', field: 'conditions' },
      ],
    })

    const response = await execute(harness, command, 'player')

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'unauthorized',
      currentRevision: 4,
      message: 'Token is not linked to selected player profile',
    })
    expect(harness.mapWrites).toEqual([])
    expect(harness.sheetWrites).toEqual([])
  })

  it('rejects invalid HP payloads without writing map or sheet state', async () => {
    const harness = createHarness()
    const command = hpCommand({ payload: { placementId: 'linked-token', currentHp: 'bad' as unknown as number } })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 4 })
    expect(response.result.ok ? '' : response.result.message).toContain('currentHp must be a finite number')
    expect(harness.mapWrites).toEqual([])
    expect(harness.sheetWrites).toEqual([])
  })

  it('rejects invalid combat stage payloads without writing map or sheet state', async () => {
    const harness = createHarness()
    const command = stagesCommand({
      payload: {
        placementId: 'linked-token',
        stages: { atk: 2, def: -1, satk: 0, sdef: 0, spd: 'fast' as unknown as number, acc: 3 },
      },
    })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: false, reason: 'invalid', currentRevision: 4 })
    expect(response.result.ok ? '' : response.result.message).toContain('stages.spd must be a finite number')
    expect(harness.mapWrites).toEqual([])
    expect(harness.sheetWrites).toEqual([])
  })

  it('returns the stored result for duplicate opIds without applying sheet changes twice', async () => {
    const harness = createHarness()
    const command = hpCommand({ opId: 'op_sheet_duplicate' })

    const first = await execute(harness, command, 'player')
    const second = await execute(harness, command, 'player')

    expect(second.result).toEqual(first.result)
    expect(harness.mapWrites).toHaveLength(1)
    expect(harness.sheetWrites).toHaveLength(1)
    expect(harness.sheets.get('pokemon:pikachu')).toMatchObject({
      revision: 3,
      sheet: { combat: { currentHp: 12, injuries: 2 }, revision: 3 },
    })
  })

  it('rejects stale sheet commands before mutating sheet state', async () => {
    const harness = createHarness()
    const command = hpCommand({ opId: 'op_sheet_stale01', baseRevision: 3 })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: false, reason: 'stale-revision', currentRevision: 4 })
    expect(harness.mapWrites).toEqual([])
    expect(harness.sheetWrites).toEqual([])
    expect(harness.sheets.get('pokemon:pikachu')).toMatchObject({
      revision: 2,
      sheet: { combat: { currentHp: 30, injuries: 0 } },
    })
  })
})
