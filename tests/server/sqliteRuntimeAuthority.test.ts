import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import type { TabletopMap } from '~/types/map'

const mapDoc = (overrides: Partial<TabletopMap> = {}): TabletopMap => ({
  schemaVersion: 2,
  revision: 0,
  slug: 'untitled-map',
  name: 'SQLite Untitled',
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

const pokemonSheet = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  slug: 'examples-pikachu',
  nickname: 'SQLite Pika',
  species: 'Pikachu',
  level: 5,
  folder: '',
  player: true,
  ...overrides,
})

const legacyJsonMap = (): TabletopMap => mapDoc({
  name: 'JSON Untitled',
  revision: 99,
})

let temporaryCampaignRoot: string | null = null
let previousCampaignRoot: string | undefined

const restoreCampaignRoot = (): void => {
  if (previousCampaignRoot === undefined) delete process.env.ROTOM_CAMPAIGN_ROOT
  else process.env.ROTOM_CAMPAIGN_ROOT = previousCampaignRoot
  previousCampaignRoot = undefined
}

afterEach(() => {
  restoreCampaignRoot()
  if (temporaryCampaignRoot) rmSync(temporaryCampaignRoot, { recursive: true, force: true })
  temporaryCampaignRoot = null
  vi.resetModules()
})

describe('SQLite runtime authority boundary', () => {
  it('loads live snapshots from SQLite even when conflicting legacy JSON files exist under a temporary campaign root', async () => {
    temporaryCampaignRoot = mkdtempSync(join(tmpdir(), 'rotom-json-boundary-'))
    previousCampaignRoot = process.env.ROTOM_CAMPAIGN_ROOT
    process.env.ROTOM_CAMPAIGN_ROOT = temporaryCampaignRoot
    mkdirSync(join(temporaryCampaignRoot, 'data/maps'), { recursive: true })
    mkdirSync(join(temporaryCampaignRoot, 'data/sheets'), { recursive: true })
    writeFileSync(
      join(temporaryCampaignRoot, 'data/maps/untitled-map.json'),
      `${JSON.stringify(legacyJsonMap(), null, 2)}\n`,
    )
    writeFileSync(
      join(temporaryCampaignRoot, 'data/sheets/examples-pikachu.json'),
      `${JSON.stringify(pokemonSheet({ nickname: 'JSON Pika', revision: 99 }), null, 2)}\n`,
    )

    vi.resetModules()
    const [
      { openRotomDatabase },
      { createSqliteMapRepository },
      { createSqliteMapInteractionModeRepository },
      { createSqliteSheetRepository },
      { loadLiveTableSnapshotUseCase },
    ] = await Promise.all([
      import('../../server/storage/database'),
      import('../../server/storage/mapRepository'),
      import('../../server/storage/mapInteractionModeRepository'),
      import('../../server/storage/sheetRepository'),
      import('../../server/useCases/loadLiveTableSnapshot'),
    ])

    const database = openRotomDatabase({ path: ':memory:' })
    try {
      const mapRepository = createSqliteMapRepository(database)
      const modeRepository = createSqliteMapInteractionModeRepository(database)
      const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)

      mapRepository.saveSetupMap(mapDoc({ revision: 22 }))
      modeRepository.set({ slug: 'untitled-map', interactionMode: MAP_INTERACTION_MODES.LIVE_PLAY, updatedAt: 220 })
      sheetRepository.saveSetupSheet('pokemon', 'examples-pikachu', pokemonSheet({ revision: 33 }))

      const snapshot = loadLiveTableSnapshotUseCase(
        { role: 'gm', slug: 'untitled-map' },
        { database, mapRepository, modeRepository, sheetRepository },
      )

      expect(snapshot.map.name).toBe('SQLite Untitled')
      expect(snapshot.mapRevision).toBe(22)
      expect(snapshot.pokemonSheets).toHaveLength(1)
      expect(snapshot.pokemonSheets[0]).toMatchObject({
        slug: 'examples-pikachu',
        nickname: 'SQLite Pika',
        revision: 33,
      })
    } finally {
      database.close()
    }
  })
})
