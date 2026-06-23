import { afterEach, describe, expect, it } from 'vitest'
import type { TabletopMap } from '~/types/map'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { RenameSheetUseCaseError, renameSheetUseCase } from '../../server/useCases/renameSheet'

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

let databases: RotomDatabase[] = []
const db = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('rename sheet use case', () => {
  it('renames a sheet and retargets map placements atomically', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const sheets = createSqliteSheetRepository(database, maps)
    sheets.saveSetupSheet('pokemon', 'pika', { slug: 'pika', nickname: 'Pika', species: '', level: 1, revision: 2 })
    maps.saveSetupMap(mapDoc({ revision: 5, placements: [{ id: 'token-1', sheetKind: 'pokemon', sheetSlug: 'pika', position: { x: 1, y: 0, z: 1 } }] }))

    const result = renameSheetUseCase({ kind: 'pokemon', slug: 'pika', name: 'Pika Prime', clientId: 'client-1' }, {
      sheetRepository: sheets,
      now: () => 1_000,
    })

    expect(result.slug).toBe('pika-prime')
    expect(result.sheet).toMatchObject({ slug: 'pika-prime', nickname: 'Pika Prime', revision: 3 })
    expect(sheets.getByRef('pokemon', 'pika')).toBeNull()
    expect(maps.getBySlug('arena')?.placements[0]?.sheetSlug).toBe('pika-prime')
    expect(maps.getBySlug('arena')?.revision).toBe(6)
    expect(result.events.some((event) => event.channel === 'map:arena' && event.type === 'updated')).toBe(true)
  })

  it('rolls back sheet and map changes when an injected failure occurs', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const sheets = createSqliteSheetRepository(database, maps)
    sheets.saveSetupSheet('trainer', 'misty', { slug: 'misty', name: 'Misty', level: 5, revision: 4 })
    maps.saveSetupMap(mapDoc({ revision: 7, placements: [{ id: 'token-1', sheetKind: 'trainer', sheetSlug: 'misty', position: { x: 1, y: 0, z: 1 } }] }))

    expect(() => renameSheetUseCase({ kind: 'trainer', slug: 'misty', name: 'Misty Prime' }, {
      sheetRepository: sheets,
      failAfterSheetUpdate: () => { throw new Error('boom') },
    })).toThrow(RenameSheetUseCaseError)

    expect(sheets.getByRef('trainer', 'misty')).not.toBeNull()
    expect(sheets.getByRef('trainer', 'misty-prime')).toBeNull()
    expect(maps.getBySlug('arena')?.placements[0]?.sheetSlug).toBe('misty')
    expect(maps.getBySlug('arena')?.revision).toBe(7)
  })

  it('updates only the display name when the slug does not change', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    const sheets = createSqliteSheetRepository(database, maps)
    sheets.saveSetupSheet('pokemon', 'pika', { slug: 'pika', nickname: 'Pika', species: '', level: 1, revision: 1 })

    const result = renameSheetUseCase({ kind: 'pokemon', slug: 'pika', name: 'Pika' }, { sheetRepository: sheets })
    expect(result.events).toEqual([])
    expect(result.slug).toBe('pika')
  })
})
