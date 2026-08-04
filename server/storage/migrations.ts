import type { DatabaseSync } from 'node:sqlite'

export const LATEST_STORAGE_SCHEMA_VERSION = 21

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

const createRealtimeEventLogTables = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS realtime_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT UNIQUE,
      material_hash TEXT NOT NULL,
      channel TEXT NOT NULL,
      event_type TEXT NOT NULL,
      access_json TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS realtime_events_channel_sequence_idx
      ON realtime_events (channel, sequence);

    CREATE INDEX IF NOT EXISTS realtime_events_created_at_idx
      ON realtime_events (created_at, sequence);

    CREATE TABLE IF NOT EXISTS realtime_event_log_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      latest_sequence INTEGER NOT NULL,
      earliest_available_sequence INTEGER NOT NULL
    );

    INSERT OR IGNORE INTO realtime_event_log_state (
      singleton,
      latest_sequence,
      earliest_available_sequence
    ) VALUES (1, 0, 1);
  `)
}

const createGroupInventoryTables = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS group_inventories (
      slug TEXT PRIMARY KEY,
      document_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

const createShopTableDocumentsTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS shop_tables (
      slug TEXT PRIMARY KEY,
      document_json TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

const createShopCheckoutOperationHistoryTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS shop_checkout_ops (
      op_id TEXT PRIMARY KEY,
      shop_slug TEXT NOT NULL,
      command_hash TEXT NOT NULL,
      command_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      result_revision INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS shop_checkout_ops_shop_revision_idx
      ON shop_checkout_ops (shop_slug, result_revision);
  `)
}

const createPendingMoveResolutionTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS pending_move_resolutions (
      resolution_id TEXT PRIMARY KEY,
      map_slug TEXT NOT NULL,
      origin_op_id TEXT NOT NULL,
      resolution_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN (
          'pending',
          'resuming',
          'committed',
          'cancelled',
          'expired',
          'conflicted',
          'abandoned'
        )
      ),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
      terminal_op_id TEXT UNIQUE,
      UNIQUE (map_slug, origin_op_id),
      FOREIGN KEY (terminal_op_id) REFERENCES live_play_ops (op_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS pending_move_resolutions_map_status_idx
      ON pending_move_resolutions (map_slug, status, updated_at, resolution_id);
  `)
}

const addPendingMoveDeclarationCompensation = (connection: DatabaseSync): void => {
  connection.exec(`
    ALTER TABLE pending_move_resolutions
    ADD COLUMN declaration_plan_json TEXT;
  `)
}

const addAcceptedMoveCompensationResults = (connection: DatabaseSync): void => {
  connection.exec(`
    ALTER TABLE live_play_ops
    ADD COLUMN move_compensation_json TEXT;
  `)
}

const addMoveCorrectionAncestry = (connection: DatabaseSync): void => {
  connection.exec(`
    ALTER TABLE live_play_ops
    ADD COLUMN correction_origin_op_id TEXT
      REFERENCES live_play_ops (op_id) ON DELETE CASCADE;

    CREATE INDEX IF NOT EXISTS live_play_ops_correction_origin_idx
      ON live_play_ops (map_slug, correction_origin_op_id, created_at);
  `)
}

const createAbilityDeclarationOfferTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS ability_declaration_offers (
      offer_id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      request_sha256 TEXT NOT NULL,
      map_slug TEXT NOT NULL,
      map_revision INTEGER NOT NULL CHECK (map_revision >= 0),
      actor_placement_id TEXT NOT NULL,
      offer_json TEXT NOT NULL,
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
      consumed_intent_sha256 TEXT,
      consumed_at INTEGER,
      CHECK ((consumed_intent_sha256 IS NULL) = (consumed_at IS NULL))
    );

    CREATE INDEX IF NOT EXISTS ability_declaration_offers_map_expiry_idx
      ON ability_declaration_offers (map_slug, expires_at, offer_id);
  `)
}

const createAbilityResolutionOperationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS ability_resolution_ops (
      intent_id TEXT PRIMARY KEY,
      intent_sha256 TEXT NOT NULL,
      map_slug TEXT NOT NULL,
      intent_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      audit_json TEXT NOT NULL,
      result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );

    CREATE INDEX IF NOT EXISTS ability_resolution_ops_map_revision_idx
      ON ability_resolution_ops (map_slug, result_revision, intent_id);
  `)
}

const createCapabilityAdjudicationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS capability_adjudications (
      request_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL,
      map_slug TEXT NOT NULL,
      actor_placement_id TEXT NOT NULL,
      canonical_id TEXT NOT NULL,
      action_id TEXT NOT NULL,
      command_json TEXT NOT NULL,
      definition_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')),
      requested_at INTEGER NOT NULL CHECK (requested_at >= 0),
      expires_at INTEGER NOT NULL CHECK (expires_at > requested_at),
      resolved_at INTEGER NULL CHECK (resolved_at IS NULL OR resolved_at >= requested_at),
      resolution_operation_id TEXT NULL
    );

    CREATE INDEX IF NOT EXISTS capability_adjudications_map_status_idx
      ON capability_adjudications (map_slug, status, expires_at, request_id);
  `)
}

const addCapabilityAdjudicationResolutionCommand = (connection: DatabaseSync): void => {
  const columns = connection.prepare('PRAGMA table_info(capability_adjudications)').all() as Array<{ name?: unknown }>
  if (!columns.some(column => column.name === 'resolution_command_sha256')) {
    connection.exec('ALTER TABLE capability_adjudications ADD COLUMN resolution_command_sha256 TEXT NULL')
  }
}

const addCapabilityAdjudicationResolutionRevision = (connection: DatabaseSync): void => {
  const columns = connection.prepare('PRAGMA table_info(capability_adjudications)').all() as Array<{ name?: unknown }>
  if (!columns.some(column => column.name === 'resolution_map_revision')) {
    connection.exec('ALTER TABLE capability_adjudications ADD COLUMN resolution_map_revision INTEGER NULL')
  }
}

const createCapabilityResolutionOperationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS capability_resolution_ops (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL,
      map_slug TEXT NOT NULL,
      command_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      audit_json TEXT NOT NULL,
      result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );

    CREATE INDEX IF NOT EXISTS capability_resolution_ops_map_revision_idx
      ON capability_resolution_ops (map_slug, result_revision, operation_id);
  `)
}

const createEncounterDocumentTables = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS encounter_documents (
      encounter_id TEXT PRIMARY KEY,
      linked_map_slug TEXT NOT NULL,
      document_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
    );

    CREATE INDEX IF NOT EXISTS encounter_documents_map_updated_idx
      ON encounter_documents (linked_map_slug, updated_at DESC, encounter_id);

    CREATE TABLE IF NOT EXISTS encounter_director_ops (
      command_id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL,
      command_sha256 TEXT NOT NULL,
      command_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      FOREIGN KEY (encounter_id) REFERENCES encounter_documents (encounter_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS encounter_director_ops_encounter_revision_idx
      ON encounter_director_ops (encounter_id, result_revision, command_id);
  `)
}

const createEncounterLaunchOperationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS encounter_launch_ops (
      launch_id TEXT PRIMARY KEY,
      encounter_id TEXT NOT NULL,
      request_sha256 TEXT NOT NULL,
      request_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      FOREIGN KEY (encounter_id) REFERENCES encounter_documents (encounter_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS encounter_launch_ops_encounter_idx
      ON encounter_launch_ops (encounter_id, created_at, launch_id);
  `)
}

const createEncounterUxMetricAggregateTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS encounter_ux_metric_aggregates (
      event TEXT NOT NULL,
      role_kind TEXT NOT NULL,
      viewport_class TEXT NOT NULL,
      input_kind TEXT NOT NULL,
      motion_preference TEXT NOT NULL,
      fixture_id TEXT NOT NULL,
      spatiality_level TEXT NOT NULL,
      terminal_status TEXT NOT NULL,
      sample_count INTEGER NOT NULL CHECK (sample_count > 0),
      value_sum REAL NOT NULL CHECK (value_sum >= 0),
      value_min REAL NOT NULL CHECK (value_min >= 0),
      value_max REAL NOT NULL CHECK (value_max >= value_min),
      updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
      PRIMARY KEY (
        event, role_kind, viewport_class, input_kind, motion_preference,
        fixture_id, spatiality_level, terminal_status
      )
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
  {
    version: 5,
    name: 'store durable realtime event log',
    up: createRealtimeEventLogTables,
  },
  {
    version: 6,
    name: 'store campaign group inventory documents',
    up: createGroupInventoryTables,
  },
  {
    version: 7,
    name: 'store campaign shop table documents',
    up: createShopTableDocumentsTable,
  },
  {
    version: 8,
    name: 'store shop checkout operation history',
    up: createShopCheckoutOperationHistoryTable,
  },
  {
    version: 9,
    name: 'store pending move resolutions',
    up: createPendingMoveResolutionTable,
  },
  {
    version: 10,
    name: 'store pending move declaration compensation plans',
    up: addPendingMoveDeclarationCompensation,
  },
  {
    version: 11,
    name: 'store accepted move compensation results',
    up: addAcceptedMoveCompensationResults,
  },
  {
    version: 12,
    name: 'link audited GM move corrections to accepted moves',
    up: addMoveCorrectionAncestry,
  },
  {
    version: 13,
    name: 'store private ability declaration offers',
    up: createAbilityDeclarationOfferTable,
  },
  {
    version: 14,
    name: 'store accepted ability resolution operations and private audits',
    up: createAbilityResolutionOperationTable,
  },
  {
    version: 15,
    name: 'store replay-safe capability resolution operations and private audits',
    up: createCapabilityResolutionOperationTable,
  },
  {
    version: 16,
    name: 'store durable bounded capability adjudication requests',
    up: createCapabilityAdjudicationTable,
  },
  {
    version: 17,
    name: 'bind exact capability adjudication resolution commands',
    up: addCapabilityAdjudicationResolutionCommand,
  },
  {
    version: 18,
    name: 'retain terminal capability adjudication map revisions',
    up: addCapabilityAdjudicationResolutionRevision,
  },
  {
    version: 19,
    name: 'store first-class encounter documents and replay-safe Director commands',
    up: createEncounterDocumentTables,
  },
  {
    version: 20,
    name: 'store replay-safe atomic Encounter Builder launches',
    up: createEncounterLaunchOperationTable,
  },
  {
    version: 21,
    name: 'store privacy-safe aggregate encounter UX metrics',
    up: createEncounterUxMetricAggregateTable,
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
  const registeredLatest = migrations.at(-1)?.version ?? 0
  if (registeredLatest !== LATEST_STORAGE_SCHEMA_VERSION) {
    throw new Error(
      `Latest storage schema version ${LATEST_STORAGE_SCHEMA_VERSION} does not match registered migration ${registeredLatest}`,
    )
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
