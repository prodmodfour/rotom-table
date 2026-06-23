import { afterEach, describe, expect, it } from 'vitest'
import { MAP_INTERACTION_MODES } from '../../shared/mapInteractionMode'
import { PLAYER_PROFILE_SCHEMA_VERSION, type PlayerProfile, type PlayerProfileDisplayName, type PlayerProfileId } from '../../shared/playerProfiles'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { SaveSheetUseCaseError, saveSheetUseCase } from '../../server/useCases/saveSheet'

const playerProfile = (linkedCharacters: PlayerProfile['linkedCharacters']): PlayerProfile => ({
  schemaVersion: PLAYER_PROFILE_SCHEMA_VERSION,
  id: 'profile_ash00000' as PlayerProfileId,
  displayName: 'Ash' as PlayerProfileDisplayName,
  linkedCharacters,
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
  it('updates SQLite, advances revision once, strips client-only access fields and emits committed events', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'pika', { slug: 'pika', nickname: 'Pika', species: 'Pikachu', level: 5, folder: 'party', player: false, revision: 4, updatedAt: 100 })

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 4,
      sheet: { slug: 'pika', nickname: 'Pika Prime', species: 'Pikachu', level: 6, playerProfileAccessible: true, sessionPlayerAccessible: true },
      clientId: 'client-1',
    }, { sheetRepository: sheets, now: () => 200 })

    expect(result.sheet).toMatchObject({ slug: 'pika', nickname: 'Pika Prime', level: 6, revision: 5, updatedAt: 200, folder: 'party' })
    expect(result.sheet).not.toHaveProperty('playerProfileAccessible')
    expect(result.sheet).not.toHaveProperty('sessionPlayerAccessible')
    expect(sheets.getByRef('pokemon', 'pika')?.revision).toBe(5)
    expect(result.events).toEqual([
      { channel: 'sheet:pokemon:pika', type: 'updated', clientId: 'client-1', data: { kind: 'pokemon', slug: 'pika', sheet: result.sheet } },
      { channel: 'sheets', type: 'updated', clientId: 'client-1', data: { kind: 'pokemon', slug: 'pika', sheet: result.sheet } },
    ])
  })

  it('returns the current document without advancing revision when unchanged', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('trainer', 'brock', { slug: 'brock', name: 'Brock', level: 3, revision: 2, updatedAt: 100 })

    const result = saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      expectedRevision: 2,
      sheet: { slug: 'brock', name: 'Brock', level: 3 },
    }, { sheetRepository: sheets, now: () => 999 })

    expect(result.sheet.revision).toBe(2)
    expect(result.events).toEqual([])
  })

  it('rejects stale expected revisions', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'pika', { slug: 'pika', nickname: 'Pika', species: '', level: 1, revision: 3 })

    expect(() => saveSheetUseCase({
      role: 'gm',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'pokemon',
      slug: 'pika',
      expectedRevision: 2,
      sheet: { slug: 'pika', nickname: 'Stale', species: '', level: 1 },
    }, { sheetRepository: sheets })).toThrow(SaveSheetUseCaseError)
  })

  it('preserves player access policy for player saves', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('trainer', 'brock', { slug: 'brock', name: 'Brock', level: 3, player: false, revision: 1 })

    const result = saveSheetUseCase({
      role: 'player',
      interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT,
      kind: 'trainer',
      slug: 'brock',
      expectedRevision: 1,
      sheet: { slug: 'brock', name: 'Brock Prime', level: 4, player: true },
      playerProfile: playerProfile([{ sheetKind: 'trainer', sheetSlug: 'brock' }]),
    }, { sheetRepository: sheets })

    expect(result.sheet).toMatchObject({ slug: 'brock', name: 'Brock Prime', player: false, revision: 2 })
  })

  it('blocks live-play whole-sheet saves and inaccessible player saves', () => {
    const database = db()
    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    sheets.saveSetupSheet('pokemon', 'locked', { slug: 'locked', nickname: 'Locked', species: '', level: 1, player: false, revision: 0 })

    expect(() => saveSheetUseCase({ role: 'gm', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, kind: 'pokemon', slug: 'locked', expectedRevision: 0, sheet: { slug: 'locked' } }, { sheetRepository: sheets }))
      .toThrow('Whole-sheet saves are setup/edit-only')
    expect(() => saveSheetUseCase({ role: 'player', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, kind: 'pokemon', slug: 'locked', expectedRevision: 0, sheet: { slug: 'locked' } }, { sheetRepository: sheets }))
      .toThrow('Sheet is not marked as player accessible or linked to the selected player profile')
  })
})
