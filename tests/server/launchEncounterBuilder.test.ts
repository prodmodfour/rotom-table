import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { ENCOUNTER_BUILDER_SCHEMA_VERSION, type LaunchEncounterBuilderRequest } from '#shared/encounterDocuments/builder'
import { launchEncounterBuilderUseCase } from '~~/server/useCases/launchEncounterBuilder'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteEncounterDocumentRepository } from '~~/server/storage/encounterDocumentRepository'
import { createSqliteEncounterLaunchOperationRepository } from '~~/server/storage/encounterLaunchOperationRepository'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TabletopMap } from '~/types/map'
import type { EncounterTable } from '~/types/encounterTable'

const databases: RotomDatabase[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })

const encounterTable: EncounterTable = {
  name: 'Pond', min_level: 5, max_level: 8,
  entries: [{ weight: 1, species: 'Bulbasaur' }],
}
const mapFixture = (): TabletopMap => ({
  schemaVersion: 2, revision: 0, slug: 'pond-map', name: 'Pond Map', folder: '',
  dimensions: { x: 8, y: 2, z: 8 }, groundLevelY: 0, playerVisible: true,
  voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements: [], lights: [],
  initiative: { activeId: null, round: 0 },
  encounterState: {
    schemaVersion: 1,
    sides: {
      wild: { id: 'wild', label: 'Wild', status: 'active' },
      heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
    },
    effects: [], counters: {}, history: createEmptyEncounterHistory(), turnResources: {}, zones: [],
    groundItems: [], pendingResolutionSummaries: [],
  },
  createdAt: 10, updatedAt: 10,
})
const generatedSheet = (species: string, level: number, slug: string): CharacterSheet => ({
  slug, nickname: species, species, level, capabilities: { overland: 4 }, stats: {},
} as CharacterSheet)

const request = (overrides: Partial<LaunchEncounterBuilderRequest> = {}): LaunchEncounterBuilderRequest => ({
  schemaVersion: ENCOUNTER_BUILDER_SCHEMA_VERSION,
  launchId: 'launch-1', encounterId: 'night-pond', name: 'Night Pond', recipe: 'wild-pack',
  mapSlug: 'pond-map', clientId: 'gm-client', startInitiative: true,
  presentation: { stage: 'standard', tactical: 'on-demand' },
  source: { region: 'vale', table: 'pond', outRoot: 'data/sheets/encounters' },
  cast: [
    { castId: 'cast-1', species: 'Bulbasaur', level: 5, roll: 11, sideId: 'wild', role: 'leader', hidden: true },
    { castId: 'cast-2', species: 'Ivysaur', level: 8, roll: 72, sideId: 'wild', role: 'support', hidden: false },
  ],
  publicStakes: 'Protect the pond', gmStakes: 'The leader may flee', notes: 'Reveal after the bell.',
  ...overrides,
})

const harness = (options: { failSpecies?: string } = {}) => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database, maps)
  const modes = createSqliteMapInteractionModeRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 222 })
  const encounters = createSqliteEncounterDocumentRepository(database)
  const launches = createSqliteEncounterLaunchOperationRepository(database)
  maps.create({ slug: 'pond-map', map: mapFixture(), now: 10 })
  modes.set({ slug: 'pond-map', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 11 })
  let placementSequence = 0
  const runPokegenSheet = vi.fn(async (species: string, level: number, prefix: string, sequence: number) => {
    if (species === options.failSpecies) return { ok: false, stderr: 'reviewed species failed', content: undefined }
    const slug = `${prefix}-${species.toLowerCase()}-lv${level}-${sequence}`
    return { ok: true, stderr: '', content: JSON.stringify(generatedSheet(species, level, slug)) }
  })
  const dependencies = {
    database, mapRepository: maps, sheetRepository: sheets, mapInteractionModeRepository: modes,
    realtimeEventRepository: realtime, encounterRepository: encounters, launchOperationRepository: launches,
    projectRoot: '/repo', encounterRoot: '/repo/encounter_tables', now: () => 111,
    random: () => 0,
    pathExists: (path: string) => path === '/repo/encounter_tables/vale/pond.json',
    readTextFile: (path: string) => {
      if (path.endsWith('/pond.json')) return JSON.stringify(encounterTable)
      throw new Error(`unexpected read: ${path}`)
    },
    uniqueOutputDir: (parent: string, baseName: string) => `${parent}/${baseName}`,
    runPokegenSheet,
    createPlacementId: () => `spawn-${++placementSequence}`,
    publishPersistedRealtimeEvent: vi.fn(),
  }
  return { database, maps, sheets, modes, realtime, encounters, launches, runPokegenSheet, dependencies }
}

describe('launchEncounterBuilderUseCase', () => {
  it('atomically launches the exact reviewed cast with sides, roles, privacy, story, and a replay-safe receipt', async () => {
    const kit = harness()
    const first = await launchEncounterBuilderUseCase(request(), kit.dependencies)

    expect(first).toEqual({
      ok: true, launchId: 'launch-1', encounterId: 'night-pond', encounterRevision: 0,
      mapSlug: 'pond-map', mapRevision: 1, spawned: 2,
    })
    expect(kit.runPokegenSheet.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['Bulbasaur', 5], ['Ivysaur', 8],
    ])
    const map = kit.maps.getBySlug('pond-map')!
    expect(map.placements.map(placement => ({ id: placement.id, sideId: placement.sideId }))).toEqual([
      { id: 'spawn-1', sideId: 'wild' }, { id: 'spawn-2', sideId: 'wild' },
    ])
    expect(map.initiative).toMatchObject({ activeId: 'spawn-2', round: 1 })
    expect(kit.modes.get('pond-map').interactionMode).toBe(MAP_INTERACTION_MODES.LIVE_PLAY)
    const document = kit.encounters.get('night-pond')!
    expect(document).toMatchObject({
      lifecycle: 'active', recipe: 'wild-pack', presentation: { stage: 'standard', tactical: 'on-demand' },
      hiddenParticipantIds: ['spawn-1'],
      castRoles: [{ participantId: 'spawn-1', role: 'leader' }, { participantId: 'spawn-2', role: 'support' }],
      stakes: { public: 'Protect the pond', gm: 'The leader may flee' },
      notes: 'Reveal after the bell.',
    })
    expect(document.objectives[0]?.label).toContain('pack')
    expect(kit.sheets.list('pokemon')).toHaveLength(2)
    expect(kit.launches.get('launch-1')?.result).toEqual(first)
    const realtime = kit.realtime.readAfter({ afterSequence: 0 }).events
    expect(realtime.map(event => event.event.channel)).toEqual(expect.arrayContaining([
      'encounter:night-pond', 'encounters', 'map:pond-map', 'maps',
    ]))
    expect(JSON.stringify(realtime.filter(event => event.event.channel.startsWith('encounter')))).not.toContain('Reveal after the bell')

    const replay = await launchEncounterBuilderUseCase(request(), kit.dependencies)
    expect(replay).toEqual(first)
    expect(kit.runPokegenSheet).toHaveBeenCalledTimes(2)
    expect(kit.maps.getBySlug('pond-map')?.placements).toHaveLength(2)
  })

  it('can prepare the integrated cast without starting initiative and rejects an already-active launch', async () => {
    const prepared = harness()
    const preparedRequest = request({
      launchId: 'launch-prepared', encounterId: 'prepared-pond', startInitiative: false,
      cast: [request().cast[0]!],
    })
    await launchEncounterBuilderUseCase(preparedRequest, prepared.dependencies)
    expect(prepared.maps.getBySlug('pond-map')?.initiative).toMatchObject({ activeId: null, round: 0 })

    const active = harness()
    const current = active.maps.getBySlug('pond-map')!
    active.maps.saveSetupMap({ ...current, initiative: { activeId: 'active-existing', round: 1 } })
    await expect(launchEncounterBuilderUseCase(request(), active.dependencies)).rejects.toMatchObject({ statusCode: 409 })
    expect(active.sheets.list('pokemon')).toEqual([])
    expect(active.encounters.get('night-pond')).toBeNull()
  })

  it('rolls back every map, sheet, document, event, and receipt write when one reviewed row cannot launch', async () => {
    const kit = harness({ failSpecies: 'Ivysaur' })

    await expect(launchEncounterBuilderUseCase(request(), kit.dependencies)).rejects.toMatchObject({ statusCode: 409 })
    expect(kit.maps.getBySlug('pond-map')).toMatchObject({ revision: 0, placements: [] })
    expect(kit.sheets.list('pokemon')).toEqual([])
    expect(kit.encounters.get('night-pond')).toBeNull()
    expect(kit.launches.get('launch-1')).toBeNull()
    expect(kit.realtime.readAfter({ afterSequence: 0 }).events).toEqual([])
    expect(kit.modes.get('pond-map').interactionMode).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)
  })

  it('rolls back launch receipt, document, mode, map, and sheets when durable publication cannot be recorded', async () => {
    const kit = harness()
    await expect(launchEncounterBuilderUseCase(request(), {
      ...kit.dependencies,
      realtimeEventRepository: {
        database: kit.database,
        appendMany: () => { throw new Error('durable launch event failed') },
      },
    })).rejects.toThrow('durable launch event failed')
    expect(kit.maps.getBySlug('pond-map')).toMatchObject({ revision: 0, placements: [] })
    expect(kit.modes.get('pond-map').interactionMode).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)
    expect(kit.sheets.list('pokemon')).toEqual([])
    expect(kit.encounters.get('night-pond')).toBeNull()
    expect(kit.launches.get('launch-1')).toBeNull()
  })

  it('rejects unknown sides and conflicting launch identities without partial state', async () => {
    const kit = harness()
    const unknownSide = request({
      cast: [{ ...request().cast[0]!, sideId: 'missing-side' }],
    })
    await expect(launchEncounterBuilderUseCase(unknownSide, kit.dependencies)).rejects.toMatchObject({ statusCode: 409 })
    expect(kit.maps.getBySlug('pond-map')?.placements).toEqual([])
    expect(kit.sheets.list('pokemon')).toEqual([])

    await launchEncounterBuilderUseCase(request(), kit.dependencies)
    await expect(launchEncounterBuilderUseCase(request({ name: 'Different intent' }), kit.dependencies)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Encounter launch ID was already used for different intent.',
    })
    expect(kit.maps.getBySlug('pond-map')?.placements).toHaveLength(2)
  })

  it('rejects malformed or enriched builder payloads before generation', async () => {
    const kit = harness()
    await expect(launchEncounterBuilderUseCase({ ...request(), mechanics: { damage: 99 } }, kit.dependencies)).rejects.toMatchObject({ statusCode: 400 })
    await expect(launchEncounterBuilderUseCase({ ...request(), cast: [] }, kit.dependencies)).rejects.toMatchObject({ statusCode: 400 })
    expect(kit.runPokegenSheet).not.toHaveBeenCalled()
  })
})
