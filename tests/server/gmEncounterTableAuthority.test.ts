import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  parseEncounterTableDocumentV1,
  projectEncounterTableForLibrary,
} from '#shared/gmToolkit/encounterTables'
import { applyStorageMigrations, LATEST_STORAGE_SCHEMA_VERSION } from '../../server/storage/migrations'
import type { RotomDatabase } from '../../server/storage/database'
import { createSqliteGmEncounterTableRepository } from '../../server/storage/gmEncounterTableRepository'
import { subscribeTransientRealtime } from '../../server/utils/realtime'
import { publishGmCampaignToolkitInvalidation } from '../../server/utils/gmToolkitRealtime'
import {
  archiveGmEncounterTableUseCase,
  copyGmEncounterTableUseCase,
  createGmEncounterTableUseCase,
  encounterTableDocumentToDraft,
  exportGmEncounterTableUseCase,
  importGmEncounterTableUseCase,
  updateGmEncounterTableUseCase,
} from '../../server/useCases/gmEncounterTableLibrary'

const openDatabase = (): RotomDatabase => {
  const connection = new DatabaseSync(':memory:')
  connection.exec('PRAGMA foreign_keys = ON')
  applyStorageMigrations(connection)
  let depth = 0
  return {
    path: ':memory:',
    connection,
    journalMode: null,
    withTransaction: (work) => {
      if (depth > 0) return work() as never
      depth += 1
      connection.exec('BEGIN IMMEDIATE')
      try {
        const result = work()
        connection.exec('COMMIT')
        return result as never
      } catch (error) {
        if (connection.isTransaction) connection.exec('ROLLBACK')
        throw error
      } finally { depth -= 1 }
    },
    close: () => connection.close(),
  }
}

const draft = {
  name: 'Canopy edge',
  environmentTags: ['Forest'],
  predicates: { timeOfDay: ['day'], weather: [] },
  rows: [
    { kind: 'species', speciesId: 'Caterpie', weight: 4, minLevel: 4, maxLevel: 7, predicates: { timeOfDay: [], weather: [] } },
    { kind: 'nothing', weight: 2, predicates: { timeOfDay: [], weather: [] } },
  ],
  groupSizePolicy: { kind: 'party-scale', minimum: 1, maximum: 6, perAdditionalTrainer: 1 },
  notes: 'Near the old road.',
}

const deps = (database: RotomDatabase) => ({
  repository: createSqliteGmEncounterTableRepository(database),
  now: () => '2026-08-25T12:00:00.000Z',
})

describe('GM encounter table schema v1', () => {
  it('rejects unknown canonical identities and unknown fields', () => {
    expect(() => parseEncounterTableDocumentV1({
      schemaVersion: 1,
      documentKind: 'encounter-table',
      tableId: 'encounter-table:v1:strict-fixture',
      revision: 0,
      status: 'active',
      name: 'Strict fixture',
      environmentTags: ['Forest'],
      predicates: { timeOfDay: [], weather: [] },
      rows: [{ rowId: 'encounter-row:v1:strict-fixture-01', kind: 'species', speciesId: 'Not-A-Canonical-Species', weight: 1, minLevel: 1, maxLevel: 1, predicates: { timeOfDay: [], weather: [] }, surprise: true }],
      groupSizePolicy: { kind: 'fixed', minimum: 1, maximum: 1, perAdditionalTrainer: 0 },
      notes: '',
      provenance: { kind: 'campaign-authored', sourceLabel: null, sourceSha256: null, sourceTableId: null, sourceRevision: null },
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
      archivedAt: null,
    })).toThrow(/not allowed|canonical Pokédex/)
  })
})

describe('SQLite GM encounter table authority', () => {
  it('migrates all four source-bound tables with explicit Nothing rows', () => {
    const database = openDatabase()
    try {
      expect(database.connection.prepare('PRAGMA user_version').get()).toEqual({ user_version: LATEST_STORAGE_SCHEMA_VERSION })
      const tables = createSqliteGmEncounterTableRepository(database).list()
      expect(tables).toHaveLength(4)
      expect(tables.map(table => table.name)).toEqual([
        'Spire City Streets',
        'Thickerby Vale Caves',
        'Thickerby Vale Forest',
        'Thickerby Vale Riverbank',
      ])
      expect(tables.every(table => table.rows.filter(row => row.kind === 'nothing').length === 1)).toBe(true)
      expect(tables.every(table => table.provenance.kind === 'legacy-migration' && table.provenance.sourceSha256?.length === 64)).toBe(true)
    } finally { database.close() }
  })

  it('settles create/update/archive/copy/import atomically with exact retries', () => {
    const database = openDatabase()
    const dependencies = deps(database)
    try {
      expect(() => createGmEncounterTableUseCase({ operationId: 'table-create-missing-draft' }, dependencies))
        .toThrowError(expect.objectContaining({ statusCode: 400, code: 'invalid-object' }))
      const created = createGmEncounterTableUseCase({ operationId: 'table-create-1', draft }, dependencies)
      expect(created.table.revision).toBe(0)
      expect(created.exactRetry).toBe(false)
      expect(createGmEncounterTableUseCase({ operationId: 'table-create-1', draft }, dependencies)).toMatchObject({ exactRetry: true, table: created.table })
      expect(() => createGmEncounterTableUseCase({ operationId: 'table-create-1', draft: { ...draft, name: 'Changed' } }, dependencies)).toThrow(/already used/)

      const updated = updateGmEncounterTableUseCase({
        operationId: 'table-update-1',
        tableId: created.table.tableId,
        expectedRevision: 0,
        draft: { ...encounterTableDocumentToDraft(created.table), name: 'Canopy at dusk' },
      }, dependencies)
      expect(updated.table).toMatchObject({ revision: 1, name: 'Canopy at dusk' })
      expect(() => updateGmEncounterTableUseCase({
        operationId: 'table-update-stale', tableId: created.table.tableId, expectedRevision: 0, draft,
      }, dependencies)).toThrow(/changed before/)

      const copied = copyGmEncounterTableUseCase({
        operationId: 'table-copy-1', tableId: updated.table.tableId, expectedRevision: 1, name: 'Canopy copy',
      }, dependencies)
      expect(copied.table).toMatchObject({ revision: 0, name: 'Canopy copy' })
      expect(copied.table.provenance).toMatchObject({ kind: 'copied', sourceTableId: updated.table.tableId })
      const defaultNamedCopy = copyGmEncounterTableUseCase({
        operationId: 'table-copy-default-name', tableId: updated.table.tableId, expectedRevision: 1,
      }, dependencies)
      expect(defaultNamedCopy.table.name).toBe('Canopy at dusk copy')

      const exported = exportGmEncounterTableUseCase({ tableId: updated.table.tableId }, dependencies)
      const imported = importGmEncounterTableUseCase({ operationId: 'table-import-1', export: exported }, dependencies)
      expect(imported.table.tableId).not.toBe(updated.table.tableId)
      expect(imported.table.provenance).toMatchObject({ kind: 'imported', sourceTableId: updated.table.tableId })

      const archived = archiveGmEncounterTableUseCase({
        operationId: 'table-archive-1', tableId: updated.table.tableId, expectedRevision: 1,
      }, dependencies)
      expect(archived.table).toMatchObject({ status: 'archived', revision: 2, archivedAt: '2026-08-25T12:00:00.000Z' })
      expect(dependencies.repository.list()).not.toContainEqual(archived.table)
      expect(dependencies.repository.list({ includeArchived: true })).toContainEqual(archived.table)
      expect(database.connection.prepare('SELECT COUNT(*) AS count FROM gm_encounter_table_ops').get()).toEqual({ count: 6 })
    } finally { database.close() }
  })

  it('converges two GM repository clients by revision and conflicts a stale write', () => {
    const database = openDatabase()
    const first = deps(database)
    const second = deps(database)
    try {
      const created = createGmEncounterTableUseCase({ operationId: 'multi-client-create', draft }, first)
      const observedBySecond = second.repository.get(created.table.tableId)!
      const accepted = updateGmEncounterTableUseCase({
        operationId: 'multi-client-first-update',
        tableId: created.table.tableId,
        expectedRevision: observedBySecond.revision,
        draft: { ...encounterTableDocumentToDraft(created.table), name: 'Accepted in first tab' },
      }, first)
      expect(second.repository.get(created.table.tableId)).toEqual(accepted.table)
      expect(() => updateGmEncounterTableUseCase({
        operationId: 'multi-client-stale-update',
        tableId: created.table.tableId,
        expectedRevision: observedBySecond.revision,
        draft: { ...encounterTableDocumentToDraft(observedBySecond), name: 'Stale second tab' },
      }, second)).toThrow(/changed before/)
    } finally { database.close() }
  })

  it('publishes identity-and-revision-only GM invalidations', () => {
    const publications: unknown[] = []
    const unsubscribe = subscribeTransientRealtime(publication => publications.push(publication))
    try {
      publishGmCampaignToolkitInvalidation({
        schemaVersion: 1,
        domain: 'encounter-table',
        documentId: 'encounter-table:v1:forest',
        revision: 3,
      }, 'table-operation-3')
      expect(publications).toHaveLength(1)
      expect(publications[0]).toMatchObject({
        access: { kind: 'gm-only' },
        event: {
          channel: 'gm-campaign-toolkit',
          type: 'encounter-table-invalidated',
          revision: 3,
          data: { documentId: 'encounter-table:v1:forest', revision: 3 },
        },
      })
      expect(JSON.stringify(publications[0])).not.toMatch(/notes|rows|sourceSha256|provenance/)
    } finally { unsubscribe() }
  })

  it('projects no provenance, notes, row identities, or source hashes in library rows', () => {
    const database = openDatabase()
    try {
      const table = createSqliteGmEncounterTableRepository(database).list()[0]!
      const projection = projectEncounterTableForLibrary(table)
      expect(projection).toEqual({
        schemaVersion: 1,
        tableId: table.tableId,
        revision: 0,
        status: 'active',
        name: table.name,
        environmentTags: table.environmentTags,
        speciesRowCount: 1,
        nothingWeight: 60,
        levelRange: { minimum: 1, maximum: 5 },
        updatedAt: '2026-08-25T00:00:00.000Z',
      })
      expect(JSON.stringify(projection)).not.toContain('sourceSha256')
      expect(JSON.stringify(projection)).not.toContain('notes')
    } finally { database.close() }
  })
})
