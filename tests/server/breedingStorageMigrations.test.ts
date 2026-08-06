import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import storageSchemaV25Json from '../../data/breeding-automation/storage-schema-v25.json'
import storageSchemaV26Json from '../../data/breeding-automation/storage-schema-v26.json'
import storageSchemaV27Json from '../../data/breeding-automation/storage-schema-v27.json'
import { LATEST_STORAGE_SCHEMA_VERSION, STORAGE_MIGRATIONS, applyStorageMigrations, getStorageSchemaVersion } from '../../server/storage/migrations'

const connections: DatabaseSync[] = []
const open = (): DatabaseSync => {
  const connection = new DatabaseSync(':memory:')
  connection.exec('PRAGMA foreign_keys = ON')
  connections.push(connection)
  return connection
}
afterEach(() => { while (connections.length > 0) connections.pop()?.close() })

const tables = (connection: DatabaseSync): string[] => connection.prepare(`
  SELECT name FROM sqlite_master
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().map(row => String(row.name))
const indexes = (connection: DatabaseSync, table: string): string[] => connection.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all().map(row => String(row.name)).sort()
const columns = (connection: DatabaseSync, table: string): string[] => connection.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().map(row => String(row.name))
const applyThrough = (connection: DatabaseSync, version: number): void => {
  const suspendForeignKeys = version >= 25
    && connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys === 1
  if (suspendForeignKeys) connection.exec('PRAGMA foreign_keys = OFF')
  for (const migration of STORAGE_MIGRATIONS.filter(candidate => candidate.version <= version)) {
    migration.up(connection)
    connection.exec(`PRAGMA user_version = ${migration.version}`)
  }
  if (suspendForeignKeys) {
    connection.exec('PRAGMA foreign_keys = ON')
    if (connection.prepare('PRAGMA foreign_key_check').all().length !== 0) {
      throw new Error('Test migration helper produced foreign-key violations')
    }
  }
}
const operationId = (value: number): string => `breeding-operation:v1:${value.toString(16).padStart(32, '0')}`
const hash = (character: string): string => character.repeat(64)
const insertPendingOperation = (connection: DatabaseSync, value: number, kind = 'create-breeding-project'): string => {
  const id = operationId(value)
  connection.prepare(`
    INSERT INTO breeding_operations (
      operation_id, command_sha256, command_kind, command_json, status,
      result_json, result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    ) VALUES (?, ?, ?, ?, 'pending', NULL, NULL, 100, NULL)
  `).run(id, hash('a'), kind, JSON.stringify({ schemaVersion: 1, operationId: id, commandKind: kind }))
  return id
}

const breedingTables = [
  'breeding_authorization_receipts',
  'breeding_checks',
  'breeding_consents',
  'breeding_gm_adjudications',
  'breeding_gm_overrides',
  'breeding_inheritance_learning_records',
  'breeding_operation_scopes',
  'breeding_operations',
  'breeding_option_offers',
  'breeding_projects',
  'breeding_read_sets',
  'breeding_rolls',
  'campaign_clock',
  'pokemon_breeding_origins',
  'pokemon_eggs',
  'trainer_species_acquisitions',
]
const archiveTables = [
  'breeding_archive_import_requests',
  'breeding_archive_restore_receipts',
  'breeding_archives',
]
const incubationTables = ['breeding_incubation_segments']

describe('breeding SQLite schema migration', () => {
  it('adds every dedicated aggregate and evidence table at contiguous schema version 22', () => {
    const connection = open()
    applyThrough(connection, 22)
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(27)
    expect(getStorageSchemaVersion(connection)).toBe(22)
    expect(tables(connection).filter(name => breedingTables.includes(name))).toEqual(breedingTables)
    expect(connection.prepare('SELECT * FROM campaign_clock').all()).toEqual([{ singleton: 1, revision: 0, campaign_minute: 0, last_operation_id: null }])
    expect(columns(connection, 'pokemon_eggs')).not.toContain('map_slug')
    expect(columns(connection, 'pokemon_eggs')).not.toContain('encounter_id')
    expect(columns(connection, 'breeding_projects')).not.toContain('placement_id')
    expect(connection.prepare("SELECT COUNT(*) AS count FROM sheets WHERE kind = 'egg'").get()).toEqual({ count: 0 })
  })

  it('upgrades v21 campaign data without interpreting legacy map Egg metadata', () => {
    const connection = open()
    applyThrough(connection, 21)
    connection.prepare(`INSERT INTO maps (slug, document_json, revision, updated_at) VALUES (?, ?, 7, 100)`).run(
      'legacy-map',
      JSON.stringify({ slug: 'legacy-map', metadata: { capabilityEggs: [{ species: 'Pikachu' }], hatchHours: 12 } }),
    )
    connection.prepare(`INSERT INTO sheets (kind, slug, document_json, revision, updated_at) VALUES ('pokemon', 'legacy-child', '{}', 3, 100)`).run()

    expect(applyStorageMigrations(connection)).toEqual({ fromVersion: 21, toVersion: 27, appliedVersions: [22, 23, 24, 25, 26, 27] })
    expect(connection.prepare('SELECT slug, revision FROM maps').get()).toEqual({ slug: 'legacy-map', revision: 7 })
    expect(connection.prepare('SELECT kind, slug, revision FROM sheets').get()).toEqual({ kind: 'pokemon', slug: 'legacy-child', revision: 3 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM breeding_projects').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM pokemon_eggs').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM pokemon_breeding_origins').get()).toEqual({ count: 0 })
  })

  it('adds immutable archive, import-request, and restore-receipt tables at schema version 23', () => {
    const connection = open()
    applyThrough(connection, 22)
    expect(tables(connection).filter(name => archiveTables.includes(name))).toEqual([])
    expect(applyStorageMigrations(connection)).toEqual({ fromVersion: 22, toVersion: 27, appliedVersions: [23, 24, 25, 26, 27] })
    expect(tables(connection).filter(name => archiveTables.includes(name))).toEqual(archiveTables)
    expect(indexes(connection, 'breeding_archives')).toContain('breeding_archives_campaign_created_idx')
    expect(() => connection.prepare(`
      INSERT INTO breeding_archives (
        archive_id, purpose, campaign_identity_sha256, created_at_campaign_minute,
        archive_json, archive_definition_sha256
      ) VALUES ('bad', 'restorable-owner-copy', ?, 0, '{}', ?)
    `).run(hash('a'), hash('b'))).toThrow()
  })

  it('adds immutable command-bound incubation segment results at schema version 24', () => {
    const connection = open()
    applyThrough(connection, 23)
    expect(tables(connection).filter(name => incubationTables.includes(name))).toEqual([])
    expect(applyStorageMigrations(connection)).toEqual({ fromVersion: 23, toVersion: 27, appliedVersions: [24, 25, 26, 27] })
    expect(tables(connection).filter(name => incubationTables.includes(name))).toEqual(incubationTables)
    expect(indexes(connection, 'breeding_incubation_segments')).toContain('breeding_incubation_segments_egg_revision_idx')
    expect(columns(connection, 'breeding_incubation_segments')).toEqual([
      'operation_id', 'egg_id', 'egg_revision_before', 'egg_revision_after', 'command_kind',
      'through_clock_revision', 'through_campaign_minute', 'record_json', 'definition_sha256',
    ])
  })

  it('adds the Egg Warmer command at v25 while preserving v24 operation and foreign-key rows exactly', () => {
    expect(createHash('sha256').update(stableJsonStringify(storageSchemaV25Json.definition)).digest('hex')).toBe(storageSchemaV25Json.definitionSha256)
    expect(storageSchemaV25Json.definition).toMatchObject({ fromVersion: 24, toVersion: 25, newCommandKind: 'apply-egg-warmer-capability', rowPolicy: 'byte-equivalent-operation-and-dependent-row-preservation' })
    const connection = open()
    applyThrough(connection, 24)
    const operation = insertPendingOperation(connection, 91)
    connection.prepare(`INSERT INTO breeding_operation_scopes (operation_id, scope_key, scope_kind, scope_json) VALUES (?, '2:test', 'pokemon-egg', '{}')`).run(operation)
    expect(applyStorageMigrations(connection)).toEqual({ fromVersion: 24, toVersion: 27, appliedVersions: [25, 26, 27] })
    expect(connection.prepare('SELECT operation_id, command_kind, status FROM breeding_operations').all()).toEqual([{ operation_id: operation, command_kind: 'create-breeding-project', status: 'pending' }])
    expect(connection.prepare('SELECT operation_id, scope_key FROM breeding_operation_scopes').all()).toEqual([{ operation_id: operation, scope_key: '2:test' }])
    expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(() => insertPendingOperation(connection, 92, 'apply-egg-warmer-capability')).not.toThrow()
    expect(tables(connection)).toContain('pokemon_egg_transfer_consents')
    expect(connection.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'breeding_operation_scopes'").get()?.sql).toContain('egg-transfer-consent')
  })

  it('adds hash-bound transfer consent storage and atomically scopeable consent identities at v26', () => {
    const root = resolve(import.meta.dirname, '../..')
    const application = readFileSync(resolve(root, 'server/storage/migrations.ts'), 'utf8')
    const offline = readFileSync(resolve(root, 'scripts/migrate-campaign-to-sqlite.mjs'), 'utf8')
    const applicationSql = /function createPokemonEggTransferConsentTable[\s\S]*?connection\.exec\(`([\s\S]*?)`\)\n}/.exec(application)?.[1]
    const offlineSql = /if \(fromVersion < 26\) \{[\s\S]*?connection\.exec\(`([\s\S]*?)`\)\n\s+setUserVersion\(connection, 26\)/.exec(offline)?.[1]
    const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
    expect(applicationSql).toBeTruthy()
    expect(offlineSql).toBe(applicationSql)
    expect(storageSchemaV26Json.definitionSha256).toBe(digest(stableJsonStringify(storageSchemaV26Json.definition)))
    expect(storageSchemaV26Json.definition.applicationMigrationSqlSha256).toBe(digest(applicationSql!))
    expect(storageSchemaV26Json.definition.offlineMigrationSqlSha256).toBe(digest(offlineSql!))
    const connection = open()
    applyStorageMigrations(connection)
    expect(columns(connection, 'pokemon_egg_transfer_consents')).toEqual([
      'consent_id', 'document_json', 'definition_sha256', 'revision', 'status', 'role',
      'egg_id', 'egg_revision', 'source_trainer_slug', 'destination_trainer_slug',
      'consenting_profile_id', 'expires_at_campaign_minute', 'settlement_operation_id',
    ])
    expect(indexes(connection, 'pokemon_egg_transfer_consents')).toContain('pokemon_egg_transfer_consents_active_role_idx')
    expect(connection.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'breeding_operation_scopes'").get()?.sql).toContain('egg-transfer-consent')
  })

  it('adds immutable external acquisition settlements and preserves v26 history at v27', () => {
    const root = resolve(import.meta.dirname, '../..')
    const application = readFileSync(resolve(root, 'server/storage/migrations.ts'), 'utf8')
    const offline = readFileSync(resolve(root, 'scripts/migrate-campaign-to-sqlite.mjs'), 'utf8')
    const applicationSql = /function createTrainerSpeciesAcquisitionSourceOperationTable[\s\S]*?connection\.exec\(`([\s\S]*?)`\)\n}/.exec(application)?.[1]
    const offlineSql = /if \(fromVersion < 27\) \{[\s\S]*?connection\.exec\(`([\s\S]*?)`\)\n\s+setUserVersion\(connection, 27\)/.exec(offline)?.[1]
    const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
    expect(applicationSql).toBeTruthy()
    expect(offlineSql).toBe(applicationSql)
    expect(storageSchemaV27Json.definitionSha256).toBe(digest(stableJsonStringify(storageSchemaV27Json.definition)))
    expect(storageSchemaV27Json.definition.applicationMigrationSqlSha256).toBe(digest(applicationSql!))
    expect(storageSchemaV27Json.definition.offlineMigrationSqlSha256).toBe(digest(offlineSql!))

    const connection = open()
    applyThrough(connection, 26)
    const operation = insertPendingOperation(connection, 127)
    connection.prepare(`
      INSERT INTO trainer_species_acquisitions (
        trainer_sheet_slug, species_id, first_acquired_at_campaign_minute, source_egg_id,
        operation_id, record_json, definition_sha256
      ) VALUES ('trainer-owner', 'bulbasaur', 100, NULL, ?, '{}', ?)
    `).run(operation, hash('f'))
    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 26,
      toVersion: 27,
      appliedVersions: [27],
    })
    expect(connection.prepare(`
      SELECT trainer_sheet_slug, species_id, operation_id
      FROM trainer_species_acquisitions
    `).get()).toEqual({
      trainer_sheet_slug: 'trainer-owner',
      species_id: 'bulbasaur',
      operation_id: operation,
    })
    expect(connection.prepare('PRAGMA foreign_key_list(trainer_species_acquisitions)').all()
      .map(row => String(row.table))).toEqual(['pokemon_eggs'])
    expect(columns(connection, 'trainer_species_acquisition_source_operations')).toEqual([
      'operation_id', 'source_kind', 'source_event_id', 'trainer_sheet_slug', 'species_id',
      'settled_at_campaign_minute', 'outcome', 'applied_reward_amount', 'record_json',
      'definition_sha256',
    ])
    const insertSource = connection.prepare(`
      INSERT INTO trainer_species_acquisition_source_operations (
        operation_id, source_kind, source_event_id, trainer_sheet_slug, species_id,
        settled_at_campaign_minute, outcome, applied_reward_amount, record_json,
        definition_sha256
      ) VALUES (?, 'migration', 'review:one', 'trainer-owner', 'bulbasaur', 100,
        'already-acquired', 0, '{}', ?)
    `)
    insertSource.run(operationId(200), hash('a'))
    expect(() => insertSource.run(operationId(201), hash('b'))).toThrow()
    expect(connection.prepare(`
      SELECT DISTINCT "table" AS referenced_table
      FROM pragma_foreign_key_list('trainer_species_acquisition_source_operations')
    `).all()).toEqual([{ referenced_table: 'trainer_species_acquisitions' }])
    expect(() => connection.prepare(`
      INSERT INTO trainer_species_acquisition_source_operations (
        operation_id, source_kind, source_event_id, trainer_sheet_slug, species_id,
        settled_at_campaign_minute, outcome, applied_reward_amount, record_json,
        definition_sha256
      ) VALUES (?, 'migration', 'review:missing-history', 'trainer-owner', 'ivysaur',
        100, 'already-acquired', 0, '{}', ?)
    `).run(operationId(202), hash('c'))).toThrow()
  })

  it('supports one deferred project/Egg transaction while enforcing lifecycle, identity, and JSON constraints', () => {
    const connection = open(); applyStorageMigrations(connection)
    const operation = operationId(1)
    const project = 'breeding-project:v1:11111111111111111111111111111111'
    const egg = 'pokemon-egg:v1:22222222222222222222222222222222'
    connection.exec('BEGIN IMMEDIATE')
    insertPendingOperation(connection, 1)
    connection.prepare(`
      INSERT INTO breeding_projects (
        project_id, document_json, revision, status, owner_trainer_slug, breeder_trainer_slug,
        parent_a_slug, parent_b_slug, produced_egg_id, last_operation_id,
        created_at_campaign_minute, updated_at_campaign_minute
      ) VALUES (?, '{}', 1, 'egg-produced', 'trainer-owner', 'trainer-breeder',
        'pokemon-parent-a', 'pokemon-parent-b', ?, ?, 100, 100)
    `).run(project, egg, operation)
    connection.prepare(`
      INSERT INTO pokemon_eggs (
        egg_id, document_json, revision, status, owner_trainer_slug, source_kind,
        source_project_id, child_sheet_slug, last_operation_id,
        created_at_campaign_minute, updated_at_campaign_minute
      ) VALUES (?, '{}', 0, 'incubating', 'trainer-owner', 'breeding', ?, NULL, ?, 100, 100)
    `).run(egg, project, operation)
    connection.exec('COMMIT')

    expect(connection.prepare('SELECT project_id, produced_egg_id FROM breeding_projects').get()).toEqual({ project_id: project, produced_egg_id: egg })
    expect(connection.prepare('SELECT egg_id, source_project_id FROM pokemon_eggs').get()).toEqual({ egg_id: egg, source_project_id: project })
    expect(() => connection.prepare(`
      INSERT INTO breeding_projects (
        project_id, document_json, revision, status, owner_trainer_slug, breeder_trainer_slug,
        parent_a_slug, parent_b_slug, produced_egg_id, last_operation_id,
        created_at_campaign_minute, updated_at_campaign_minute
      ) VALUES ('bad-project', 'not-json', 0, 'draft', 'owner', 'breeder', 'same', 'same', NULL, ?, 0, 0)
    `).run(operation)).toThrow()
    expect(() => connection.prepare(`
      INSERT INTO pokemon_eggs (
        egg_id, document_json, revision, status, owner_trainer_slug, source_kind,
        source_project_id, child_sheet_slug, last_operation_id,
        created_at_campaign_minute, updated_at_campaign_minute
      ) VALUES ('bad-egg', '{}', 0, 'hatched', 'owner', 'gm-created', NULL, NULL, ?, 0, 0)
    `).run(operation)).toThrow()
    expect(() => connection.prepare(`UPDATE campaign_clock SET revision = 1 WHERE singleton = 1`).run()).toThrow()
  })

  it('enforces one active consent, one project check, operation roll ordinals, and first-acquisition identity', () => {
    const connection = open(); applyStorageMigrations(connection)
    const operation = insertPendingOperation(connection, 2)
    const project = 'breeding-project:v1:33333333333333333333333333333333'
    connection.prepare(`
      INSERT INTO breeding_projects (
        project_id, document_json, revision, status, owner_trainer_slug, breeder_trainer_slug,
        parent_a_slug, parent_b_slug, produced_egg_id, last_operation_id,
        created_at_campaign_minute, updated_at_campaign_minute
      ) VALUES (?, '{}', 0, 'draft', 'trainer-owner', 'trainer-breeder', 'parent-a', 'parent-b', NULL, ?, 100, 100)
    `).run(project, operation)
    const insertConsent = connection.prepare(`
      INSERT INTO breeding_consents (
        consent_id, document_json, definition_sha256, revision, status, project_id,
        parent_sheet_slug, parent_sheet_revision, owner_trainer_slug, consenting_profile_id,
        expires_at_campaign_minute, grant_operation_id, settlement_operation_id,
        granted_at_campaign_minute, settled_at_campaign_minute
      ) VALUES (?, '{}', ?, 0, 'active', ?, 'parent-a', 1, 'trainer-owner', 'profile_owner1234', 200, ?, NULL, 100, NULL)
    `)
    insertConsent.run('breeding-consent:v1:44444444444444444444444444444444', hash('b'), project, operation)
    expect(() => insertConsent.run('breeding-consent:v1:55555555555555555555555555555555', hash('c'), project, operation)).toThrow()

    connection.prepare(`
      INSERT INTO breeding_rolls (
        roll_record_id, operation_id, operation_roll_ordinal, command_sha256, purpose,
        record_json, definition_sha256, generated_at_campaign_minute
      ) VALUES ('breeding-roll:v1:66666666666666666666666666666666', ?, 0, ?, 'breeder-check-d20', '{}', ?, 100)
    `).run(operation, hash('a'), hash('d'))
    expect(() => connection.prepare(`
      INSERT INTO breeding_rolls (
        roll_record_id, operation_id, operation_roll_ordinal, command_sha256, purpose,
        record_json, definition_sha256, generated_at_campaign_minute
      ) VALUES ('breeding-roll:v1:77777777777777777777777777777777', ?, 0, ?, 'breeder-check-d20', '{}', ?, 100)
    `).run(operation, hash('a'), hash('e'))).toThrow()

    const acquisition = connection.prepare(`
      INSERT INTO trainer_species_acquisitions (
        trainer_sheet_slug, species_id, first_acquired_at_campaign_minute, source_egg_id,
        operation_id, record_json, definition_sha256
      ) VALUES ('trainer-owner', 'pikachu', 100, NULL, ?, '{}', ?)
    `)
    acquisition.run(operation, hash('f'))
    expect(() => acquisition.run(operation, hash('f'))).toThrow()
    expect(indexes(connection, 'breeding_consents')).toContain('breeding_consents_active_parent_idx')
    expect(indexes(connection, 'breeding_rolls').some(name => name.startsWith('sqlite_autoindex_breeding_rolls'))).toBe(true)
  })

  it('keeps the application and offline campaign-migration schema-22 SQL byte-equivalent', () => {
    const root = resolve(import.meta.dirname, '../..')
    const application = readFileSync(resolve(root, 'server/storage/migrations.ts'), 'utf8')
    const offline = readFileSync(resolve(root, 'scripts/migrate-campaign-to-sqlite.mjs'), 'utf8')
    const applicationSql = /const createBreedingLifecycleTables[\s\S]*?connection\.exec\(`([\s\S]*?)`\)\n}/.exec(application)?.[1]
    const offlineSql = /if \(fromVersion < 22\) \{\n\s+connection\.exec\(`([\s\S]*?)`\)\n\s+setUserVersion\(connection, 22\)/.exec(offline)?.[1]
    expect(applicationSql).toBeTruthy()
    expect(offlineSql).toBe(applicationSql)
    expect(offline).toContain('export const STORAGE_SCHEMA_VERSION = 27')
    const artifact = JSON.parse(readFileSync(resolve(root, 'data/breeding-automation/storage-schema-v22.json'), 'utf8'))
    const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
    expect(artifact.definitionSha256).toBe(digest(stableJsonStringify(artifact.definition)))
    expect(artifact.definition.applicationMigrationSqlSha256).toBe(digest(applicationSql!))
    expect(artifact.definition.offlineMigrationSqlSha256).toBe(digest(offlineSql!))
    expect(artifact.definition.invariants).toMatchObject({ eggsAreSheets: false, eggMapOrEncounterColumns: false, legacyMapMetadataMigration: 'forbidden-empty-tables-only' })
  })

  it('keeps application and offline schema-23 archive SQL byte-equivalent and hash-bound', () => {
    const root = resolve(import.meta.dirname, '../..')
    const application = readFileSync(resolve(root, 'server/storage/migrations.ts'), 'utf8')
    const offline = readFileSync(resolve(root, 'scripts/migrate-campaign-to-sqlite.mjs'), 'utf8')
    const applicationSql = /const createBreedingArchiveTables[\s\S]*?connection\.exec\(`([\s\S]*?)`\)\n}/.exec(application)?.[1]
    const offlineSql = /if \(fromVersion < 23\) \{\n\s+connection\.exec\(`([\s\S]*?)`\)\n\s+setUserVersion\(connection, 23\)/.exec(offline)?.[1]
    expect(applicationSql).toBeTruthy()
    expect(offlineSql).toBe(applicationSql)
    const artifact = JSON.parse(readFileSync(resolve(root, 'data/breeding-automation/archive-storage-schema-v23.json'), 'utf8'))
    const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
    expect(artifact.definitionSha256).toBe(digest(stableJsonStringify(artifact.definition)))
    expect(artifact.definition.applicationMigrationSqlSha256).toBe(digest(applicationSql!))
    expect(artifact.definition.offlineMigrationSqlSha256).toBe(digest(offlineSql!))
    expect(artifact.definition.tables).toEqual(archiveTables)
  })

  it('keeps application and offline schema-24 incubation SQL byte-equivalent and hash-bound', () => {
    const root = resolve(import.meta.dirname, '../..')
    const application = readFileSync(resolve(root, 'server/storage/migrations.ts'), 'utf8')
    const offline = readFileSync(resolve(root, 'scripts/migrate-campaign-to-sqlite.mjs'), 'utf8')
    const applicationSql = /const createBreedingIncubationSegmentTable[\s\S]*?connection\.exec\(`([\s\S]*?)`\)\n}/.exec(application)?.[1]
    const offlineSql = /if \(fromVersion < 24\) \{\n\s+connection\.exec\(`([\s\S]*?)`\)\n\s+setUserVersion\(connection, 24\)/.exec(offline)?.[1]
    expect(applicationSql).toBeTruthy()
    expect(offlineSql).toBe(applicationSql)
    const artifact = JSON.parse(readFileSync(resolve(root, 'data/breeding-automation/incubation-storage-schema-v24.json'), 'utf8'))
    const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
    expect(artifact.definitionSha256).toBe(digest(stableJsonStringify(artifact.definition)))
    expect(artifact.definition.applicationMigrationSqlSha256).toBe(digest(applicationSql!))
    expect(artifact.definition.offlineMigrationSqlSha256).toBe(digest(offlineSql!))
    expect(artifact.definition.tables).toEqual(incubationTables)
  })
})
