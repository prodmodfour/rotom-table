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
import { acceptedRealtimeTestHooks } from './livePlayAcceptedRealtimeTestUtils'
import { executeLivePlaySheetCommandUseCase } from '~~/server/useCases/applyLivePlaySheetCommand'
import { MAPS_ROOT } from '~~/server/utils/mapPaths'
import { createSqliteSheetRepository, type PersistedSheet } from '~~/server/storage/sheetRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { openRotomDatabase } from '~~/server/storage/database'
import type { SheetKind, TabletopMap } from '~/types/map'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import { createEmptyCapabilityCampaignState } from '#shared/capabilityAutomation/campaignState'
import { resolveEffectiveCapabilities } from '~~/server/domain/capabilityAutomation/effectiveCapabilities'
import type { CharacterSheet } from '~/types/characterSheet'

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
    ...acceptedRealtimeTestHooks(published),
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
    list: vi.fn((kind?: SheetKind) => [...sheets.values()]
      .filter(sheet => kind === undefined || sheet.kind === kind)
      .map(sheet => ({
        kind: sheet.kind,
        slug: sheet.slug,
        document: sheet.sheet,
        revision: sheet.revision,
        updatedAt: sheet.updatedAt,
      }))),
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

const asOneFixture = (options: { readonly sourceEffective?: boolean } = {}) => {
  const ownerPlacement = baseMap().placements[0]!
  const mountPlacement = {
    id: 'mount-token', sheetKind: 'pokemon' as const, sheetSlug: 'glastrier',
    position: { x: 1, y: 0, z: 1 }, facing: 'south-east' as const, turned: false,
  }
  const ownerSheet: PersistedSheet = {
    ...pokemonSheet(),
    sheet: {
      ...pokemonSheet().sheet,
      capabilities: { other: ['As One'] },
    },
  }
  const mountSheet: PersistedSheet = {
    kind: 'pokemon', slug: 'glastrier', revision: 3, updatedAt: 30,
    sheet: {
      slug: 'glastrier', species: 'Glastrier', level: 20,
      combat: { currentHp: 40, injuries: 0, conditions: [] }, revision: 3, updatedAt: 30,
    },
  }
  const encounter = createEmptyEncounterState()
  const unlinkedMap = baseMap({ placements: [ownerPlacement, mountPlacement], encounterState: encounter })
  const asOne = resolveEffectiveCapabilities({
    map: unlinkedMap,
    placement: ownerPlacement,
    sheet: ownerSheet.sheet as unknown as CharacterSheet,
  }).instances.find(instance => instance.canonicalId === 'As One' && instance.effective)!
  const map = baseMap({
    placements: [ownerPlacement, mountPlacement],
    encounterState: {
      ...encounter,
      capabilityRuntime: {
        ...encounter.capabilityRuntime!,
        links: [{
          id: 'as-one-hp-link', kind: 'as-one-mount', ownerPlacementId: ownerPlacement.id,
          participantPlacementIds: [mountPlacement.id],
          capabilityInstanceId: options.sourceEffective === false ? `${asOne.instanceId}:stale` : asOne.instanceId,
          canonicalId: 'As One', establishedAt: 100, configurationId: 'Chilling Neigh',
          sourceOperationId: 'as-one-link-operation',
        }],
      },
    },
  })
  return { map, ownerPlacement, mountPlacement, ownerSheet, mountSheet }
}

const createAsOneHarness = (options: { readonly sourceEffective?: boolean } = {}) => {
  const fixture = asOneFixture(options)
  const harness = createHarness(fixture.map)
  harness.sheets.set('pokemon:pikachu', fixture.ownerSheet)
  harness.sheets.set('pokemon:glastrier', fixture.mountSheet)
  return { ...fixture, harness }
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
    expect(response.map).toBeUndefined()
    expect(harness.sheets.get('pokemon:pikachu')).toMatchObject({
      revision: 3,
      sheet: { combat: { conditions: ['Burned'] }, revision: 3 },
    })
    expect(response.sheetUpdates?.[0]?.sheet).toMatchObject({ combat: { conditions: ['Burned'] }, revision: 3 })
  })

  it('does not emit sheet updates for temporary-HP-only changes', async () => {
    const harness = createHarness(baseMap({ activeScene: { name: 'Battle', startedAt: 100 } }))
    const command = hpCommand({
      opId: 'op_sheet_temphp',
      payload: { placementId: 'linked-token', currentHp: 30, temporaryHp: 5 },
    })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({ ok: true, previousRevision: 4, revision: 5 })
    expect(harness.mapWrites).toHaveLength(1)
    expect(harness.sheetWrites).toHaveLength(0)
    expect(response.sheetUpdates).toBeUndefined()
    expect(harness.published.map((event) => (event as { channel?: string }).channel)).toEqual(['map:arena'])
  })

  it.each([
    { target: 'owner' as const, placementId: 'linked-token', targetSlug: 'pikachu', counterpartSlug: 'glastrier' },
    { target: 'participant' as const, placementId: 'mount-token', targetSlug: 'glastrier', counterpartSlug: 'pikachu' },
  ])('atomically faints both exact source-effective As One participants when directly fainting the $target', async ({
    placementId, targetSlug, counterpartSlug,
  }) => {
    const { harness } = createAsOneHarness()
    const command = hpCommand({
      opId: `op_as_one_faint_${placementId}`,
      payload: { placementId, currentHp: 0 },
      scopes: [
        { kind: 'token', placementId, field: 'hp' },
        { kind: 'sheet', sheetKind: 'pokemon', sheetSlug: targetSlug, field: 'hp' },
      ],
    })

    const response = await execute(harness, command)

    expect(response.result).toMatchObject({
      ok: true,
      patches: expect.arrayContaining([
        expect.objectContaining({
          type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
          payload: expect.objectContaining({ placementId: 'linked-token', current: expect.objectContaining({ currentHp: 0 }) }),
        }),
        expect.objectContaining({
          type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
          payload: expect.objectContaining({ placementId: 'mount-token', current: expect.objectContaining({ currentHp: 0 }) }),
        }),
      ]),
    })
    expect(harness.sheets.get(`pokemon:${targetSlug}`)?.sheet).toMatchObject({ combat: { currentHp: 0 } })
    expect(harness.sheets.get(`pokemon:${counterpartSlug}`)?.sheet).toMatchObject({ combat: { currentHp: 0 } })
    expect(harness.sheetWrites).toHaveLength(2)
    expect(response.sheetUpdates?.map(update => update.slug).sort()).toEqual(['glastrier', 'pikachu'])
    expect(harness.published).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'sheet:pokemon:pikachu', type: 'updated' }),
      expect.objectContaining({ channel: 'sheet:pokemon:glastrier', type: 'updated' }),
      expect.objectContaining({
        channel: 'map:arena',
        patches: expect.arrayContaining([
          expect.objectContaining({ payload: expect.objectContaining({ placementId: 'linked-token' }) }),
          expect.objectContaining({ payload: expect.objectContaining({ placementId: 'mount-token' }) }),
        ]),
      }),
    ]))
  })

  it('does not propagate fainting through a mismatched As One capability instance', async () => {
    const { harness } = createAsOneHarness({ sourceEffective: false })

    const response = await execute(harness, hpCommand({
      opId: 'op_stale_as_one_faint',
      payload: { placementId: 'linked-token', currentHp: 0 },
    }))

    expect(response.result).toMatchObject({ ok: true })
    expect(harness.sheets.get('pokemon:pikachu')?.sheet).toMatchObject({ combat: { currentHp: 0 } })
    expect(harness.sheets.get('pokemon:glastrier')?.sheet).toMatchObject({ combat: { currentHp: 40 } })
    expect(harness.sheetWrites).toHaveLength(1)
    expect(response.result.ok && !('duplicate' in response.result)
      ? response.result.patches.some(patch => (
          typeof patch.payload === 'object' && patch.payload !== null
          && 'placementId' in patch.payload && patch.payload.placementId === 'mount-token'
        ))
      : true).toBe(false)
  })

  it('fails before every write when a consulted As One sheet revision changes before commit', async () => {
    const { harness } = createAsOneHarness()
    harness.deps.database.withTransaction = <T>(work: () => T): T => {
      const counterpart = harness.sheets.get('pokemon:glastrier')!
      harness.sheets.set('pokemon:glastrier', {
        ...counterpart,
        revision: counterpart.revision + 1,
        sheet: { ...counterpart.sheet, revision: counterpart.revision + 1 },
      })
      return work()
    }

    const response = await execute(harness, hpCommand({
      opId: 'op_as_one_stale_counterpart',
      payload: { placementId: 'linked-token', currentHp: 0 },
    }))

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'persistence-failed',
      message: expect.stringContaining('glastrier changed after Capability HP planning'),
    })
    expect(harness.mapWrites).toEqual([])
    expect(harness.sheetWrites).toEqual([])
    expect(harness.sheets.get('pokemon:pikachu')?.sheet).toMatchObject({ combat: { currentHp: 30 } })
    expect(harness.sheets.get('pokemon:glastrier')?.sheet).toMatchObject({ combat: { currentHp: 40 } })
  })

  it('rolls back the map and primary HP write when an As One counterpart write fails', async () => {
    const database = openRotomDatabase({ path: ':memory:' })
    try {
      const fixture = asOneFixture()
      const mapRepository = createSqliteMapRepository<TabletopMap>(database)
      const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
      mapRepository.saveSetupMap(fixture.map)
      sheetRepository.saveSetupSheet('pokemon', 'pikachu', fixture.ownerSheet.sheet)
      sheetRepository.saveSetupSheet('pokemon', 'glastrier', fixture.mountSheet.sheet)
      const executor = createAuthoritativeLivePlayCommandExecutor({
        opStore: createInMemoryLivePlayOpStore(),
        queue: createInProcessMapWriteQueue(),
        ...acceptedRealtimeTestHooks([]),
      })
      const command = hpCommand({
        opId: 'op_as_one_atomic_rollback',
        payload: { placementId: 'linked-token', currentHp: 0 },
      })
      const failingRepository = {
        ...sheetRepository,
        applyLivePlayUpdate: (write: Parameters<typeof sheetRepository.applyLivePlayUpdate>[0]) => {
          if (write.slug === 'glastrier') throw new Error('counterpart HP write failed')
          return sheetRepository.applyLivePlayUpdate(write)
        },
      }

      const failed = await executeLivePlaySheetCommandUseCase({
        role: 'gm', command, expectedType: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      }, {
        database, mapRepository, sheetRepository: failingRepository, commandExecutor: executor, now: () => 2_000,
      })
      expect(failed.result).toMatchObject({
        ok: false,
        reason: 'persistence-failed',
        message: expect.stringContaining('counterpart HP write failed'),
      })
      expect(mapRepository.getBySlug('arena')).toMatchObject({ revision: 4 })
      expect(sheetRepository.getByRef('pokemon', 'pikachu')).toMatchObject({
        revision: 2, sheet: { combat: { currentHp: 30 } },
      })
      expect(sheetRepository.getByRef('pokemon', 'glastrier')).toMatchObject({
        revision: 3, sheet: { combat: { currentHp: 40 } },
      })

      const succeeded = await executeLivePlaySheetCommandUseCase({
        role: 'gm', command, expectedType: LIVE_PLAY_COMMAND_TYPES.MODIFY_HP,
      }, { database, mapRepository, sheetRepository, commandExecutor: executor, now: () => 2_000 })
      expect(succeeded.result).toMatchObject({ ok: true, revision: 5 })
      expect(sheetRepository.getByRef('pokemon', 'pikachu')?.sheet).toMatchObject({ combat: { currentHp: 0 } })
      expect(sheetRepository.getByRef('pokemon', 'glastrier')?.sheet).toMatchObject({ combat: { currentHp: 0 } })
    }
    finally {
      database.close()
    }
  })

  it('publishes a map-only Temporary HP cleanup for a linked Soulless counterpart', async () => {
    const fixture = asOneFixture()
    const activeScene = { name: 'Battle', startedAt: 100 }
    const harness = createHarness({
      ...fixture.map,
      activeScene,
      temporaryHitPoints: { scene: activeScene, byPlacementId: { 'mount-token': 8 } },
    })
    harness.sheets.set('pokemon:pikachu', fixture.ownerSheet)
    harness.sheets.set('pokemon:glastrier', {
      ...fixture.mountSheet,
      sheet: { ...fixture.mountSheet.sheet, species: 'Shedinja' },
    })

    const response = await execute(harness, hpCommand({
      opId: 'op_as_one_soulless_temp_cleanup',
      payload: { placementId: 'linked-token', currentHp: 30 },
    }))

    expect(response.result).toMatchObject({
      ok: true,
      patches: expect.arrayContaining([
        expect.objectContaining({
          type: LIVE_PLAY_PATCH_TYPES.TOKEN_HP,
          payload: expect.objectContaining({ placementId: 'mount-token', currentTemporaryHp: 0 }),
        }),
      ]),
    })
    expect(harness.storedMap.temporaryHitPoints).toBeUndefined()
    expect(harness.sheetWrites).toEqual([])
    expect(response.sheetUpdates).toBeUndefined()
  })

  it('redacts a derived As One sheet consequence from unauthorized player responses and replays', async () => {
    const { harness } = createAsOneHarness()
    const command = hpCommand({
      opId: 'op_as_one_private_counterpart',
      payload: { placementId: 'linked-token', currentHp: 0 },
    })

    const first = await execute(harness, command, 'player')
    const replay = await execute(harness, command, 'player')
    for (const response of [first, replay]) {
      expect(response.map).toBeUndefined()
      const accepted = response.result.ok && 'duplicate' in response.result
        ? response.result.original
        : response.result
      expect(accepted).toMatchObject({ ok: true })
      if (!accepted.ok) continue
      expect(accepted.patches.some(patch => (
        typeof patch.payload === 'object' && patch.payload !== null
        && 'placementId' in patch.payload && patch.payload.placementId === 'mount-token'
      ))).toBe(false)
    }
    expect(first.sheetUpdates?.map(update => update.slug) ?? []).toEqual(['pikachu'])
    expect(replay.sheetUpdates ?? []).toEqual([])
  })

  it('rejects Temporary HP for effective Soulless and reconciles legacy Temporary HP and injuries', async () => {
    const activeScene = { name: 'Battle', startedAt: 100 }
    const harness = createHarness(baseMap({
      activeScene,
      temporaryHitPoints: { scene: activeScene, byPlacementId: { 'linked-token': 8 } },
    }))
    harness.sheets.set('pokemon:pikachu', {
      ...pokemonSheet(),
      sheet: {
        ...pokemonSheet().sheet,
        species: 'Shedinja',
        combat: { currentHp: 1, injuries: 4, conditions: [] },
      },
    })

    const rejected = await execute(harness, hpCommand({
      opId: 'op_soulless_temp_reject',
      payload: { placementId: 'linked-token', currentHp: 1, temporaryHp: 5 },
    }))
    expect(rejected.result).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: 'Soulless creatures cannot gain Temporary HP',
    })
    expect(harness.mapWrites).toEqual([])
    expect(harness.sheetWrites).toEqual([])

    const reconciled = await execute(harness, hpCommand({
      opId: 'op_soulless_reconcile',
      payload: { placementId: 'linked-token', currentHp: 1 },
    }))
    expect(reconciled.result).toMatchObject({ ok: true, revision: 5 })
    expect(harness.storedMap.temporaryHitPoints).toBeUndefined()
    expect(harness.sheets.get('pokemon:pikachu')?.sheet).toMatchObject({
      combat: { currentHp: 1, injuries: 0 },
    })
  })

  it('uses suppression-aware Soulless authority for direct Temporary HP and injuries', async () => {
    const activeScene = { name: 'Battle', startedAt: 100 }
    const encounter = createEmptyEncounterState()
    const suppression = parseEncounterEffect({
      id: 'suppress-soulless-direct-hp',
      kind: 'capability',
      source: { operationId: 'suppress-operation', moveId: 'test.suppress-soulless', placementId: 'unlinked-token' },
      affected: { placementIds: ['linked-token'], sideIds: [], cells: [] },
      createdRound: 1,
      createdTurn: 0,
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['test', 'capability-suppression'],
      payload: { capabilityId: 'soulless', action: 'suppress' },
      dispel: { policy: 'none', tags: [] },
      transferPolicy: 'expire',
      suppression: { sources: [] },
    })
    const harness = createHarness(baseMap({
      activeScene,
      encounterState: { ...encounter, effects: [suppression] },
    }))
    harness.sheets.set('pokemon:pikachu', {
      ...pokemonSheet(),
      sheet: {
        ...pokemonSheet().sheet,
        species: 'Shedinja',
        combat: { currentHp: 1, injuries: 0, conditions: [] },
      },
    })

    const response = await execute(harness, hpCommand({
      opId: 'op_suppressed_soulless_hp',
      payload: { placementId: 'linked-token', currentHp: 10, temporaryHp: 5, injuries: 2 },
    }))

    expect(response.result).toMatchObject({ ok: true, revision: 5 })
    expect(harness.storedMap.temporaryHitPoints?.byPlacementId['linked-token']).toBe(5)
    expect(harness.sheets.get('pokemon:pikachu')?.sheet).toMatchObject({ combat: { currentHp: 10, injuries: 2 } })
  })

  it('durably ends Crowned Forme on direct faint so healing cannot reactivate it', async () => {
    const placement = baseMap().placements[0]!
    const zacianSheet: PersistedSheet = {
      ...pokemonSheet(),
      sheet: {
        ...pokemonSheet().sheet,
        species: 'Zacian',
        combat: { currentHp: 30, injuries: 0, conditions: [] },
        capabilities: { other: ['Weapon Bond'] },
      },
    }
    const encounter = createEmptyEncounterState()
    const unlinkedMap = baseMap({ encounterState: encounter })
    const weaponBond = resolveEffectiveCapabilities({
      map: unlinkedMap,
      placement,
      sheet: zacianSheet.sheet as unknown as CharacterSheet,
    }).instances.find(instance => instance.canonicalId === 'Weapon Bond' && instance.effective)!
    const harness = createHarness(baseMap({
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          modes: [{
            id: 'crowned-mode', actorPlacementId: placement.id,
            capabilityInstanceId: weaponBond.instanceId, canonicalId: 'Weapon Bond', mode: 'crowned',
            description: null, configurationId: null, activatedAt: 100, expiresAt: null,
            sourceOperationId: 'crowned-operation',
          }],
        },
      },
    }))
    harness.sheets.set('pokemon:pikachu', zacianSheet)

    const fainted = await execute(harness, hpCommand({
      opId: 'op_crowned_direct_faint',
      payload: { placementId: 'linked-token', currentHp: 0 },
    }))
    expect(fainted.result).toMatchObject({
      ok: true,
      revision: 5,
      patches: expect.arrayContaining([
        expect.objectContaining({ type: LIVE_PLAY_PATCH_TYPES.RECONCILIATION_REQUIRED }),
      ]),
    })
    expect(harness.storedMap.encounterState?.capabilityRuntime?.modes).toEqual([])

    const healed = await execute(harness, hpCommand({
      opId: 'op_crowned_direct_heal',
      baseRevision: 5,
      payload: { placementId: 'linked-token', currentHp: 10 },
    }))
    expect(healed.result).toMatchObject({ ok: true, revision: 6 })
    expect(harness.storedMap.encounterState?.capabilityRuntime?.modes).toEqual([])
    expect(harness.sheets.get('pokemon:pikachu')?.sheet).toMatchObject({ combat: { currentHp: 10 } })
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

  it('atomically shares twenty percent with the durable off-map Marsupial counterpart', async () => {
    const pouch = {
      motherSheetSlug: 'pikachu', babySheetSlug: 'kangaskhan-baby', experienceSharePercent: 20 as const,
      establishedAt: 20, sourceOperationId: 'shelter-operation',
    }
    const harness = createHarness()
    harness.sheets.set('pokemon:pikachu', {
      ...pokemonSheet(),
      sheet: {
        ...pokemonSheet().sheet, species: 'Kangaskhan', nickname: 'Mother', level: 30,
        capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
      },
    })
    harness.sheets.set('pokemon:kangaskhan-baby', {
      kind: 'pokemon', slug: 'kangaskhan-baby', revision: 1, updatedAt: 30,
      sheet: {
        slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 20,
        totalExp: 500, babyTemplate: true, revision: 1, updatedAt: 30,
        capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
      },
    })

    const response = await execute(harness, grantExperienceCommand(), 'gm')

    expect(harness.sheets.get('pokemon:pikachu')?.sheet.totalExp).toBe(596)
    expect(harness.sheets.get('pokemon:kangaskhan-baby')?.sheet.totalExp).toBe(524)
    expect(response.sheetUpdates?.map(update => update.slug)).toEqual(['pikachu', 'kangaskhan-baby'])
    expect(harness.sheetWrites).toHaveLength(2)
  })

  it('fails closed without awarding Experience when reciprocal Marsupial state is corrupt', async () => {
    const motherPouch = {
      motherSheetSlug: 'pikachu', babySheetSlug: 'kangaskhan-baby', experienceSharePercent: 20 as const,
      establishedAt: 20, sourceOperationId: 'shelter-operation',
    }
    const harness = createHarness()
    harness.sheets.set('pokemon:pikachu', {
      ...pokemonSheet(),
      sheet: {
        ...pokemonSheet().sheet, species: 'Kangaskhan', nickname: 'Mother', level: 30,
        capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: motherPouch },
      },
    })
    harness.sheets.set('pokemon:kangaskhan-baby', {
      kind: 'pokemon', slug: 'kangaskhan-baby', revision: 1, updatedAt: 30,
      sheet: {
        slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 20,
        totalExp: 500, babyTemplate: true, revision: 1, updatedAt: 30,
        capabilityCampaignState: {
          ...createEmptyCapabilityCampaignState(),
          marsupialPouch: { ...motherPouch, experienceSharePercent: 0 },
        },
      },
    })

    const response = await execute(harness, grantExperienceCommand({ opId: 'op_corrupt_marsupial_xp' }), 'gm')

    expect(response.result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(harness.sheets.get('pokemon:pikachu')?.sheet.totalExp).toBe(500)
    expect(harness.sheets.get('pokemon:kangaskhan-baby')?.sheet.totalExp).toBe(500)
    expect(harness.sheetWrites).toEqual([])
    expect(harness.mapWrites).toEqual([])
  })

  it('ends the durable Marsupial pouch relationship when the baby reaches Level 25', async () => {
    const babyPlacement = {
      id: 'baby-token', sheetKind: 'pokemon' as const, sheetSlug: 'kangaskhan-baby',
      position: { x: 1, y: 0, z: 2 }, facing: 'south-east' as const, turned: false,
    }
    const pouch = {
      motherSheetSlug: 'pikachu', babySheetSlug: 'kangaskhan-baby', experienceSharePercent: 20 as const,
      establishedAt: 20, sourceOperationId: 'shelter-operation',
    }
    const encounter = createEmptyEncounterState()
    const harness = createHarness(baseMap({
      placements: [...baseMap().placements, babyPlacement],
      metadata: { capabilityMarsupialPouches: [{
        motherPlacementId: 'linked-token', babyPlacementId: 'baby-token', experienceSharePercent: 20,
        capabilityInstanceId: 'capability:linked-token:Marsupial:base',
      }] },
      encounterState: {
        ...encounter,
        capabilityRuntime: {
          ...encounter.capabilityRuntime!,
          links: [{
            id: 'marsupial-link', ownerPlacementId: 'linked-token', participantPlacementIds: ['baby-token'],
            capabilityInstanceId: 'capability:linked-token:Marsupial:base', canonicalId: 'Marsupial',
            kind: 'marsupial-pouch', establishedAt: 20, configurationId: 'experience-share:20',
            sourceOperationId: 'shelter-operation',
          }],
        },
      },
    }))
    harness.sheets.set('pokemon:pikachu', {
      ...pokemonSheet(),
      sheet: {
        ...pokemonSheet().sheet, species: 'Kangaskhan', nickname: 'Mother', level: 30,
        capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
      },
    })
    harness.sheets.set('pokemon:kangaskhan-baby', {
      kind: 'pokemon', slug: 'kangaskhan-baby', revision: 1, updatedAt: 30,
      sheet: {
        slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 24,
        totalExp: 740, babyTemplate: true, revision: 1, updatedAt: 30,
        capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
      },
    })
    const command = grantExperienceCommand({ payload: { placementId: 'linked-token', amount: 50 } })

    const first = await execute(harness, command, 'gm')
    const replay = await execute(harness, command, 'gm')

    expect(first.result).toMatchObject({ ok: true, revision: 5 })
    expect(replay.result).toEqual(first.result)
    expect(harness.sheets.get('pokemon:kangaskhan-baby')?.sheet).toMatchObject({
      level: 25,
      babyTemplate: false,
    })
    expect(harness.sheets.get('pokemon:kangaskhan-baby')?.sheet.capabilityCampaignState?.marsupialPouch ?? null).toBeNull()
    expect(harness.sheets.get('pokemon:pikachu')?.sheet.capabilityCampaignState?.marsupialPouch ?? null).toBeNull()
    expect(harness.storedMap.metadata?.capabilityMarsupialPouches).toEqual([])
    expect(harness.storedMap.encounterState?.capabilityRuntime?.links).toEqual([])
    expect(harness.sheetWrites).toHaveLength(2)
  })

  it('rolls back an off-map Marsupial share failure and then replays exactly once', async () => {
    const database = openRotomDatabase({ path: ':memory:' })
    try {
      const mapRepository = createSqliteMapRepository<TabletopMap>(database)
      const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
      const pouch = {
        motherSheetSlug: 'pikachu', babySheetSlug: 'kangaskhan-baby', experienceSharePercent: 20 as const,
        establishedAt: 20, sourceOperationId: 'shelter-operation',
      }
      mapRepository.saveSetupMap(baseMap())
      sheetRepository.saveSetupSheet('pokemon', 'pikachu', {
        ...pokemonSheet().sheet, slug: 'pikachu', species: 'Kangaskhan', nickname: 'Mother', level: 30,
        capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
      })
      sheetRepository.saveSetupSheet('pokemon', 'kangaskhan-baby', {
        slug: 'kangaskhan-baby', nickname: 'Baby', species: 'Kangaskhan', level: 20,
        totalExp: 500, babyTemplate: true, revision: 1, updatedAt: 30,
        capabilityCampaignState: { ...createEmptyCapabilityCampaignState(), marsupialPouch: pouch },
      })
      sheetRepository.saveSetupSheet('trainer', 'giovanni', trainerSheet().sheet)
      const published: unknown[] = []
      const executor = createAuthoritativeLivePlayCommandExecutor({
        opStore: createInMemoryLivePlayOpStore(),
        queue: createInProcessMapWriteQueue(),
        ...acceptedRealtimeTestHooks(published),
      })
      const command = grantExperienceCommand({ opId: 'op_marsupial_rollback_replay' })
      const failingRepository = {
        ...sheetRepository,
        applyLivePlayUpdate: (write: Parameters<typeof sheetRepository.applyLivePlayUpdate>[0]) => {
          if (write.slug === 'kangaskhan-baby') throw new Error('baby write failed')
          return sheetRepository.applyLivePlayUpdate(write)
        },
      }

      const failed = await executeLivePlaySheetCommandUseCase({
        role: 'gm', command, expectedType: LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
      }, {
        database, mapRepository, sheetRepository: failingRepository, commandExecutor: executor, now: () => 2_000,
      })
      expect(failed.result).toMatchObject({
        ok: false, reason: 'persistence-failed', message: expect.stringContaining('baby write failed'),
      })
      expect(mapRepository.getBySlug('arena')).toMatchObject({ revision: 4 })
      expect(sheetRepository.getByRef('pokemon', 'pikachu')).toMatchObject({ revision: 2, sheet: { totalExp: 500 } })
      expect(sheetRepository.getByRef('pokemon', 'kangaskhan-baby')).toMatchObject({ revision: 1, sheet: { totalExp: 500 } })

      const dependencies = {
        database, mapRepository, sheetRepository, commandExecutor: executor, now: () => 2_000,
      }
      const first = await executeLivePlaySheetCommandUseCase({
        role: 'gm', command, expectedType: LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
      }, dependencies)
      const replay = await executeLivePlaySheetCommandUseCase({
        role: 'gm', command, expectedType: LIVE_PLAY_COMMAND_TYPES.GRANT_EXPERIENCE,
      }, dependencies)
      expect(replay.result).toEqual(first.result)
      expect(sheetRepository.getByRef('pokemon', 'pikachu')).toMatchObject({ revision: 3, sheet: { totalExp: 596 } })
      expect(sheetRepository.getByRef('pokemon', 'kangaskhan-baby')).toMatchObject({ revision: 2, sheet: { totalExp: 524 } })
      expect(mapRepository.getBySlug('arena')).toMatchObject({ revision: 5 })
    }
    finally {
      database.close()
    }
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
