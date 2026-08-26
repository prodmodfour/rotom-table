import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import deterministicFixtures from '../../data/gm-campaign-toolkit/fixtures/deterministic-generation.v1.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import type { WildGenerationCommitProjectionV1, WildGenerationPreviewCommandV1, WildGenerationPreviewProjectionV1 } from '#shared/gmToolkit/generation'
import { applyStorageMigrations } from '../../server/storage/migrations'
import type { RotomDatabase } from '../../server/storage/database'
import { createSqliteGmWildGenerationRepository } from '../../server/storage/gmWildGenerationRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { manageWildGenerationUseCase, type ManageWildGenerationDependencies } from '../../server/useCases/manageWildGeneration'
import { applyItemRepelCampaignEffect } from '../../server/domain/itemAutomation/exploration'
import { ITEM_AUTOMATION_RUNTIME_REGISTRY } from '../../server/domain/itemAutomation/registry'
import { constructWildPokemon } from '../../server/domain/gmToolkit/wildPokemonConstruction'
import { createGmToolkitSeededRng } from '../../server/domain/gmToolkit/seededRng'
import type { TrainerSheet } from '~/types/trainerSheet'

const openDatabase = (): RotomDatabase => {
  const connection = new DatabaseSync(':memory:')
  connection.exec('PRAGMA foreign_keys = ON')
  applyStorageMigrations(connection)
  let depth = 0
  return {
    path: ':memory:', connection, journalMode: null,
    withTransaction: (work) => {
      if (depth > 0) return work() as never
      depth += 1
      connection.exec('BEGIN IMMEDIATE')
      try { const result = work(); connection.exec('COMMIT'); return result as never }
      catch (error) { if (connection.isTransaction) connection.exec('ROLLBACK'); throw error }
      finally { depth -= 1 }
    },
    close: () => connection.close(),
  }
}

const seed = createHash('sha256').update('p12-forest-vertical-slice-1').digest('hex')
const command = (operationId = 'wild-operation-forest-001', requestedSlots = 3): WildGenerationPreviewCommandV1 => ({
  schemaVersion: 1,
  mode: 'preview',
  operationId,
  tableId: 'encounter-table:v1:thickerby-vale-forest',
  expectedTableRevision: 0,
  requestedSlots,
  party: { trainerRefs: [] },
  environment: { timeOfDay: null, weather: null },
  policy: { shinyChancePercent: 0, heldItemName: null },
  exploration: null,
})
const dependencies = (database: RotomDatabase, overrides: Partial<ManageWildGenerationDependencies> = {}): ManageWildGenerationDependencies => ({
  database,
  now: () => '2026-08-25T14:00:00.000Z',
  signingKey: 'test-only-gm-toolkit-signing-key-that-is-long-enough',
  seedForCommand: () => seed,
  publishPersistedRealtimeEvent: () => undefined,
  reportAfterCommitPublicationFailure: () => undefined,
  publishToolkitInvalidation: () => undefined,
  ...overrides,
})
const asPreview = (value: ReturnType<typeof manageWildGenerationUseCase>): WildGenerationPreviewProjectionV1 => {
  if (!('previewToken' in value)) throw new Error('Expected preview')
  return value
}
const asCommit = (value: ReturnType<typeof manageWildGenerationUseCase>): WildGenerationCommitProjectionV1 => {
  if (!('packageId' in value)) throw new Error('Expected commit')
  return value
}

describe('journaled wild generation authority', () => {
  it('produces byte-repeatable inert previews with every server draw journaled', () => {
    const database = openDatabase()
    try {
      const before = {
        sheets: database.connection.prepare('SELECT COUNT(*) AS count FROM sheets').get()!.count,
        operations: database.connection.prepare('SELECT COUNT(*) AS count FROM gm_wild_generation_ops').get()!.count,
        realtime: database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()!.count,
      }
      const first = asPreview(manageWildGenerationUseCase(command(), dependencies(database)))
      const second = asPreview(manageWildGenerationUseCase(command(), dependencies(database)))
      expect({ ...first, previewToken: 'opaque', expiresAt: 'time' }).toEqual({ ...second, previewToken: 'opaque', expiresAt: 'time' })
      expect(first.requestedSlots).toBe(3)
      expect(first.candidates).toHaveLength(3)
      expect(first.nothingSlots).toBe(0)
      expect(first.journal.map(draw => draw.ordinal)).toEqual(first.journal.map((_draw, index) => index + 1))
      expect(first.journal.every(draw => draw.purpose.length > 0 && draw.result >= draw.range.minimum && draw.result <= draw.range.maximum)).toBe(true)
      expect(first.sourceDefinitionHashes.length).toBeGreaterThanOrEqual(7)
      const fixture = deterministicFixtures.fixtures.find(row => row.fixtureId === 'forest-vertical-slice')!.expected
      expect(first.previewHash).toBe(fixture.previewHash)
      expect(createHash('sha256').update(stableJsonStringify(first.journal)).digest('hex')).toBe(fixture.journalSha256)
      expect(first.candidates.map(candidate => ({
        speciesId: candidate.speciesId,
        level: candidate.level,
        gender: candidate.gender,
        nature: candidate.nature,
        abilityNames: candidate.abilityNames,
        moveNames: candidate.moveNames,
      }))).toEqual(fixture.candidates)
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM sheets').get()!.count).toBe(before.sheets)
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM gm_wild_generation_ops').get()!.count).toBe(before.operations)
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()!.count).toBe(before.realtime)
    } finally { database.close() }
  })

  it('commits exact preview candidates as ordinary sheets atomically and exact-retries without draws or writes', () => {
    const database = openDatabase()
    const invalidations: unknown[] = []
    const deps = dependencies(database, { publishToolkitInvalidation: payload => { invalidations.push(payload) } })
    try {
      const preview = asPreview(manageWildGenerationUseCase(command(), deps))
      const commitCommand = {
        schemaVersion: 1 as const,
        mode: 'commit' as const,
        operationId: preview.operationId,
        previewToken: preview.previewToken,
        selectedCandidateIds: preview.candidates.map(candidate => candidate.candidateId),
        folder: 'generated/wild',
      }
      const accepted = asCommit(manageWildGenerationUseCase(commitCommand, deps))
      expect(accepted).toMatchObject({ exactRetry: false, operationId: preview.operationId, table: preview.table })
      expect(accepted.sheets).toHaveLength(3)
      expect(invalidations).toEqual([{
        schemaVersion: 1,
        domain: 'wild-generation',
        documentId: accepted.packageId,
        revision: 0,
      }])
      expect(new Set(accepted.sheets.map(sheet => sheet.slug)).size).toBe(3)
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      for (const ref of accepted.sheets) {
        const stored = sheets.getByRef('pokemon', ref.slug)
        expect(stored).toBeTruthy()
        expect(stored).toMatchObject({ kind: 'pokemon', revision: 0 })
        expect(stored!.sheet).toMatchObject({
          slug: ref.slug,
          folder: 'generated/wild',
          revision: 0,
          player: false,
          serverPrivate: { gmGeneration: { operationId: preview.operationId, candidateId: ref.candidateId, tableRevision: 0 } },
        })
        expect((stored!.sheet.movelist as unknown[]).length).toBeGreaterThan(0)
        expect((stored!.sheet.abilities as unknown[]).length).toBeGreaterThan(0)
        expect((stored!.sheet.combat as { currentHp: number }).currentHp).toBeGreaterThan(0)
      }
      const realtimeRows = database.connection.prepare('SELECT access_json, event_json FROM realtime_events ORDER BY sequence').all() as unknown as Array<{ access_json: string; event_json: string }>
      expect(realtimeRows).toHaveLength(accepted.sheets.length)
      for (const row of realtimeRows) {
        expect(JSON.parse(row.access_json)).toEqual({ kind: 'gm-only' })
        const event = JSON.parse(row.event_json) as { data: Record<string, unknown> }
        expect(Object.keys(event.data).sort()).toEqual(['kind', 'revision', 'slug'])
        expect(JSON.stringify(event)).not.toMatch(/serverPrivate|sourceDefinition|journal/i)
      }
      const beforeRetry = {
        sheets: database.connection.prepare('SELECT COUNT(*) AS count FROM sheets').get()!.count,
        operations: database.connection.prepare('SELECT COUNT(*) AS count FROM gm_wild_generation_ops').get()!.count,
        realtime: database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()!.count,
        journal: createSqliteGmWildGenerationRepository(database).get(preview.operationId)!.journal,
      }
      const retried = asCommit(manageWildGenerationUseCase(commitCommand, { ...deps, now: () => '2026-08-30T14:00:00.000Z' }))
      expect(retried).toEqual({ ...accepted, exactRetry: true })
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM sheets').get()!.count).toBe(beforeRetry.sheets)
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM gm_wild_generation_ops').get()!.count).toBe(beforeRetry.operations)
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()!.count).toBe(beforeRetry.realtime)
      expect(createSqliteGmWildGenerationRepository(database).get(preview.operationId)!.journal).toEqual(beforeRetry.journal)
      expect(invalidations).toHaveLength(1)
      expect(() => manageWildGenerationUseCase({ ...commitCommand, selectedCandidateIds: [preview.candidates[0]!.candidateId] }, deps)).toThrow(/different material/)
    } finally { database.close() }
  })

  it('rejects token tampering and rolls back every sheet, receipt, operation, and realtime row on failure', () => {
    const database = openDatabase()
    try {
      const preview = asPreview(manageWildGenerationUseCase(command('wild-operation-rollback-001', 6), dependencies(database)))
      const base = {
        schemaVersion: 1 as const,
        mode: 'commit' as const,
        operationId: preview.operationId,
        selectedCandidateIds: preview.candidates.slice(0, 2).map(candidate => candidate.candidateId),
        folder: 'generated/wild',
      }
      const tampered = `${preview.previewToken.slice(0, -1)}${preview.previewToken.endsWith('a') ? 'b' : 'a'}`
      expect(() => manageWildGenerationUseCase({ ...base, previewToken: tampered }, dependencies(database))).toThrow(/signature/)
      expect(() => manageWildGenerationUseCase({ ...base, previewToken: preview.previewToken }, dependencies(database, {
        afterSheetWrite: (_slug, index) => { if (index === 0) throw new Error('injected package write failure') },
      }))).toThrow(/injected package write failure/)
      expect(database.connection.prepare("SELECT COUNT(*) AS count FROM sheets WHERE json_extract(document_json, '$.serverPrivate.gmGeneration.operationId') = ?").get(preview.operationId)).toEqual({ count: 0 })
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM gm_wild_generation_ops WHERE operation_id = ?').get(preview.operationId)).toEqual({ count: 0 })
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM gm_generated_packages WHERE operation_id = ?').get(preview.operationId)).toEqual({ count: 0 })
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
    } finally { database.close() }
  })

  it('uses party-scale group policy and revalidates every exact Trainer revision', () => {
    const database = openDatabase()
    try {
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      for (const slug of ['trainer-one', 'trainer-two', 'trainer-three']) {
        sheets.save({ kind: 'trainer', slug, revision: 0, updatedAt: 1, document: { slug, name: slug, level: 5, revision: 0 } })
      }
      const scaled = asPreview(manageWildGenerationUseCase({
        ...command('wild-operation-party-scale-001'),
        requestedSlots: null,
        party: { trainerRefs: ['trainer-one', 'trainer-two', 'trainer-three'].map(trainerSlug => ({ trainerSlug, expectedRevision: 0 })) },
      }, dependencies(database)))
      expect(scaled.requestedSlots).toBe(3)
      expect(() => manageWildGenerationUseCase({
        ...command('wild-operation-party-stale-001'),
        party: { trainerRefs: [{ trainerSlug: 'trainer-one', expectedRevision: 1 }] },
      }, dependencies(database))).toThrow(/Trainer trainer-one changed/)
    } finally { database.close() }
  })

  it('selects the latest six legal moves, milestone ability tiers, canonical skills and derived resources', () => {
    const rng = createGmToolkitSeededRng(createHash('sha256').update('p12-level-40-legality').digest('hex'))
    const candidate = constructWildPokemon({
      operationId: 'wild-operation-legality-001',
      candidateId: 'wild-candidate:v1:0123456789abcdef01234567:1',
      slot: 1,
      speciesId: 'Pidgeot',
      level: 40,
      shinyChancePercent: 0,
      heldItemName: null,
      tableId: 'encounter-table:v1:thickerby-vale-forest',
      tableRevision: 0,
      rng,
    })
    expect(candidate.projection.moveNames.length).toBeLessThanOrEqual(6)
    expect(candidate.projection.moveNames.length).toBeGreaterThan(0)
    expect(candidate.projection.abilityNames).toHaveLength(3)
    expect(Object.keys(candidate.document.skills ?? {}).length).toBeGreaterThan(0)
    expect(candidate.document.capabilities?.overland).toBeTypeOf('number')
    expect(candidate.document.combat?.currentHp).toBeGreaterThan(0)
    expect(candidate.document.totalExp).toBeGreaterThan(0)
    expect(rng.journal.every(draw => draw.accepted)).toBe(true)
  })

  it('preserves exact Trainer and campaign-clock route Repel authority with journaled omitted slots', () => {
    const database = openDatabase()
    try {
      database.connection.prepare('UPDATE campaign_clock SET campaign_minute = 100 WHERE singleton = 1').run()
      const applied = applyItemRepelCampaignEffect({
        current: null,
        definition: ITEM_AUTOMATION_RUNTIME_REGISTRY.require('Repel'),
        sourceOperationId: 'item-source-operation:gm-toolkit-repel-001',
        sourceInstanceId: 'item-instance:trainer:explorer:medicalKit:repel-row',
        campaignMinute: 100,
      })
      const trainer: TrainerSheet = {
        slug: 'explorer', name: 'Explorer', level: 10, revision: 3,
        serverPrivate: { itemExploration: applied.state },
      }
      createSqliteSheetRepository<Record<string, unknown>>(database).save({
        kind: 'trainer', slug: 'explorer', revision: 3, updatedAt: 10,
        document: trainer as unknown as Record<string, unknown>,
      })
      const repelCommand: WildGenerationPreviewCommandV1 = {
        ...command('wild-operation-repel-001', 5),
        tableId: 'encounter-table:v1:spire-city-streets',
        exploration: { trainerSlug: 'explorer', trainerRevision: 3, campaignClockRevision: 0 },
      }
      const repelSeed = createHash('sha256').update('p12-nothing-and-repel').digest('hex')
      const preview = asPreview(manageWildGenerationUseCase(repelCommand, dependencies(database, { seedForCommand: () => repelSeed })))
      expect(preview.candidates).toEqual([])
      expect(preview.repelledSlots + preview.nothingSlots).toBe(5)
      expect(preview.repelledSlots).toBeGreaterThan(0)
      expect(preview.journal.every(draw => draw.accepted)).toBe(true)
      expect(() => manageWildGenerationUseCase({
        ...repelCommand,
        operationId: 'wild-operation-repel-stale-001',
        exploration: { ...repelCommand.exploration!, trainerRevision: 2 },
      }, dependencies(database))).toThrow(/Trainer changed/)
    } finally { database.close() }
  })

  it('fails closed on stale table revisions and canonical item identities', () => {
    const database = openDatabase()
    try {
      expect(() => manageWildGenerationUseCase({ ...command(), expectedTableRevision: 99 }, dependencies(database))).toThrow(/changed/)
      expect(() => manageWildGenerationUseCase({ ...command(), policy: { shinyChancePercent: 0, heldItemName: 'Invented Item' } }, dependencies(database))).toThrow(/app-owned canonical Items/)
    } finally { database.close() }
  })
})
