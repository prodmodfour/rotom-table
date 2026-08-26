import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ENCOUNTER_BUILDER_SCHEMA_VERSION, type EncounterBuilderHandoffProjectionV1, type LaunchEncounterBuilderRequest } from '#shared/encounterDocuments/builder'
import { parseSessionPreparationDocumentV1 } from '#shared/gmToolkit/sessionPreparation'
import type { NpcGenerationCommitProjectionV1, NpcGenerationPreviewProjectionV1 } from '#shared/gmToolkit/npcGeneration'
import type { WildGenerationCommitProjectionV1, WildGenerationPreviewProjectionV1 } from '#shared/gmToolkit/generation'
import { createEmptyEncounterHistory } from '#shared/moveAutomation/encounterHistory'
import { MAP_INTERACTION_MODES } from '#shared/mapInteractionMode'
import { openRotomDatabase, type RotomDatabase } from '~~/server/storage/database'
import { createSqliteMapRepository } from '~~/server/storage/mapRepository'
import { createSqliteSheetRepository } from '~~/server/storage/sheetRepository'
import { createSqliteMapInteractionModeRepository } from '~~/server/storage/mapInteractionModeRepository'
import { createSqliteEncounterDocumentRepository } from '~~/server/storage/encounterDocumentRepository'
import { createSqliteEncounterLaunchOperationRepository } from '~~/server/storage/encounterLaunchOperationRepository'
import { createSqliteGmWildGenerationRepository } from '~~/server/storage/gmWildGenerationRepository'
import { createSqliteGmNpcGenerationRepository } from '~~/server/storage/gmNpcGenerationRepository'
import { createSqliteGmSessionPreparationRepository } from '~~/server/storage/gmSessionPreparationRepository'
import { createSqliteRealtimeEventRepository } from '~~/server/storage/realtimeEventRepository'
import { loadEncounterBuilderHandoffUseCase } from '~~/server/useCases/loadEncounterBuilderHandoff'
import { launchEncounterBuilderUseCase } from '~~/server/useCases/launchEncounterBuilder'
import { manageWildGenerationUseCase } from '~~/server/useCases/manageWildGeneration'
import { manageNpcGenerationUseCase } from '~~/server/useCases/manageNpcGeneration'
import { prepareFinishEncounter } from '~~/server/useCases/prepareFinishEncounter'
import { finishEncounter } from '~~/server/useCases/finishEncounter'
import { applyEncounterDirectorCommandUseCase } from '~~/server/useCases/encounterDocuments'
import { listEncounterWorkspacesUseCase } from '~~/server/useCases/listEncounterWorkspaces'
import { projectCampaignContinuation } from '~~/server/useCases/loadCampaignContinuation'
import type { TabletopMap } from '~/types/map'

const databases: RotomDatabase[] = []
afterEach(() => { for (const database of databases.splice(0)) database.close() })
const instant = '2026-08-25T18:00:00.000Z'

const mapFixture = (): TabletopMap => ({
  schemaVersion: 2, revision: 0, slug: 'forest-map', name: 'Forest Map', folder: '',
  dimensions: { x: 12, y: 2, z: 12 }, groundLevelY: 0, playerVisible: true,
  voxels: [], hazards: [], fieldEffects: { weather: [], terrains: [], rooms: [] }, placements: [], lights: [],
  initiative: { activeId: null, round: 0 },
  encounterState: {
    schemaVersion: 1,
    sides: {
      opposition: { id: 'opposition', label: 'Opposition', status: 'active' },
      heroes: { id: 'heroes', label: 'Heroes', status: 'active' },
    },
    effects: [], counters: {}, history: createEmptyEncounterHistory(), turnResources: {}, zones: [], groundItems: [], pendingResolutionSummaries: [],
  },
  createdAt: Date.parse(instant), updatedAt: Date.parse(instant),
})

const setup = () => {
  const database = openRotomDatabase({ path: ':memory:' }); databases.push(database)
  const maps = createSqliteMapRepository<TabletopMap>(database)
  const sheets = createSqliteSheetRepository<Record<string, unknown>>(database, maps)
  const modes = createSqliteMapInteractionModeRepository(database)
  const encounters = createSqliteEncounterDocumentRepository(database)
  const launches = createSqliteEncounterLaunchOperationRepository(database)
  const wild = createSqliteGmWildGenerationRepository(database)
  const npc = createSqliteGmNpcGenerationRepository(database)
  const preparations = createSqliteGmSessionPreparationRepository(database)
  const realtime = createSqliteRealtimeEventRepository({ database, clock: () => Date.parse(instant) })
  maps.create({ slug: 'forest-map', map: mapFixture(), now: Date.parse(instant) })
  modes.set({ slug: 'forest-map', interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: Date.parse(instant) })
  return { database, maps, sheets, modes, encounters, launches, wild, npc, preparations, realtime }
}

const commitWild = (database: RotomDatabase, operationId = 'wild-handoff-001'): WildGenerationCommitProjectionV1 => {
  const dependencies = {
    database, now: () => instant,
    signingKey: 'test-only-gm-toolkit-signing-key-that-is-long-enough',
    seedForCommand: () => createHash('sha256').update(operationId).digest('hex'),
    publishPersistedRealtimeEvent: () => undefined,
    publishToolkitInvalidation: () => undefined,
  }
  const preview = manageWildGenerationUseCase({
    schemaVersion: 1, mode: 'preview', operationId,
    tableId: 'encounter-table:v1:thickerby-vale-forest', expectedTableRevision: 0, requestedSlots: 2,
    party: { trainerRefs: [] }, environment: { timeOfDay: null, weather: null },
    policy: { shinyChancePercent: 0, heldItemName: null }, exploration: null,
  }, dependencies) as WildGenerationPreviewProjectionV1
  return manageWildGenerationUseCase({
    schemaVersion: 1, mode: 'commit', operationId, previewToken: preview.previewToken,
    selectedCandidateIds: preview.candidates.map(row => row.candidateId), folder: 'generated/wild',
  }, dependencies) as WildGenerationCommitProjectionV1
}

const commitNpc = (database: RotomDatabase): NpcGenerationCommitProjectionV1 => {
  const dependencies = {
    database, now: () => instant,
    signingKey: 'test-only-gm-toolkit-signing-key-that-is-long-enough',
    seedForCommand: () => createHash('sha256').update('npc-builder-handoff').digest('hex'),
    publishPersistedRealtimeEvent: () => undefined,
    publishToolkitInvalidation: () => undefined,
  }
  const preview = manageNpcGenerationUseCase({
    schemaVersion: 1, mode: 'preview', operationId: 'npc-builder-handoff-001',
    archetypeId: 'npc-archetype:v1:field-researcher', expectedArchetypeRevision: 0, rosterCount: 2,
    guided: { name: 'Researcher Rowan', identity: 'Private identity', tactics: 'Private tactics', notes: 'Private generation note' },
  }, dependencies) as NpcGenerationPreviewProjectionV1
  return manageNpcGenerationUseCase({
    schemaVersion: 1, mode: 'commit', operationId: preview.operationId, previewToken: preview.previewToken,
    trainerFolder: 'generated/npcs', pokemonFolder: 'generated/npcs/rosters',
  }, dependencies) as NpcGenerationCommitProjectionV1
}

const requestFrom = (projection: EncounterBuilderHandoffProjectionV1): LaunchEncounterBuilderRequest => ({
  schemaVersion: ENCOUNTER_BUILDER_SCHEMA_VERSION,
  launchId: 'launch-prepared-forest', encounterId: 'prepared-forest', name: projection.defaults.name,
  recipe: projection.defaults.recipe, mapSlug: projection.defaults.map?.slug ?? 'forest-map',
  expectedMapRevision: projection.defaults.map?.expectedRevision ?? 0, clientId: 'gm-one', startInitiative: true,
  presentation: { stage: 'standard', tactical: 'on-demand' }, handoff: projection.handoff,
  cast: projection.cast.map((row, index) => ({
    castId: `cast-${index + 1}`, sheet: row.sheet, sourceCandidateId: row.sourceCandidateId,
    sideId: 'opposition', role: index === 0 ? 'leader' : 'support', hidden: false,
  })),
  publicStakes: projection.defaults.publicStakes,
  gmStakes: projection.defaults.gmStakes,
  notes: projection.defaults.notes,
})

const readyPreparation = (kit: ReturnType<typeof setup>, packageId: string) => {
  const document = parseSessionPreparationDocumentV1({
    schemaVersion: 1, preparationId: 'session-preparation:v1:forest-session', revision: 0, lifecycle: 'ready',
    title: 'Forest Session', scheduledFor: instant, playerOverview: 'Follow the tracks.', gmNotes: 'Global private pacing remains in preparation.',
    scenes: [{
      sceneId: 'scene:forest-ambush', title: 'Forest Ambush', playerSummary: 'Protect the survey camp.', gmNotes: 'The leader withdraws if cornered.',
      map: { slug: 'forest-map', revision: 0 },
      encounterCandidates: [{ candidateId: 'candidate:accepted-wilds', label: 'Forest wildlife', selection: 'selected', source: { kind: 'wild-package', packageId }, placementIntent: { kind: 'map-zone', zoneLabel: 'North trail' }, gmNotes: 'Begin out of sight.' }],
    }],
    handouts: [], unresolvedDecisions: [], launches: [], provenance: { kind: 'campaign-authored', sourcePreparationId: null, sourceRevision: null },
    createdAt: instant, updatedAt: instant,
  })
  return kit.preparations.create(document)
}

const launchDependencies = (kit: ReturnType<typeof setup>, overrides: Record<string, unknown> = {}) => ({
  database: kit.database, mapRepository: kit.maps, sheetRepository: kit.sheets, mapInteractionModeRepository: kit.modes,
  realtimeEventRepository: kit.realtime, encounterRepository: kit.encounters, launchOperationRepository: kit.launches,
  wildGenerationRepository: kit.wild, npcGenerationRepository: kit.npc, sessionPreparationRepository: kit.preparations,
  now: () => Date.parse('2026-08-25T18:05:00.000Z'), publishPersistedRealtimeEvent: vi.fn(), ...overrides,
})

describe('typed immutable Encounter Builder handoffs', () => {
  it('assembles direct wild and NPC packages without exposing private generation provenance', () => {
    const kit = setup()
    const wild = commitWild(kit.database)
    const npc = commitNpc(kit.database)
    const wildHandoff = loadEncounterBuilderHandoffUseCase({ kind: 'wild-package', documentId: wild.packageId, expectedRevision: 0, sceneId: null }, { database: kit.database }).handoff
    const npcHandoff = loadEncounterBuilderHandoffUseCase({ kind: 'npc-package', documentId: npc.packageId, expectedRevision: 0, sceneId: null }, { database: kit.database }).handoff
    expect(wildHandoff).toMatchObject({ source: { label: wild.table.name }, defaults: { recipe: 'wild-pack', storyLocked: false } })
    expect(wildHandoff.cast).toHaveLength(wild.sheets.length)
    expect(npcHandoff).toMatchObject({ source: { label: 'Researcher Rowan' }, defaults: { recipe: 'trainer-duel', storyLocked: false } })
    expect(npcHandoff.cast).toHaveLength(3)
    expect(npcHandoff.cast.map(row => row.sheet.kind)).toEqual(['trainer', 'pokemon', 'pokemon'])
    expect(JSON.stringify(npcHandoff)).not.toMatch(/Private identity|Private tactics|Private generation note|serverPrivate|journal|seed/i)
  }, 15_000)

  it('revalidates a Ready scene in one transaction, records one immutable launch, and exact-retries without duplication', async () => {
    const kit = setup(); const generated = commitWild(kit.database); readyPreparation(kit, generated.packageId)
    const invalidations: unknown[] = []
    const loaded = loadEncounterBuilderHandoffUseCase({ kind: 'session-preparation', documentId: 'session-preparation:v1:forest-session', expectedRevision: 0, sceneId: 'scene:forest-ambush' }, { database: kit.database }).handoff
    expect(loaded).toMatchObject({ source: { label: 'Forest Session', sceneLabel: 'Forest Ambush' }, defaults: { map: { slug: 'forest-map', expectedRevision: 0 }, publicStakes: 'Protect the survey camp.', storyLocked: true } })
    expect(loaded.cast.every(row => row.placementIntent.zoneLabel === 'North trail')).toBe(true)
    const request = requestFrom(loaded)
    const deps = launchDependencies(kit, { publishToolkitInvalidation: (value: unknown) => invalidations.push(value) })
    const first = await launchEncounterBuilderUseCase(request, deps)
    expect(first).toMatchObject({ exactRetry: false, spawned: generated.sheets.length, mapRevision: 1 })
    expect(kit.encounters.get('prepared-forest')).toMatchObject({ stakes: { public: 'Protect the survey camp.', gm: null }, notes: expect.stringContaining('Begin out of sight.') })
    expect(kit.preparations.get('session-preparation:v1:forest-session')).toMatchObject({
      revision: 1, lifecycle: 'launched', launches: [{ launchId: request.launchId, sceneId: 'scene:forest-ambush', encounterId: 'prepared-forest', mapSlug: 'forest-map' }],
    })
    expect(kit.database.connection.prepare("SELECT COUNT(*) count FROM gm_session_preparation_ops WHERE command_kind = 'record-launch'").get()).toEqual({ count: 1 })
    expect(invalidations).toEqual([{ schemaVersion: 1, domain: 'session-preparation', documentId: 'session-preparation:v1:forest-session', revision: 1 }])
    const events = kit.realtime.readAfter({ afterSequence: 0 }).events.length
    expect(await launchEncounterBuilderUseCase(request, deps)).toEqual({ ...first, exactRetry: true })
    expect(kit.maps.getBySlug('forest-map')?.placements).toHaveLength(generated.sheets.length)
    expect(kit.preparations.get('session-preparation:v1:forest-session')?.launches).toHaveLength(1)
    expect(kit.realtime.readAfter({ afterSequence: 0 }).events).toHaveLength(events)
    expect(invalidations).toHaveLength(1)
  })

  it('continues through the ordinary liveplay settlement authority without a toolkit-specific engine', async () => {
    const kit = setup(); const generated = commitWild(kit.database, 'wild-handoff-settlement'); readyPreparation(kit, generated.packageId)
    const loaded = loadEncounterBuilderHandoffUseCase({ kind: 'session-preparation', documentId: 'session-preparation:v1:forest-session', expectedRevision: 0, sceneId: 'scene:forest-ambush' }, { database: kit.database }).handoff
    await launchEncounterBuilderUseCase(requestFrom(loaded), launchDependencies(kit))
    expect(listEncounterWorkspacesUseCase({ role: 'player' }, { mapRepository: kit.maps, encounterRepository: kit.encounters }).summaries[0]).toMatchObject({ encounterId: 'prepared-forest', lifecycle: 'active', participantCount: generated.sheets.length })
    applyEncounterDirectorCommandUseCase({
      schemaVersion: 1, commandId: 'director-resolve-prepared-story', encounterId: 'prepared-forest', baseRevision: 0,
      type: 'set-story', payload: { name: 'Forest Ambush', lifecycle: 'active', publicStakes: null, gmStakes: null, notes: null },
    }, { database: kit.database, now: () => Date.parse('2026-08-25T18:09:00.000Z'), publishPersistedRealtimeEvent: () => undefined })
    const objective = kit.encounters.get('prepared-forest')!.objectives[0]!
    applyEncounterDirectorCommandUseCase({
      schemaVersion: 1, commandId: 'director-resolve-prepared-objective', encounterId: 'prepared-forest', baseRevision: 1,
      type: 'upsert-objective', payload: { objective: { ...objective, status: 'completed' } },
    }, { database: kit.database, now: () => Date.parse('2026-08-25T18:09:30.000Z'), publishPersistedRealtimeEvent: () => undefined })
    const prepared = prepareFinishEncounter({ role: 'gm', encounterId: 'prepared-forest', now: Date.parse('2026-08-25T18:10:00.000Z') }, { database: kit.database })
    expect(prepared.view).toMatchObject({ state: 'ready', readinessLabel: 'Ready to settle', participantCount: generated.sheets.length })
    expect(prepared.view.command).not.toBeNull()
    const settled = finishEncounter({ role: 'gm', principalKey: 'role:gm', command: prepared.view.command }, { database: kit.database })
    expect(settled).toMatchObject({ state: 'accepted', accepted: { replayed: false } })
    expect(kit.encounters.get('prepared-forest')?.lifecycle).toBe('completed')
    expect(kit.maps.getBySlug('forest-map')).toMatchObject({ initiative: { activeId: null, round: 1 } })
    expect(listEncounterWorkspacesUseCase({ role: 'gm' }, { mapRepository: kit.maps, encounterRepository: kit.encounters }).summaries[0]).toMatchObject({ encounterId: 'prepared-forest', lifecycle: 'completed' })
    expect(finishEncounter({ role: 'gm', principalKey: 'role:gm', command: prepared.view.command }, { database: kit.database })).toMatchObject({ state: 'accepted', accepted: { replayed: true } })
  })

  it('runs one multi-scene wild-and-NPC campaign through ordinary settlement and convergent continuation for six clients', async () => {
    const kit = setup()
    const secondMap = { ...mapFixture(), slug: 'research-map', name: 'Research Camp', createdAt: Date.parse(instant), updatedAt: Date.parse(instant) }
    kit.maps.create({ slug: secondMap.slug, map: secondMap, now: Date.parse(instant) })
    kit.modes.set({ slug: secondMap.slug, interactionMode: MAP_INTERACTION_MODES.SETUP_EDIT, updatedAt: Date.parse(instant) })
    const wild = commitWild(kit.database, 'wild-golden-multi-scene')
    const npc = commitNpc(kit.database)
    kit.preparations.create(parseSessionPreparationDocumentV1({
      schemaVersion: 1, preparationId: 'session-preparation:v1:golden-weekend', revision: 0, lifecycle: 'ready',
      title: 'Thickerby Vale Weekend', scheduledFor: instant, playerOverview: 'Follow the survey road.', gmNotes: 'PRIVATE ROOT PLAN',
      scenes: [
        {
          sceneId: 'scene:golden-wild', title: 'Old Canopy', playerSummary: 'Protect the old trail.', gmNotes: 'PRIVATE WILD PLAN',
          map: { slug: 'forest-map', revision: 0 },
          encounterCandidates: [{ candidateId: 'candidate:golden-wild', label: 'Forest wildlife', selection: 'selected', source: { kind: 'wild-package', packageId: wild.packageId }, placementIntent: { kind: 'builder-default', zoneLabel: null }, gmNotes: 'PRIVATE WILD PLACEMENT' }],
        },
        {
          sceneId: 'scene:golden-npc', title: 'Research Camp', playerSummary: 'Meet the rival survey team.', gmNotes: 'PRIVATE NPC PLAN',
          map: { slug: 'research-map', revision: 0 },
          encounterCandidates: [{ candidateId: 'candidate:golden-npc', label: 'Field researcher', selection: 'selected', source: { kind: 'npc-package', packageId: npc.packageId }, placementIntent: { kind: 'map-zone', zoneLabel: 'Camp edge' }, gmNotes: 'PRIVATE NPC PLACEMENT' }],
        },
      ],
      handouts: [{ handoutId: 'handout:golden-map', title: 'Survey map', playerText: 'A trail joins the two camps.', gmNotes: 'PRIVATE HANDOUT NOTE', release: 'on-launch' }],
      unresolvedDecisions: [], launches: [], provenance: { kind: 'campaign-authored', sourcePreparationId: null, sourceRevision: null },
      createdAt: instant, updatedAt: instant,
    }))

    const settle = (encounterId: string, key: string): void => {
      let document = kit.encounters.get(encounterId)!
      applyEncounterDirectorCommandUseCase({
        schemaVersion: 1, commandId: `director-story-${key}`, encounterId, baseRevision: document.revision,
        type: 'set-story', payload: { name: document.name, lifecycle: 'active', publicStakes: null, gmStakes: null, notes: null },
      }, { database: kit.database, now: () => Date.parse('2026-08-25T18:09:00.000Z'), publishPersistedRealtimeEvent: () => undefined })
      document = kit.encounters.get(encounterId)!
      const objective = document.objectives[0]!
      applyEncounterDirectorCommandUseCase({
        schemaVersion: 1, commandId: `director-objective-${key}`, encounterId, baseRevision: document.revision,
        type: 'upsert-objective', payload: { objective: { ...objective, status: 'completed' } },
      }, { database: kit.database, now: () => Date.parse('2026-08-25T18:09:30.000Z'), publishPersistedRealtimeEvent: () => undefined })
      const prepared = prepareFinishEncounter({ role: 'gm', encounterId, now: Date.parse('2026-08-25T18:10:00.000Z') }, { database: kit.database })
      expect(prepared.view).toMatchObject({ state: 'ready', readinessLabel: 'Ready to settle' })
      expect(finishEncounter({ role: 'gm', principalKey: 'role:gm', command: prepared.view.command! }, { database: kit.database })).toMatchObject({ state: 'accepted', accepted: { replayed: false } })
    }

    const first = loadEncounterBuilderHandoffUseCase({ kind: 'session-preparation', documentId: 'session-preparation:v1:golden-weekend', expectedRevision: 0, sceneId: 'scene:golden-wild' }, { database: kit.database }).handoff
    await launchEncounterBuilderUseCase({ ...requestFrom(first), launchId: 'launch-golden-wild', encounterId: 'golden-wild', name: 'Old Canopy' }, launchDependencies(kit))
    settle('golden-wild', 'wild')
    const afterWild = kit.preparations.get('session-preparation:v1:golden-weekend')!
    expect(afterWild).toMatchObject({ lifecycle: 'launched', revision: 1, launches: [{ sceneId: 'scene:golden-wild' }] })
    const emptyAttention = { schemaVersion: 1 as const, snapshotId: `campaign-attention-snapshot:v1:${'a'.repeat(64)}`, scope: 'gm' as const, campaignMinute: 0, items: [], summary: { total: 0, blocking: 0, urgent: 0, normal: 0, informational: 0 } }
    expect(projectCampaignContinuation({ role: 'gm', attention: emptyAttention, workspaces: [], settlements: [], preparations: [afterWild], eggs: [] }).readyPreparation).toMatchObject({ label: 'Thickerby Vale Weekend', state: 'in-progress', sceneCount: 1 })

    const second = loadEncounterBuilderHandoffUseCase({ kind: 'session-preparation', documentId: 'session-preparation:v1:golden-weekend', expectedRevision: 1, sceneId: 'scene:golden-npc' }, { database: kit.database }).handoff
    expect(second.cast.map(row => row.sheet.kind)).toEqual(['trainer', 'pokemon', 'pokemon'])
    await launchEncounterBuilderUseCase({ ...requestFrom(second), launchId: 'launch-golden-npc', encounterId: 'golden-npc', name: 'Research Camp' }, launchDependencies(kit))
    settle('golden-npc', 'npc')
    const completedPreparation = kit.preparations.get('session-preparation:v1:golden-weekend')!
    expect(completedPreparation).toMatchObject({ revision: 2, launches: [{ sceneId: 'scene:golden-wild' }, { sceneId: 'scene:golden-npc' }] })
    expect(projectCampaignContinuation({ role: 'gm', attention: emptyAttention, workspaces: [], settlements: [], preparations: [completedPreparation], eggs: [] }).readyPreparation).toBeNull()

    const clients = ['gm-one', 'gm-two', 'player-one', 'player-two', 'player-three', 'player-four'].map((clientId, index) => ({
      clientId,
      summaries: listEncounterWorkspacesUseCase({ role: index < 2 ? 'gm' : 'player' }, { mapRepository: kit.maps, encounterRepository: kit.encounters }).summaries,
    }))
    for (const client of clients) {
      expect(client.summaries.map(row => [row.encounterId, row.lifecycle]).sort()).toEqual([['golden-npc', 'completed'], ['golden-wild', 'completed']])
      expect(JSON.stringify(client.summaries)).not.toMatch(/PRIVATE ROOT PLAN|PRIVATE WILD PLAN|PRIVATE NPC PLAN|PRIVATE HANDOUT NOTE/)
    }
    expect(kit.preparations.get('session-preparation:v1:golden-weekend')?.launches).toHaveLength(2)
    expect(kit.launches.get('launch-golden-wild')).not.toBeNull()
    expect(kit.launches.get('launch-golden-npc')).not.toBeNull()
  }, 20_000)

  it('rolls back map, Encounter Document, preparation evidence, operation, mode, and realtime after an interrupted linked write', async () => {
    const kit = setup(); const generated = commitWild(kit.database, 'wild-handoff-rollback'); readyPreparation(kit, generated.packageId)
    const loaded = loadEncounterBuilderHandoffUseCase({ kind: 'session-preparation', documentId: 'session-preparation:v1:forest-session', expectedRevision: 0, sceneId: 'scene:forest-ambush' }, { database: kit.database }).handoff
    const baselineEvents = kit.realtime.readAfter({ afterSequence: 0 }).events.length
    await expect(launchEncounterBuilderUseCase(requestFrom(loaded), launchDependencies(kit, {
      afterPreparationWrite: () => { throw new Error('injected linked preparation interruption') },
    }))).rejects.toThrow('injected linked preparation interruption')
    expect(kit.maps.getBySlug('forest-map')).toMatchObject({ revision: 0, placements: [] })
    expect(kit.encounters.get('prepared-forest')).toBeNull()
    expect(kit.launches.get('launch-prepared-forest')).toBeNull()
    expect(kit.preparations.get('session-preparation:v1:forest-session')).toMatchObject({ revision: 0, lifecycle: 'ready', launches: [] })
    expect(kit.database.connection.prepare("SELECT COUNT(*) count FROM gm_session_preparation_ops WHERE command_kind = 'record-launch'").get()).toEqual({ count: 0 })
    expect(kit.modes.get('forest-map').interactionMode).toBe(MAP_INTERACTION_MODES.SETUP_EDIT)
    expect(kit.realtime.readAfter({ afterSequence: 0 }).events).toHaveLength(baselineEvents)
  })

  it('backs up and restores table, package, linked preparation, launch receipt, map, Encounter Document, and signing authority exactly', async () => {
    const kit = setup(); const generated = commitWild(kit.database, 'wild-handoff-backup'); readyPreparation(kit, generated.packageId)
    const loaded = loadEncounterBuilderHandoffUseCase({ kind: 'session-preparation', documentId: 'session-preparation:v1:forest-session', expectedRevision: 0, sceneId: 'scene:forest-ambush' }, { database: kit.database }).handoff
    const launched = await launchEncounterBuilderUseCase(requestFrom(loaded), launchDependencies(kit))
    const secretBefore = kit.database.connection.prepare("SELECT secret_value FROM gm_toolkit_secrets WHERE secret_id = 'preview-signing-v1'").get()
    const root = mkdtempSync(join(tmpdir(), 'rotom-toolkit-backup-')); const backupPath = join(root, 'campaign-backup.sqlite')
    try {
      await backup(kit.database.connection, backupPath)
      const audit = JSON.parse(execFileSync('python3', ['scripts/audit_gm_campaign_toolkit_storage.py', '--database', backupPath, '--json'], { encoding: 'utf8' }))
      expect(audit).toMatchObject({ status: 'accepted', counts: { storageSchemaVersion: 56, wildOperations: 1, wildPackages: 1, preparations: 1, launchOperations: 1, recordLaunchOperations: 1, errors: 0 } })
      const restored = openRotomDatabase({ path: backupPath, enableWal: false })
      try {
        expect(createSqliteGmWildGenerationRepository(restored).getByPackageId(generated.packageId)?.result).toEqual({ ...generated, exactRetry: true })
        expect(createSqliteGmSessionPreparationRepository(restored).get('session-preparation:v1:forest-session')).toMatchObject({ revision: 1, lifecycle: 'launched', launches: [{ launchId: launched.launchId }] })
        expect(createSqliteEncounterLaunchOperationRepository(restored).get(launched.launchId)?.result).toEqual(launched)
        expect(createSqliteEncounterDocumentRepository(restored).get(launched.encounterId)).toMatchObject({ lifecycle: 'active', linkedMapSlug: 'forest-map' })
        expect(createSqliteMapRepository<TabletopMap>(restored).getBySlug('forest-map')).toMatchObject({ revision: 1, placements: expect.any(Array) })
        expect(restored.connection.prepare("SELECT COUNT(*) count FROM gm_encounter_tables WHERE table_id = 'encounter-table:v1:thickerby-vale-forest'").get()).toEqual({ count: 1 })
        expect(restored.connection.prepare("SELECT secret_value FROM gm_toolkit_secrets WHERE secret_id = 'preview-signing-v1'").get()).toEqual(secretBefore)
        expect(restored.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      } finally { restored.close() }

      const brokenPath = join(root, 'broken-backup.sqlite'); copyFileSync(backupPath, brokenPath)
      const broken = new DatabaseSync(brokenPath)
      try { broken.prepare('DELETE FROM sheets WHERE kind = ? AND slug = ?').run('pokemon', generated.sheets[0]!.slug) } finally { broken.close() }
      const failedAudit = spawnSync('python3', ['scripts/audit_gm_campaign_toolkit_storage.py', '--database', brokenPath, '--json'], { encoding: 'utf8' })
      expect(failedAudit.status).toBe(1)
      expect(JSON.parse(failedAudit.stdout)).toMatchObject({ status: 'failed', counts: { errors: expect.any(Number) } })
      expect(failedAudit.stdout).toContain('missing ordinary sheet')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('fails stale preparation, source sheet, map, and browser-authored scene prose closed with zero launch state', async () => {
    const stalePreparation = setup(); const generated = commitWild(stalePreparation.database); readyPreparation(stalePreparation, generated.packageId)
    expect(() => loadEncounterBuilderHandoffUseCase({ kind: 'session-preparation', documentId: 'session-preparation:v1:forest-session', expectedRevision: 1, sceneId: 'scene:forest-ambush' }, { database: stalePreparation.database })).toThrow(/changed/i)

    const staleSheet = setup(); const generatedSheet = commitWild(staleSheet.database); readyPreparation(staleSheet, generatedSheet.packageId)
    staleSheet.database.connection.prepare('UPDATE sheets SET revision = 1 WHERE kind = ? AND slug = ?').run('pokemon', generatedSheet.sheets[0]!.slug)
    expect(() => loadEncounterBuilderHandoffUseCase({ kind: 'session-preparation', documentId: 'session-preparation:v1:forest-session', expectedRevision: 0, sceneId: 'scene:forest-ambush' }, { database: staleSheet.database })).toThrow(/sheet.*changed/i)

    const spoofed = setup(); const generatedSpoof = commitWild(spoofed.database); readyPreparation(spoofed, generatedSpoof.packageId)
    const loaded = loadEncounterBuilderHandoffUseCase({ kind: 'session-preparation', documentId: 'session-preparation:v1:forest-session', expectedRevision: 0, sceneId: 'scene:forest-ambush' }, { database: spoofed.database }).handoff
    await expect(launchEncounterBuilderUseCase({ ...requestFrom(loaded), notes: 'Browser-authored replacement' }, launchDependencies(spoofed))).rejects.toMatchObject({ statusCode: 409 })
    expect(spoofed.maps.getBySlug('forest-map')?.placements).toEqual([])
    expect(spoofed.encounters.get('prepared-forest')).toBeNull()
  })
})
