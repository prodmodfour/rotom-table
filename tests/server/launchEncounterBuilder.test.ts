import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createEmptyEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { ENCOUNTER_BUILDER_SCHEMA_VERSION, type LaunchEncounterBuilderRequest } from '#shared/encounterDocuments/builder'
import type { WildGenerationCommitProjectionV1, WildGenerationPreviewProjectionV1 } from '#shared/gmToolkit/generation'
import { launchEncounterBuilderUseCase } from '~~/server/useCases/launchEncounterBuilder'
import { manageWildGenerationUseCase } from '~~/server/useCases/manageWildGeneration'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { createSqliteEncounterDocumentRepository } from '~~/server/storage/encounterDocumentRepository'
import { createSqliteEncounterLaunchOperationRepository } from '~~/server/storage/encounterLaunchOperationRepository'
import { createSqliteGmWildGenerationRepository } from '~~/server/storage/gmWildGenerationRepository'
import type { TabletopMap } from '~/types/map'

const databases: RotomDatabase[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })

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

const request = (packageResult: WildGenerationCommitProjectionV1, overrides: Partial<LaunchEncounterBuilderRequest> = {}): LaunchEncounterBuilderRequest => ({
  schemaVersion: ENCOUNTER_BUILDER_SCHEMA_VERSION,
  launchId: 'launch-1', encounterId: 'night-pond', name: 'Night Pond', recipe: 'wild-pack',
  mapSlug: 'pond-map', expectedMapRevision: 0, clientId: 'gm-client', startInitiative: true,
  presentation: { stage: 'standard', tactical: 'on-demand' },
  handoff: { kind: 'wild-package', documentId: packageResult.packageId, expectedRevision: 0, sceneId: null },
  cast: packageResult.sheets.map((sheet, index) => ({
    castId: `cast-${index + 1}`,
    sheet: { kind: sheet.kind, slug: sheet.slug, expectedRevision: sheet.revision },
    sourceCandidateId: sheet.candidateId,
    sideId: 'wild',
    role: index === 0 ? 'leader' : 'support',
    hidden: index === 0,
  })),
  publicStakes: 'Protect the pond', gmStakes: 'The leader may flee', notes: 'Reveal after the bell.',
  ...overrides,
})

const harness = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  databases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database, maps)
  const modes = createSqliteMapInteractionModeRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => 222 })
  const encounters = createSqliteEncounterDocumentRepository(database)
  const launches = createSqliteEncounterLaunchOperationRepository(database)
  const wild = createSqliteGmWildGenerationRepository(database)
  maps.create({ slug: 'pond-map', map: mapFixture(), now: 10 })
  modes.set({ slug: 'pond-map', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: 11 })
  const generationDeps = {
    database,
    now: () => '2026-08-25T14:00:00.000Z',
    signingKey: 'test-only-gm-toolkit-signing-key-that-is-long-enough',
    seedForCommand: () => createHash('sha256').update('p12-forest-vertical-slice-1').digest('hex'),
    publishPersistedRealtimeEvent: () => undefined,
    publishToolkitInvalidation: () => undefined,
  }
  const preview = manageWildGenerationUseCase({
    schemaVersion: 1, mode: 'preview', operationId: 'wild-operation-builder-001',
    tableId: 'encounter-table:v1:thickerby-vale-forest', expectedTableRevision: 0, requestedSlots: 3,
    party: { trainerRefs: [] }, environment: { timeOfDay: null, weather: null },
    policy: { shinyChancePercent: 0, heldItemName: null }, exploration: null,
  }, generationDeps) as WildGenerationPreviewProjectionV1
  const generated = manageWildGenerationUseCase({
    schemaVersion: 1, mode: 'commit', operationId: preview.operationId, previewToken: preview.previewToken,
    selectedCandidateIds: preview.candidates.slice(0, 2).map(row => row.candidateId), folder: 'generated/wild',
  }, generationDeps) as WildGenerationCommitProjectionV1
  const baselineEvents = realtime.readAfter({ afterSequence: 0 }).events.length
  const dependencies = {
    database, mapRepository: maps, sheetRepository: sheets, mapInteractionModeRepository: modes,
    realtimeEventRepository: realtime, encounterRepository: encounters, launchOperationRepository: launches,
    wildGenerationRepository: wild, now: () => 111,
    publishPersistedRealtimeEvent: vi.fn(),
  }
  return { database, maps, sheets, modes, realtime, encounters, launches, wild, generated, baselineEvents, dependencies }
}

describe('package-based launchEncounterBuilderUseCase', () => {
  it('atomically launches immutable accepted sheets with roles, privacy, story, and an exact receipt', async () => {
    const kit = harness()
    const first = await launchEncounterBuilderUseCase(request(kit.generated), kit.dependencies)
    expect(first).toEqual({
      ok: true, exactRetry: false, launchId: 'launch-1', encounterId: 'night-pond', encounterRevision: 0,
      mapSlug: 'pond-map', mapRevision: 1, spawned: 2,
    })
    const map = kit.maps.getBySlug('pond-map')!
    expect(map.placements).toHaveLength(2)
    expect(map.placements.every(row => row.sideId === 'wild')).toBe(true)
    expect(map.initiative?.round).toBe(1)
    expect(kit.modes.get('pond-map').interactionMode).toBe(MAP_INTERACTION_MODES.LIVE_PLAY)
    const participantIds = map.placements.map(row => row.id)
    expect(kit.encounters.get('night-pond')).toMatchObject({
      lifecycle: 'active', recipe: 'wild-pack', presentation: { stage: 'standard', tactical: 'on-demand' },
      hiddenParticipantIds: [participantIds[0]],
      castRoles: [{ participantId: participantIds[0], role: 'leader' }, { participantId: participantIds[1], role: 'support' }],
      stakes: { public: 'Protect the pond', gm: 'The leader may flee' }, notes: 'Reveal after the bell.',
    })
    expect(kit.sheets.list('pokemon')).toHaveLength(2)
    const afterFirst = kit.realtime.readAfter({ afterSequence: 0 }).events.length
    expect(afterFirst).toBeGreaterThan(kit.baselineEvents)

    const replay = await launchEncounterBuilderUseCase(request(kit.generated), kit.dependencies)
    expect(replay).toEqual({ ...first, exactRetry: true })
    expect(kit.maps.getBySlug('pond-map')?.placements).toHaveLength(2)
    expect(kit.realtime.readAfter({ afterSequence: 0 }).events).toHaveLength(afterFirst)
  })

  it('can prepare cast without initiative and fails stale package-sheet or map revisions closed', async () => {
    const prepared = harness()
    await launchEncounterBuilderUseCase(request(prepared.generated, { startInitiative: false }), prepared.dependencies)
    expect(prepared.maps.getBySlug('pond-map')?.initiative).toMatchObject({ activeId: null, round: 0 })

    const staleMap = harness()
    await expect(launchEncounterBuilderUseCase(request(staleMap.generated, { expectedMapRevision: 2 }), staleMap.dependencies)).rejects.toMatchObject({ statusCode: 409 })
    expect(staleMap.maps.getBySlug('pond-map')?.placements).toEqual([])

    const staleSheet = harness()
    const staleRequest = request(staleSheet.generated)
    const changed = { ...staleRequest, cast: [{ ...staleRequest.cast[0]!, sheet: { ...staleRequest.cast[0]!.sheet, expectedRevision: 1 } }] }
    await expect(launchEncounterBuilderUseCase(changed, staleSheet.dependencies)).rejects.toMatchObject({ statusCode: 409 })
    expect(staleSheet.maps.getBySlug('pond-map')?.placements).toEqual([])
  })

  it('rolls back map, document, mode, event, and receipt when any in-transaction step fails', async () => {
    const kit = harness()
    await expect(launchEncounterBuilderUseCase(request(kit.generated), {
      ...kit.dependencies,
      afterMapWrite: () => { throw new Error('injected launch interruption') },
    })).rejects.toThrow('injected launch interruption')
    expect(kit.maps.getBySlug('pond-map')).toMatchObject({ revision: 0, placements: [] })
    expect(kit.encounters.get('night-pond')).toBeNull()
    expect(kit.launches.get('launch-1')).toBeNull()
    expect(kit.realtime.readAfter({ afterSequence: 0 }).events).toHaveLength(kit.baselineEvents)
    expect(kit.modes.get('pond-map').interactionMode).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)
  })

  it('rejects unknown sides, changed launch material, and enriched payloads without partial state', async () => {
    const unknown = harness()
    await expect(launchEncounterBuilderUseCase(request(unknown.generated, {
      cast: [{ ...request(unknown.generated).cast[0]!, sideId: 'missing-side' }],
    }), unknown.dependencies)).rejects.toMatchObject({ statusCode: 409 })
    expect(unknown.maps.getBySlug('pond-map')?.placements).toEqual([])

    const kit = harness()
    await launchEncounterBuilderUseCase(request(kit.generated), kit.dependencies)
    await expect(launchEncounterBuilderUseCase(request(kit.generated, { name: 'Different intent' }), kit.dependencies)).rejects.toMatchObject({ statusCode: 409 })
    expect(kit.maps.getBySlug('pond-map')?.placements).toHaveLength(2)

    const malformed = harness()
    await expect(launchEncounterBuilderUseCase({ ...request(malformed.generated), mechanics: { damage: 99 } }, malformed.dependencies)).rejects.toMatchObject({ statusCode: 400 })
    await expect(launchEncounterBuilderUseCase({ ...request(malformed.generated), cast: [] }, malformed.dependencies)).rejects.toMatchObject({ statusCode: 400 })
  })
})
