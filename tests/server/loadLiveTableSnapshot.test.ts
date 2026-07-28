import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION } from '#shared/liveTableSnapshot'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import { parseEncounterEffect } from '#shared/moveAutomation/encounterEffects'
import {
  PLAYER_PROFILE_SCHEMA_VERSION,
  type PlayerProfile,
  type PlayerProfileDisplayName,
  type PlayerProfileId,
} from '#shared/playerProfiles'
import { subscribeRealtime } from '~~/server/utils/realtime'
import type { TabletopMap } from '~/types/map'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapInteractionModeRepository } from '../../server/storage/mapInteractionModeRepository'
import { createSqliteMapRepository, type StoredMapDocument } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository, type StoredSheetDocument } from '../../server/storage/sheetRepository'
import { sqlitePlayerVisibleMapSheetAccessKeys } from '../../server/utils/mapSheetAccess'
import type { PlayerSessionAccessGrant } from '../../server/utils/sessionPlayerAccess'
import { playerSheetAccessContextFromKeys } from '../../server/useCases/authorizeSheetList'
import { listSheetsUseCase } from '../../server/useCases/listSheets'
import { loadLiveTableSnapshotUseCase } from '../../server/useCases/loadLiveTableSnapshot'

const mapDoc = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'arena',
  name: 'Arena',
  folder: '',
  dimensions: { x: 8, y: 4, z: 8 },
  groundLevelY: 0,
  playerVisible: true,
  placements: [],
  voxels: [],
  hazards: [],
  fieldEffects: { weather: [], terrains: [], rooms: [] },
  lights: [],
  initiative: { activeId: null, round: 1 },
  ...overrides,
})

const pokemon = (overrides: Partial<CharacterSheet> = {}): CharacterSheet => ({
  slug: 'pika',
  nickname: 'Pika',
  species: 'Pikachu',
  level: 5,
  folder: '',
  player: false,
  ...overrides,
})

const trainer = (overrides: Partial<TrainerSheet> = {}): TrainerSheet => ({
  slug: 'ash',
  name: 'Ash',
  level: 1,
  folder: '',
  player: false,
  ...overrides,
})

const profile = (
  id: string,
  linkedCharacters: PlayerProfile['linkedCharacters'],
): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: id as PlayerProfileId,
  displayName: id.replace('profile_', '') as PlayerProfileDisplayName,
  linkedCharacters,
})

const sessionGrant = (sheetKeys: readonly `${'pokemon' | 'trainer'}:${string}`[]): PlayerSessionAccessGrant => ({
  visibleMapSlugs: new Set(),
  sheetKeys: new Set(sheetKeys),
})

let databases: RotomDatabase[] = []
const db = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('load live table snapshot use case', () => {
  it('returns a GM snapshot with the authoritative map, mode, all sheets, and SQLite revisions', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)

    maps.saveSetupMap(mapDoc({ slug: 'arena', name: 'SQLite Arena', revision: 7 }))
    modes.set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 1234 })
    sheets.saveSetupSheet('pokemon', 'public-mon', pokemon({ slug: 'public-mon', player: true, revision: 11 }) as unknown as Record<string, unknown>)
    sheets.saveSetupSheet('pokemon', 'hidden-mon', pokemon({ slug: 'hidden-mon', player: false, revision: 12 }) as unknown as Record<string, unknown>)
    sheets.saveSetupSheet('trainer', 'public-trainer', trainer({ slug: 'public-trainer', player: true, revision: 21 }) as unknown as Record<string, unknown>)
    sheets.saveSetupSheet('trainer', 'hidden-trainer', trainer({ slug: 'hidden-trainer', player: false, revision: 22 }) as unknown as Record<string, unknown>)

    const snapshot = loadLiveTableSnapshotUseCase(
      { role: 'gm', slug: 'arena' },
      { database, mapRepository: maps, modeRepository: modes, sheetRepository: sheets },
    )

    expect(snapshot.schemaVersion).toBe(LIVE_TABLE_SNAPSHOT_SCHEMA_VERSION)
    expect(snapshot.map.slug).toBe('arena')
    expect(snapshot.map.name).toBe('SQLite Arena')
    expect(snapshot.map.revision).toBe(7)
    expect(snapshot.mapRevision).toBe(7)
    expect(snapshot.interactionMode).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)
    expect(snapshot.interactionModeUpdatedAt).toBe(1234)
    expect(snapshot.pokemonSheets.map((sheet) => [sheet.slug, sheet.revision])).toEqual([
      ['hidden-mon', 12],
      ['public-mon', 11],
    ])
    expect(snapshot.trainerSheets.map((sheet) => [sheet.slug, sheet.revision])).toEqual([
      ['hidden-trainer', 22],
      ['public-trainer', 21],
    ])
  })

  it('returns the load-map 404 policy for a missing map', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)

    try {
      loadLiveTableSnapshotUseCase(
        { role: 'gm', slug: 'missing' },
        { database, mapRepository: maps, modeRepository: modes, sheetRepository: sheets },
      )
      expect.unreachable('missing map should fail')
    } catch (error) {
      expect(error).toMatchObject({ statusCode: 404, message: 'Map missing.json not found' })
    }
  })

  it('redacts Ability authority and non-controlled Ability identities from player snapshots', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const privateEffect = parseEncounterEffect({
      id: 'ability.intimidate.target.private',
      kind: 'capability',
      source: {
        operationId: 'intent.private-intimidate',
        moveId: 'ability.intimidate',
        placementId: 'actor-token',
      },
      affected: { placementIds: ['target-token'], sideIds: [], cells: [] },
      createdRound: 1,
      createdTurn: 0,
      duration: { kind: 'scene', remaining: null },
      stacks: 1,
      charges: null,
      stackPolicy: { kind: 'replace', maxStacks: null },
      chargePolicy: { kind: 'none', amount: null },
      tags: ['ability', 'intimidate', 'target-gate'],
      payload: { capabilityId: 'intimidate.targeted-this-scene', action: 'grant' },
      dispel: { policy: 'none', tags: [] },
      transferPolicy: 'retain',
      suppression: { sources: [] },
    })
    maps.saveSetupMap(mapDoc({
      revision: 8,
      placements: [
        { id: 'actor-token', sheetKind: 'pokemon', sheetSlug: 'actor-mon', position: { x: 1, y: 0, z: 1 } },
        { id: 'target-token', sheetKind: 'pokemon', sheetSlug: 'target-mon', position: { x: 2, y: 0, z: 1 } },
      ],
      encounterState: {
        ...createEmptyEncounterState(),
        effects: [privateEffect],
        abilityUsage: { schemaVersion: 1, sceneId: 'scene.private', entries: [] },
        abilityTiming: {
          schemaVersion: 1,
          sceneId: 'scene.private',
          round: { windowId: null, sequence: null, uses: [] },
          turn: { windowId: null, sequence: null, uses: [] },
          cooldowns: [],
          receipts: [],
        },
      },
    }))
    sheets.saveSetupSheet('pokemon', 'actor-mon', pokemon({
      slug: 'actor-mon',
      abilities: [{ name: 'Compound Eyes', frequency: 'Static', effect: 'Private actor text.' }],
    }) as unknown as Record<string, unknown>)
    sheets.saveSetupSheet('pokemon', 'target-mon', pokemon({
      slug: 'target-mon',
      abilities: [{ name: 'Sturdy', frequency: 'Static', effect: 'Private target text.' }],
    }) as unknown as Record<string, unknown>)
    const actorProfile = profile('profile_actor000', [
      { sheetKind: 'pokemon', sheetSlug: 'actor-mon' },
    ])

    const playerSnapshot = loadLiveTableSnapshotUseCase(
      { role: 'player', slug: 'arena', playerProfile: actorProfile },
      { database, mapRepository: maps, modeRepository: modes, sheetRepository: sheets },
    )
    expect(playerSnapshot.pokemonSheets.find(sheet => sheet.slug === 'actor-mon')?.abilities)
      .toEqual([expect.objectContaining({ name: 'Compound Eyes' })])
    expect(playerSnapshot.pokemonSheets.find(sheet => sheet.slug === 'target-mon'))
      .not.toHaveProperty('abilities')
    expect(playerSnapshot.map.encounterState).toMatchObject({
      effects: [],
      abilityUsage: { schemaVersion: 1, sceneId: null, entries: [] },
      abilityTiming: { schemaVersion: 1, sceneId: null, receipts: [] },
      abilityOwnedState: { schemaVersion: 1, entries: [], receipts: [] },
      abilityTransformations: { schemaVersion: 1, entries: [], receipts: [] },
    })
    const serializedPlayerSnapshot = JSON.stringify(playerSnapshot)
    expect(serializedPlayerSnapshot).not.toContain('Sturdy')
    expect(serializedPlayerSnapshot).not.toContain('intent.private-intimidate')
    expect(serializedPlayerSnapshot).not.toContain('target-gate')

    const gmSnapshot = loadLiveTableSnapshotUseCase(
      { role: 'gm', slug: 'arena' },
      { database, mapRepository: maps, modeRepository: modes, sheetRepository: sheets },
    )
    expect(JSON.stringify(gmSnapshot)).toContain('intent.private-intimidate')
    expect(gmSnapshot.pokemonSheets.find(sheet => sheet.slug === 'target-mon')?.abilities)
      .toEqual([expect.objectContaining({ name: 'Sturdy' })])
  })

  it('rejects a player snapshot for a hidden map', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)

    maps.saveSetupMap(mapDoc({ slug: 'hidden-map', name: 'Hidden', playerVisible: false, revision: 3 }))

    expect(() => loadLiveTableSnapshotUseCase(
      { role: 'player', slug: 'hidden-map' },
      { database, mapRepository: maps, modeRepository: modes, sheetRepository: sheets },
    )).toThrow('Map is not player visible')
  })

  it('filters player sheets by public, session, player-visible map placement, and selected profile access', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)

    maps.saveSetupMap(mapDoc({
      slug: 'arena',
      revision: 5,
      playerVisible: true,
      placements: [
        { id: 'map-mon-token', sheetKind: 'pokemon', sheetSlug: 'map-mon', position: { x: 1, y: 0, z: 1 } },
      ],
    }))
    maps.saveSetupMap(mapDoc({
      slug: 'public-side-map',
      revision: 1,
      playerVisible: true,
      placements: [
        { id: 'map-trainer-token', sheetKind: 'trainer', sheetSlug: 'map-trainer', position: { x: 2, y: 0, z: 2 } },
      ],
    }))
    maps.saveSetupMap(mapDoc({
      slug: 'hidden-side-map',
      revision: 1,
      playerVisible: false,
      placements: [
        { id: 'hidden-map-token', sheetKind: 'pokemon', sheetSlug: 'hidden-map-mon', position: { x: 3, y: 0, z: 3 } },
      ],
    }))
    modes.set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 222 })

    for (const sheet of [
      pokemon({ slug: 'public-mon', player: true, revision: 1 }),
      pokemon({ slug: 'map-mon', revision: 2 }),
      pokemon({ slug: 'session-mon', revision: 3 }),
      pokemon({ slug: 'profile-mon', revision: 4 }),
      pokemon({ slug: 'team-mon', revision: 5 }),
      pokemon({ slug: 'other-profile-mon', revision: 6 }),
      pokemon({ slug: 'private-mon', revision: 7 }),
      pokemon({ slug: 'hidden-map-mon', revision: 8 }),
    ]) {
      sheets.saveSetupSheet('pokemon', sheet.slug, sheet as unknown as Record<string, unknown>)
    }

    for (const sheet of [
      trainer({ slug: 'public-trainer', player: true, revision: 10 }),
      trainer({ slug: 'profile-trainer', currentTeam: ['team-mon'], revision: 11 }),
      trainer({ slug: 'other-profile-trainer', currentTeam: ['other-profile-mon'], revision: 12 }),
      trainer({ slug: 'session-trainer', revision: 13 }),
      trainer({ slug: 'map-trainer', revision: 14 }),
      trainer({ slug: 'private-trainer', revision: 15 }),
    ]) {
      sheets.saveSetupSheet('trainer', sheet.slug, sheet as unknown as Record<string, unknown>)
    }

    const ash = profile('profile_ash00000', [
      { sheetKind: 'pokemon', sheetSlug: 'profile-mon' },
      { sheetKind: 'trainer', sheetSlug: 'profile-trainer' },
    ])
    const misty = profile('profile_misty000', [
      { sheetKind: 'pokemon', sheetSlug: 'other-profile-mon' },
      { sheetKind: 'trainer', sheetSlug: 'other-profile-trainer' },
    ])
    const sessionAccess = sessionGrant(['pokemon:session-mon', 'trainer:session-trainer'])

    const ashSnapshot = loadLiveTableSnapshotUseCase(
      { role: 'player', slug: 'arena', playerProfile: ash, sessionAccess },
      { database, mapRepository: maps, modeRepository: modes, sheetRepository: sheets },
    )

    expect(ashSnapshot.pokemonSheets.map((sheet) => sheet.slug)).toEqual([
      'map-mon',
      'profile-mon',
      'public-mon',
      'session-mon',
      'team-mon',
    ])
    expect(ashSnapshot.trainerSheets.map((sheet) => sheet.slug)).toEqual([
      'map-trainer',
      'profile-trainer',
      'public-trainer',
      'session-trainer',
    ])
    expect(ashSnapshot.pokemonSheets.find((sheet) => sheet.slug === 'map-mon')).not.toHaveProperty('sessionPlayerAccessible')
    expect(ashSnapshot.pokemonSheets.find((sheet) => sheet.slug === 'map-mon')).not.toHaveProperty('playerProfileAccessible')
    expect(ashSnapshot.pokemonSheets.find((sheet) => sheet.slug === 'session-mon')).toMatchObject({ sessionPlayerAccessible: true })
    expect(ashSnapshot.pokemonSheets.find((sheet) => sheet.slug === 'profile-mon')).toMatchObject({ playerProfileAccessible: true })
    expect(ashSnapshot.pokemonSheets.find((sheet) => sheet.slug === 'team-mon')).toMatchObject({ playerProfileAccessible: true })
    expect(ashSnapshot.trainerSheets.find((sheet) => sheet.slug === 'session-trainer')).toMatchObject({ sessionPlayerAccessible: true })
    expect(ashSnapshot.trainerSheets.find((sheet) => sheet.slug === 'profile-trainer')).toMatchObject({ playerProfileAccessible: true })

    const sheetListAccessContext = playerSheetAccessContextFromKeys({
      sessionAccessKeys: sessionAccess.sheetKeys,
      mapSheetAccessKeys: sqlitePlayerVisibleMapSheetAccessKeys(maps),
    })
    const sheetList = listSheetsUseCase(
      { role: 'player', playerProfile: ash, ...sheetListAccessContext },
      { sheetRepository: sheets },
    )
    expect(ashSnapshot.pokemonSheets).toEqual(sheetList.pokemonSheets)
    expect(ashSnapshot.trainerSheets).toEqual(sheetList.trainerSheets)

    const mistySnapshot = loadLiveTableSnapshotUseCase(
      { role: 'player', slug: 'arena', playerProfile: misty, sessionAccess },
      { database, mapRepository: maps, modeRepository: modes, sheetRepository: sheets },
    )

    expect(mistySnapshot.pokemonSheets.map((sheet) => sheet.slug)).toEqual([
      'map-mon',
      'other-profile-mon',
      'public-mon',
      'session-mon',
    ])
    expect(mistySnapshot.trainerSheets.map((sheet) => sheet.slug)).toEqual([
      'map-trainer',
      'other-profile-trainer',
      'public-trainer',
      'session-trainer',
    ])
  })

  it('executes map, mode, and sheet repository reads inside one injected transaction boundary', () => {
    let activeTransaction = false
    let transactionCount = 0
    const assertInTransaction = vi.fn(() => {
      expect(activeTransaction).toBe(true)
    })
    const database = {
      withTransaction: <T,>(work: () => T): T => {
        expect(activeTransaction).toBe(false)
        transactionCount += 1
        activeTransaction = true
        try {
          return work()
        } finally {
          activeTransaction = false
        }
      },
    }
    const storedMap: StoredMapDocument<Record<string, unknown>> = {
      slug: 'arena',
      document: mapDoc({
        slug: 'arena',
        revision: 9,
        placements: [
          { id: 'map-mon-token', sheetKind: 'pokemon', sheetSlug: 'map-mon', position: { x: 0, y: 0, z: 0 } },
        ],
      }) as unknown as Record<string, unknown>,
      revision: 9,
      updatedAt: 90,
    }
    const mapRepository = {
      get: vi.fn((slug: string) => {
        assertInTransaction()
        return slug === 'arena' ? storedMap : null
      }),
      list: vi.fn(() => {
        assertInTransaction()
        return [storedMap]
      }),
    }
    const modeRepository = {
      get: vi.fn(() => {
        assertInTransaction()
        return { slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 91 }
      }),
    }
    const sheetRepository = {
      list: vi.fn((kind?: 'pokemon' | 'trainer') => {
        assertInTransaction()
        const rows: StoredSheetDocument<Record<string, unknown>>[] = kind === 'trainer'
          ? [{ kind: 'trainer', slug: 'gm', document: trainer({ slug: 'gm', player: true }) as unknown as Record<string, unknown>, revision: 4, updatedAt: 40 }]
          : [{ kind: 'pokemon', slug: 'map-mon', document: pokemon({ slug: 'map-mon' }) as unknown as Record<string, unknown>, revision: 3, updatedAt: 30 }]
        return rows
      }),
    }

    const snapshot = loadLiveTableSnapshotUseCase(
      { role: 'player', slug: 'arena' },
      { database, mapRepository, modeRepository, sheetRepository },
    )

    expect(transactionCount).toBe(1)
    expect(mapRepository.get).toHaveBeenCalledOnce()
    expect(mapRepository.list).toHaveBeenCalledOnce()
    expect(modeRepository.get).toHaveBeenCalledOnce()
    expect(sheetRepository.list).toHaveBeenCalledTimes(2)
    expect(assertInTransaction).toHaveBeenCalledTimes(5)
    expect(snapshot.mapRevision).toBe(9)
  })

  it('fails without returning a partial snapshot or publishing realtime when sheet normalisation fails', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const received: unknown[] = []
    const unsubscribe = subscribeRealtime((event) => received.push(event))

    maps.saveSetupMap(mapDoc({ slug: 'arena', revision: 2 }))
    modes.set({ slug: 'arena', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 20 })
    sheets.saveSetupSheet('trainer', 'gm', trainer({ slug: 'gm', player: true, revision: 1 }) as unknown as Record<string, unknown>)
    database.connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES ('pokemon', 'bad-sheet', '"not an object"', 1, 10)
    `).run()

    try {
      expect(() => loadLiveTableSnapshotUseCase(
        { role: 'gm', slug: 'arena' },
        { database, mapRepository: maps, modeRepository: modes, sheetRepository: sheets },
      )).toThrow('SQLite pokemon sheet bad-sheet document must be an object')
      expect(received).toEqual([])
    } finally {
      unsubscribe()
    }
  })

  it('returns only SQLite state for map and sheet slugs that historically existed as JSON files', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const modes = createSqliteMapInteractionModeRepository(database)
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)

    maps.saveSetupMap(mapDoc({
      slug: 'untitled-map',
      name: 'SQLite Untitled',
      revision: 22,
      playerVisible: true,
    }))
    modes.set({ slug: 'untitled-map', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 220 })
    sheets.saveSetupSheet('pokemon', 'examples-pikachu', pokemon({
      slug: 'examples-pikachu',
      nickname: 'SQLite Pika',
      revision: 33,
      player: true,
    }) as unknown as Record<string, unknown>)

    const snapshot = loadLiveTableSnapshotUseCase(
      { role: 'gm', slug: 'untitled-map' },
      { database, mapRepository: maps, modeRepository: modes, sheetRepository: sheets },
    )

    expect(snapshot.map.name).toBe('SQLite Untitled')
    expect(snapshot.mapRevision).toBe(22)
    expect(snapshot.pokemonSheets).toHaveLength(1)
    expect(snapshot.pokemonSheets[0]).toMatchObject({ slug: 'examples-pikachu', nickname: 'SQLite Pika', revision: 33 })
  })
})
