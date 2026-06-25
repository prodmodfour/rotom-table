import { afterEach } from 'vitest'
import type { PersistedRealtimeEvent } from '#shared/realtimeEventLog'
import type { TabletopMap } from '~/types/map'
import { openRotomDatabase, type RotomDatabase } from '../../../server/storage/database'
import { createSqliteMapRepository } from '../../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../../server/storage/sheetRepository'
import { createSqliteMapInteractionModeRepository } from '../../../server/storage/mapInteractionModeRepository'
import { createSqliteRealtimeEventRepository } from '../../../server/storage/realtimeEventRepository'

const databases: RotomDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

export const mapDoc = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
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
  createdAt: 10,
  updatedAt: 10,
  ...overrides,
})

export const durableHarness = (clock = 10_000) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database, maps)
  const modes = createSqliteMapInteractionModeRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => clock })
  const published: PersistedRealtimeEvent[] = []
  return { database, maps, sheets, modes, realtime, published }
}

export const pokemonSheet = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'pika',
  nickname: 'Pika',
  species: 'Pikachu',
  level: 5,
  player: false,
  folder: '',
  revision: 0,
  updatedAt: 20,
  ...overrides,
})

export const trainerSheet = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'brock',
  name: 'Brock',
  level: 5,
  player: false,
  folder: '',
  revision: 0,
  updatedAt: 20,
  ...overrides,
})
