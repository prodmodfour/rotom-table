import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createContestDocument, parseContestDocument } from '../../shared/contests/document'
import {
  LATEST_STORAGE_SCHEMA_VERSION,
  STORAGE_MIGRATIONS,
  applyStorageMigrations,
  getStorageSchemaVersion,
} from '../../server/storage/migrations'

const connections: DatabaseSync[] = []
const open = (): DatabaseSync => {
  const connection = new DatabaseSync(':memory:')
  connections.push(connection)
  return connection
}
afterEach(() => {
  while (connections.length > 0) connections.pop()!.close()
})

const applyThrough = (connection: DatabaseSync, version: number): void => {
  connection.exec('PRAGMA foreign_keys = OFF')
  for (const migration of STORAGE_MIGRATIONS.filter(row => row.version <= version)) {
    migration.up(connection)
    connection.exec(`PRAGMA user_version = ${migration.version}`)
  }
  connection.exec('PRAGMA foreign_keys = ON')
}

const expectedUpgradeFrom = (version: number) => ({
  fromVersion: version,
  toVersion: LATEST_STORAGE_SCHEMA_VERSION,
  appliedVersions: STORAGE_MIGRATIONS.filter(row => row.version > version).map(row => row.version),
})

const tableNames = (connection: DatabaseSync): string[] => connection.prepare(`
  SELECT name FROM sqlite_schema
  WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all().map(row => String(row.name))

const indexNames = (connection: DatabaseSync, table: string): string[] => connection
  .prepare(`PRAGMA index_list(${JSON.stringify(table)})`)
  .all()
  .map(row => String(row.name))

const contest = createContestDocument({
  contestId: 'contest:v1:p11-migration',
  name: 'Historical ordinary Contest',
  hallName: 'Migration Hall',
  description: '',
  variantId: 'standard',
  contestTypeId: 'cool',
  significanceMultiplier: 1,
  awardRibbon: true,
  prize: { declared: false, money: 0, items: [], notes: '' },
  gmNotes: 'preserve exactly',
  now: 100,
})

const insertContest = (connection: DatabaseSync): void => {
  connection.prepare(`
    INSERT INTO contests (
      contest_id, document_json, revision, stage, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(contest.contestId, JSON.stringify(contest), contest.revision, contest.stage, contest.createdAt, contest.updatedAt)
}

const insertGuided = (
  connection: DatabaseSync,
  requestKind: 'loyalty-consequence' | 'fishing-adjudication' | 'snag-conversion-adjudication',
  suffix: string,
): string => {
  const requestId = `item-guided:v1:${suffix.repeat(32).slice(0, 32)}`
  connection.prepare(`
    INSERT INTO item_guided_requests (
      request_id, request_kind, status, revision, canonical_item_id,
      canonical_definition_sha256, declaration_principal_key, actor_kind, actor_slug,
      target_kind, target_slug, item_operation_id, declaration_operation_id,
      declaration_command_sha256, declaration_command_json, authority_json,
      created_at, updated_at
    ) VALUES (?, ?, 'pending', 0, ?, ?, 'role:gm', 'trainer', 'migration-trainer',
      'trainer', 'migration-trainer', NULL, ?, ?, '{}', '{}', 100, 100)
  `).run(
    requestId,
    requestKind,
    requestKind === 'fishing-adjudication' ? 'Old Rod' : requestKind === 'snag-conversion-adjudication' ? 'Snag Machine' : 'Energy Powder',
    'a'.repeat(64),
    `p11-migration-${requestKind}`,
    'b'.repeat(64),
  )
  return requestId
}

const insertEquipmentOperation = (connection: DatabaseSync): void => {
  connection.prepare(`
    INSERT INTO equipment_action_operations (
      operation_id, command_sha256, principal_key, map_slug, command_json,
      result_json, evidence_json, result_revision, created_at
    ) VALUES (?, ?, ?, ?, '{}', '{}', '{}', 7, 100)
  `).run('p11-migration-equipment-operation', 'c'.repeat(64), 'role:gm', 'migration-map')
}

const rowJson = (connection: DatabaseSync, table: string, key: string, value: string): string => JSON.stringify(
  connection.prepare(`SELECT * FROM ${table} WHERE ${key} = ?`).get(value),
)

describe('P11-082 Deferred Mechanics Closure storage migrations', () => {
  it('retains every Plan 11 table and index on a fresh current-schema database', () => {
    const connection = open()
    expect(applyStorageMigrations(connection)).toEqual(expectedUpgradeFrom(0))
    expect(LATEST_STORAGE_SCHEMA_VERSION).toBe(56)
    expect(getStorageSchemaVersion(connection)).toBe(LATEST_STORAGE_SCHEMA_VERSION)
    expect(tableNames(connection)).toEqual(expect.arrayContaining([
      'equipment_action_operations',
      'item_guided_requests',
      'skill_checks',
      'skill_check_operations',
      'contests',
      'contest_operations',
    ]))
    expect(indexNames(connection, 'equipment_action_operations')).toContain('equipment_action_operations_map_revision_idx')
    expect(indexNames(connection, 'skill_checks')).toEqual(expect.arrayContaining([
      'skill_checks_state_updated_idx',
      'skill_checks_requester_updated_idx',
      'skill_checks_expiry_idx',
    ]))
    expect(indexNames(connection, 'skill_check_operations')).toContain('skill_check_operations_check_revision_idx')
  })

  it('upgrades a Plan 10 v46 campaign through all four Plan 11 versions without rewriting authority', () => {
    const connection = open()
    applyThrough(connection, 46)
    insertContest(connection)
    const requestId = insertGuided(connection, 'loyalty-consequence', '4')
    const contestBefore = rowJson(connection, 'contests', 'contest_id', contest.contestId)
    const guidedBefore = rowJson(connection, 'item_guided_requests', 'request_id', requestId)

    expect(applyStorageMigrations(connection)).toEqual(expectedUpgradeFrom(46))
    expect(rowJson(connection, 'contests', 'contest_id', contest.contestId)).toBe(contestBefore)
    expect(rowJson(connection, 'item_guided_requests', 'request_id', requestId)).toBe(guidedBefore)
    const stored = connection.prepare('SELECT document_json FROM contests WHERE contest_id = ?').get(contest.contestId) as { document_json: string }
    expect(parseContestDocument(JSON.parse(stored.document_json))).toEqual(contest)
    expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it.each([
    { version: 47, kind: 'loyalty-consequence' as const, suffix: '7', equipment: true },
    { version: 48, kind: 'fishing-adjudication' as const, suffix: '8', equipment: true },
    { version: 49, kind: 'snag-conversion-adjudication' as const, suffix: '9', equipment: true },
  ])('preserves exact v$version Plan 11 rows while applying later versions', ({ version, kind, suffix, equipment }) => {
    const connection = open()
    applyThrough(connection, version)
    const requestId = insertGuided(connection, kind, suffix)
    if (equipment) insertEquipmentOperation(connection)
    const guidedBefore = rowJson(connection, 'item_guided_requests', 'request_id', requestId)
    const equipmentBefore = rowJson(connection, 'equipment_action_operations', 'operation_id', 'p11-migration-equipment-operation')

    expect(applyStorageMigrations(connection)).toEqual(expectedUpgradeFrom(version))
    expect(rowJson(connection, 'item_guided_requests', 'request_id', requestId)).toBe(guidedBefore)
    expect(rowJson(connection, 'equipment_action_operations', 'operation_id', 'p11-migration-equipment-operation')).toBe(equipmentBefore)
    expect(connection.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })

  it('rolls back a failed predecessor-shape upgrade without advancing or partially rebuilding', () => {
    const connection = open()
    applyThrough(connection, 47)
    connection.exec(`
      ALTER TABLE item_guided_requests RENAME TO item_guided_requests_original;
      CREATE TABLE item_guided_requests AS SELECT * FROM item_guided_requests_original;
      DROP TABLE item_guided_requests_original;
    `)
    const tablesBefore = tableNames(connection)
    expect(() => applyStorageMigrations(connection)).toThrow('Storage migration v48 requires the exact v44 guided-request table definition')
    expect(getStorageSchemaVersion(connection)).toBe(47)
    expect(tableNames(connection)).toEqual(tablesBefore)
    expect(tableNames(connection)).not.toContain('item_guided_requests_v48')
  })

  it('refuses downgrade-by-opening a future schema before any migration write', () => {
    const connection = open()
    applyThrough(connection, LATEST_STORAGE_SCHEMA_VERSION)
    connection.exec(`CREATE TABLE future_authority (id TEXT PRIMARY KEY, payload TEXT NOT NULL);`)
    connection.prepare('INSERT INTO future_authority VALUES (?, ?)').run('future-row', 'retain-me')
    const futureVersion = LATEST_STORAGE_SCHEMA_VERSION + 1
    connection.exec(`PRAGMA user_version = ${futureVersion}`)
    const tablesBefore = tableNames(connection)
    expect(() => applyStorageMigrations(connection)).toThrow(
      `SQLite schema version ${futureVersion} is newer than this Rotom Table build supports (${LATEST_STORAGE_SCHEMA_VERSION})`,
    )
    expect(getStorageSchemaVersion(connection)).toBe(futureVersion)
    expect(tableNames(connection)).toEqual(tablesBefore)
    expect(connection.prepare('SELECT * FROM future_authority').all()).toEqual([{ id: 'future-row', payload: 'retain-me' }])
  })
})
