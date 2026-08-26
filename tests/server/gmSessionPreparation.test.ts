import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sessionFixture from '../../data/gm-campaign-toolkit/fixtures/session-preparation.v1.json'
import { describe, expect, it } from 'vitest'
import { applyStorageMigrations, LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteGmSessionPreparationRepository } from '../../server/storage/gmSessionPreparationRepository'
import { manageSessionPreparationUseCase } from '../../server/useCases/manageSessionPreparation'
import { parseSessionPreparationDocumentV1, projectSessionPreparationForPublic, type SessionPreparationDocumentV1 } from '#shared/gmToolkit/sessionPreparation'
import { projectCampaignSessionPreparationAttention } from '../../server/domain/campaignAttention/sessionPreparationDetector'

const openDatabase = (): RotomDatabase => {
  const connection = new DatabaseSync(':memory:'); connection.exec('PRAGMA foreign_keys = ON'); applyStorageMigrations(connection)
  let depth = 0
  return { path: ':memory:', connection, journalMode: null, withTransaction: (work) => {
    if (depth) return work() as never
    depth += 1; connection.exec('BEGIN IMMEDIATE')
    try { const result = work(); connection.exec('COMMIT'); return result as never }
    catch (error) { if (connection.isTransaction) connection.exec('ROLLBACK'); throw error }
    finally { depth -= 1 }
  }, close: () => connection.close() }
}
let sequence = 0
const op = (label: string): string => `session-preparation-test:${label}:${++sequence}`
const scene = (input: { option?: boolean; sceneId?: string } = {}) => ({
  sceneId: input.sceneId ?? 'scene:forest-arrival', title: 'Forest arrival', playerSummary: 'The path narrows beneath an old canopy.', gmNotes: 'Keep the source of the tracks private.', map: null,
  encounterCandidates: [{ candidateId: 'candidate:forest-table', label: 'Forest wildlife', selection: input.option ? 'option' : 'selected', source: { kind: 'encounter-table', tableId: 'encounter-table:v1:thickerby-vale-forest', revision: 0 }, placementIntent: { kind: 'builder-default', zoneLabel: null }, gmNotes: 'Use only if the party follows the tracks.' }],
})
const content = (input: { option?: boolean; open?: boolean; title?: string; sceneId?: string } = {}) => ({
  title: input.title ?? 'Under the Old Canopy', scheduledFor: '2026-08-30T18:00:00.000Z', playerOverview: 'The road into Thickerby Vale continues.', gmNotes: 'Private campaign plan.', scenes: [scene(input)],
  handouts: [{ handoutId: 'handout:field-note', title: 'Field note', playerText: 'A pressed leaf marks the page.', gmNotes: 'Reveal only after scene one.', release: 'on-launch' }],
  unresolvedDecisions: [{ decisionId: 'decision:weather', headline: 'Choose the weather', prompt: 'Will the rain break before arrival?', state: input.open ? 'open' : 'resolved', resolution: input.open ? null : 'The rain stops at dusk.' }],
})
const create = (database: RotomDatabase, title = 'Under the Old Canopy') => manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'create', operationId: op('create'), title, scheduledFor: null }, { repository: createSqliteGmSessionPreparationRepository(database), now: () => '2026-08-25T15:00:00.000Z' })

describe('GM session preparation authority', () => {
  it('strictly parses bounded scenes and structurally omits private material from public projections', () => {
    const draft = parseSessionPreparationDocumentV1(sessionFixture.document)
    expect(projectSessionPreparationForPublic(draft)).toBeNull()
    const launched = parseSessionPreparationDocumentV1({ ...draft, revision: 1, lifecycle: 'launched', launches: [{ launchId: 'launch:forest', sceneId: draft.scenes[0]!.sceneId, encounterId: 'encounter:forest', mapSlug: 'forest-map', launchedAt: '2026-08-30T18:05:00.000Z' }], updatedAt: '2026-08-30T18:05:00.000Z' })
    const projected = projectSessionPreparationForPublic(launched)!
    expect(projected).toMatchObject({ title: draft.title, scenes: [{ title: 'Forest arrival', playerSummary: draft.scenes[0]!.playerSummary }], handouts: [{ title: 'Field note' }] })
    expect(JSON.stringify(projected)).not.toMatch(/gmNotes|candidate|encounter-table|weather|tracks|mapSlug/i)
    expect(() => parseSessionPreparationDocumentV1({ ...draft, scenes: Array.from({ length: 21 }, (_row, index) => ({ ...scene(), sceneId: `scene:${index}` })) })).toThrow(/at most 20/)
    expect(() => parseSessionPreparationDocumentV1({ ...draft, scenes: [{ ...scene(), encounterCandidates: [{ ...scene().encounterCandidates[0], source: { kind: 'existing-sheets', sheets: [] } }] }] })).toThrow(/at least one sheet/)
  })

  it('surfaces unresolved preparation decisions as GM-only campaign attention without private text', () => {
    const preparation = parseSessionPreparationDocumentV1({ schemaVersion: 1, preparationId: 'session-preparation:v1:attention', revision: 3, lifecycle: 'review', ...content({ open: true }), launches: [], provenance: { kind: 'campaign-authored', sourcePreparationId: null, sourceRevision: null }, createdAt: '2026-08-25T15:00:00.000Z', updatedAt: '2026-08-25T15:10:00.000Z' })
    const items = projectCampaignSessionPreparationAttention({ preparations: [preparation], campaignMinute: 400, completeness: { preparations: true } })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ reason: 'session-preparation-decision', audience: 'gm', urgency: 'urgent', authority: { kind: 'session-preparation', id: preparation.preparationId, revision: 3 }, legalActions: [{ intent: 'review-session-preparation' }] })
    expect(JSON.stringify(items)).not.toMatch(/Choose the weather|rain stops|Private campaign plan|tracks/i)
    const resolved = parseSessionPreparationDocumentV1({ ...preparation, unresolvedDecisions: content().unresolvedDecisions, revision: 4 })
    expect(projectCampaignSessionPreparationAttention({ preparations: [resolved], campaignMinute: 401, completeness: { preparations: true } })).toEqual([])
  })

  it('persists exact create/save/review/ready/archive operations with visible readiness reasons', () => {
    const database = openDatabase(); const repository = createSqliteGmSessionPreparationRepository(database)
    try {
      expect(database.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: LATEST_STORAGE_SCHEMA_VERSION })
      const createCommand = { schemaVersion: 1 as const, kind: 'create' as const, operationId: op('exact-create'), title: 'Under the Old Canopy', scheduledFor: null }
      const created = manageSessionPreparationUseCase(createCommand, { repository, now: () => '2026-08-25T15:00:00.000Z' })
      expect(created).toMatchObject({ exactRetry: false, preparation: { revision: 0, lifecycle: 'draft', scenes: [] } })
      expect(manageSessionPreparationUseCase(createCommand, { repository, now: () => '2026-09-01T00:00:00.000Z' })).toEqual({ ...created, exactRetry: true })
      expect(() => manageSessionPreparationUseCase({ ...createCommand, title: 'Changed' }, { repository })).toThrow(/different preparation material/)
      const id = created.preparation.preparationId
      const saved = manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'save', operationId: op('save-open'), preparationId: id, expectedRevision: 0, content: content({ option: true, open: true }) }, { repository, now: () => '2026-08-25T15:01:00.000Z' })
      const review = manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'transition', operationId: op('review'), preparationId: id, expectedRevision: saved.preparation.revision, target: 'review' }, { repository, now: () => '2026-08-25T15:02:00.000Z' })
      expect(() => manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'transition', operationId: op('not-ready'), preparationId: id, expectedRevision: review.preparation.revision, target: 'ready' }, { repository })).toThrow(/resolve every open decision/)
      expect(repository.get(id)!.revision).toBe(review.preparation.revision)
      const resolved = manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'save', operationId: op('resolve'), preparationId: id, expectedRevision: review.preparation.revision, content: content() }, { repository, now: () => '2026-08-25T15:03:00.000Z' })
      const ready = manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'transition', operationId: op('ready'), preparationId: id, expectedRevision: resolved.preparation.revision, target: 'ready' }, { repository, now: () => '2026-08-25T15:04:00.000Z' })
      expect(ready.preparation.lifecycle).toBe('ready')
      expect(() => manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'save', operationId: op('locked-save'), preparationId: id, expectedRevision: ready.preparation.revision, content: content() }, { repository })).toThrow(/back to review/)
      const archived = manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'archive', operationId: op('archive'), preparationId: id, expectedRevision: ready.preparation.revision }, { repository, now: () => '2026-08-25T15:05:00.000Z' })
      expect(archived.preparation.lifecycle).toBe('archived')
      expect(repository.list()).toHaveLength(1)
      expect(database.connection.prepare('SELECT COUNT(*) count FROM gm_session_preparation_ops').get()).toEqual({ count: 6 })
    } finally { database.close() }
  })

  it('copies and imports exact scenes with source revisions and collision-free identities', () => {
    const database = openDatabase(); const repository = createSqliteGmSessionPreparationRepository(database)
    try {
      const source = create(database, 'Source session')
      const sourceSaved = manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'save', operationId: op('source-save'), preparationId: source.preparation.preparationId, expectedRevision: 0, content: content() }, { repository, now: () => '2026-08-25T15:01:00.000Z' })
      const copied = manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'copy', operationId: op('copy'), sourcePreparationId: source.preparation.preparationId, expectedSourceRevision: sourceSaved.preparation.revision, title: 'Copied session' }, { repository, now: () => '2026-08-25T15:02:00.000Z' })
      expect(copied.preparation).toMatchObject({ revision: 0, lifecycle: 'draft', title: 'Copied session', provenance: { kind: 'copy', sourcePreparationId: source.preparation.preparationId, sourceRevision: sourceSaved.preparation.revision } })
      const target = create(database, 'Target session')
      const imported = manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'import-scenes', operationId: op('import'), preparationId: target.preparation.preparationId, expectedRevision: 0, sourcePreparationId: source.preparation.preparationId, expectedSourceRevision: sourceSaved.preparation.revision, sceneIds: [sourceSaved.preparation.scenes[0]!.sceneId] }, { repository, now: () => '2026-08-25T15:03:00.000Z' })
      expect(imported.preparation.scenes).toHaveLength(1)
      expect(imported.preparation.scenes[0]!.sceneId).not.toBe(sourceSaved.preparation.scenes[0]!.sceneId)
      expect(imported.preparation.scenes[0]!.encounterCandidates[0]!.candidateId).not.toBe(sourceSaved.preparation.scenes[0]!.encounterCandidates[0]!.candidateId)
      const cancelled = manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'cancel', operationId: op('cancel'), preparationId: target.preparation.preparationId, expectedRevision: imported.preparation.revision }, { repository, now: () => '2026-08-25T15:04:00.000Z' })
      expect(cancelled.preparation.lifecycle).toBe('cancelled')
      expect(() => manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'copy', operationId: op('copy-cancelled'), sourcePreparationId: cancelled.preparation.preparationId, expectedSourceRevision: cancelled.preparation.revision, title: 'No copy' }, { repository })).toThrow(/cancelled preparation/)
    } finally { database.close() }
  })

  it('recovers accepted operations after restart and converges two GM tabs without duplicate revisions', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-session-preparation-')); const path = join(root, 'campaign.sqlite')
    let database = openRotomDatabase({ path })
    try {
      let repository = createSqliteGmSessionPreparationRepository(database)
      const createCommand = { schemaVersion: 1 as const, kind: 'create' as const, operationId: op('restart-create'), title: 'Restart recovery', scheduledFor: null }
      const created = manageSessionPreparationUseCase(createCommand, { repository, now: () => '2026-08-25T15:00:00.000Z' })
      const saveCommand = { schemaVersion: 1 as const, kind: 'save' as const, operationId: op('restart-save'), preparationId: created.preparation.preparationId, expectedRevision: 0, content: content() }
      const saved = manageSessionPreparationUseCase(saveCommand, { repository, now: () => '2026-08-25T15:01:00.000Z' })
      database.close(); database = openRotomDatabase({ path }); repository = createSqliteGmSessionPreparationRepository(database)
      expect(manageSessionPreparationUseCase(saveCommand, { repository, now: () => '2026-09-01T00:00:00.000Z' })).toEqual({ ...saved, exactRetry: true })
      expect(() => manageSessionPreparationUseCase({ ...saveCommand, operationId: op('second-gm-stale'), content: content({ title: 'Second GM change' }) }, { repository })).toThrow(/changed/)
      expect(repository.get(created.preparation.preparationId)!.revision).toBe(1)
      expect(database.connection.prepare('SELECT COUNT(*) count FROM gm_session_preparation_ops').get()).toEqual({ count: 2 })
    } finally { database.close(); rmSync(root, { recursive: true, force: true }) }
  }, 15_000)

  it('fails closed when a typed linked authority changes', () => {
    const database = openDatabase(); const repository = createSqliteGmSessionPreparationRepository(database)
    try {
      const preparation = create(database)
      database.connection.prepare("UPDATE gm_encounter_tables SET revision = 1, document_json = json_set(document_json, '$.revision', 1) WHERE table_id = 'encounter-table:v1:thickerby-vale-forest'").run()
      expect(() => manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'save', operationId: op('stale-table'), preparationId: preparation.preparation.preparationId, expectedRevision: 0, content: content() }, { repository })).toThrow(/missing, archived, or changed encounter table/)
      expect(repository.get(preparation.preparation.preparationId)!.revision).toBe(0)
      const missingPackageContent = content()
      missingPackageContent.scenes[0]!.encounterCandidates[0]!.source = { kind: 'wild-package', packageId: `wild-package:v1:${'0'.repeat(32)}` }
      expect(() => manageSessionPreparationUseCase({ schemaVersion: 1, kind: 'save', operationId: op('missing-package'), preparationId: preparation.preparation.preparationId, expectedRevision: 0, content: missingPackageContent }, { repository })).toThrow(/missing wild package/)
    } finally { database.close() }
  })
})
