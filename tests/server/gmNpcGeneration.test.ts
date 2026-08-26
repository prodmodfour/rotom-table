import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import defaultArchetypes from '../../data/gm-campaign-toolkit/default-npc-archetypes.v1.json'
import deterministicFixtures from '../../data/gm-campaign-toolkit/fixtures/deterministic-generation.v1.json'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseNpcArchetypePolicyV1 } from '#shared/gmToolkit/npcArchetypes'
import type { NpcGenerationCommitProjectionV1, NpcGenerationPreviewProjectionV1 } from '#shared/gmToolkit/npcGeneration'
import { applyStorageMigrations } from '../../server/storage/migrations'
import { openRotomDatabase, type RotomDatabase } from '../../server/storage/database'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import { createSqliteGmNpcArchetypeRepository } from '../../server/storage/gmNpcArchetypeRepository'
import { createSqliteGmNpcGenerationRepository } from '../../server/storage/gmNpcGenerationRepository'
import { manageNpcGenerationUseCase, type ManageNpcGenerationDependencies } from '../../server/useCases/manageNpcGeneration'

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
const seed = createHash('sha256').update('p12-npc-one-plus-six').digest('hex')
const command = (operationId = 'npc-operation-field-researcher-001') => ({
  schemaVersion: 1 as const, mode: 'preview' as const, operationId,
  archetypeId: 'npc-archetype:v1:field-researcher', expectedArchetypeRevision: 0, rosterCount: 6,
  guided: { name: 'Researcher Rowan', identity: 'A mud-spattered local ecologist.', tactics: 'Protects the team and withdraws from needless risk.', notes: 'Knows why the forest is changing.' },
})
const deps = (database: RotomDatabase, overrides: Partial<ManageNpcGenerationDependencies> = {}): ManageNpcGenerationDependencies => ({
  database, now: () => '2026-08-25T15:00:00.000Z', signingKey: 'test-only-gm-toolkit-signing-key-that-is-long-enough',
  seedForCommand: () => seed, publishPersistedRealtimeEvent: () => undefined, reportAfterCommitPublicationFailure: () => undefined,
  publishToolkitInvalidation: () => undefined, ...overrides,
})
const preview = (value: ReturnType<typeof manageNpcGenerationUseCase>): NpcGenerationPreviewProjectionV1 => {
  if (!('previewToken' in value)) throw new Error('Expected NPC preview'); return value
}
const commit = (value: ReturnType<typeof manageNpcGenerationUseCase>): NpcGenerationCommitProjectionV1 => {
  if (!('packageId' in value)) throw new Error('Expected NPC commit'); return value
}

describe('campaign NPC archetype and generation authority', () => {
  it('strictly validates and revision-controls the reviewed campaign-owned archetype', () => {
    const parsed = parseNpcArchetypePolicyV1(defaultArchetypes.policies[0])
    expect(parsed).toMatchObject({ archetypeId: 'npc-archetype:v1:field-researcher', revision: 0, trainer: { level: 5 }, roster: { count: 6 } })
    expect(() => parseNpcArchetypePolicyV1({
      ...structuredClone(defaultArchetypes.policies[0]),
      trainer: { ...structuredClone(defaultArchetypes.policies[0]!.trainer), inventory: [{ section: 'medicalKit', itemId: 'Invented Item', quantity: 1 }] },
    })).toThrow(/unknown canonical item/)
    const database = openDatabase()
    try {
      const repository = createSqliteGmNpcArchetypeRepository(database)
      expect(repository.list()).toEqual([parsed])
      const next = parseNpcArchetypePolicyV1({ ...structuredClone(defaultArchetypes.policies[0]), revision: 1, status: 'archived', updatedAt: '2026-08-25T15:01:00.000Z' })
      expect(repository.replace(next, 0)).toEqual(next)
      expect(repository.replace(next, 0)).toBeNull()
      expect(() => repository.create(next)).toThrow(/revision 0/)
    } finally { database.close() }
  })

  it('builds an inert deterministic 1+6 preview with exact Trainer legality and private guided decisions', () => {
    const database = openDatabase()
    try {
      const before = {
        sheets: database.connection.prepare('SELECT COUNT(*) count FROM sheets').get()!.count,
        operations: database.connection.prepare('SELECT COUNT(*) count FROM gm_npc_generation_ops').get()!.count,
        events: database.connection.prepare('SELECT COUNT(*) count FROM realtime_events').get()!.count,
      }
      const first = preview(manageNpcGenerationUseCase(command(), deps(database)))
      const second = preview(manageNpcGenerationUseCase(command(), deps(database)))
      expect({ ...first, previewToken: 'opaque' }).toEqual({ ...second, previewToken: 'opaque' })
      const expected = deterministicFixtures.fixtures.find(row => row.fixtureId === 'npc-one-plus-six')!.expected as unknown as {
        previewHash: string; journalSha256: string; trainer: Record<string, unknown>; roster: readonly Record<string, unknown>[]
      }
      expect(first.previewHash).toBe(expected.previewHash)
      expect(createHash('sha256').update(stableJsonStringify(first.journal)).digest('hex')).toBe(expected.journalSha256)
      expect(first.trainer).toMatchObject({ name: 'Researcher Rowan', level: 5, trainingFeatureId: 'Focused Training', money: 5000, ...expected.trainer })
      expect(first.roster).toMatchObject(expected.roster)
      expect(first.trainer.featureNames).toHaveLength(6)
      expect(first.trainer.edgeNames).toHaveLength(7)
      expect(first.trainer.skillRanks).toMatchObject({ pokeEd: 'Adept', command: 'Novice', medicineEd: 'Novice' })
      expect(first.roster).toHaveLength(6)
      expect(first.journal.length).toBeGreaterThan(6)
      expect(first.journal.every(draw => draw.accepted)).toBe(true)
      expect(first.sourceDefinitionHashes.length).toBeGreaterThan(8)
      expect(database.connection.prepare('SELECT COUNT(*) count FROM sheets').get()!.count).toBe(before.sheets)
      expect(database.connection.prepare('SELECT COUNT(*) count FROM gm_npc_generation_ops').get()!.count).toBe(before.operations)
      expect(database.connection.prepare('SELECT COUNT(*) count FROM realtime_events').get()!.count).toBe(before.events)
    } finally { database.close() }
  })

  it('atomically commits one ordinary Trainer plus six owned Pokémon and exact-retries without writes', () => {
    const database = openDatabase(); const invalidations: unknown[] = []
    const dependencies = deps(database, { publishToolkitInvalidation: value => { invalidations.push(value) } })
    try {
      const reviewed = preview(manageNpcGenerationUseCase(command(), dependencies))
      const commitCommand = { schemaVersion: 1 as const, mode: 'commit' as const, operationId: reviewed.operationId, previewToken: reviewed.previewToken, trainerFolder: 'generated/npcs', pokemonFolder: 'generated/npcs/rosters' }
      const accepted = commit(manageNpcGenerationUseCase(commitCommand, dependencies))
      expect(accepted).toMatchObject({ exactRetry: false, trainer: { kind: 'trainer', revision: 0 }, archetype: reviewed.archetype })
      expect(accepted.roster).toHaveLength(6)
      expect(accepted.roster.every(row => row.ownerTrainerSlug === accepted.trainer.slug)).toBe(true)
      const sheets = createSqliteSheetRepository<Record<string, unknown>>(database)
      const trainer = sheets.getByRef('trainer', accepted.trainer.slug)!
      expect(trainer.sheet).toMatchObject({
        player: false, currentTeam: accepted.roster.map(row => row.slug), boxedPokemon: [], folder: 'generated/npcs',
        serverPrivate: { gmGeneration: { operationId: reviewed.operationId, guided: {
          identity: command().guided.identity,
          tactics: command().guided.tactics,
          notes: command().guided.notes,
        } } },
      })
      expect((trainer.sheet.currentHp as number)).toBeGreaterThan(0)
      expect((trainer.sheet.inventory as Record<string, unknown[]>).medicalKit).toHaveLength(2)
      for (const row of accepted.roster) expect(sheets.getByRef('pokemon', row.slug)).toMatchObject({ revision: 0, sheet: { folder: 'generated/npcs/rosters' } })
      const realtimeRows = database.connection.prepare('SELECT access_json, event_json FROM realtime_events ORDER BY sequence').all() as unknown as Array<{ access_json: string; event_json: string }>
      expect(realtimeRows).toHaveLength(7)
      for (const row of realtimeRows) {
        expect(JSON.parse(row.access_json)).toEqual({ kind: 'gm-only' })
        const event = JSON.parse(row.event_json) as { data: Record<string, unknown> }
        expect(Object.keys(event.data).sort()).toEqual(['kind', 'revision', 'slug'])
        expect(JSON.stringify(event)).not.toMatch(/guided|serverPrivate|sourceDefinition|journal/i)
      }
      expect(invalidations).toEqual([{ schemaVersion: 1, domain: 'npc-generation', documentId: accepted.packageId, revision: 0 }])
      const counts = {
        sheets: database.connection.prepare('SELECT COUNT(*) count FROM sheets').get()!.count,
        operations: database.connection.prepare('SELECT COUNT(*) count FROM gm_npc_generation_ops').get()!.count,
        events: database.connection.prepare('SELECT COUNT(*) count FROM realtime_events').get()!.count,
        journal: createSqliteGmNpcGenerationRepository(database).get(reviewed.operationId)!.journal,
      }
      const retry = commit(manageNpcGenerationUseCase(commitCommand, { ...dependencies, now: () => '2026-09-01T15:00:00.000Z' }))
      expect(retry).toEqual({ ...accepted, exactRetry: true })
      expect(database.connection.prepare('SELECT COUNT(*) count FROM sheets').get()!.count).toBe(counts.sheets)
      expect(database.connection.prepare('SELECT COUNT(*) count FROM gm_npc_generation_ops').get()!.count).toBe(counts.operations)
      expect(database.connection.prepare('SELECT COUNT(*) count FROM realtime_events').get()!.count).toBe(counts.events)
      expect(createSqliteGmNpcGenerationRepository(database).get(reviewed.operationId)!.journal).toEqual(counts.journal)
      expect(invalidations).toHaveLength(1)
      expect(() => manageNpcGenerationUseCase({ ...commitCommand, pokemonFolder: 'different' }, dependencies)).toThrow(/different material/)
    } finally { database.close() }
  })

  it('rolls back Trainer, roster, operation, package, and realtime authority on interruption', () => {
    const database = openDatabase()
    try {
      const reviewed = preview(manageNpcGenerationUseCase(command('npc-operation-rollback-001'), deps(database)))
      expect(() => manageNpcGenerationUseCase({ schemaVersion: 1, mode: 'commit', operationId: reviewed.operationId, previewToken: reviewed.previewToken, trainerFolder: 'generated/npcs', pokemonFolder: 'generated/npcs/rosters' }, deps(database, {
        afterSheetWrite: (_kind, _slug, index) => { if (index === 2) throw new Error('injected NPC package interruption') },
      }))).toThrow(/injected NPC package interruption/)
      expect(database.connection.prepare("SELECT COUNT(*) count FROM sheets WHERE json_extract(document_json, '$.serverPrivate.gmGeneration.operationId') = ?").get(reviewed.operationId)).toEqual({ count: 0 })
      expect(database.connection.prepare('SELECT COUNT(*) count FROM gm_npc_generation_ops').get()).toEqual({ count: 0 })
      expect(database.connection.prepare('SELECT COUNT(*) count FROM gm_npc_packages').get()).toEqual({ count: 0 })
      expect(database.connection.prepare('SELECT COUNT(*) count FROM realtime_events').get()).toEqual({ count: 0 })
    } finally { database.close() }
  })

  it('recovers a signed preview after a database restart and converges two GM clients on one receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'rotom-npc-generation-'))
    const path = join(root, 'campaign.sqlite')
    let database = openRotomDatabase({ path })
    try {
      const previewCommand = command('npc-operation-restart-001')
      const reviewed = preview(manageNpcGenerationUseCase(previewCommand, {
        database, now: () => '2026-08-25T15:00:00.000Z',
      }))
      database.close()
      database = openRotomDatabase({ path })
      const commitCommand = { schemaVersion: 1 as const, mode: 'commit' as const, operationId: reviewed.operationId, previewToken: reviewed.previewToken, trainerFolder: 'generated/npcs', pokemonFolder: 'generated/npcs/rosters' }
      const gmOne = commit(manageNpcGenerationUseCase(commitCommand, { database, now: () => '2026-08-25T16:00:00.000Z', publishPersistedRealtimeEvent: () => undefined, publishToolkitInvalidation: () => undefined }))
      const gmTwo = commit(manageNpcGenerationUseCase(commitCommand, { database, now: () => '2026-08-25T16:01:00.000Z', publishPersistedRealtimeEvent: () => undefined, publishToolkitInvalidation: () => undefined }))
      expect(gmTwo).toEqual({ ...gmOne, exactRetry: true })
      expect(database.connection.prepare('SELECT COUNT(*) count FROM gm_npc_generation_ops').get()).toEqual({ count: 1 })
      expect(database.connection.prepare('SELECT COUNT(*) count FROM gm_npc_packages').get()).toEqual({ count: 1 })
      expect(database.connection.prepare("SELECT COUNT(*) count FROM sheets WHERE json_extract(document_json, '$.serverPrivate.gmGeneration.operationId') = ?").get(reviewed.operationId)).toEqual({ count: 7 })
    } finally { database.close(); rmSync(root, { recursive: true, force: true }) }
  }, 15_000)

  it('fails closed on stale archetype and roster table revisions', () => {
    const database = openDatabase()
    try {
      expect(() => manageNpcGenerationUseCase({ ...command(), expectedArchetypeRevision: 9 }, deps(database))).toThrow(/archetype changed/)
      database.connection.prepare("UPDATE gm_encounter_tables SET revision = 1, document_json = json_set(document_json, '$.revision', 1) WHERE table_id = 'encounter-table:v1:thickerby-vale-forest'").run()
      expect(() => manageNpcGenerationUseCase(command('npc-operation-table-stale-001'), deps(database))).toThrow(/table changed/)
    } finally { database.close() }
  })
})
