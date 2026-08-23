import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  LATEST_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS,
  applyStorageMigrations,
  getStorageSchemaVersion,
} from '~~/server/storage/migrations'

const openConnections: DatabaseSync[] = []

const openMemoryConnection = (): DatabaseSync => {
  const connection = new DatabaseSync(':memory:')
  openConnections.push(connection)
  return connection
}

afterEach(() => {
  while (openConnections.length > 0) openConnections.pop()?.close()
})

const tableNames = (connection: DatabaseSync): string[] => connection.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
  ORDER BY name ASC
`).all().map((row) => String(row.name))

const indexList = (connection: DatabaseSync, table: string): Array<{ readonly name: string; readonly unique: number }> =>
  connection.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all()
    .map((row) => ({ name: String(row.name), unique: Number(row.unique) }))

const tableColumns = (connection: DatabaseSync, table: string): Array<{
  readonly name: string
  readonly type: string
  readonly notNull: number
  readonly primaryKeyPosition: number
}> => connection.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all()
  .map((row) => ({
    name: String(row.name),
    type: String(row.type),
    notNull: Number(row.notnull),
    primaryKeyPosition: Number(row.pk),
  }))

const applyMigrationsThroughVersion = (connection: DatabaseSync, version: number): void => {
  for (const migration of STORAGE_MIGRATIONS.filter((candidate) => candidate.version <= version)) {
    migration.up(connection)
    connection.exec(`PRAGMA user_version = ${migration.version}`)
  }
}
const applySingleMigrationVersion = (connection: DatabaseSync, version: number): void => {
  const migration = STORAGE_MIGRATIONS.find(candidate => candidate.version === version)
  if (!migration) throw new Error(`Missing storage migration ${version}`)
  migration.up(connection)
  connection.exec(`PRAGMA user_version = ${version}`)
}

const expectedTableNames = [
  'ability_declaration_offers',
  'ability_resolution_ops',
  'breeding_archive_import_requests',
  'breeding_archive_restore_receipts',
  'breeding_archives',
  'breeding_authorization_receipts',
  'breeding_checks',
  'breeding_consents',
  'breeding_gm_adjudications',
  'breeding_gm_overrides',
  'breeding_incubation_segments',
  'breeding_inheritance_learning_records',
  'breeding_operation_scopes',
  'breeding_operations',
  'breeding_option_offers',
  'breeding_projects',
  'breeding_read_sets',
  'breeding_rolls',
  'campaign_clock',
  'campaign_day_operations',
  'capability_adjudications',
  'capability_resolution_ops',
  'contest_operations',
  'contest_preparation_operations',
  'contest_ux_metric_aggregates',
  'contests',
  'encounter_director_ops',
  'encounter_documents',
  'encounter_launch_ops',
  'encounter_settlement_attention_sources',
  'encounter_settlement_corrections',
  'encounter_settlement_history_facts',
  'encounter_settlement_operations',
  'encounter_settlements',
  'encounter_ux_metric_aggregates',
  'equipment_action_operations',
  'equipment_operations',
  'group_inventories',
  'inventory_action_operations',
  'item_breeding_operations',
  'item_exploration_operations',
  'item_extended_action_activities',
  'item_form_change_operations',
  'item_guided_requests',
  'item_operation_scopes',
  'item_operations',
  'live_play_ops',
  'map_folders',
  'map_interaction_modes',
  'maps',
  'onboarding_completions',
  'onboarding_drafts',
  'onboarding_ops',
  'onboarding_policies',
  'onboarding_review_entries',
  'onboarding_slots',
  'onboarding_submissions',
  'pending_move_resolutions',
  'pokemon_breeding_origins',
  'pokemon_egg_transfer_consents',
  'pokemon_eggs',
  'realtime_event_log_state',
  'realtime_events',
  'sheet_folders',
  'sheets',
  'shop_checkout_ops',
  'shop_tables',
  'skill_check_operations',
  'skill_checks',
  'trainer_species_acquisition_source_operations',
  'trainer_species_acquisitions',
]

const documentStoreTableColumns = [
  { name: 'slug', type: 'TEXT', notNull: 0, primaryKeyPosition: 1 },
  { name: 'document_json', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
  { name: 'revision', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
  { name: 'updated_at', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
]

const expectedMigrationVersions = Array.from(
  { length: LATEST_STORAGE_SCHEMA_VERSION },
  (_, index) => index + 1,
)
const expectedMigrationsAfter = (version: number): number[] =>
  expectedMigrationVersions.filter(candidate => candidate > version)

describe('SQLite storage migrations', () => {
  it('keeps migration versions contiguous through the declared latest schema', () => {
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(50)
    expect(STORAGE_MIGRATIONS.map((migration) => migration.version))
      .toEqual(expectedMigrationVersions)
    expect(STORAGE_MIGRATIONS.at(-1)?.version).toBe(LATEST_STORAGE_SCHEMA_VERSION)
  })

  it('upgrades v39 through the unified inventory journal and stack-action extension only once', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 39)
    connection.exec('PRAGMA foreign_keys = ON')
    expect(tableNames(connection)).toContain('item_guided_requests')
    expect(tableNames(connection)).not.toContain('inventory_action_operations')
    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 39,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(39),
    })
    expect(tableNames(connection)).toContain('inventory_action_operations')
    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: LATEST_STORAGE_SCHEMA_VERSION,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: [],
    })
  })

  it('upgrades v40 inventory-action rows byte-for-byte while admitting only reviewed stack actions', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 40)
    connection.exec('PRAGMA foreign_keys = ON')
    const insert = (operationId: string, action: string, hash: string) => connection.prepare(`
      INSERT INTO inventory_action_operations (
        operation_id, action_kind, status, principal_key, trainer_slug,
        declaration_sha256, declaration_json, downstream_command_json,
        result_json, created_at, updated_at
      ) VALUES (?, ?, 'pending', 'role:gm', 'ash', ?, '{}', '{}', NULL, 10, 10)
    `).run(operationId, action, hash)
    const existingId = `inventory-action:v1:${'1'.repeat(32)}`
    insert(existingId, 'equip', 'a'.repeat(64))
    const before = connection.prepare('SELECT * FROM inventory_action_operations WHERE operation_id = ?').get(existingId)

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 40,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(40),
    })
    expect(connection.prepare('SELECT * FROM inventory_action_operations WHERE operation_id = ?').get(existingId)).toEqual(before)
    for (const [index, action] of ['split', 'merge', 'discard'].entries()) {
      insert(`inventory-action:v1:${String(index + 2).repeat(32)}`, action, 'b'.repeat(64))
    }
    expect(() => insert(`inventory-action:v1:${'9'.repeat(32)}`, 'use', 'c'.repeat(64))).toThrow()
    expect(connection.prepare(`
      SELECT action_kind FROM inventory_action_operations ORDER BY operation_id
    `).all().map(row => row.action_kind)).toEqual(['equip', 'split', 'merge', 'discard'])
  })

  it('adds revisioned atomic settlement, immutable history, and authority-linked attention tables at v42', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 41)
    connection.exec('PRAGMA foreign_keys = ON')
    expect(tableNames(connection)).not.toContain('encounter_settlements')

    applySingleMigrationVersion(connection, 42)
    expect(getStorageSchemaVersion(connection)).toBe(42)
    expect(tableNames(connection)).toEqual(expect.arrayContaining([
      'encounter_settlements',
      'encounter_settlement_operations',
      'encounter_settlement_history_facts',
      'encounter_settlement_attention_sources',
    ]))
    expect(tableColumns(connection, 'encounter_settlements').map(column => column.name)).toEqual([
      'settlement_id', 'encounter_id', 'status', 'revision', 'document_json',
      'definition_sha256', 'created_at_campaign_minute', 'updated_at_campaign_minute',
      'completion_operation_id',
    ])
    expect(indexList(connection, 'encounter_settlement_history_facts').map(index => index.name)).toEqual(expect.arrayContaining([
      'encounter_settlement_history_facts_settlement_idx',
      'encounter_settlement_history_facts_subject_idx',
    ]))
    expect(indexList(connection, 'encounter_settlement_attention_sources').map(index => index.name)).toEqual(expect.arrayContaining([
      'encounter_settlement_attention_sources_entity_status_idx',
      'encounter_settlement_attention_sources_status_created_idx',
    ]))
    expect(() => connection.prepare(`
      INSERT INTO encounter_settlements (
        settlement_id, encounter_id, status, revision, document_json, definition_sha256,
        created_at_campaign_minute, updated_at_campaign_minute, completion_operation_id
      ) VALUES ('settlement-a', 'encounter-a', 'completed', 0, '{}', ?, 0, 0, NULL)
    `).run('a'.repeat(64))).toThrow()
  })

  it('adds immutable authority-linked settlement correction evidence at v43', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 42)
    connection.exec('PRAGMA foreign_keys = ON')
    expect(tableNames(connection)).not.toContain('encounter_settlement_corrections')

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 42,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(42),
    })
    expect(tableColumns(connection, 'encounter_settlement_corrections').map(column => column.name)).toEqual([
      'operation_id', 'settlement_id', 'principal_key', 'source_receipt_id', 'reason_code',
      'command_sha256', 'command_json', 'offer_definition_sha256',
      'authority_definition_sha256', 'evidence_json', 'result_json',
      'result_definition_sha256', 'settlement_revision', 'created_at',
      'accepted_at_campaign_minute',
    ])
    expect(indexList(connection, 'encounter_settlement_corrections').map(index => index.name))
      .toContain('encounter_settlement_corrections_settlement_revision_idx')
  })

  it('rebuilds v43 guided requests at v44 without losing rows and admits only the reviewed campaign-tool kind', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 43)
    connection.exec('PRAGMA foreign_keys = ON')
    const insert = connection.prepare(`
      INSERT INTO item_guided_requests (
        request_id, request_kind, status, revision, canonical_item_id,
        canonical_definition_sha256, declaration_principal_key, actor_kind, actor_slug,
        target_kind, target_slug, item_operation_id, declaration_operation_id,
        declaration_command_sha256, declaration_command_json, authority_json,
        created_at, updated_at
      ) VALUES (?, ?, 'pending', 0, ?, ?, ?, 'trainer', ?, 'trainer', ?, NULL, ?, ?, '{}', '{}', 10, 10)
    `)
    insert.run(
      `item-guided:v1:${'1'.repeat(32)}`, 'loyalty-consequence', 'Energy Powder',
      'a'.repeat(64), 'profile:ash', 'ash', 'ash', 'guided-declaration-old', 'b'.repeat(64),
    )
    expect(() => insert.run(
      `item-guided:v1:${'2'.repeat(32)}`, 'campaign-tool-adjudication', 'Smoke Ball',
      'c'.repeat(64), 'profile:ash', 'ash', 'ash', 'guided-declaration-new', 'd'.repeat(64),
    )).toThrow()

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 43,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(43),
    })
    expect(connection.prepare(`
      SELECT request_id, request_kind, canonical_item_id FROM item_guided_requests ORDER BY request_id
    `).all()).toEqual([{
      request_id: `item-guided:v1:${'1'.repeat(32)}`,
      request_kind: 'loyalty-consequence',
      canonical_item_id: 'Energy Powder',
    }])
    insert.run(
      `item-guided:v1:${'2'.repeat(32)}`, 'campaign-tool-adjudication', 'Smoke Ball',
      'c'.repeat(64), 'profile:ash', 'ash', 'ash', 'guided-declaration-new', 'd'.repeat(64),
    )
    expect(connection.prepare(`
      SELECT request_kind FROM item_guided_requests ORDER BY request_id DESC LIMIT 1
    `).get()).toEqual({ request_kind: 'campaign-tool-adjudication' })
    insert.run(
      `item-guided:v1:${'3'.repeat(32)}`, 'fishing-adjudication', 'Old Rod',
      'e'.repeat(64), 'profile:ash', 'ash', 'ash', 'equipment-fishing-declaration', 'f'.repeat(64),
    )
    insert.run(
      `item-guided:v1:${'4'.repeat(32)}`, 'snag-conversion-adjudication', 'Snag Machine',
      '1'.repeat(64), 'profile:ash', 'ash', 'ash', 'equipment-snag-declaration', '2'.repeat(64),
    )
    const guidedSql = (connection.prepare(`
      SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'item_guided_requests'
    `).get() as { sql: string }).sql
    expect(guidedSql).toContain("'campaign-tool-adjudication'")
    expect(guidedSql).toContain("'fishing-adjudication'")
    expect(guidedSql).toContain("'snag-conversion-adjudication'")
  })

  it('rebuilds v48 guided requests at v49 without rewriting fishing evidence and admits Snag conversion', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 48)
    connection.exec('PRAGMA foreign_keys = ON')
    const insert = connection.prepare(`
      INSERT INTO item_guided_requests (
        request_id, request_kind, status, revision, canonical_item_id,
        canonical_definition_sha256, declaration_principal_key, actor_kind, actor_slug,
        target_kind, target_slug, item_operation_id, declaration_operation_id,
        declaration_command_sha256, declaration_command_json, authority_json,
        created_at, updated_at
      ) VALUES (?, ?, 'pending', 0, ?, ?, 'role:gm', 'trainer', 'ash',
        'trainer', 'ash', NULL, ?, ?, '{}', '{}', 10, 10)
    `)
    const fishingId = `item-guided:v1:${'5'.repeat(32)}`
    insert.run(fishingId, 'fishing-adjudication', 'Old Rod', 'a'.repeat(64), 'fishing-declaration-v48', 'b'.repeat(64))
    const before = connection.prepare('SELECT * FROM item_guided_requests WHERE request_id = ?').get(fishingId)

    applySingleMigrationVersion(connection, 49)

    expect(getStorageSchemaVersion(connection)).toBe(49)
    expect(connection.prepare('SELECT * FROM item_guided_requests WHERE request_id = ?').get(fishingId)).toEqual(before)
    insert.run(
      `item-guided:v1:${'6'.repeat(32)}`, 'snag-conversion-adjudication', 'Snag Machine',
      'c'.repeat(64), 'snag-declaration-v49', 'd'.repeat(64),
    )
    expect(connection.prepare(`
      SELECT request_kind FROM item_guided_requests WHERE request_id = ?
    `).get(`item-guided:v1:${'6'.repeat(32)}`)).toEqual({ request_kind: 'snag-conversion-adjudication' })
  })

  it('upgrades v29 item rows with pending-decision and immutable resume evidence without rewriting history', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 29)
    connection.exec('PRAGMA foreign_keys = ON')
    expect(tableColumns(connection, 'item_operations').map(column => column.name)).not.toContain('pending_decision_json')
    connection.prepare(`
      INSERT INTO item_operations (
        operation_id, command_sha256, command_json, status, canonical_item_id,
        canonical_definition_sha256, plan_json, result_json, correction_of_operation_id,
        created_at, updated_at
      ) VALUES ('op_item_migration_0001', ?, '{}', 'pending', 'Potion', ?, '{}', NULL, NULL, 10, 10)
    `).run('a'.repeat(64), 'b'.repeat(64))
    connection.prepare(`
      INSERT INTO item_operation_scopes (
        operation_id, scope_kind, scope_key, expected_revision, scope_json
      ) VALUES ('op_item_migration_0001', 'sheet', 'trainer:ash', 3,
        '{"kind":"sheet","sheetKind":"trainer","id":"ash","revision":3}')
    `).run()

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 29,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(29),
    })
    expect(tableColumns(connection, 'item_operations').map(column => column.name).slice(-6)).toEqual([
      'pending_decision_json', 'resume_command_sha256', 'resume_command_json',
      'recovery_command_sha256', 'recovery_command_json', 'compensation_json',
    ])
    expect(connection.prepare(`
      SELECT operation_id, command_sha256, status, canonical_item_id, created_at, updated_at
      FROM item_operations
    `).get()).toEqual({
      operation_id: 'op_item_migration_0001',
      command_sha256: 'a'.repeat(64),
      status: 'pending',
      canonical_item_id: 'Potion',
      created_at: 10,
      updated_at: 10,
    })
    expect(connection.prepare('SELECT operation_id, scope_key FROM item_operation_scopes').get())
      .toEqual({ operation_id: 'op_item_migration_0001', scope_key: 'trainer:ash' })
    expect(() => connection.prepare(`
      UPDATE item_operations SET resume_command_sha256 = ? WHERE operation_id = 'op_item_migration_0001'
    `).run('c'.repeat(64))).toThrow('resume command evidence must be complete')
  })

  it('adds immutable recovery and compensation evidence at v31 without rewriting v30 rows', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 30)
    connection.exec('PRAGMA foreign_keys = ON')
    connection.prepare(`
      INSERT INTO item_operations (
        operation_id, command_sha256, command_json, resume_command_sha256, resume_command_json,
        status, canonical_item_id, canonical_definition_sha256, plan_json, pending_decision_json,
        result_json, correction_of_operation_id, created_at, updated_at
      ) VALUES ('op_item_v30_history_0001', ?, '{}', NULL, NULL, 'accepted', 'Potion', ?, '{}', NULL,
        '{"schemaVersion":1,"operationId":"op_item_v30_history_0001","status":"accepted","canonicalItemId":"Potion","aggregateRefs":[],"receiptId":"legacy-receipt","exactReplay":false}',
        NULL, 10, 20)
    `).run('a'.repeat(64), 'b'.repeat(64))

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 30,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(30),
    })
    expect(connection.prepare(`
      SELECT operation_id, status, recovery_command_sha256, recovery_command_json, compensation_json
      FROM item_operations
    `).get()).toEqual({
      operation_id: 'op_item_v30_history_0001', status: 'accepted',
      recovery_command_sha256: null, recovery_command_json: null, compensation_json: null,
    })
    expect(() => connection.prepare(`
      UPDATE item_operations SET status = 'abandoned', result_json = '{}'
      WHERE operation_id = 'op_item_v30_history_0001'
    `).run()).toThrow('recovery evidence must match terminal status')
    expect(() => connection.prepare(`
      UPDATE item_operations SET recovery_command_sha256 = ?
      WHERE operation_id = 'op_item_v30_history_0001'
    `).run('c'.repeat(64))).toThrow('recovery evidence must match terminal status')
  })

  it('adds bounded replay-safe campaign-day evidence at v32 without rewriting prior operation tables', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 31)
    connection.exec('PRAGMA foreign_keys = ON')
    expect(tableNames(connection)).not.toContain('campaign_day_operations')
    connection.prepare(`
      INSERT INTO item_operations (
        operation_id, command_sha256, command_json, status, canonical_item_id,
        canonical_definition_sha256, plan_json, result_json, correction_of_operation_id,
        created_at, updated_at
      ) VALUES ('op_item_v31_preserved', ?, '{}', 'accepted', 'Potion', ?, '{}', '{}', NULL, 10, 20)
    `).run('a'.repeat(64), 'b'.repeat(64))

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 31,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(31),
    })
    expect(connection.prepare(`
      SELECT operation_id, status FROM item_operations WHERE operation_id = 'op_item_v31_preserved'
    `).get()).toEqual({ operation_id: 'op_item_v31_preserved', status: 'accepted' })
    expect(tableColumns(connection, 'campaign_day_operations').map(column => column.name)).toEqual([
      'operation_id', 'command_sha256', 'command_json', 'result_json', 'created_at',
    ])
    expect(indexList(connection, 'campaign_day_operations').map(index => index.name))
      .toContain('campaign_day_operations_created_idx')
    const insert = connection.prepare(`
      INSERT INTO campaign_day_operations (
        operation_id, command_sha256, command_json, result_json, created_at
      ) VALUES (?, ?, '{}', '{}', 100)
    `)
    expect(() => insert.run(
      'campaign-day:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'b'.repeat(64),
    )).not.toThrow()
    expect(() => insert.run(
      'campaign-day:v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'c'.repeat(64),
    )).toThrow()
    expect(() => connection.prepare(`
      INSERT INTO campaign_day_operations (
        operation_id, command_sha256, command_json, result_json, created_at
      ) VALUES (?, ?, ?, '{}', 101)
    `).run(
      'campaign-day:v1:dddddddddddddddddddddddddddddddd',
      'e'.repeat(64),
      JSON.stringify({ payload: 'x'.repeat(5_000) }),
    )).toThrow()
  })

  it('adds replay-safe equipment evidence at v33 and lifecycle kinds at v34 without rewriting v32 history', () => {
    const connection = openMemoryConnection()
    connection.exec('PRAGMA foreign_keys = OFF')
    applyMigrationsThroughVersion(connection, 32)
    connection.exec('PRAGMA foreign_keys = ON')
    connection.prepare(`
      INSERT INTO campaign_day_operations (
        operation_id, command_sha256, command_json, result_json, created_at
      ) VALUES (?, ?, '{}', '{}', 100)
    `).run('campaign-day:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'b'.repeat(64))
    expect(tableNames(connection)).not.toContain('equipment_operations')

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 32,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(32),
    })
    expect(connection.prepare('SELECT operation_id FROM campaign_day_operations').get()).toEqual({
      operation_id: 'campaign-day:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
    expect(tableColumns(connection, 'equipment_operations').map(column => column.name)).toEqual([
      'operation_id', 'command_sha256', 'command_kind', 'actor_profile_id',
      'command_json', 'result_json', 'evidence_json', 'created_at',
    ])
    expect(indexList(connection, 'equipment_operations').map(index => index.name))
      .toContain('equipment_operations_created_idx')
    expect(() => connection.prepare(`
      INSERT INTO equipment_operations (
        operation_id, command_sha256, command_kind, actor_profile_id,
        command_json, result_json, evidence_json, created_at
      ) VALUES (?, ?, 'equip', NULL, '{}', '{}', '{}', 100)
    `).run(`equipment-operation:v1:${'a'.repeat(32)}`, 'b'.repeat(64))).not.toThrow()
    expect(() => connection.prepare(`
      INSERT INTO equipment_operations (
        operation_id, command_sha256, command_kind, actor_profile_id,
        command_json, result_json, evidence_json, created_at
      ) VALUES (?, ?, 'drop', NULL, '{}', '{}', '{}', 100)
    `).run(`equipment-operation:v1:${'c'.repeat(32)}`, 'd'.repeat(64))).toThrow()
  })

  it('creates realtime, inventory, shop, and pending-resolution tables for a fresh database', () => {
    const connection = openMemoryConnection()

    const result = applyStorageMigrations(connection)

    expect(result).toMatchObject({
      fromVersion: 0,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(0),
    })
    expect(getStorageSchemaVersion(connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(connection.prepare('SELECT latest_sequence, earliest_available_sequence FROM realtime_event_log_state WHERE singleton = 1').get())
      .toEqual({ latest_sequence: 0, earliest_available_sequence: 1 })

    const indexes = indexList(connection, 'realtime_events')
    expect(indexes.map((index) => index.name)).toContain('realtime_events_channel_sequence_idx')
    expect(indexes.map((index) => index.name)).toContain('realtime_events_created_at_idx')
    expect(indexes.some((index) => index.unique === 1)).toBe(true)

    expect(tableColumns(connection, 'group_inventories')).toEqual(documentStoreTableColumns)
    expect(tableColumns(connection, 'shop_tables')).toEqual(documentStoreTableColumns)
    expect(tableColumns(connection, 'live_play_ops')).toEqual([
      { name: 'op_id', type: 'TEXT', notNull: 0, primaryKeyPosition: 1 },
      { name: 'map_slug', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'command_hash', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'command_json', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'result_json', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'result_revision', type: 'INTEGER', notNull: 0, primaryKeyPosition: 0 },
      { name: 'created_at', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
      { name: 'move_compensation_json', type: 'TEXT', notNull: 0, primaryKeyPosition: 0 },
      { name: 'correction_origin_op_id', type: 'TEXT', notNull: 0, primaryKeyPosition: 0 },
    ])
    expect(indexList(connection, 'live_play_ops').map((index) => index.name))
      .toContain('live_play_ops_correction_origin_idx')
    expect(tableColumns(connection, 'shop_checkout_ops')).toEqual([
      { name: 'op_id', type: 'TEXT', notNull: 0, primaryKeyPosition: 1 },
      { name: 'shop_slug', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'command_hash', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'command_json', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'result_json', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'result_revision', type: 'INTEGER', notNull: 0, primaryKeyPosition: 0 },
      { name: 'created_at', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
    ])
    expect(indexList(connection, 'shop_checkout_ops').map((index) => index.name))
      .toContain('shop_checkout_ops_shop_revision_idx')
    expect(tableColumns(connection, 'pending_move_resolutions')).toEqual([
      { name: 'resolution_id', type: 'TEXT', notNull: 0, primaryKeyPosition: 1 },
      { name: 'map_slug', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'origin_op_id', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'resolution_json', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'status', type: 'TEXT', notNull: 1, primaryKeyPosition: 0 },
      { name: 'revision', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
      { name: 'created_at', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
      { name: 'updated_at', type: 'INTEGER', notNull: 1, primaryKeyPosition: 0 },
      { name: 'terminal_op_id', type: 'TEXT', notNull: 0, primaryKeyPosition: 0 },
      { name: 'declaration_plan_json', type: 'TEXT', notNull: 0, primaryKeyPosition: 0 },
    ])
    expect(indexList(connection, 'pending_move_resolutions').map((index) => index.name))
      .toContain('pending_move_resolutions_map_status_idx')
    expect(tableColumns(connection, 'capability_adjudications').map(column => column.name)).toEqual([
      'request_id', 'command_sha256', 'map_slug', 'actor_placement_id', 'canonical_id',
      'action_id', 'command_json', 'definition_hash', 'status', 'requested_at', 'expires_at',
      'resolved_at', 'resolution_operation_id', 'resolution_command_sha256', 'resolution_map_revision',
    ])

    connection.prepare(`
      INSERT INTO realtime_events (dedupe_key, material_hash, channel, event_type, access_json, event_json, created_at)
      VALUES ('same-key', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'maps', 'updated', '{}', '{}', 1)
    `).run()
    expect(() => connection.prepare(`
      INSERT INTO realtime_events (dedupe_key, material_hash, channel, event_type, access_json, event_json, created_at)
      VALUES ('same-key', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'maps', 'updated', '{}', '{}', 2)
    `).run()).toThrow()
  })

  it('upgrades schema version 4 databases without deleting existing campaign rows', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 4)
    connection.prepare(`
      INSERT INTO maps (slug, document_json, revision, updated_at)
      VALUES ('training-yard', '{"slug":"training-yard"}', 4, 100)
    `).run()
    connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES ('pokemon', 'pikachu', '{"slug":"pikachu"}', 2, 101)
    `).run()
    connection.prepare(`
      INSERT INTO live_play_ops (op_id, map_slug, command_hash, command_json, result_json, result_revision, created_at)
      VALUES ('op_abcdefgh', 'training-yard', 'hash', '{}', '{"ok":false,"opId":"op_abcdefgh","mapSlug":"training-yard","reason":"invalid","message":"old"}', NULL, 102)
    `).run()

    const result = applyStorageMigrations(connection)

    expect(result).toEqual({
      fromVersion: 4,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(4),
    })
    expect(getStorageSchemaVersion(connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(connection.prepare('SELECT COUNT(*) AS count FROM maps').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM sheets').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM live_play_ops').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM group_inventories').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_tables').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM pending_move_resolutions').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT latest_sequence, earliest_available_sequence FROM realtime_event_log_state WHERE singleton = 1').get())
      .toEqual({ latest_sequence: 0, earliest_available_sequence: 1 })

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: LATEST_STORAGE_SCHEMA_VERSION,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: [],
    })
  })

  it('upgrades schema version 6 databases with the shop table without touching existing rows', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 6)
    connection.prepare(`
      INSERT INTO maps (slug, document_json, revision, updated_at)
      VALUES ('training-yard', '{"slug":"training-yard"}', 4, 100)
    `).run()
    connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES ('trainer', 'brock', '{"slug":"brock"}', 3, 101)
    `).run()
    connection.prepare(`
      INSERT INTO live_play_ops (op_id, map_slug, command_hash, command_json, result_json, result_revision, created_at)
      VALUES ('op_shopmig1', 'training-yard', 'hash', '{}', '{"ok":false,"opId":"op_shopmig1","mapSlug":"training-yard","reason":"invalid","message":"old"}', NULL, 102)
    `).run()
    connection.prepare(`
      INSERT INTO group_inventories (slug, document_json, revision, updated_at)
      VALUES ('main', '{"slug":"main"}', 8, 103)
    `).run()

    const result = applyStorageMigrations(connection)

    expect(result).toEqual({
      fromVersion: 6,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(6),
    })
    expect(getStorageSchemaVersion(connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(tableColumns(connection, 'shop_tables')).toEqual(documentStoreTableColumns)
    expect(connection.prepare('SELECT slug, revision, updated_at FROM maps').get())
      .toEqual({ slug: 'training-yard', revision: 4, updated_at: 100 })
    expect(connection.prepare('SELECT kind, slug, revision, updated_at FROM sheets').get())
      .toEqual({ kind: 'trainer', slug: 'brock', revision: 3, updated_at: 101 })
    expect(connection.prepare('SELECT op_id, map_slug, created_at FROM live_play_ops').get())
      .toEqual({ op_id: 'op_shopmig1', map_slug: 'training-yard', created_at: 102 })
    expect(connection.prepare('SELECT slug, revision, updated_at FROM group_inventories').get())
      .toEqual({ slug: 'main', revision: 8, updated_at: 103 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_tables').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get()).toEqual({ count: 0 })

    connection.prepare(`
      INSERT INTO shop_tables (slug, document_json, revision, updated_at)
      VALUES ('mart', '{"slug":"mart"}', 1, 104)
    `).run()
    expect(connection.prepare('SELECT slug, revision, updated_at FROM shop_tables').get())
      .toEqual({ slug: 'mart', revision: 1, updated_at: 104 })
  })

  it('upgrades schema version 7 databases with shop checkout operation history without touching shop rows', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 7)
    connection.prepare(`
      INSERT INTO shop_tables (slug, document_json, revision, updated_at)
      VALUES ('mart', '{"slug":"mart","name":"Mart"}', 2, 104)
    `).run()
    connection.prepare(`
      INSERT INTO live_play_ops (op_id, map_slug, command_hash, command_json, result_json, result_revision, created_at)
      VALUES ('op_oldmapop1', 'training-yard', 'hash', '{}', '{"ok":false,"opId":"op_oldmapop1","mapSlug":"training-yard","reason":"invalid","message":"old"}', NULL, 105)
    `).run()

    const result = applyStorageMigrations(connection)

    expect(result).toEqual({
      fromVersion: 7,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(7),
    })
    expect(getStorageSchemaVersion(connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(connection.prepare('SELECT slug, revision, updated_at FROM shop_tables').get())
      .toEqual({ slug: 'mart', revision: 2, updated_at: 104 })
    expect(connection.prepare('SELECT op_id, map_slug, created_at FROM live_play_ops').get())
      .toEqual({ op_id: 'op_oldmapop1', map_slug: 'training-yard', created_at: 105 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get()).toEqual({ count: 0 })

    connection.prepare(`
      INSERT INTO shop_checkout_ops (op_id, shop_slug, command_hash, command_json, result_json, result_revision, created_at)
      VALUES (
        'op_shopckmig01',
        'mart',
        'hash',
        '{"schemaVersion":1,"opId":"op_shopckmig01","type":"shopCheckout","scopes":[{"kind":"shop","shopSlug":"mart","field":"purchase"}],"payload":{"shopSlug":"mart","shopRevision":2,"paymentSource":{"kind":"trainer","slug":"ash","revision":1},"deliveryTarget":{"kind":"trainer","slug":"ash","revision":1},"lines":[{"entryId":"potion","quantity":1}],"origin":{"kind":"shopPage"}}}',
        '{"ok":false,"opId":"op_shopckmig01","shopSlug":"mart","reason":"invalid","message":"migration smoke","currentShopRevision":2}',
        2,
        106
      )
    `).run()
    expect(connection.prepare('SELECT op_id, shop_slug, result_revision, created_at FROM shop_checkout_ops').get())
      .toEqual({ op_id: 'op_shopckmig01', shop_slug: 'mart', result_revision: 2, created_at: 106 })
  })

  it('upgrades schema version 8 databases with a separate pending-resolution store', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 8)
    connection.prepare(`
      INSERT INTO live_play_ops (op_id, map_slug, command_hash, command_json, result_json, result_revision, created_at)
      VALUES ('op_beforepending1', 'training-yard', 'hash', '{}', '{"ok":false}', NULL, 107)
    `).run()

    const result = applyStorageMigrations(connection)

    expect(result).toEqual({
      fromVersion: 8,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(8),
    })
    expect(getStorageSchemaVersion(connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(connection.prepare('SELECT op_id, map_slug FROM live_play_ops').get())
      .toEqual({ op_id: 'op_beforepending1', map_slug: 'training-yard' })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM pending_move_resolutions').get())
      .toEqual({ count: 0 })
  })

  it('upgrades schema version 9 rows with unknown legacy declaration compensation', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 9)
    connection.prepare(`
      INSERT INTO pending_move_resolutions (
        resolution_id, map_slug, origin_op_id, resolution_json, status,
        revision, created_at, updated_at, terminal_op_id
      ) VALUES ('resolution-legacy', 'training-yard', 'op_legacypending1', '{}', 'pending', 0, 100, 100, NULL)
    `).run()

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 9,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(9),
    })
    expect(connection.prepare(`
      SELECT resolution_id, declaration_plan_json
      FROM pending_move_resolutions
    `).get()).toEqual({
      resolution_id: 'resolution-legacy',
      declaration_plan_json: null,
    })
  })

  it('upgrades schema version 10 operation rows with null private compensation metadata', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 10)
    connection.prepare(`
      INSERT INTO live_play_ops (
        op_id, map_slug, command_hash, command_json, result_json,
        result_revision, created_at
      ) VALUES (
        'op_beforecomp01', 'training-yard', 'hash', '{}',
        '{"ok":false,"opId":"op_beforecomp01","mapSlug":"training-yard","reason":"invalid","message":"old"}',
        NULL, 108
      )
    `).run()

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 10,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(10),
    })
    expect(connection.prepare(`
      SELECT op_id, move_compensation_json
      FROM live_play_ops
    `).get()).toEqual({
      op_id: 'op_beforecomp01',
      move_compensation_json: null,
    })
  })

  it('upgrades schema version 11 operation rows with null correction ancestry', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 11)
    connection.prepare(`
      INSERT INTO live_play_ops (
        op_id, map_slug, command_hash, command_json, result_json,
        result_revision, move_compensation_json, created_at
      ) VALUES (
        'op_beforecorrect1', 'training-yard', 'hash', '{}',
        '{"ok":false,"opId":"op_beforecorrect1","mapSlug":"training-yard","reason":"invalid","message":"old"}',
        NULL, NULL, 109
      )
    `).run()

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 11,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(11),
    })
    expect(connection.prepare(`
      SELECT op_id, correction_origin_op_id
      FROM live_play_ops
    `).get()).toEqual({
      op_id: 'op_beforecorrect1',
      correction_origin_op_id: null,
    })
  })

  it('upgrades schema version 5 databases with group inventory and shop tables', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 5)
    connection.prepare(`
      INSERT INTO maps (slug, document_json, revision, updated_at)
      VALUES ('training-yard', '{"slug":"training-yard"}', 4, 100)
    `).run()
    connection.prepare(`
      INSERT INTO realtime_events (dedupe_key, material_hash, channel, event_type, access_json, event_json, created_at)
      VALUES ('group-inventory-upgrade', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 'maps', 'updated', '{}', '{}', 103)
    `).run()

    const result = applyStorageMigrations(connection)

    expect(result).toEqual({
      fromVersion: 5,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(5),
    })
    expect(getStorageSchemaVersion(connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(connection)).toEqual(expectedTableNames)
    expect(tableColumns(connection, 'group_inventories')).toEqual(documentStoreTableColumns)
    expect(tableColumns(connection, 'shop_tables')).toEqual(documentStoreTableColumns)
    expect(connection.prepare('SELECT COUNT(*) AS count FROM shop_checkout_ops').get()).toEqual({ count: 0 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM maps').get()).toEqual({ count: 1 })
    expect(connection.prepare('SELECT COUNT(*) AS count FROM realtime_events').get()).toEqual({ count: 1 })

    connection.prepare(`
      INSERT INTO group_inventories (slug, document_json, revision, updated_at)
      VALUES ('main', '{"slug":"main"}', 0, 104)
    `).run()
    expect(connection.prepare('SELECT slug, revision, updated_at FROM group_inventories').get())
      .toEqual({ slug: 'main', revision: 0, updated_at: 104 })
  })

  it('upgrades version 16 adjudications with replay command and terminal revision authority', () => {
    const connection = openMemoryConnection()
    applyMigrationsThroughVersion(connection, 16)
    connection.prepare(`
      INSERT INTO capability_adjudications (
        request_id, command_sha256, map_slug, actor_placement_id, canonical_id,
        action_id, command_json, definition_hash, status, requested_at,
        expires_at, resolved_at, resolution_operation_id
      ) VALUES (
        'legacy-request', '${'a'.repeat(64)}', 'arena', 'actor', 'Sprouter',
        'sprout', '{}', '${'b'.repeat(64)}', 'pending', 100, 200, NULL, NULL
      )
    `).run()

    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: 16,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: expectedMigrationsAfter(16),
    })
    expect(connection.prepare(`
      SELECT request_id, resolution_command_sha256, resolution_map_revision
      FROM capability_adjudications
    `).get()).toEqual({
      request_id: 'legacy-request',
      resolution_command_sha256: null,
      resolution_map_revision: null,
    })
    expect(applyStorageMigrations(connection)).toEqual({
      fromVersion: LATEST_STORAGE_SCHEMA_VERSION,
      toVersion: LATEST_STORAGE_SCHEMA_VERSION,
      appliedVersions: [],
    })
  })
})
