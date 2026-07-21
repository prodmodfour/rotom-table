import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '../../shared/mapInteractionMode'
import { PLAYER_PROFILE_SCHEMA_VERSION, type PlayerProfile, type PlayerProfileDisplayName, type PlayerProfileId } from '../../shared/playerProfiles'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  createSqliteRealtimeEventRepository,
  RealtimeEventDedupeConflictError,
  type RealtimeEventRepository,
} from '../../server/storage/realtimeEventRepository'
import { setupSheetSaveRealtimeDedupeKey } from '../../server/realtime/setupDocumentRealtime'
import { SaveSheetUseCaseError, saveSheetUseCase } from '../../server/useCases/saveSheet'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
})

const pokemonSheet = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'pika',
  nickname: 'Pika',
  species: 'Pikachu',
  level: 5,
  folder: 'party',
  player: false,
  revision: 4,
  updatedAt: 100,
  ...overrides,
})

const trainerSheet = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'brock',
  name: 'Brock',
  level: 3,
  folder: 'gym',
  revision: 2,
  updatedAt: 100,
  ...overrides,
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

describe('save sheet use case', () => {
  it('commits a changed Pokémon sheet and two durable sheet-access events', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 800 })
    const published: unknown[] = []
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 4,
      sheet: { slug: 'pika', nickname: 'Pika Prime', species: 'Pikachu', level: 6, playerProfileAccessible: true, sessionPlayerAccessible: true },
      clientId: 'client-1',
    }, {
      database,
      sheetRepository: sheets,
      realtimeEventRepository: realtime,
      now: () => 200,
      publishPersistedRealtimeEvent: (event) => published.push(event),
    })

    expect(result.sheet).toMatchObject({ slug: 'pika', nickname: 'Pika Prime', level: 6, revision: 5, updatedAt: 200, folder: 'party' })
    expect(result.sheet).not.toHaveProperty('playerProfileAccessible')
    expect(result.sheet).not.toHaveProperty('sessionPlayerAccessible')
    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(5)
    expect(result.realtimeEvents.map((event) => event.event.channel)).toEqual(['sheet:pokemon:pika', 'sheets'])
    expect(result.realtimeEvents.map((event) => event.dedupeKey)).toEqual([
      'setup-sheet:pokemon:pika:5:specific',
      'setup-sheet:pokemon:pika:5:global',
    ])
    expect(result.realtimeEvents.map((event) => event.access)).toEqual([
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
      { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
    ])
    expect(result.realtimeEvents[0]?.event).toEqual({
      sequence: 1,
      timestamp: 800,
      channel: 'sheet:pokemon:pika',
      type: 'updated',
      clientId: 'client-1',
      data: { kind: 'pokemon', slug: 'pika', sheet: result.sheet },
    })
    expect(result.realtimeEvents[1]?.event).toEqual({
      sequence: 2,
      timestamp: 800,
      channel: 'sheets',
      type: 'updated',
      clientId: 'client-1',
      data: { kind: 'pokemon', slug: 'pika', sheet: result.sheet },
    })
    expect(realtime.readAfter({ afterSequence: 0 }).events).toEqual(result.realtimeEvents)
    expect(published).toEqual(result.realtimeEvents)
  })

  it('server-rolls Color Theory acquisition and ignores client-authored parameter mechanics', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())

    const result = saveSheetUseCase({
      role: 'gm', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon', slug: 'pika', expectedRevision: 4,
      sheet: {
        slug: 'pika', nickname: 'Pika', species: 'Pikachu', level: 5,
        abilities: [{
          name: 'Color Theory',
          automation: {
            schemaVersion: 1, instanceId: 'client:forged', canonicalId: 'Color Theory', definitionVersion: 1,
            selections: [{ parameterId: 'color', optionIds: ['red'] }],
          },
        }],
      },
    }, {
      database, sheetRepository: sheets, realtimeEventRepository: realtime,
      now: () => 201, randomInt: () => 9,
    })

    const automation = (result.sheet.abilities as Array<Record<string, any>>)[0]?.automation
    expect(automation).toMatchObject({
      canonicalId: 'Color Theory', definitionVersion: 1,
      selections: [{ parameterId: 'color', optionIds: ['blue-violet'] }],
    })
    expect(automation.instanceId).not.toBe('client:forged')
  })

  it('commits a changed trainer sheet with the same durable event shape', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 801 })
    sheets.saveSetupSheet('trainer', 'brock', trainerSheet())

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      expectedRevision: 2,
      sheet: {
        slug: 'brock',
        name: 'Brock Prime',
        level: 4,
        skills: {
          command: { rank: 'Master', modifier: 2 },
          focus: { rank: 'Adept' },
        },
      },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 201 })

    expect(result.sheet).toMatchObject({ slug: 'brock', name: 'Brock Prime', revision: 3, updatedAt: 201 })
    expect(result.sheet.skills).toEqual({ command: { modifier: 2 } })
    expect(result.realtimeEvents.map((event) => event.event.channel)).toEqual(['sheet:trainer:brock', 'sheets'])
    expect(result.realtimeEvents.every((event) => event.access.kind === 'sheet-access')).toBe(true)
    expect(result.realtimeEvents[0]?.event.data).toEqual({ kind: 'trainer', slug: 'brock', sheet: result.sheet })
    expect(result.realtimeEvents[1]?.dedupeKey).toBe('setup-sheet:trainer:brock:3:global')
  })

  it('returns the current document without advancing revision, appending, or publishing when unchanged', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()
    sheets.saveSetupSheet('trainer', 'brock', trainerSheet())

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      expectedRevision: 2,
      sheet: { slug: 'brock', name: 'Brock', level: 3 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, now: () => 999, publishPersistedRealtimeEvent: publish })

    expect(result.sheet.revision).toBe(2)
    expect(result.realtimeEvents).toEqual([])
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  it('rejects stale expected revisions without appending or publishing', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    const publish = vi.fn()
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({ revision: 3 }))

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 2,
      sheet: { slug: 'pika', nickname: 'Stale', species: '', level: 1 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime, publishPersistedRealtimeEvent: publish })).toThrow(SaveSheetUseCaseError)

    expect(sheets.getByRef('pokemon', 'pika')).toMatchObject({ revision: 3 })
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(publish).not.toHaveBeenCalled()
  })

  it('preserves player access policy for player saves and writes durable events', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('trainer', 'brock', trainerSheet({ player: false, revision: 1 }))

    const result = saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      expectedRevision: 1,
      sheet: { slug: 'brock', name: 'Brock Prime', level: 4, player: true },
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'brock' }]),
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime })

    expect(result.sheet).toMatchObject({ slug: 'brock', name: 'Brock Prime', player: false, revision: 2 })
    expect(result.realtimeEvents).toHaveLength(2)
    expect(result.realtimeEvents.every((event) => event.access.kind === 'sheet-access')).toBe(true)
  })

  it('preserves and redacts Pokémon GM fields for player saves', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet({
      player: true,
      revision: 1,
      gm: { notes: 'secret capture twist' },
    }))

    const result = saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 1,
      sheet: { slug: 'pika', nickname: 'Pika Prime', species: 'Pikachu', level: 5, gm: { notes: 'player should not write this' } },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime })

    expect(result.sheet).toMatchObject({ slug: 'pika', nickname: 'Pika Prime', revision: 2 })
    expect(result.sheet).not.toHaveProperty('gm')
    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({
      nickname: 'Pika Prime',
      gm: { notes: 'secret capture twist' },
      revision: 2,
    })
  })

  it('rolls back the sheet when the specific realtime event append fails', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())
    const failingRealtime = {
      database,
      appendMany: vi.fn(() => { throw new Error('specific append failed') }),
    }

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 4,
      sheet: { slug: 'pika', nickname: 'Broken', species: 'Pikachu', level: 7 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: failingRealtime })).toThrow('specific append failed')

    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({ nickname: 'Pika', revision: 4, updatedAt: 100 })
  })

  it('rolls back the specific event and sheet when the global realtime event append fails', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())
    const partialRealtime = {
      database,
      appendMany: vi.fn((inputs: Parameters<RealtimeEventRepository['appendMany']>[0]) => {
        const first = inputs[0]
        if (!first) throw new Error('missing first event')
        realtime.append(first)
        throw new Error('global append failed')
      }),
    }

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 4,
      sheet: { slug: 'pika', nickname: 'Broken', species: 'Pikachu', level: 7 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: partialRealtime })).toThrow('global append failed')

    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({ nickname: 'Pika', revision: 4, updatedAt: 100 })
    expect(realtime.cursorState().latestSequence).toBe(0)
    expect(realtime.getBySequence(1)).toBeNull()
  })

  it('rolls back sheet revision on dedupe conflicts', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    const realtime = createSqliteRealtimeEventRepository({ database })
    sheets.saveSetupSheet('pokemon', 'pika', pokemonSheet())
    realtime.append({
      event: { channel: 'sheet:pokemon:pika', type: 'updated', data: { wrong: true } },
      access: { kind: 'sheet-access', sheetKind: 'pokemon', sheetSlug: 'pika' },
      dedupeKey: setupSheetSaveRealtimeDedupeKey({ kind: 'pokemon', slug: 'pika', revision: 5, destination: 'specific' }),
    })

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 4,
      sheet: { slug: 'pika', nickname: 'Conflict', species: 'Pikachu', level: 7 },
    }, { database, sheetRepository: sheets, realtimeEventRepository: realtime })).toThrow(RealtimeEventDedupeConflictError)

    expect(sheets.getByRef('pokemon', 'pika')?.sheet).toMatchObject({ nickname: 'Pika', revision: 4, updatedAt: 100 })
    expect(realtime.cursorState().latestSequence).toBe(1)
  })

  it('blocks live-play whole-sheet saves and inaccessible player saves', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'locked', { slug: 'locked', nickname: 'Locked', species: '', level: 1, player: false, revision: 0, updatedAt: 1 })

    expect(() => saveSheetUseCase({ role: 'gm', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, kind: 'pokemon', slug: 'locked', expectedRevision: 0, sheet: { slug: 'locked' } }, { database, sheetRepository: sheets }))
      .toThrow('Whole-sheet saves are setup/edit-only')
    expect(() => saveSheetUseCase({ role: 'player', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, kind: 'pokemon', slug: 'locked', expectedRevision: 0, sheet: { slug: 'locked' } }, { database, sheetRepository: sheets }))
      .toThrow('Sheet is not marked as player accessible or linked to the selected player profile')
  })
})
