import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyEncounterState } from '#shared/moveAutomation/encounterState'
import type { TabletopMap } from '~/types/map'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { LoadMapUseCaseError, loadMapUseCase, normalizeLoadMapSlug } from '../../server/useCases/loadMap'

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

describe('load map use case', () => {
  it('loads maps from SQLite for GMs and visible maps for players', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    maps.saveSetupMap(mapDoc({ slug: 'visible-map', name: 'Visible', revision: 7, playerVisible: true }))
    maps.saveSetupMap(mapDoc({ slug: 'hidden-map', name: 'Hidden', revision: 3, playerVisible: false }))

    expect(loadMapUseCase({ role: 'player', slug: 'visible-map' }, { mapRepository: maps })).toMatchObject({ revision: 7 })
    expect(loadMapUseCase({ role: 'gm', slug: 'hidden-map' }, { mapRepository: maps })).toMatchObject({ revision: 3 })
  })

  it('ignores missing/conflicting JSON dependencies and always uses SQLite', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    maps.saveSetupMap(mapDoc({ slug: 'arena', name: 'SQLite Arena', revision: 4 }))

    const result = loadMapUseCase({ role: 'gm', slug: 'arena' }, { mapRepository: maps })

    expect(result.map.name).toBe('SQLite Arena')
    expect(result.revision).toBe(4)
  })

  it('loads when no JSON map directory exists', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    maps.saveSetupMap(mapDoc({ slug: 'arena', revision: 1 }))

    expect(loadMapUseCase({ role: 'gm', slug: 'arena' }, { mapRepository: maps }).map.slug).toBe('arena')
  })

  it('normalizes legacy encounter state in memory without writing until the next accepted change', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    maps.save({
      slug: 'arena',
      document: mapDoc({ revision: 5, updatedAt: 500 }),
      revision: 5,
      updatedAt: 500,
    })
    const readStoredRow = () => database.connection.prepare(`
      SELECT document_json, revision, updated_at
      FROM maps
      WHERE slug = ?
    `).get('arena') as { readonly document_json: string; readonly revision: number; readonly updated_at: number }
    const beforeLoad = readStoredRow()
    expect(JSON.parse(beforeLoad.document_json)).not.toHaveProperty('encounterState')

    const loaded = loadMapUseCase({ role: 'gm', slug: 'arena' }, { mapRepository: maps })

    expect(loaded).toMatchObject({ revision: 5, map: { revision: 5 } })
    expect(loaded.map.encounterState).toEqual(createEmptyEncounterState())
    expect(readStoredRow()).toEqual(beforeLoad)

    const changed = maps.replaceSetupMap({
      slug: 'arena',
      expectedRevision: loaded.revision,
      map: { ...loaded.map, name: 'Arena Updated' },
      now: 600,
    })
    const afterWrite = readStoredRow()

    expect(changed).toMatchObject({ changed: true, map: { revision: 6 } })
    expect(afterWrite).toMatchObject({ revision: 6, updated_at: 600 })
    expect(JSON.parse(afterWrite.document_json)).toMatchObject({
      name: 'Arena Updated',
      encounterState: createEmptyEncounterState(),
    })
  })

  it('rejects unsupported encounter state loaded from SQLite', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    maps.save({
      slug: 'arena',
      document: {
        ...mapDoc(),
        encounterState: { ...createEmptyEncounterState(), schemaVersion: 2 },
      },
      revision: 0,
      updatedAt: 100,
    })

    expect(() => loadMapUseCase({ role: 'gm', slug: 'arena' }, { mapRepository: maps }))
      .toThrow('Map SQLite map arena is invalid: encounterState.schemaVersion: must be 1')
  })

  it('rejects hidden maps for players and missing maps', () => {
    const database = db()
    const maps = createSqliteMapRepository(database)
    maps.saveSetupMap(mapDoc({ slug: 'hidden-map', playerVisible: false }))

    expect(() => loadMapUseCase({ role: 'player', slug: 'hidden-map' }, { mapRepository: maps }))
      .toThrow('Map is not player visible')
    expect(() => loadMapUseCase({ role: 'gm', slug: 'missing' }, { mapRepository: maps }))
      .toThrow('Map missing.json not found')
  })

  it('validates slugs', () => {
    expect(normalizeLoadMapSlug('valid-slug-1')).toBe('valid-slug-1')
    expect(() => normalizeLoadMapSlug('../bad')).toThrow(LoadMapUseCaseError)
  })
})
