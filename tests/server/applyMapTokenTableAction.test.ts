import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAuthoritativeLivePlayCommandExecutor } from '../../server/livePlay/commandExecutor'
import { createInProcessMapWriteQueue } from '../../server/livePlay/mapWriteQueue'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteLivePlayOpRepository } from '../../server/storage/opRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { executeLivePlayTableActionCommandUseCase } from '../../server/useCases/applyMapTokenTableAction'
import {
  LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  LIVE_PLAY_COMMAND_TYPES,
  LIVE_PLAY_PATCH_TYPES,
  type LivePlayScope,
} from '../../shared/livePlayCommands'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '../../shared/playerProfiles'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { TrainerSheet } from '~/types/trainerSheet'

const tempRoots: string[] = []
const databases: RotomDatabase[] = []

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_actions' as PlayerProfileId,
  displayName: 'Action Player' as PlayerProfileDisplayName,
  linkedCharacters,
})

const baseMap = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 7,
  slug: 'arena',
  name: 'Arena',
  dimensions: { x: 8, y: 3, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  placements: [
    { id: 'actor', sheetKind: 'pokemon', sheetSlug: 'sandile', position: { x: 0, y: 0, z: 0 } },
    { id: 'target', sheetKind: 'pokemon', sheetSlug: 'target', position: { x: 2, y: 0, z: 0 } },
    { id: 'trainer', sheetKind: 'trainer', sheetSlug: 'lenora', position: { x: 1, y: 0, z: 0 } },
  ],
  lights: [],
  initiative: { activeId: 'trainer', round: 2 },
  metadata: { owner: 'gm' },
  createdAt: 10,
  updatedAt: 20,
  ...overrides,
})

const pokemonSheet = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  revision: 3,
  slug: 'sandile',
  nickname: 'Sandile',
  species: 'Sandile',
  level: 5,
  stats: {},
  combat: { currentHp: 20, conditions: [] },
  abilities: [{ name: 'Intimidate' }],
  movelist: [],
  ...overrides,
} as CharacterSheet)

const trainerSheet = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  revision: 3,
  slug: 'lenora',
  name: 'Lenora',
  level: 5,
  stats: {},
  currentHp: 20,
  features: [{ name: 'Agility Training' }],
  currentTeam: ['sandile'],
  ...overrides,
} as TrainerSheet)

const createDeps = (options: {
  map?: TabletopMap
  sheets?: Record<string, CharacterSheet | TrainerSheet>
  now?: number
  idFactory?: () => string
} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'rotom-table-actions-'))
  tempRoots.push(root)
  const database = openRotomDatabase({ path: join(root, 'rotom.sqlite'), enableWal: false })
  databases.push(database)
  const mapRepository = createSqliteMapRepository(database)
  const sheetRepository = createSqliteSheetRepository(database)
  const opRepository = createSqliteLivePlayOpRepository({ database, clock: () => options.now ?? 5000 })
  const commandExecutor = createAuthoritativeLivePlayCommandExecutor({
    opStore: opRepository,
    queue: createInProcessMapWriteQueue(),
  })
  const events: unknown[] = []
  const sheets = options.sheets ?? {
    'pokemon:sandile': pokemonSheet(),
    'pokemon:target': pokemonSheet({
      slug: 'target',
      nickname: 'Target',
      species: 'Pikachu',
      stats: { atk: { stage: 2 } },
      abilities: [],
    }),
    'trainer:lenora': trainerSheet(),
  }

  const map = options.map ?? baseMap()
  mapRepository.save({ slug: map.slug, document: map, revision: map.revision ?? 0, updatedAt: map.updatedAt ?? 20 })
  for (const [key, sheet] of Object.entries(sheets)) {
    const [kind, slug] = key.split(':') as ['pokemon' | 'trainer', string]
    sheetRepository.save({ kind, slug, document: sheet, revision: sheet.revision ?? 0, updatedAt: 30 })
  }

  return {
    deps: {
      commandExecutor,
      mapRepository,
      sheetRepository,
      database,
      now: vi.fn(() => options.now ?? 5000),
      idFactory: options.idFactory,
      publishRealtimeEvent: vi.fn((event) => events.push(event)),
      relativePath: vi.fn((path: string) => path.replace(/.*data\//, 'data/')),
    },
    mapRepository,
    sheetRepository,
    opRepository,
    events,
  }
}

const command = (
  type: (typeof LIVE_PLAY_COMMAND_TYPES)[keyof typeof LIVE_PLAY_COMMAND_TYPES],
  opId: string,
  payload: Record<string, unknown>,
  scopes: readonly LivePlayScope[],
) => ({
  schemaVersion: LIVE_PLAY_COMMAND_SCHEMA_VERSION,
  opId,
  mapSlug: 'arena',
  baseRevision: 7,
  type,
  scopes,
  payload,
})

const metadataScope = { kind: 'map' as const, lane: 'metadata' as const }
const tokenActionScope = (placementId: string) => ({ kind: 'token' as const, placementId, field: 'action' as const })
const sheetAbilityScope = (sheetSlug: string) => ({ kind: 'sheet' as const, sheetKind: 'pokemon' as const, sheetSlug, field: 'ability' })

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('live-play map token table action commands', () => {
  it('persists linked player maneuver usage through SQLite and publishes an accepted patch', async () => {
    const { deps, mapRepository, events } = createDeps({ now: 1111 })
    const request = command(
      LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
      'op_actionman1',
      { placementId: 'actor', maneuverName: 'Trip', targetPlacementId: 'target' },
      [tokenActionScope('actor'), metadataScope],
    )

    const response = await executeLivePlayTableActionCommandUseCase({
      role: 'player',
      command: request,
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'sandile' }]),
      clientId: 'client-1',
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
    }, deps)

    expect(response.result).toMatchObject({ ok: true, opId: 'op_actionman1', previousRevision: 7, revision: 8 })
    expect(response.action).toMatchObject({ type: 'maneuver', placementId: 'actor', targetPlacementId: 'target', name: 'Trip' })
    expect('patches' in response.result ? response.result.patches[0] : null).toMatchObject({ type: LIVE_PLAY_PATCH_TYPES.MAP_METADATA })
    const storedMap = await mapRepository.getBySlug('arena')
    expect(storedMap?.revision).toBe(8)
    expect(storedMap?.metadata?.maneuverLog).toMatchObject([
      {
        at: 1111,
        userId: 'actor',
        maneuverName: 'Trip',
        lines: expect.arrayContaining(['Sandile used Trip.', 'Target: Target']),
      },
    ])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ channel: 'map:arena', type: 'live-play-command-accepted' })
  })

  it('updates ability target sheet state in the same accepted command transaction', async () => {
    const { deps, mapRepository, sheetRepository, events } = createDeps({ now: 2222 })
    const request = command(
      LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      'op_actionabil',
      { placementId: 'actor', abilityName: 'Intimidate', targetPlacementId: 'target' },
      [
        tokenActionScope('actor'),
        metadataScope,
        sheetAbilityScope('sandile'),
        sheetAbilityScope('target'),
      ],
    )

    const response = await executeLivePlayTableActionCommandUseCase({
      role: 'player',
      command: request,
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'sandile' }]),
      clientId: 'client-2',
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
    }, deps)

    expect(response.result).toMatchObject({ ok: true, revision: 8 })
    expect(response.action).toMatchObject({ type: 'ability', placementId: 'actor', targetPlacementId: 'target', name: 'Intimidate', category: 'map' })
    expect(response.sheetUpdates).toHaveLength(1)
    expect(response.sheetUpdates?.[0]).toMatchObject({ kind: 'pokemon', slug: 'target', sheet: { revision: 4, stats: { atk: { stage: 1 } } } })
    expect((await mapRepository.getBySlug('arena'))?.metadata?.abilityLog).toMatchObject([
      { at: 2222, userId: 'actor', abilityName: 'Intimidate', category: 'map' },
    ])
    expect((await sheetRepository.getByRef('pokemon', 'target'))?.sheet).toMatchObject({ revision: 4, stats: { atk: { stage: 1 } } })
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'sheet:pokemon:target', type: 'updated' }),
      expect.objectContaining({ channel: 'sheets', type: 'updated' }),
      expect.objectContaining({ channel: 'map:arena', type: 'live-play-command-accepted' }),
    ]))
  })

  it('replays duplicate opId table actions without applying effects twice', async () => {
    const { deps, mapRepository, opRepository } = createDeps({ now: 3333, idFactory: () => 'order-effect' })
    const request = command(
      LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
      'op_actionordr',
      { placementId: 'trainer', orderName: 'Agility Training', targetPlacementId: 'actor' },
      [tokenActionScope('trainer'), metadataScope],
    )

    const first = await executeLivePlayTableActionCommandUseCase({
      role: 'player',
      command: request,
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'lenora' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
    }, deps)
    const second = await executeLivePlayTableActionCommandUseCase({
      role: 'player',
      command: request,
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'lenora' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_ORDER,
    }, deps)

    expect(first.result).toMatchObject({ ok: true, revision: 8 })
    expect(second.result).toMatchObject({ ok: true, revision: 8 })
    const storedMap = await mapRepository.getBySlug('arena')
    expect(storedMap?.revision).toBe(8)
    expect(storedMap?.metadata?.orderLog).toHaveLength(1)
    expect(opRepository.listAcceptedOpsSinceRevision({ mapSlug: 'arena', baseRevision: 7, currentRevision: 8 })).toHaveLength(1)
  })

  it('rejects unlinked player table actions before advancing map or sheet revisions', async () => {
    const { deps, mapRepository, sheetRepository } = createDeps()
    const request = command(
      LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      'op_actiondeny',
      { placementId: 'actor', abilityName: 'Intimidate', targetPlacementId: 'target' },
      [tokenActionScope('actor'), metadataScope, sheetAbilityScope('sandile'), sheetAbilityScope('target')],
    )

    const response = await executeLivePlayTableActionCommandUseCase({
      role: 'player',
      command: request,
      playerProfile: playerProfile([{ sheetKind: 'pokemon', sheetSlug: 'unlinked' }]),
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
    }, deps)

    expect(response.result).toMatchObject({ ok: false, reason: 'unauthorized', currentRevision: 7 })
    expect((await mapRepository.getBySlug('arena'))?.revision).toBe(7)
    expect((await sheetRepository.getByRef('pokemon', 'target'))?.revision).toBe(3)
  })

  it('rolls back the map, sheet updates, operation record, and realtime publish when an affected sheet is stale', async () => {
    const { deps, mapRepository, sheetRepository, opRepository, events } = createDeps({ now: 4444 })
    const staleSheetRepository = {
      getByRef: sheetRepository.getByRef,
      applyLivePlayUpdate: vi.fn((input: Parameters<typeof sheetRepository.applyLivePlayUpdate>[0]) => (
        input.kind === 'pokemon' && input.slug === 'target'
          ? 'stale' as const
          : sheetRepository.applyLivePlayUpdate(input)
      )),
    }
    const request = command(
      LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
      'op_actionstale',
      { placementId: 'actor', abilityName: 'Intimidate', targetPlacementId: 'target' },
      [
        tokenActionScope('actor'),
        metadataScope,
        sheetAbilityScope('sandile'),
        sheetAbilityScope('target'),
      ],
    )

    const response = await executeLivePlayTableActionCommandUseCase({
      role: 'gm',
      command: request,
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_ABILITY,
    }, { ...deps, sheetRepository: staleSheetRepository })

    expect(response.result).toMatchObject({
      ok: false,
      reason: 'persistence-failed',
      currentRevision: 7,
    })
    expect(staleSheetRepository.applyLivePlayUpdate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'pokemon',
      slug: 'target',
      expectedRevision: 3,
    }))
    expect((await mapRepository.getBySlug('arena'))).toMatchObject({
      revision: 7,
      metadata: { owner: 'gm' },
    })
    expect((await sheetRepository.getByRef('pokemon', 'target'))?.sheet).toMatchObject({
      revision: 3,
      stats: { atk: { stage: 2 } },
    })
    expect(opRepository.getOpRecord('arena', 'op_actionstale')).toBeNull()
    expect(events).toHaveLength(0)
  })

  it('keeps GM table actions available on hidden maps through the command path', async () => {
    const { deps, mapRepository } = createDeps({ map: baseMap({ playerVisible: false }) })
    const request = command(
      LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
      'op_actiongm01',
      { placementId: 'actor', maneuverName: 'Trip', targetPlacementId: 'target' },
      [tokenActionScope('actor'), metadataScope],
    )

    const response = await executeLivePlayTableActionCommandUseCase({
      role: 'gm',
      command: request,
      playerProfile: null,
      expectedType: LIVE_PLAY_COMMAND_TYPES.USE_MANEUVER,
    }, deps)

    expect(response.result).toMatchObject({ ok: true, revision: 8 })
    expect((await mapRepository.getBySlug('arena'))?.metadata?.maneuverLog).toHaveLength(1)
  })
})
