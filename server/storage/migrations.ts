import type { DatabaseSync } from 'node:sqlite'

export const LATEST_STORAGE_SCHEMA_VERSION = 4

export interface StorageMigration {
  readonly version: number
  readonly name: string
  up(connection: DatabaseSync): void
}

export interface StorageMigrationResult {
  readonly fromVersion: number
  readonly toVersion: number
  readonly appliedVersions: readonly number[]
}

const createInitialSchema = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS maps (
      slug TEXT PRIMARY KEY,
      document_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sheets (
      kind TEXT NOT NULL,
      slug TEXT NOT NULL,
      document_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (kind, slug)
    );

    CREATE TABLE IF NOT EXISTS live_play_ops (
      op_id TEXT PRIMARY KEY,
      map_slug TEXT NOT NULL,
      command_hash TEXT NOT NULL,
      command_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      result_revision INTEGER,
      created_at INTEGER NOT NULL
    );
  `)
}

const createLivePlayOperationHistoryIndexes = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE INDEX IF NOT EXISTS live_play_ops_map_revision_idx
      ON live_play_ops (map_slug, result_revision);
  `)
}

const createMapInteractionModeTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS map_interaction_modes (
      slug TEXT PRIMARY KEY,
      interaction_mode TEXT NOT NULL CHECK (interaction_mode IN ('setup-edit', 'live-play')),
      updated_at INTEGER NOT NULL
    );
  `)
}

const createRuntimeFolderTables = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS map_folders (
      path TEXT PRIMARY KEY,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sheet_folders (
      kind TEXT NOT NULL,
      path TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (kind, path)
    );
  `)
}

export const STORAGE_MIGRATIONS: readonly StorageMigration[] = [
  {
    version: 1,
    name: 'initial maps sheets and live-play operation tables',
    up: createInitialSchema,
  },
  {
    version: 2,
    name: 'index live-play operation history by map and revision',
    up: createLivePlayOperationHistoryIndexes,
  },
  {
    version: 3,
    name: 'store shared map interaction mode',
    up: createMapInteractionModeTable,
  },
  {
    version: 4,
    name: 'store runtime map and sheet library folders',
    up: createRuntimeFolderTables,
  },
]

const readPragmaUserVersion = (connection: DatabaseSync): number => {
  const row = connection.prepare('PRAGMA user_version').get()
  const version = row?.user_version
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new Error('SQLite user_version must be a safe non-negative integer')
  }
  return version
}

const setPragmaUserVersion = (connection: DatabaseSync, version: number): void => {
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new Error('SQLite user_version must be a safe non-negative integer')
  }
  connection.exec(`PRAGMA user_version = ${version}`)
}

const sortedMigrations = (): readonly StorageMigration[] => {
  const migrations = [...STORAGE_MIGRATIONS].sort((left, right) => left.version - right.version)
  for (const [index, migration] of migrations.entries()) {
    const expected = index + 1
    if (migration.version !== expected) {
      throw new Error(`Storage migration versions must be contiguous; expected ${expected}, got ${migration.version}`)
    }
  }
  return migrations
}

export const getStorageSchemaVersion = (connection: DatabaseSync): number => readPragmaUserVersion(connection)

export const applyStorageMigrations = (connection: DatabaseSync): StorageMigrationResult => {
  const fromVersion = readPragmaUserVersion(connection)

  if (fromVersion > LATEST_STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `SQLite schema version ${fromVersion} is newer than this Rotom Table build supports (${LATEST_STORAGE_SCHEMA_VERSION})`,
    )
  }

  const appliedVersions: number[] = []
  connection.exec('BEGIN IMMEDIATE')
  try {
    let currentVersion = fromVersion
    for (const migration of sortedMigrations()) {
      if (migration.version <= currentVersion) continue
      migration.up(connection)
      setPragmaUserVersion(connection, migration.version)
      currentVersion = migration.version
      appliedVersions.push(migration.version)
    }
    connection.exec('COMMIT')
    return {
      fromVersion,
      toVersion: currentVersion,
      appliedVersions,
    }
  } catch (error) {
    connection.exec('ROLLBACK')
    throw error
  }
}
