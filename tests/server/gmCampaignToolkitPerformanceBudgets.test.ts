import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import budgets from '../../data/gm-campaign-toolkit/performance-scale-budgets.v1.json'
import { parseEncounterTableDocumentV1, projectEncounterTableForLibrary } from '#shared/gmToolkit/encounterTables'
import { parseSessionPreparationDocumentV1 } from '#shared/gmToolkit/sessionPreparation'
import type { WildGenerationCommitProjectionV1, WildGenerationPreviewProjectionV1 } from '#shared/gmToolkit/generation'
import type { NpcGenerationPreviewProjectionV1 } from '#shared/gmToolkit/npcGeneration'
import { createEmptyEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteGmEncounterTableRepository } from '~~/server/storage/gmEncounterTableRepository'
import { createSqliteGmSessionPreparationRepository } from '~~/server/storage/gmSessionPreparationRepository'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { listGmEncounterTablesUseCase } from '~~/server/useCases/gmEncounterTableLibrary'
import { getSessionPreparationUseCase } from '~~/server/useCases/manageSessionPreparation'
import { manageWildGenerationUseCase } from '~~/server/useCases/manageWildGeneration'
import { manageNpcGenerationUseCase } from '~~/server/useCases/manageNpcGeneration'
import { launchEncounterBuilderUseCase } from '~~/server/useCases/launchEncounterBuilder'
import { filterRealtimeEventsForPrincipal } from '~~/server/realtime/realtimeEventAccessPolicy'
import type { TabletopMap } from '~/types/map'

const databases: RotomDatabase[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })
const elapsed = (start: number): number => performance.now() - start
const now = '2026-08-26T12:00:00.000Z'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2, revision: 0, slug: 'scale-map', name: 'Scale Map', folder: '', playerVisible: true,
  dimensions: { x: 30, y: 2, z: 30 }, groundLevelY: 0, voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements: [], lights: [],
  initiative: { activeId: null, round: 0 }, encounterState: { schemaVersion: 1, sides: { opposition: { id: 'opposition', label: 'Opposition', status: 'active' } }, effects: [], counters: {}, history: createEmptyEncounterHistory(), turnResources: {}, zones: [], groundItems: [], pendingResolutionSummaries: [] },
  createdAt: Date.parse(now), updatedAt: Date.parse(now),
})

const generationDependencies = (database: RotomDatabase, seedLabel: string) => ({
  database, now: () => now,
  signingKey: 'test-only-gm-toolkit-signing-key-that-is-long-enough',
  seedForCommand: () => createHash('sha256').update(seedLabel).digest('hex'),
  publishPersistedRealtimeEvent: () => undefined,
  publishToolkitInvalidation: () => undefined,
})

describe('Plan 12 GM Campaign Toolkit performance and scale budgets', () => {
  it('keeps 200×50 table projection, maximum generation, preparation, launch, and six-client convergence within reviewed budgets', async () => {
    const database = openRotomDatabase({ path: ':memory:' }); databases.push(database)
    const tables = createSqliteGmEncounterTableRepository(database)
    const source = tables.get('encounter-table:v1:thickerby-vale-forest')!
    const sourceSpeciesRows = source.rows.filter(row => row.kind === 'species')
    for (let tableIndex = 0; tableIndex < budgets.scale.campaignTables - 4; tableIndex += 1) {
      const tableId = `encounter-table:v1:scale-${String(tableIndex).padStart(3, '0')}`
      tables.create(parseEncounterTableDocumentV1({
        ...structuredClone(source), tableId, name: `Scale table ${String(tableIndex).padStart(3, '0')}`,
        rows: Array.from({ length: budgets.scale.rowsPerTable }, (_, rowIndex) => ({
          ...structuredClone(sourceSpeciesRows[rowIndex % sourceSpeciesRows.length]!),
          rowId: `encounter-row:v1:scale-${String(tableIndex).padStart(3, '0')}-${String(rowIndex).padStart(2, '0')}`,
        })),
        provenance: { kind: 'campaign-authored', sourceLabel: null, sourceSha256: null, sourceTableId: null, sourceRevision: null },
      }))
    }

    const listStarted = performance.now()
    const library = listGmEncounterTablesUseCase({}, { repository: tables, now: () => now })
    const listDuration = elapsed(listStarted)
    expect(library.tables).toHaveLength(budgets.scale.campaignTables)
    expect(listDuration).toBeLessThan(budgets.budgetsMs.listAndProjectTables)
    expect(Buffer.byteLength(JSON.stringify(library))).toBeLessThanOrEqual(budgets.projectionBytes.tableLibrary)

    const maximum = tables.get('encounter-table:v1:scale-000')!
    const validateStarted = performance.now()
    expect(projectEncounterTableForLibrary(parseEncounterTableDocumentV1(maximum))).toMatchObject({ speciesRowCount: budgets.scale.rowsPerTable })
    expect(elapsed(validateStarted)).toBeLessThan(budgets.budgetsMs.validateMaximumTable)

    manageWildGenerationUseCase({ schemaVersion: 1, mode: 'preview', operationId: 'wild-scale-warmup', tableId: source.tableId, expectedTableRevision: 0, requestedSlots: 1, party: { trainerRefs: [] }, environment: { timeOfDay: null, weather: null }, policy: { shinyChancePercent: 0, heldItemName: null }, exploration: null }, generationDependencies(database, 'warmup'))
    const wildDeps = generationDependencies(database, 'scale-wild')
    const previewStarted = performance.now()
    const preview = manageWildGenerationUseCase({ schemaVersion: 1, mode: 'preview', operationId: 'wild-scale-maximum', tableId: source.tableId, expectedTableRevision: 0, requestedSlots: budgets.scale.generationRequestMaximum, party: { trainerRefs: [] }, environment: { timeOfDay: null, weather: null }, policy: { shinyChancePercent: 0, heldItemName: null }, exploration: null }, wildDeps) as WildGenerationPreviewProjectionV1
    expect(elapsed(previewStarted)).toBeLessThan(budgets.budgetsMs.previewTenPokemon)
    const selected = preview.candidates.slice(0, budgets.scale.committedPokemonBudget).map(row => row.candidateId)
    expect(selected.length).toBeGreaterThan(0)
    const commitStarted = performance.now()
    const committed = manageWildGenerationUseCase({ schemaVersion: 1, mode: 'commit', operationId: preview.operationId, previewToken: preview.previewToken, selectedCandidateIds: selected, folder: 'generated/scale' }, wildDeps) as WildGenerationCommitProjectionV1
    expect(elapsed(commitStarted)).toBeLessThan(budgets.budgetsMs.commitTenPokemon)
    expect(committed.sheets.length).toBeLessThanOrEqual(budgets.scale.committedPokemonBudget)
    expect(Buffer.byteLength(JSON.stringify(preview))).toBeLessThanOrEqual(budgets.projectionBytes.previewTenPokemon)

    const npcDeps = generationDependencies(database, 'scale-npc')
    manageNpcGenerationUseCase({ schemaVersion: 1, mode: 'preview', operationId: 'npc-scale-warmup', archetypeId: 'npc-archetype:v1:field-researcher', expectedArchetypeRevision: 0, rosterCount: 0, guided: { name: 'Warmup', identity: '', tactics: '', notes: '' } }, npcDeps)
    const npcStarted = performance.now()
    const npc = manageNpcGenerationUseCase({ schemaVersion: 1, mode: 'preview', operationId: 'npc-scale-one-plus-six', archetypeId: 'npc-archetype:v1:field-researcher', expectedArchetypeRevision: 0, rosterCount: budgets.scale.npcRosterMaximum, guided: { name: 'Scale Researcher', identity: '', tactics: '', notes: '' } }, npcDeps) as NpcGenerationPreviewProjectionV1
    expect(npc.roster).toHaveLength(budgets.scale.npcRosterMaximum)
    expect(elapsed(npcStarted)).toBeLessThan(budgets.budgetsMs.previewNpcOnePlusSix)

    const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
    for (let index = 0; index < budgets.scale.preparationLinkedDocuments; index += 1) sheets.save({ kind: 'trainer', slug: `scale-trainer-${index}`, document: { slug: `scale-trainer-${index}`, name: `Scale Trainer ${index}` }, revision: 0, updatedAt: Date.parse(now) })
    const scenes = Array.from({ length: budgets.scale.preparationScenes }, (_, sceneIndex) => ({
      sceneId: `scene:scale-${sceneIndex}`, title: `Scene ${sceneIndex + 1}`, playerSummary: '', gmNotes: '', map: null,
      encounterCandidates: Array.from({ length: sceneIndex < 10 ? 3 : 2 }, (_, candidateIndex) => {
        const sheetIndex = sceneIndex < 10 ? sceneIndex * 3 + candidateIndex : 30 + (sceneIndex - 10) * 2 + candidateIndex
        return { candidateId: `candidate:scale-${sceneIndex}-${candidateIndex}`, label: `Candidate ${sheetIndex}`, selection: 'selected' as const, source: { kind: 'existing-sheets' as const, sheets: [{ kind: 'trainer' as const, slug: `scale-trainer-${sheetIndex}`, revision: 0 }] }, placementIntent: { kind: 'builder-default' as const, zoneLabel: null }, gmNotes: '' }
      }),
    }))
    const preparation = parseSessionPreparationDocumentV1({ schemaVersion: 1, preparationId: 'session-preparation:v1:scale', revision: 0, lifecycle: 'ready', title: 'Scale Preparation', scheduledFor: null, playerOverview: '', gmNotes: '', scenes, handouts: [], unresolvedDecisions: [], launches: [], provenance: { kind: 'campaign-authored', sourcePreparationId: null, sourceRevision: null }, createdAt: now, updatedAt: now })
    const preparations = createSqliteGmSessionPreparationRepository(database); preparations.create(preparation)
    const prepStarted = performance.now()
    const loaded = getSessionPreparationUseCase(preparation.preparationId, { repository: preparations })
    expect(elapsed(prepStarted)).toBeLessThan(budgets.budgetsMs.loadMaximumPreparation)
    expect(loaded.preparation.scenes).toHaveLength(budgets.scale.preparationScenes)
    expect(Buffer.byteLength(JSON.stringify(loaded))).toBeLessThanOrEqual(budgets.projectionBytes.maximumPreparation)

    const maps = createSqliteMapRepository<TabletopMap>(database); maps.create({ slug: 'scale-map', map: mapFixture(), now: Date.parse(now) })
    const modes = createSqliteMapInteractionModeRepository(database); modes.set({ slug: 'scale-map', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: Date.parse(now) })
    const launchStarted = performance.now()
    const launch = await launchEncounterBuilderUseCase({
      schemaVersion: 2, launchId: 'launch-scale-budget', encounterId: 'scale-encounter', name: 'Scale Encounter', recipe: 'wild-pack', mapSlug: 'scale-map', expectedMapRevision: 0, clientId: 'scale-gm', startInitiative: true,
      presentation: { stage: 'standard', tactical: 'on-demand' }, handoff: { kind: 'wild-package', documentId: committed.packageId, expectedRevision: 0, sceneId: null },
      cast: committed.sheets.map((ref, index) => ({ castId: `cast-${index}`, sheet: { kind: ref.kind, slug: ref.slug, expectedRevision: ref.revision }, sourceCandidateId: ref.candidateId, sideId: 'opposition', role: 'standard', hidden: false })),
      publicStakes: null, gmStakes: null, notes: null,
    }, { database, now: () => Date.parse(now), publishPersistedRealtimeEvent: () => undefined })
    expect(elapsed(launchStarted)).toBeLessThan(budgets.budgetsMs.atomicLaunch)
    expect(launch.spawned).toBe(committed.sheets.length)

    const events = createSqliteRealtimeEventRepository({ database }).readAfter({ afterSequence: 0, limit: 500 }).events
    const accessDependencies = { getMap: () => null, getSheet: () => null, getGroupInventory: () => null, getShop: () => null, getPendingMoveResolution: () => null, listTrainerSheets: () => [], playerVisibleMapSheetAccessKeys: () => new Set<string>() }
    const convergenceStarted = performance.now(); const heads: number[] = []
    for (let client = 0; client < budgets.scale.realtimeClients; client += 1) {
      const projected = filterRealtimeEventsForPrincipal({ events, principal: { role: 'gm' }, dependencies: accessDependencies })
      heads.push(projected.allowed.at(-1)?.sequence ?? 0)
    }
    expect(new Set(heads).size).toBe(1)
    expect(elapsed(convergenceStarted)).toBeLessThan(budgets.budgetsMs.sixClientConvergence)
  }, 30_000)
})
