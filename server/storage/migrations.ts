import type { DatabaseSync } from 'node:sqlite'

export const LATEST_STORAGE_SCHEMA_VERSION = 50

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

const createBreedingLifecycleTables = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS breeding_operations (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'preview-breeding', 'create-breeding-project', 'grant-breeding-consent',
        'revoke-breeding-consent', 'advance-breeding-project-time', 'resolve-breeding-check',
        'produce-egg', 'cancel-breeding-project', 'create-source-egg', 'transfer-egg',
        'advance-egg-incubation', 'set-egg-incubation-pause', 'mark-egg-ready', 'begin-hatch',
        'resolve-hatch-special', 'complete-hatch', 'cancel-egg', 'advance-campaign-clock',
        'record-inheritance-learning', 'recover-breeding-operation'
      )),
      command_json TEXT NOT NULL CHECK (json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 32768),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      result_definition_sha256 TEXT CHECK (result_definition_sha256 IS NULL OR length(result_definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= created_at_campaign_minute),
      CHECK (
        (status = 'pending' AND result_json IS NULL AND result_definition_sha256 IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (status IN ('accepted', 'rejected') AND result_json IS NOT NULL AND result_definition_sha256 IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS breeding_operations_status_created_idx
      ON breeding_operations (status, created_at_campaign_minute, operation_id);

    CREATE TABLE IF NOT EXISTS breeding_operation_scopes (
      operation_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      scope_kind TEXT NOT NULL CHECK (scope_kind IN (
        'campaign-clock', 'breeding-project', 'pokemon-egg', 'parent-consent', 'trainer-sheet',
        'pokemon-sheet', 'pokemon-sheet-allocation', 'species-acquisition', 'breeding-operation'
      )),
      scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
      PRIMARY KEY (operation_id, scope_key),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS breeding_operation_scopes_conflict_idx
      ON breeding_operation_scopes (scope_kind, scope_key, operation_id);

    CREATE TABLE IF NOT EXISTS breeding_projects (
      project_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      status TEXT NOT NULL CHECK (status IN (
        'draft', 'awaiting-parent-consent', 'initial-time-in-progress', 'check-ready',
        'additional-time-in-progress', 'ready-to-produce', 'egg-produced', 'check-failed',
        'cancelled', 'expired', 'abandoned', 'conflicted'
      )),
      owner_trainer_slug TEXT NOT NULL,
      breeder_trainer_slug TEXT NOT NULL,
      parent_a_slug TEXT NOT NULL,
      parent_b_slug TEXT NOT NULL CHECK (parent_b_slug <> parent_a_slug),
      produced_egg_id TEXT UNIQUE,
      last_operation_id TEXT NOT NULL,
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      updated_at_campaign_minute INTEGER NOT NULL CHECK (updated_at_campaign_minute >= created_at_campaign_minute),
      FOREIGN KEY (last_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (produced_egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_projects_owner_status_idx
      ON breeding_projects (owner_trainer_slug, status, updated_at_campaign_minute DESC, project_id);
    CREATE INDEX IF NOT EXISTS breeding_projects_parent_a_status_idx
      ON breeding_projects (parent_a_slug, status, project_id);
    CREATE INDEX IF NOT EXISTS breeding_projects_parent_b_status_idx
      ON breeding_projects (parent_b_slug, status, project_id);

    CREATE TABLE IF NOT EXISTS pokemon_eggs (
      egg_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      status TEXT NOT NULL CHECK (status IN (
        'incubating', 'ready', 'awaiting-special-adjudication', 'hatching', 'hatched', 'cancelled', 'invalidated-by-gm'
      )),
      owner_trainer_slug TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('breeding', 'fossil', 'gm', 'feature-artificial')),
      source_project_id TEXT,
      child_sheet_slug TEXT UNIQUE,
      last_operation_id TEXT NOT NULL,
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      updated_at_campaign_minute INTEGER NOT NULL CHECK (updated_at_campaign_minute >= created_at_campaign_minute),
      CHECK ((source_kind = 'breeding') = (source_project_id IS NOT NULL)),
      CHECK ((status = 'hatched') = (child_sheet_slug IS NOT NULL)),
      FOREIGN KEY (source_project_id) REFERENCES breeding_projects (project_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (last_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS pokemon_eggs_owner_status_idx
      ON pokemon_eggs (owner_trainer_slug, status, updated_at_campaign_minute DESC, egg_id);
    CREATE INDEX IF NOT EXISTS pokemon_eggs_source_project_idx
      ON pokemon_eggs (source_project_id, egg_id);

    CREATE TABLE IF NOT EXISTS breeding_consents (
      consent_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      revision INTEGER NOT NULL CHECK (revision IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired', 'superseded')),
      project_id TEXT NOT NULL,
      parent_sheet_slug TEXT NOT NULL,
      parent_sheet_revision INTEGER NOT NULL CHECK (parent_sheet_revision >= 0),
      owner_trainer_slug TEXT NOT NULL,
      consenting_profile_id TEXT NOT NULL,
      expires_at_campaign_minute INTEGER CHECK (expires_at_campaign_minute IS NULL OR expires_at_campaign_minute >= 0),
      grant_operation_id TEXT NOT NULL,
      settlement_operation_id TEXT,
      granted_at_campaign_minute INTEGER NOT NULL CHECK (granted_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= granted_at_campaign_minute),
      CHECK (
        (revision = 0 AND status = 'active' AND settlement_operation_id IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (revision = 1 AND status <> 'active' AND settlement_operation_id IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      ),
      FOREIGN KEY (project_id) REFERENCES breeding_projects (project_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (grant_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (settlement_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE UNIQUE INDEX IF NOT EXISTS breeding_consents_active_parent_idx
      ON breeding_consents (project_id, parent_sheet_slug) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS breeding_consents_profile_status_expiry_idx
      ON breeding_consents (consenting_profile_id, status, expires_at_campaign_minute, consent_id);

    CREATE TABLE IF NOT EXISTS breeding_rolls (
      roll_record_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      operation_roll_ordinal INTEGER NOT NULL CHECK (operation_roll_ordinal BETWEEN 0 AND 31),
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      purpose TEXT NOT NULL CHECK (purpose IN (
        'breeder-check-d20', 'offspring-family-d20', 'nature-ordered-2d6', 'ability-uniform-index',
        'gender-d100', 'hatch-duration-percentage', 'hatch-special-d100', 'provider-bounded'
      )),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      generated_at_campaign_minute INTEGER NOT NULL CHECK (generated_at_campaign_minute >= 0),
      UNIQUE (operation_id, operation_roll_ordinal),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_checks (
      check_record_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      operation_id TEXT NOT NULL,
      roll_record_id TEXT NOT NULL UNIQUE,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      resolved_at_campaign_minute INTEGER NOT NULL CHECK (resolved_at_campaign_minute >= 0),
      FOREIGN KEY (project_id) REFERENCES breeding_projects (project_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (roll_record_id) REFERENCES breeding_rolls (roll_record_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_option_offers (
      offer_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      revision INTEGER NOT NULL CHECK (revision IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'expired', 'revoked')),
      choice_kind TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('breeding-project', 'pokemon-egg', 'pokemon-sheet', 'trainer-sheet')),
      target_id TEXT NOT NULL,
      chooser_profile_id TEXT NOT NULL,
      issued_operation_id TEXT NOT NULL,
      settlement_operation_id TEXT,
      issued_at_campaign_minute INTEGER NOT NULL CHECK (issued_at_campaign_minute >= 0),
      expires_at_campaign_minute INTEGER CHECK (expires_at_campaign_minute IS NULL OR expires_at_campaign_minute > issued_at_campaign_minute),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= issued_at_campaign_minute),
      CHECK (
        (revision = 0 AND status = 'active' AND settlement_operation_id IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (revision = 1 AND status <> 'active' AND settlement_operation_id IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      ),
      FOREIGN KEY (issued_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (settlement_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_option_offers_chooser_status_idx
      ON breeding_option_offers (chooser_profile_id, status, expires_at_campaign_minute, offer_id);
    CREATE INDEX IF NOT EXISTS breeding_option_offers_target_idx
      ON breeding_option_offers (target_kind, target_id, status, offer_id);

    CREATE TABLE IF NOT EXISTS breeding_gm_adjudications (
      adjudication_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      revision INTEGER NOT NULL CHECK (revision IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('pending', 'resolved', 'cancelled')),
      adjudication_kind TEXT NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('breeding-project', 'pokemon-egg', 'pokemon-sheet', 'trainer-sheet')),
      target_id TEXT NOT NULL,
      offer_id TEXT,
      created_operation_id TEXT NOT NULL,
      settlement_operation_id TEXT,
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= created_at_campaign_minute),
      CHECK (
        (revision = 0 AND status = 'pending' AND settlement_operation_id IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (revision = 1 AND status <> 'pending' AND settlement_operation_id IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      ),
      FOREIGN KEY (offer_id) REFERENCES breeding_option_offers (offer_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (created_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (settlement_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_gm_adjudications_status_target_idx
      ON breeding_gm_adjudications (status, target_kind, target_id, adjudication_id);

    CREATE TABLE IF NOT EXISTS breeding_read_sets (
      read_set_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      captured_at_campaign_minute INTEGER NOT NULL CHECK (captured_at_campaign_minute >= 0),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_authorization_receipts (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      read_set_definition_sha256 TEXT NOT NULL CHECK (length(read_set_definition_sha256) = 64),
      authorized INTEGER NOT NULL CHECK (authorized IN (0, 1)),
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      evaluated_at_campaign_minute INTEGER NOT NULL CHECK (evaluated_at_campaign_minute >= 0),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_gm_overrides (
      override_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      override_kind TEXT NOT NULL,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_gm_overrides_operation_idx
      ON breeding_gm_overrides (operation_id, override_id);

    CREATE TABLE IF NOT EXISTS pokemon_breeding_origins (
      origin_id TEXT PRIMARY KEY,
      egg_id TEXT NOT NULL UNIQUE,
      child_sheet_slug TEXT NOT NULL UNIQUE,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      lineage_definition_sha256 TEXT NOT NULL CHECK (length(lineage_definition_sha256) = 64),
      hatch_operation_id TEXT NOT NULL,
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      FOREIGN KEY (egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (hatch_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE IF NOT EXISTS breeding_inheritance_learning_records (
      learning_record_id TEXT PRIMARY KEY,
      origin_id TEXT NOT NULL,
      egg_id TEXT NOT NULL,
      child_sheet_slug TEXT NOT NULL,
      checkpoint_level INTEGER NOT NULL CHECK (checkpoint_level IN (20, 30, 40, 50, 60, 70, 80, 90, 100)),
      operation_id TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      UNIQUE (origin_id, checkpoint_level),
      FOREIGN KEY (origin_id) REFERENCES pokemon_breeding_origins (origin_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_inheritance_learning_child_idx
      ON breeding_inheritance_learning_records (child_sheet_slug, checkpoint_level);

    CREATE TABLE IF NOT EXISTS trainer_species_acquisitions (
      trainer_sheet_slug TEXT NOT NULL,
      species_id TEXT NOT NULL,
      first_acquired_at_campaign_minute INTEGER NOT NULL CHECK (first_acquired_at_campaign_minute >= 0),
      source_egg_id TEXT,
      operation_id TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      PRIMARY KEY (trainer_sheet_slug, species_id),
      FOREIGN KEY (source_egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS trainer_species_acquisitions_species_idx
      ON trainer_species_acquisitions (species_id, first_acquired_at_campaign_minute, trainer_sheet_slug);

    CREATE TABLE IF NOT EXISTS campaign_clock (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      campaign_minute INTEGER NOT NULL CHECK (campaign_minute >= 0),
      last_operation_id TEXT,
      CHECK ((revision = 0) = (last_operation_id IS NULL)),
      FOREIGN KEY (last_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );

    INSERT OR IGNORE INTO campaign_clock (singleton, revision, campaign_minute, last_operation_id)
    VALUES (1, 0, 0, NULL);
  `)
}

const createBreedingArchiveTables = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS breeding_archives (
      archive_id TEXT PRIMARY KEY,
      purpose TEXT NOT NULL CHECK (purpose IN ('campaign-backup', 'gm-audit', 'owner-portable')),
      campaign_identity_sha256 TEXT NOT NULL CHECK (length(campaign_identity_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      archive_json TEXT NOT NULL CHECK (
        json_valid(archive_json)
        AND length(CAST(archive_json AS BLOB)) <= 67108864
      ),
      archive_definition_sha256 TEXT NOT NULL CHECK (length(archive_definition_sha256) = 64)
    );

    CREATE INDEX IF NOT EXISTS breeding_archives_campaign_created_idx
      ON breeding_archives (campaign_identity_sha256, created_at_campaign_minute DESC, archive_id);

    CREATE TABLE IF NOT EXISTS breeding_archive_import_requests (
      request_id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('replace-campaign', 'restore-new-campaign', 'validate-only')),
      target_campaign_identity_sha256 TEXT NOT NULL CHECK (length(target_campaign_identity_sha256) = 64),
      request_json TEXT NOT NULL CHECK (json_valid(request_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      requested_at_campaign_minute INTEGER NOT NULL CHECK (requested_at_campaign_minute >= 0),
      FOREIGN KEY (archive_id) REFERENCES breeding_archives (archive_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_archive_requests_target_time_idx
      ON breeding_archive_import_requests (
        target_campaign_identity_sha256, requested_at_campaign_minute, request_id
      );

    CREATE TABLE IF NOT EXISTS breeding_archive_restore_receipts (
      request_id TEXT PRIMARY KEY,
      archive_id TEXT NOT NULL,
      accepted INTEGER NOT NULL CHECK (accepted IN (0, 1)),
      reason_id TEXT NOT NULL CHECK (reason_id IN (
        'breeding.archive.accepted', 'breeding.archive.digest-mismatch',
        'breeding.archive.incompatible-reference', 'breeding.archive.invalid-record',
        'breeding.archive.not-restorable', 'breeding.archive.stale-target'
      )),
      receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      committed_at_campaign_minute INTEGER CHECK (
        committed_at_campaign_minute IS NULL OR committed_at_campaign_minute >= 0
      ),
      CHECK ((accepted = 1) = (committed_at_campaign_minute IS NOT NULL)),
      FOREIGN KEY (request_id) REFERENCES breeding_archive_import_requests (request_id),
      FOREIGN KEY (archive_id) REFERENCES breeding_archives (archive_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_archive_receipts_archive_idx
      ON breeding_archive_restore_receipts (archive_id, request_id);
  `)
}

const createBreedingIncubationSegmentTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS breeding_incubation_segments (
      operation_id TEXT PRIMARY KEY,
      egg_id TEXT NOT NULL,
      egg_revision_before INTEGER NOT NULL CHECK (egg_revision_before >= 0),
      egg_revision_after INTEGER NOT NULL CHECK (egg_revision_after = egg_revision_before + 1),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'advance-egg-incubation', 'set-egg-incubation-pause'
      )),
      through_clock_revision INTEGER NOT NULL CHECK (through_clock_revision >= 0),
      through_campaign_minute INTEGER NOT NULL CHECK (through_campaign_minute >= 0),
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      UNIQUE (egg_id, egg_revision_after),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id)
        ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (egg_id) REFERENCES pokemon_eggs (egg_id)
        DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS breeding_incubation_segments_egg_revision_idx
      ON breeding_incubation_segments (egg_id, egg_revision_after, operation_id);
  `)
}

const createItemOperationTables = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS item_operations (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_json TEXT NOT NULL CHECK (json_valid(command_json)),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'abandoned', 'corrected')),
      canonical_item_id TEXT,
      canonical_definition_sha256 TEXT CHECK (
        canonical_definition_sha256 IS NULL OR length(canonical_definition_sha256) = 64
      ),
      plan_json TEXT CHECK (plan_json IS NULL OR json_valid(plan_json)),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      correction_of_operation_id TEXT,
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
      CHECK (
        (status = 'pending' AND result_json IS NULL)
        OR (status <> 'pending' AND result_json IS NOT NULL)
      ),
      CHECK (
        canonical_item_id IS NULL
        OR (length(canonical_item_id) BETWEEN 1 AND 200)
      ),
      CHECK (
        correction_of_operation_id IS NULL
        OR correction_of_operation_id <> operation_id
      ),
      FOREIGN KEY (correction_of_operation_id) REFERENCES item_operations (operation_id)
        DEFERRABLE INITIALLY DEFERRED
    );

    CREATE INDEX IF NOT EXISTS item_operations_status_updated_idx
      ON item_operations (status, updated_at, operation_id);
    CREATE INDEX IF NOT EXISTS item_operations_canonical_item_idx
      ON item_operations (canonical_item_id, created_at, operation_id);

    CREATE TABLE IF NOT EXISTS item_operation_scopes (
      operation_id TEXT NOT NULL,
      scope_kind TEXT NOT NULL CHECK (scope_kind IN (
        'map', 'encounter', 'sheet', 'group-inventory', 'equipment', 'campaign-clock'
      )),
      scope_key TEXT NOT NULL,
      expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
      scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
      PRIMARY KEY (operation_id, scope_kind, scope_key),
      FOREIGN KEY (operation_id) REFERENCES item_operations (operation_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS item_operation_scopes_conflict_idx
      ON item_operation_scopes (scope_kind, scope_key, operation_id);
  `)
}

const addItemPendingDecisionAndResumeEvidence = (connection: DatabaseSync): void => {
  const table = connection.prepare(`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'item_operations'
  `).get()
  if (!table) throw new Error('Storage migration v30 requires the authoritative item_operations table')
  const columns = new Set(connection.prepare(`PRAGMA table_info(item_operations)`).all().map(row => String(row.name)))
  if (!columns.has('pending_decision_json')) {
    connection.exec(`
      ALTER TABLE item_operations ADD COLUMN pending_decision_json TEXT
        CHECK (pending_decision_json IS NULL OR json_valid(pending_decision_json));
    `)
  }
  if (!columns.has('resume_command_sha256')) {
    connection.exec(`
      ALTER TABLE item_operations ADD COLUMN resume_command_sha256 TEXT
        CHECK (resume_command_sha256 IS NULL OR length(resume_command_sha256) = 64);
    `)
  }
  if (!columns.has('resume_command_json')) {
    connection.exec(`
      ALTER TABLE item_operations ADD COLUMN resume_command_json TEXT
        CHECK (resume_command_json IS NULL OR json_valid(resume_command_json));
    `)
  }
  connection.exec(`
    CREATE TRIGGER IF NOT EXISTS item_operations_resume_evidence_insert_check
    BEFORE INSERT ON item_operations
    WHEN (NEW.resume_command_sha256 IS NULL) <> (NEW.resume_command_json IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'item operation resume command evidence must be complete');
    END;

    CREATE TRIGGER IF NOT EXISTS item_operations_resume_evidence_update_check
    BEFORE UPDATE OF resume_command_sha256, resume_command_json ON item_operations
    WHEN (NEW.resume_command_sha256 IS NULL) <> (NEW.resume_command_json IS NULL)
    BEGIN
      SELECT RAISE(ABORT, 'item operation resume command evidence must be complete');
    END;
  `)
}

const addItemRecoveryEvidence = (connection: DatabaseSync): void => {
  const table = connection.prepare(`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'item_operations'
  `).get()
  if (!table) throw new Error('Storage migration v31 requires the authoritative item_operations table')
  const columns = new Set(connection.prepare(`PRAGMA table_info(item_operations)`).all().map(row => String(row.name)))
  if (!columns.has('recovery_command_sha256')) {
    connection.exec(`
      ALTER TABLE item_operations ADD COLUMN recovery_command_sha256 TEXT
        CHECK (recovery_command_sha256 IS NULL OR length(recovery_command_sha256) = 64);
    `)
  }
  if (!columns.has('recovery_command_json')) {
    connection.exec(`
      ALTER TABLE item_operations ADD COLUMN recovery_command_json TEXT
        CHECK (recovery_command_json IS NULL OR json_valid(recovery_command_json));
    `)
  }
  if (!columns.has('compensation_json')) {
    connection.exec(`
      ALTER TABLE item_operations ADD COLUMN compensation_json TEXT
        CHECK (compensation_json IS NULL OR json_valid(compensation_json));
    `)
  }
  connection.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS item_operations_recovery_origin_idx
      ON item_operations (correction_of_operation_id)
      WHERE correction_of_operation_id IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS item_operations_recovery_evidence_insert_check
    BEFORE INSERT ON item_operations
    WHEN (NEW.recovery_command_sha256 IS NULL) <> (NEW.recovery_command_json IS NULL)
      OR ((NEW.status IN ('abandoned', 'corrected')) <> (NEW.recovery_command_json IS NOT NULL))
      OR (NEW.status = 'corrected' AND NEW.correction_of_operation_id IS NULL)
      OR (NEW.status <> 'corrected' AND NEW.correction_of_operation_id IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'item operation recovery evidence must match terminal status');
    END;

    CREATE TRIGGER IF NOT EXISTS item_operations_recovery_evidence_update_check
    BEFORE UPDATE OF status, correction_of_operation_id, recovery_command_sha256, recovery_command_json
      ON item_operations
    WHEN (NEW.recovery_command_sha256 IS NULL) <> (NEW.recovery_command_json IS NULL)
      OR ((NEW.status IN ('abandoned', 'corrected')) <> (NEW.recovery_command_json IS NOT NULL))
      OR (NEW.status = 'corrected' AND NEW.correction_of_operation_id IS NULL)
      OR (NEW.status <> 'corrected' AND NEW.correction_of_operation_id IS NOT NULL)
    BEGIN
      SELECT RAISE(ABORT, 'item operation recovery evidence must match terminal status');
    END;
  `)
}

const createCampaignDayOperationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS campaign_day_operations (
      operation_id TEXT PRIMARY KEY CHECK (
        length(operation_id) = 48
        AND operation_id GLOB 'campaign-day:v1:[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'
      ),
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json)
        AND length(CAST(command_json AS BLOB)) <= 4096
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json)
        AND length(CAST(result_json AS BLOB)) <= 4194304
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );

    CREATE INDEX IF NOT EXISTS campaign_day_operations_created_idx
      ON campaign_day_operations (created_at, operation_id);
  `)
}

const createEquipmentOperationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS equipment_operations (
      operation_id TEXT PRIMARY KEY CHECK (
        length(operation_id) = 55
        AND operation_id GLOB 'equipment-operation:v1:[0-9a-f]*'
      ),
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN ('equip', 'unequip', 'swap', 'give', 'take')),
      actor_profile_id TEXT,
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json)
        AND length(CAST(command_json AS BLOB)) <= 32768
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json)
        AND length(CAST(result_json AS BLOB)) <= 4194304
      ),
      evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json)
        AND length(CAST(evidence_json AS BLOB)) <= 8388608
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );

    CREATE INDEX IF NOT EXISTS equipment_operations_created_idx
      ON equipment_operations (created_at, operation_id);
  `)
}

const createItemExtendedActionActivityTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS item_extended_action_activities (
      activity_id TEXT PRIMARY KEY CHECK (
        length(activity_id) = 49
        AND activity_id GLOB 'item-activity:v1:[0-9a-f]*'
      ),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      status TEXT NOT NULL CHECK (status IN ('in-progress', 'completed', 'interrupted')),
      start_operation_id TEXT NOT NULL UNIQUE CHECK (
        length(start_operation_id) = 59
        AND start_operation_id GLOB 'item-activity-operation:v1:[0-9a-f]*'
      ),
      settlement_operation_id TEXT NOT NULL UNIQUE,
      actor_sheet_slug TEXT NOT NULL,
      source_instance_id TEXT NOT NULL,
      start_command_sha256 TEXT NOT NULL CHECK (length(start_command_sha256) = 64),
      start_command_json TEXT NOT NULL CHECK (
        json_valid(start_command_json)
        AND length(CAST(start_command_json AS BLOB)) <= 32768
      ),
      terminal_operation_id TEXT UNIQUE,
      terminal_command_sha256 TEXT,
      terminal_command_json TEXT,
      result_json TEXT,
      record_json TEXT NOT NULL CHECK (
        json_valid(record_json)
        AND length(CAST(record_json AS BLOB)) <= 262144
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
      CHECK (
        (status = 'in-progress' AND terminal_operation_id IS NULL
          AND terminal_command_sha256 IS NULL AND terminal_command_json IS NULL AND result_json IS NULL)
        OR
        (status IN ('completed', 'interrupted') AND terminal_operation_id IS NOT NULL
          AND terminal_command_sha256 IS NOT NULL AND terminal_command_json IS NOT NULL AND result_json IS NOT NULL)
      ),
      CHECK ((terminal_command_sha256 IS NULL) = (terminal_command_json IS NULL))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS item_extended_action_actor_active_idx
      ON item_extended_action_activities (actor_sheet_slug)
      WHERE status = 'in-progress';
    CREATE UNIQUE INDEX IF NOT EXISTS item_extended_action_source_active_idx
      ON item_extended_action_activities (source_instance_id)
      WHERE status = 'in-progress';
    CREATE INDEX IF NOT EXISTS item_extended_action_status_updated_idx
      ON item_extended_action_activities (status, updated_at, activity_id);
  `)
}

const addEquipmentLifecycleOperationKinds = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE equipment_operations_v34 (
      operation_id TEXT PRIMARY KEY CHECK (
        length(operation_id) = 55
        AND operation_id GLOB 'equipment-operation:v1:[0-9a-f]*'
      ),
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'equip', 'unequip', 'swap', 'give', 'take',
        'suppress', 'deactivate', 'break', 'restore', 'repair',
        'damage', 'restore-durability'
      )),
      actor_profile_id TEXT,
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json)
        AND length(CAST(command_json AS BLOB)) <= 32768
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json)
        AND length(CAST(result_json AS BLOB)) <= 4194304
      ),
      evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json)
        AND length(CAST(evidence_json AS BLOB)) <= 8388608
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );
    INSERT INTO equipment_operations_v34 (
      operation_id, command_sha256, command_kind, actor_profile_id,
      command_json, result_json, evidence_json, created_at
    ) SELECT
      operation_id, command_sha256, command_kind, actor_profile_id,
      command_json, result_json, evidence_json, created_at
    FROM equipment_operations;
    DROP TABLE equipment_operations;
    ALTER TABLE equipment_operations_v34 RENAME TO equipment_operations;
    CREATE INDEX equipment_operations_created_idx
      ON equipment_operations (created_at, operation_id);
  `)
}

const createItemFormChangeOperationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE item_form_change_operations (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      principal_key TEXT NOT NULL,
      map_slug TEXT NOT NULL,
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 65536
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 65536
      ),
      evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json) AND length(CAST(evidence_json AS BLOB)) <= 1048576
      ),
      result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );
    CREATE INDEX item_form_change_operations_map_revision_idx
      ON item_form_change_operations (map_slug, result_revision, operation_id);
  `)
}

const createItemExplorationOperationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE item_exploration_operations (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'resolve-route-lure-check', 'settle-route-lure', 'settle-direct-repel'
      )),
      principal_key TEXT NOT NULL,
      aggregate_kind TEXT NOT NULL CHECK (aggregate_kind IN ('trainer', 'map')),
      aggregate_id TEXT NOT NULL,
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 65536
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 65536
      ),
      evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json) AND length(CAST(evidence_json AS BLOB)) <= 1048576
      ),
      result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );
    CREATE INDEX item_exploration_operations_aggregate_revision_idx
      ON item_exploration_operations (
        aggregate_kind, aggregate_id, result_revision, operation_id
      );
  `)
}

const createItemBreedingOperationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE item_breeding_operations (
      operation_id TEXT PRIMARY KEY CHECK (length(operation_id) = 49),
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'assign-egg-warmer', 'restore-fossil', 'create-artificial-egg'
      )),
      principal_key TEXT NOT NULL CHECK (
        length(principal_key) BETWEEN 1 AND 160
      ),
      trainer_slug TEXT NOT NULL CHECK (
        length(trainer_slug) BETWEEN 1 AND 160
      ),
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 65536
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 65536
      ),
      evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json) AND length(CAST(evidence_json AS BLOB)) <= 1048576
      ),
      result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );
    CREATE INDEX item_breeding_operations_trainer_revision_idx
      ON item_breeding_operations (trainer_slug, result_revision, operation_id);
  `)
}

const createInventoryActionOperationTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE inventory_action_operations (
      operation_id TEXT PRIMARY KEY CHECK (
        operation_id GLOB 'inventory-action:v1:[0-9a-f]*' AND length(operation_id) = 52
      ),
      action_kind TEXT NOT NULL CHECK (action_kind IN ('equip', 'give', 'transfer')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
      principal_key TEXT NOT NULL CHECK (length(principal_key) BETWEEN 1 AND 160),
      trainer_slug TEXT NOT NULL CHECK (length(trainer_slug) BETWEEN 1 AND 200),
      declaration_sha256 TEXT NOT NULL CHECK (length(declaration_sha256) = 64),
      declaration_json TEXT NOT NULL CHECK (
        json_valid(declaration_json) AND length(CAST(declaration_json AS BLOB)) <= 65536
      ),
      downstream_command_json TEXT CHECK (
        downstream_command_json IS NULL OR (
          json_valid(downstream_command_json) AND length(CAST(downstream_command_json AS BLOB)) <= 65536
        )
      ),
      result_json TEXT CHECK (
        result_json IS NULL OR (
          json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576
        )
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
      CHECK (
        (status = 'pending' AND result_json IS NULL)
        OR (status = 'accepted' AND result_json IS NOT NULL)
      )
    );
    CREATE INDEX inventory_action_operations_trainer_created_idx
      ON inventory_action_operations (trainer_slug, created_at, operation_id);
  `)
}

const addInventoryStackOperationKinds = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE inventory_action_operations_v41 (
      operation_id TEXT PRIMARY KEY CHECK (
        operation_id GLOB 'inventory-action:v1:[0-9a-f]*' AND length(operation_id) = 52
      ),
      action_kind TEXT NOT NULL CHECK (action_kind IN (
        'equip', 'give', 'transfer', 'split', 'merge', 'discard'
      )),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
      principal_key TEXT NOT NULL CHECK (length(principal_key) BETWEEN 1 AND 160),
      trainer_slug TEXT NOT NULL CHECK (length(trainer_slug) BETWEEN 1 AND 200),
      declaration_sha256 TEXT NOT NULL CHECK (length(declaration_sha256) = 64),
      declaration_json TEXT NOT NULL CHECK (
        json_valid(declaration_json) AND length(CAST(declaration_json AS BLOB)) <= 65536
      ),
      downstream_command_json TEXT CHECK (
        downstream_command_json IS NULL OR (
          json_valid(downstream_command_json) AND length(CAST(downstream_command_json AS BLOB)) <= 65536
        )
      ),
      result_json TEXT CHECK (
        result_json IS NULL OR (
          json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576
        )
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
      CHECK (
        (status = 'pending' AND result_json IS NULL)
        OR (status = 'accepted' AND result_json IS NOT NULL)
      )
    );
    INSERT INTO inventory_action_operations_v41 (
      operation_id, action_kind, status, principal_key, trainer_slug,
      declaration_sha256, declaration_json, downstream_command_json,
      result_json, created_at, updated_at
    ) SELECT
      operation_id, action_kind, status, principal_key, trainer_slug,
      declaration_sha256, declaration_json, downstream_command_json,
      result_json, created_at, updated_at
    FROM inventory_action_operations;
    DROP TABLE inventory_action_operations;
    ALTER TABLE inventory_action_operations_v41 RENAME TO inventory_action_operations;
    CREATE INDEX inventory_action_operations_trainer_created_idx
      ON inventory_action_operations (trainer_slug, created_at, operation_id);
  `)
}

const createEncounterSettlementTables = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE encounter_settlements (
      settlement_id TEXT PRIMARY KEY CHECK (length(settlement_id) BETWEEN 8 AND 200),
      encounter_id TEXT NOT NULL UNIQUE CHECK (length(encounter_id) BETWEEN 1 AND 200),
      status TEXT NOT NULL CHECK (status IN (
        'draft', 'blocked', 'ready', 'committing', 'completed', 'cancelled'
      )),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      document_json TEXT NOT NULL CHECK (
        json_valid(document_json) AND length(CAST(document_json AS BLOB)) <= 67108864
      ),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      updated_at_campaign_minute INTEGER NOT NULL CHECK (
        updated_at_campaign_minute >= created_at_campaign_minute
      ),
      completion_operation_id TEXT UNIQUE CHECK (
        completion_operation_id IS NULL OR length(completion_operation_id) BETWEEN 8 AND 200
      ),
      CHECK (
        (status = 'completed' AND completion_operation_id IS NOT NULL)
        OR (status <> 'completed' AND completion_operation_id IS NULL)
      )
    );
    CREATE INDEX encounter_settlements_status_updated_idx
      ON encounter_settlements (status, updated_at_campaign_minute, settlement_id);

    CREATE TABLE encounter_settlement_operations (
      operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 8 AND 200),
      settlement_id TEXT NOT NULL,
      principal_key TEXT NOT NULL CHECK (length(principal_key) BETWEEN 1 AND 160),
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 65536
      ),
      plan_definition_sha256 TEXT NOT NULL CHECK (length(plan_definition_sha256) = 64),
      authority_definition_sha256 TEXT NOT NULL CHECK (length(authority_definition_sha256) = 64),
      evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json) AND length(CAST(evidence_json AS BLOB)) <= 67108864
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576
      ),
      result_definition_sha256 TEXT NOT NULL CHECK (length(result_definition_sha256) = 64),
      settlement_revision INTEGER NOT NULL CHECK (settlement_revision >= 1),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      accepted_at_campaign_minute INTEGER NOT NULL CHECK (accepted_at_campaign_minute >= 0),
      FOREIGN KEY (settlement_id) REFERENCES encounter_settlements(settlement_id)
        DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX encounter_settlement_operations_settlement_revision_idx
      ON encounter_settlement_operations (settlement_id, settlement_revision, operation_id);

    CREATE TABLE encounter_settlement_history_facts (
      fact_id TEXT PRIMARY KEY CHECK (length(fact_id) BETWEEN 8 AND 200),
      settlement_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      fact_kind TEXT NOT NULL CHECK (fact_kind IN (
        'experience-award', 'loot-award', 'capture-settled', 'outcome', 'cleanup', 'completion'
      )),
      audience TEXT NOT NULL CHECK (audience IN (
        'public', 'gm', 'participant-owner', 'destination-owner'
      )),
      subject_kind TEXT NOT NULL CHECK (subject_kind IN (
        'sheet', 'inventory', 'capture', 'outcome', 'cleanup', 'settlement'
      )),
      subject_id TEXT NOT NULL CHECK (length(subject_id) BETWEEN 1 AND 400),
      result_code TEXT NOT NULL CHECK (length(result_code) BETWEEN 1 AND 100),
      fact_json TEXT NOT NULL CHECK (
        json_valid(fact_json) AND length(CAST(fact_json AS BLOB)) <= 262144
      ),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      FOREIGN KEY (settlement_id) REFERENCES encounter_settlements(settlement_id),
      FOREIGN KEY (operation_id) REFERENCES encounter_settlement_operations(operation_id)
    );
    CREATE INDEX encounter_settlement_history_facts_settlement_idx
      ON encounter_settlement_history_facts (
        settlement_id, created_at_campaign_minute DESC, fact_id DESC
      );
    CREATE INDEX encounter_settlement_history_facts_subject_idx
      ON encounter_settlement_history_facts (
        subject_kind, subject_id, created_at_campaign_minute DESC, fact_id DESC
      );

    CREATE TABLE encounter_settlement_attention_sources (
      source_id TEXT PRIMARY KEY CHECK (length(source_id) BETWEEN 8 AND 200),
      settlement_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      source_fact_id TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN (
        'level-threshold', 'advancement-review', 'capture-review', 'medical-review',
        'equipment-review', 'continuation-review'
      )),
      audience TEXT NOT NULL CHECK (audience IN ('gm', 'owner')),
      entity_kind TEXT NOT NULL CHECK (entity_kind IN (
        'trainer-sheet', 'pokemon-sheet', 'profile', 'campaign'
      )),
      entity_id TEXT NOT NULL CHECK (length(entity_id) BETWEEN 1 AND 200),
      status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      source_json TEXT NOT NULL CHECK (
        json_valid(source_json) AND length(CAST(source_json AS BLOB)) <= 65536
      ),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      resolved_at_campaign_minute INTEGER CHECK (
        resolved_at_campaign_minute IS NULL OR resolved_at_campaign_minute >= created_at_campaign_minute
      ),
      resolution_operation_id TEXT UNIQUE CHECK (
        resolution_operation_id IS NULL OR length(resolution_operation_id) BETWEEN 8 AND 200
      ),
      CHECK (
        (status = 'open' AND revision = 0 AND resolved_at_campaign_minute IS NULL
          AND resolution_operation_id IS NULL)
        OR
        (status = 'resolved' AND revision >= 1 AND resolved_at_campaign_minute IS NOT NULL
          AND resolution_operation_id IS NOT NULL)
      ),
      FOREIGN KEY (settlement_id) REFERENCES encounter_settlements(settlement_id),
      FOREIGN KEY (operation_id) REFERENCES encounter_settlement_operations(operation_id),
      FOREIGN KEY (source_fact_id) REFERENCES encounter_settlement_history_facts(fact_id)
    );
    CREATE INDEX encounter_settlement_attention_sources_entity_status_idx
      ON encounter_settlement_attention_sources (
        entity_kind, entity_id, status, created_at_campaign_minute, source_id
      );
    CREATE INDEX encounter_settlement_attention_sources_status_created_idx
      ON encounter_settlement_attention_sources (
        status, created_at_campaign_minute, source_id
      );
  `)
}

const createEncounterSettlementCorrectionTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE encounter_settlement_corrections (
      operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 8 AND 200),
      settlement_id TEXT NOT NULL,
      principal_key TEXT NOT NULL CHECK (length(principal_key) BETWEEN 1 AND 160),
      source_receipt_id TEXT NOT NULL CHECK (length(source_receipt_id) BETWEEN 8 AND 200),
      reason_code TEXT NOT NULL CHECK (reason_code IN (
        'reward-adjusted', 'capture-corrected', 'outcome-corrected',
        'cleanup-corrected', 'clerical-corrected', 'authority-linked'
      )),
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 65536
      ),
      offer_definition_sha256 TEXT NOT NULL CHECK (length(offer_definition_sha256) = 64),
      authority_definition_sha256 TEXT NOT NULL CHECK (length(authority_definition_sha256) = 64),
      evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json) AND length(CAST(evidence_json AS BLOB)) <= 67108864
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 65536
      ),
      result_definition_sha256 TEXT NOT NULL CHECK (length(result_definition_sha256) = 64),
      settlement_revision INTEGER NOT NULL CHECK (settlement_revision >= 1),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      accepted_at_campaign_minute INTEGER NOT NULL CHECK (accepted_at_campaign_minute >= 0),
      UNIQUE (settlement_id, source_receipt_id),
      FOREIGN KEY (settlement_id) REFERENCES encounter_settlements(settlement_id)
        DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX encounter_settlement_corrections_settlement_revision_idx
      ON encounter_settlement_corrections (settlement_id, settlement_revision, operation_id);
  `)
}

const createItemGuidedRequestTable = (connection: DatabaseSync): void => {
  connection.exec(`
    CREATE TABLE item_guided_requests (
      request_id TEXT PRIMARY KEY CHECK (
        request_id GLOB 'item-guided:v1:[0-9a-f]*' AND length(request_id) = 47
      ),
      request_kind TEXT NOT NULL CHECK (request_kind IN (
        'loyalty-consequence', 're-breather-activation', 're-breather-refill'
      )),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'cancelled')),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      canonical_item_id TEXT NOT NULL CHECK (length(canonical_item_id) BETWEEN 1 AND 200),
      canonical_definition_sha256 TEXT NOT NULL CHECK (length(canonical_definition_sha256) = 64),
      declaration_principal_key TEXT NOT NULL CHECK (length(declaration_principal_key) BETWEEN 1 AND 160),
      actor_kind TEXT NOT NULL CHECK (actor_kind IN ('trainer', 'pokemon')),
      actor_slug TEXT NOT NULL CHECK (length(actor_slug) BETWEEN 1 AND 200),
      target_kind TEXT NOT NULL CHECK (target_kind IN ('trainer', 'pokemon')),
      target_slug TEXT NOT NULL CHECK (length(target_slug) BETWEEN 1 AND 200),
      item_operation_id TEXT UNIQUE REFERENCES item_operations(operation_id),
      declaration_operation_id TEXT NOT NULL UNIQUE CHECK (length(declaration_operation_id) BETWEEN 8 AND 200),
      declaration_command_sha256 TEXT NOT NULL CHECK (length(declaration_command_sha256) = 64),
      declaration_command_json TEXT NOT NULL CHECK (
        json_valid(declaration_command_json) AND length(CAST(declaration_command_json AS BLOB)) <= 65536
      ),
      authority_json TEXT NOT NULL CHECK (
        json_valid(authority_json) AND length(CAST(authority_json AS BLOB)) <= 262144
      ),
      terminal_principal_key TEXT CHECK (
        terminal_principal_key IS NULL OR length(terminal_principal_key) BETWEEN 1 AND 160
      ),
      terminal_operation_id TEXT UNIQUE CHECK (
        terminal_operation_id IS NULL OR length(terminal_operation_id) BETWEEN 8 AND 200
      ),
      terminal_command_sha256 TEXT CHECK (
        terminal_command_sha256 IS NULL OR length(terminal_command_sha256) = 64
      ),
      terminal_command_json TEXT CHECK (
        terminal_command_json IS NULL OR (
          json_valid(terminal_command_json) AND length(CAST(terminal_command_json AS BLOB)) <= 65536
        )
      ),
      outcome_option_id TEXT,
      result_json TEXT CHECK (
        result_json IS NULL OR (
          json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 65536
        )
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
      CHECK (
        (status = 'pending' AND revision = 0 AND terminal_principal_key IS NULL
          AND terminal_operation_id IS NULL AND terminal_command_sha256 IS NULL
          AND terminal_command_json IS NULL AND outcome_option_id IS NULL AND result_json IS NULL)
        OR
        (status IN ('accepted', 'cancelled') AND revision = 1
          AND terminal_principal_key IS NOT NULL AND terminal_operation_id IS NOT NULL
          AND terminal_command_sha256 IS NOT NULL AND terminal_command_json IS NOT NULL
          AND result_json IS NOT NULL
          AND ((status = 'accepted' AND outcome_option_id IS NOT NULL)
            OR (status = 'cancelled' AND outcome_option_id IS NULL)))
      )
    );
    CREATE INDEX item_guided_requests_status_created_idx
      ON item_guided_requests (status, created_at, request_id);
    CREATE INDEX item_guided_requests_actor_status_idx
      ON item_guided_requests (actor_kind, actor_slug, status, request_id);
    CREATE INDEX item_guided_requests_target_status_idx
      ON item_guided_requests (target_kind, target_slug, status, request_id);
  `)
}

const addCampaignToolGuidedRequestKind = (connection: DatabaseSync): void => {
  const row = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'item_guided_requests'
  `).get() as { readonly sql?: unknown } | undefined
  const sourceSql = row?.sql
  if (typeof sourceSql !== 'string'
    || !sourceSql.includes("'loyalty-consequence', 're-breather-activation', 're-breather-refill'")) {
    throw new Error('Storage migration v44 requires the exact v39 guided-request table definition')
  }
  const destinationSql = sourceSql
    .replace('CREATE TABLE item_guided_requests', 'CREATE TABLE item_guided_requests_v44')
    .replace(
      "'loyalty-consequence', 're-breather-activation', 're-breather-refill'",
      "'loyalty-consequence', 'campaign-tool-adjudication', 're-breather-activation', 're-breather-refill'",
    )
  connection.exec(`
    DROP INDEX item_guided_requests_status_created_idx;
    DROP INDEX item_guided_requests_actor_status_idx;
    DROP INDEX item_guided_requests_target_status_idx;
    ${destinationSql};
    INSERT INTO item_guided_requests_v44 SELECT * FROM item_guided_requests;
    DROP TABLE item_guided_requests;
    ALTER TABLE item_guided_requests_v44 RENAME TO item_guided_requests;
    CREATE INDEX item_guided_requests_status_created_idx
      ON item_guided_requests (status, created_at, request_id);
    CREATE INDEX item_guided_requests_actor_status_idx
      ON item_guided_requests (actor_kind, actor_slug, status, request_id);
    CREATE INDEX item_guided_requests_target_status_idx
      ON item_guided_requests (target_kind, target_slug, status, request_id);
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
  {
    version: 22,
    name: 'store authoritative breeding projects Eggs evidence lineage acquisitions and campaign clock',
    up: createBreedingLifecycleTables,
  },
  {
    version: 23,
    name: 'store immutable breeding archives import requests and restore receipts',
    up: createBreedingArchiveTables,
  },
  {
    version: 24,
    name: 'store immutable authoritative Egg incubation segment results',
    up: createBreedingIncubationSegmentTable,
  },
  {
    version: 25,
    name: 'allow authoritative Egg Warmer Capability breeding operations without rewriting v24 rows',
    up: addBreedingEggWarmerCapabilityOperationKind,
  },
  {
    version: 26,
    name: 'store replay-safe Egg transfer consents and scope their atomic consumption',
    up: createPokemonEggTransferConsentTable,
  },
  {
    version: 27,
    name: 'store external Species acquisition source settlements without forging breeding commands',
    up: createTrainerSpeciesAcquisitionSourceOperationTable,
  },
  {
    version: 28,
    name: 'store replay-safe Egg transfer-consent revocation and expiry operations',
    up: addPokemonEggTransferConsentSettlementOperationKind,
  },
  {
    version: 29,
    name: 'store authoritative replay-safe item operations and revisioned scopes',
    up: createItemOperationTables,
  },
  {
    version: 30,
    name: 'store item pending decisions and immutable resume-command replay evidence',
    up: addItemPendingDecisionAndResumeEvidence,
  },
  {
    version: 31,
    name: 'store immutable item correction and abandonment evidence',
    up: addItemRecoveryEvidence,
  },
  {
    version: 32,
    name: 'store accepted replay-safe campaign-day operations',
    up: createCampaignDayOperationTable,
  },
  {
    version: 33,
    name: 'store accepted replay-safe atomic equipment operations',
    up: createEquipmentOperationTable,
  },
  {
    version: 34,
    name: 'store guided equipment lifecycle and durability operations',
    up: addEquipmentLifecycleOperationKinds,
  },
  {
    version: 35,
    name: 'store durable replay-safe item Extended Action activities',
    up: createItemExtendedActionActivityTable,
  },
  {
    version: 36,
    name: 'store replay-safe item-driven form-change operations and private evidence',
    up: createItemFormChangeOperationTable,
  },
  {
    version: 37,
    name: 'store replay-safe exploration timing and GM positioning operations',
    up: createItemExplorationOperationTable,
  },
  {
    version: 38,
    name: 'store replay-safe breeding item assignments and source workflows',
    up: createItemBreedingOperationTable,
  },
  {
    version: 39,
    name: 'store bounded guided item requests and terminal adjudication evidence',
    up: createItemGuidedRequestTable,
  },
  {
    version: 40,
    name: 'store replay-safe unified inventory action declarations and accepted results',
    up: createInventoryActionOperationTable,
  },
  {
    version: 41,
    name: 'store split merge and discard inventory action operations',
    up: addInventoryStackOperationKinds,
  },
  {
    version: 42,
    name: 'store atomic encounter settlements history and attention sources',
    up: createEncounterSettlementTables,
  },
  {
    version: 43,
    name: 'store immutable authority-linked encounter settlement corrections',
    up: createEncounterSettlementCorrectionTable,
  },
  {
    version: 44,
    name: 'admit bounded guided campaign-tool adjudication requests',
    up: addCampaignToolGuidedRequestKind,
  },
  {
    version: 45,
    name: 'store guided onboarding policies, slots, drafts, submissions, reviews, operations, and completions',
    up: createGuidedOnboardingTables,
  },
  {
    version: 46,
    name: 'store authoritative Pokemon Contest documents operations metrics and structured preparation state',
    up: createPokemonContestTables,
  },
  {
    version: 47,
    name: 'store replay-safe authoritative encounter equipment actions',
    up: createEquipmentActionOperationTable,
  },
  {
    version: 48,
    name: 'admit durable guided fishing declarations and cancellation',
    up: addFishingGuidedRequestKind,
  },
  {
    version: 49,
    name: 'admit durable guided Snag Machine conversion adjudication',
    up: addSnagMachineGuidedRequestKind,
  },
  {
    version: 50,
    name: 'store versioned generic Skill Check documents and replay-safe operations',
    up: createSkillCheckTables,
  },
]

function addFishingGuidedRequestKind(connection: DatabaseSync): void {
  const row = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'item_guided_requests'
  `).get() as { readonly sql?: unknown } | undefined
  const sourceSql = row?.sql
  if (typeof sourceSql !== 'string'
    || !sourceSql.includes("'loyalty-consequence', 'campaign-tool-adjudication', 're-breather-activation'")) {
    throw new Error('Storage migration v48 requires the exact v44 guided-request table definition')
  }
  const destinationSql = sourceSql
    .replace(/CREATE TABLE\s+"?item_guided_requests"?/i, 'CREATE TABLE item_guided_requests_v48')
    .replace(
      "'loyalty-consequence', 'campaign-tool-adjudication', 're-breather-activation'",
      "'loyalty-consequence', 'campaign-tool-adjudication', 'fishing-adjudication', 're-breather-activation'",
    )
  connection.exec(`
    DROP INDEX item_guided_requests_status_created_idx;
    DROP INDEX item_guided_requests_actor_status_idx;
    DROP INDEX item_guided_requests_target_status_idx;
    ${destinationSql};
    INSERT INTO item_guided_requests_v48 SELECT * FROM item_guided_requests;
    DROP TABLE item_guided_requests;
    ALTER TABLE item_guided_requests_v48 RENAME TO item_guided_requests;
    CREATE INDEX item_guided_requests_status_created_idx
      ON item_guided_requests (status, created_at, request_id);
    CREATE INDEX item_guided_requests_actor_status_idx
      ON item_guided_requests (actor_kind, actor_slug, status, request_id);
    CREATE INDEX item_guided_requests_target_status_idx
      ON item_guided_requests (target_kind, target_slug, status, request_id);
  `)
}

function addSnagMachineGuidedRequestKind(connection: DatabaseSync): void {
  const row = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'item_guided_requests'
  `).get() as { readonly sql?: unknown } | undefined
  const sourceSql = row?.sql
  if (typeof sourceSql !== 'string'
    || !sourceSql.includes("'campaign-tool-adjudication', 'fishing-adjudication', 're-breather-activation'")) {
    throw new Error('Storage migration v49 requires the exact v48 guided-request table definition')
  }
  const destinationSql = sourceSql
    .replace(/CREATE TABLE\s+"?item_guided_requests"?/i, 'CREATE TABLE item_guided_requests_v49')
    .replace(
      "'campaign-tool-adjudication', 'fishing-adjudication', 're-breather-activation'",
      "'campaign-tool-adjudication', 'fishing-adjudication', 'snag-conversion-adjudication', 're-breather-activation'",
    )
  connection.exec(`
    DROP INDEX item_guided_requests_status_created_idx;
    DROP INDEX item_guided_requests_actor_status_idx;
    DROP INDEX item_guided_requests_target_status_idx;
    ${destinationSql};
    INSERT INTO item_guided_requests_v49 SELECT * FROM item_guided_requests;
    DROP TABLE item_guided_requests;
    ALTER TABLE item_guided_requests_v49 RENAME TO item_guided_requests;
    CREATE INDEX item_guided_requests_status_created_idx
      ON item_guided_requests (status, created_at, request_id);
    CREATE INDEX item_guided_requests_actor_status_idx
      ON item_guided_requests (actor_kind, actor_slug, status, request_id);
    CREATE INDEX item_guided_requests_target_status_idx
      ON item_guided_requests (target_kind, target_slug, status, request_id);
  `)
}

function createSkillCheckTables(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE skill_checks (
      check_id TEXT PRIMARY KEY CHECK (length(check_id) BETWEEN 16 AND 95),
      document_json TEXT NOT NULL CHECK (
        json_valid(document_json) AND length(CAST(document_json AS BLOB)) <= 8388608
      ),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      state TEXT NOT NULL CHECK (state IN ('pending', 'ready', 'accepted', 'cancelled', 'timed-out')),
      mode TEXT NOT NULL CHECK (mode IN ('single', 'group')),
      requester_principal_id TEXT NOT NULL CHECK (length(requester_principal_id) BETWEEN 1 AND 200),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
      expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= created_at),
      terminal_at INTEGER CHECK (terminal_at IS NULL OR terminal_at >= created_at),
      CHECK (
        (state IN ('accepted', 'cancelled', 'timed-out') AND terminal_at IS NOT NULL)
        OR (state IN ('pending', 'ready') AND terminal_at IS NULL)
      )
    );
    CREATE INDEX skill_checks_state_updated_idx
      ON skill_checks (state, updated_at DESC, check_id);
    CREATE INDEX skill_checks_requester_updated_idx
      ON skill_checks (requester_principal_id, updated_at DESC, check_id);
    CREATE INDEX skill_checks_expiry_idx
      ON skill_checks (expires_at, check_id) WHERE expires_at IS NOT NULL AND terminal_at IS NULL;

    CREATE TABLE skill_check_operations (
      operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 24 AND 114),
      check_id TEXT NOT NULL,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      principal_key TEXT NOT NULL CHECK (length(principal_key) BETWEEN 1 AND 240),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'request', 'respond', 'resolve', 'cancel', 'timeout', 'correct'
      )),
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 1048576
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 65536
      ),
      result_revision INTEGER NOT NULL CHECK (result_revision >= 1),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      FOREIGN KEY (check_id) REFERENCES skill_checks(check_id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX skill_check_operations_check_revision_idx
      ON skill_check_operations (check_id, result_revision, operation_id);
  `)
}

function createEquipmentActionOperationTable(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE equipment_action_operations (
      operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 1 AND 180),
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      principal_key TEXT NOT NULL CHECK (length(principal_key) BETWEEN 1 AND 240),
      map_slug TEXT NOT NULL CHECK (length(map_slug) BETWEEN 1 AND 180),
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 65536
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 65536
      ),
      evidence_json TEXT NOT NULL CHECK (
        json_valid(evidence_json) AND length(CAST(evidence_json AS BLOB)) <= 8388608
      ),
      result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );
    CREATE INDEX equipment_action_operations_map_revision_idx
      ON equipment_action_operations (map_slug, result_revision, operation_id);
  `)
}

function createPokemonContestTables(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE contests (
      contest_id TEXT PRIMARY KEY CHECK (length(contest_id) BETWEEN 12 AND 96),
      document_json TEXT NOT NULL CHECK (
        json_valid(document_json) AND length(CAST(document_json AS BLOB)) <= 8388608
      ),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      stage TEXT NOT NULL CHECK (stage IN (
        'setup', 'introduction', 'performance', 'settling', 'completed', 'cancelled'
      )),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
    );
    CREATE INDEX contests_stage_updated_idx ON contests (stage, updated_at DESC, contest_id);

    CREATE TABLE contest_operations (
      operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 20 AND 120),
      contest_id TEXT NOT NULL,
      command_hash TEXT NOT NULL CHECK (length(command_hash) = 64),
      command_kind TEXT NOT NULL CHECK (length(command_kind) BETWEEN 3 AND 80),
      command_json TEXT NOT NULL CHECK (
        json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 1048576
      ),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 8388608
      ),
      result_revision INTEGER NOT NULL CHECK (result_revision >= 0),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      FOREIGN KEY (contest_id) REFERENCES contests(contest_id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX contest_operations_contest_revision_idx
      ON contest_operations (contest_id, result_revision, operation_id);

    CREATE TABLE contest_preparation_operations (
      operation_id TEXT PRIMARY KEY CHECK (length(operation_id) BETWEEN 20 AND 120),
      pokemon_sheet_slug TEXT NOT NULL,
      trainer_sheet_slug TEXT NOT NULL,
      command_hash TEXT NOT NULL CHECK (length(command_hash) = 64),
      command_json TEXT NOT NULL CHECK (json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 262144),
      result_json TEXT NOT NULL CHECK (json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );
    CREATE INDEX contest_preparation_pokemon_idx
      ON contest_preparation_operations (pokemon_sheet_slug, created_at, operation_id);

    CREATE TABLE contest_ux_metric_aggregates (
      metric_day INTEGER NOT NULL CHECK (metric_day >= 0),
      metric_id TEXT NOT NULL CHECK (length(metric_id) BETWEEN 3 AND 80),
      sample_count INTEGER NOT NULL CHECK (sample_count >= 0),
      total_value INTEGER NOT NULL CHECK (total_value >= 0),
      maximum_value INTEGER NOT NULL CHECK (maximum_value >= 0),
      PRIMARY KEY (metric_day, metric_id)
    );

    UPDATE sheets
    SET document_json = json_set(
      document_json,
      '$.contestStats',
      json_object(
        'schemaVersion', 1,
        'legacyDescription', CASE json_type(document_json, '$.contestStats')
          WHEN 'text' THEN json_extract(document_json, '$.contestStats')
          ELSE ''
        END,
        'poffins', json('[]'),
        'grooming', json('null'),
        'reallocations', json('[]')
      )
    )
    WHERE kind = 'pokemon'
      AND (json_type(document_json, '$.contestStats') IS NULL
        OR json_type(document_json, '$.contestStats') = 'text');
  `)
}

function createGuidedOnboardingTables(connection: DatabaseSync): void {
  connection.exec(`
    CREATE TABLE onboarding_policies (
      policy_id TEXT NOT NULL CHECK (length(policy_id) BETWEEN 8 AND 80),
      version INTEGER NOT NULL CHECK (version >= 1),
      content_json TEXT NOT NULL CHECK (
        json_valid(content_json) AND length(CAST(content_json AS BLOB)) <= 1048576
      ),
      display_json TEXT NOT NULL CHECK (
        json_valid(display_json) AND length(CAST(display_json AS BLOB)) <= 65536
      ),
      content_hash TEXT NOT NULL CHECK (length(content_hash) BETWEEN 16 AND 64),
      published_at INTEGER NOT NULL CHECK (published_at >= 0),
      is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1)),
      PRIMARY KEY (policy_id, version)
    );
    CREATE UNIQUE INDEX onboarding_policies_single_active_uidx
      ON onboarding_policies (is_active) WHERE is_active = 1;

    CREATE TABLE onboarding_slots (
      slot_id TEXT PRIMARY KEY CHECK (length(slot_id) BETWEEN 8 AND 80),
      profile_id TEXT NOT NULL CHECK (length(profile_id) BETWEEN 8 AND 80),
      policy_id TEXT NOT NULL CHECK (length(policy_id) BETWEEN 8 AND 80),
      policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
      status TEXT NOT NULL CHECK (status IN ('open', 'completed', 'cancelled', 'superseded')),
      active_draft_id TEXT CHECK (active_draft_id IS NULL OR length(active_draft_id) BETWEEN 8 AND 80),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
    );
    CREATE INDEX onboarding_slots_profile_idx ON onboarding_slots (profile_id, status, slot_id);
    CREATE UNIQUE INDEX onboarding_slots_open_profile_uidx
      ON onboarding_slots (profile_id) WHERE status = 'open';

    CREATE TABLE onboarding_drafts (
      draft_id TEXT PRIMARY KEY CHECK (length(draft_id) BETWEEN 8 AND 80),
      slot_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (
        'draft', 'submitted', 'changes-requested', 'approved', 'committing',
        'completed', 'cancelled', 'superseded'
      )),
      revision INTEGER NOT NULL CHECK (revision >= 0),
      document_json TEXT NOT NULL CHECK (
        json_valid(document_json) AND length(CAST(document_json AS BLOB)) <= 2097152
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
      FOREIGN KEY (slot_id) REFERENCES onboarding_slots(slot_id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX onboarding_drafts_slot_idx ON onboarding_drafts (slot_id, state, draft_id);

    CREATE TABLE onboarding_submissions (
      draft_id TEXT NOT NULL,
      submission_revision INTEGER NOT NULL CHECK (submission_revision >= 1),
      snapshot_json TEXT NOT NULL CHECK (
        json_valid(snapshot_json) AND length(CAST(snapshot_json AS BLOB)) <= 4194304
      ),
      validation_json TEXT NOT NULL CHECK (
        json_valid(validation_json) AND length(CAST(validation_json AS BLOB)) <= 1048576
      ),
      policy_content_hash TEXT NOT NULL CHECK (length(policy_content_hash) BETWEEN 16 AND 64),
      catalog_fingerprint TEXT NOT NULL CHECK (length(catalog_fingerprint) BETWEEN 16 AND 64),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      PRIMARY KEY (draft_id, submission_revision),
      FOREIGN KEY (draft_id) REFERENCES onboarding_drafts(draft_id) DEFERRABLE INITIALLY DEFERRED
    );

    CREATE TABLE onboarding_review_entries (
      entry_id TEXT PRIMARY KEY CHECK (length(entry_id) BETWEEN 8 AND 120),
      draft_id TEXT NOT NULL,
      submission_revision INTEGER NOT NULL CHECK (submission_revision >= 0),
      kind TEXT NOT NULL CHECK (kind IN (
        'change-request', 'player-response', 'correction', 'acknowledgement', 'approval-note'
      )),
      audience TEXT NOT NULL CHECK (audience IN ('table', 'gm-only')),
      payload_json TEXT NOT NULL CHECK (
        json_valid(payload_json) AND length(CAST(payload_json AS BLOB)) <= 262144
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      FOREIGN KEY (draft_id) REFERENCES onboarding_drafts(draft_id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX onboarding_review_entries_draft_idx
      ON onboarding_review_entries (draft_id, created_at, entry_id);

    CREATE TABLE onboarding_ops (
      op_id TEXT PRIMARY KEY CHECK (length(op_id) BETWEEN 8 AND 120),
      scope TEXT NOT NULL CHECK (scope IN (
        'create-slot', 'submit', 'request-changes', 'respond', 'correct', 'acknowledge',
        'approve', 'commit', 'cancel', 'supersede', 'migrate-policy'
      )),
      payload_hash TEXT NOT NULL CHECK (length(payload_hash) BETWEEN 16 AND 64),
      result_json TEXT NOT NULL CHECK (
        json_valid(result_json) AND length(CAST(result_json AS BLOB)) <= 1048576
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0)
    );

    CREATE TABLE onboarding_completions (
      completion_id TEXT PRIMARY KEY CHECK (length(completion_id) BETWEEN 8 AND 120),
      slot_id TEXT NOT NULL UNIQUE,
      draft_id TEXT NOT NULL,
      submission_revision INTEGER NOT NULL CHECK (submission_revision >= 1),
      policy_id TEXT NOT NULL CHECK (length(policy_id) BETWEEN 8 AND 80),
      policy_version INTEGER NOT NULL CHECK (policy_version >= 1),
      refs_json TEXT NOT NULL CHECK (
        json_valid(refs_json) AND length(CAST(refs_json AS BLOB)) <= 1048576
      ),
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      FOREIGN KEY (slot_id) REFERENCES onboarding_slots(slot_id) DEFERRABLE INITIALLY DEFERRED
    );
  `)
}

function createTrainerSpeciesAcquisitionSourceOperationTable(connection: DatabaseSync): void {
  const acquisitionRow = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'trainer_species_acquisitions'
  `).get() as { readonly sql?: unknown } | undefined
  const acquisitionSql = acquisitionRow?.sql
  if (typeof acquisitionSql !== 'string' || !acquisitionSql.includes('REFERENCES breeding_operations (operation_id)')) {
    throw new Error('Storage migration v27 requires the exact row-preserving v26 Species acquisition definition')
  }
  const foreignKeys = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
  if (foreignKeys !== 0) throw new Error('Storage migration v27 requires the migration runner to suspend foreign-key actions during the acquisition-table rebuild')
  connection.exec(`
    CREATE TABLE trainer_species_acquisitions_v27 (
      trainer_sheet_slug TEXT NOT NULL,
      species_id TEXT NOT NULL,
      first_acquired_at_campaign_minute INTEGER NOT NULL CHECK (first_acquired_at_campaign_minute >= 0),
      source_egg_id TEXT,
      operation_id TEXT NOT NULL,
      record_json TEXT NOT NULL CHECK (json_valid(record_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      PRIMARY KEY (trainer_sheet_slug, species_id),
      FOREIGN KEY (source_egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED
    );
    INSERT INTO trainer_species_acquisitions_v27 (
      trainer_sheet_slug, species_id, first_acquired_at_campaign_minute, source_egg_id,
      operation_id, record_json, definition_sha256
    ) SELECT
      trainer_sheet_slug, species_id, first_acquired_at_campaign_minute, source_egg_id,
      operation_id, record_json, definition_sha256
    FROM trainer_species_acquisitions;
    DROP TABLE trainer_species_acquisitions;
    ALTER TABLE trainer_species_acquisitions_v27 RENAME TO trainer_species_acquisitions;
    CREATE INDEX trainer_species_acquisitions_species_idx
      ON trainer_species_acquisitions (species_id, first_acquired_at_campaign_minute, trainer_sheet_slug);

    CREATE TABLE trainer_species_acquisition_source_operations (
      operation_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('capture', 'evolution', 'trade', 'migration', 'gm-reviewed')),
      source_event_id TEXT NOT NULL,
      trainer_sheet_slug TEXT NOT NULL,
      species_id TEXT NOT NULL,
      settled_at_campaign_minute INTEGER NOT NULL CHECK (settled_at_campaign_minute >= 0),
      outcome TEXT NOT NULL CHECK (outcome IN ('first-acquisition-rewarded', 'already-acquired')),
      applied_reward_amount INTEGER NOT NULL CHECK (applied_reward_amount IN (0, 1)),
      record_json TEXT NOT NULL CHECK (json_valid(record_json) AND length(CAST(record_json AS BLOB)) <= 32768),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      UNIQUE (source_kind, source_event_id),
      CHECK ((outcome = 'first-acquisition-rewarded') = (applied_reward_amount = 1)),
      FOREIGN KEY (trainer_sheet_slug, species_id)
        REFERENCES trainer_species_acquisitions (trainer_sheet_slug, species_id)
        DEFERRABLE INITIALLY DEFERRED
    );
    CREATE INDEX trainer_species_acquisition_source_operations_trainer_idx
      ON trainer_species_acquisition_source_operations (
        trainer_sheet_slug, settled_at_campaign_minute, operation_id
      );
  `)
}

function createPokemonEggTransferConsentTable(connection: DatabaseSync): void {
  const scopeRow = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'breeding_operation_scopes'
  `).get() as { readonly sql?: unknown } | undefined
  const scopeSql = scopeRow?.sql
  if (typeof scopeSql !== 'string' || !scopeSql.includes("'species-acquisition', 'breeding-operation'")
    || scopeSql.includes('egg-transfer-consent')) {
    throw new Error('Storage migration v26 requires the exact row-preserving v25 breeding_operation_scopes definition')
  }
  const foreignKeys = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
  if (foreignKeys !== 0) {
    throw new Error('Storage migration v26 requires the migration runner to suspend foreign-key actions during the scope-table rebuild')
  }
  connection.exec(`
    CREATE TABLE breeding_operation_scopes_v26 (
      operation_id TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      scope_kind TEXT NOT NULL CHECK (scope_kind IN (
        'campaign-clock', 'breeding-project', 'pokemon-egg', 'parent-consent', 'trainer-sheet',
        'pokemon-sheet', 'pokemon-sheet-allocation', 'species-acquisition', 'breeding-operation',
        'egg-transfer-consent'
      )),
      scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
      PRIMARY KEY (operation_id, scope_key),
      FOREIGN KEY (operation_id) REFERENCES breeding_operations (operation_id) ON DELETE CASCADE
    );
    INSERT INTO breeding_operation_scopes_v26 (operation_id, scope_key, scope_kind, scope_json)
    SELECT operation_id, scope_key, scope_kind, scope_json FROM breeding_operation_scopes;
    DROP TABLE breeding_operation_scopes;
    ALTER TABLE breeding_operation_scopes_v26 RENAME TO breeding_operation_scopes;
    CREATE INDEX breeding_operation_scopes_conflict_idx
      ON breeding_operation_scopes (scope_kind, scope_key, operation_id);

    CREATE TABLE pokemon_egg_transfer_consents (
      consent_id TEXT PRIMARY KEY,
      document_json TEXT NOT NULL CHECK (json_valid(document_json)),
      definition_sha256 TEXT NOT NULL CHECK (length(definition_sha256) = 64),
      revision INTEGER NOT NULL CHECK (revision IN (0, 1)),
      status TEXT NOT NULL CHECK (status IN ('active', 'consumed', 'revoked', 'expired')),
      role TEXT NOT NULL CHECK (role IN ('source-gift', 'recipient-acceptance')),
      egg_id TEXT NOT NULL,
      egg_revision INTEGER NOT NULL CHECK (egg_revision >= 0),
      source_trainer_slug TEXT NOT NULL,
      destination_trainer_slug TEXT NOT NULL CHECK (destination_trainer_slug <> source_trainer_slug),
      consenting_profile_id TEXT NOT NULL,
      expires_at_campaign_minute INTEGER NOT NULL CHECK (expires_at_campaign_minute >= 0),
      settlement_operation_id TEXT,
      CHECK (
        (revision = 0 AND status = 'active' AND settlement_operation_id IS NULL)
        OR
        (revision = 1 AND status <> 'active' AND settlement_operation_id IS NOT NULL)
      ),
      FOREIGN KEY (egg_id) REFERENCES pokemon_eggs (egg_id) DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (settlement_operation_id) REFERENCES breeding_operations (operation_id) DEFERRABLE INITIALLY DEFERRED
    );
    CREATE UNIQUE INDEX pokemon_egg_transfer_consents_active_role_idx
      ON pokemon_egg_transfer_consents (egg_id, egg_revision, role) WHERE status = 'active';
    CREATE INDEX pokemon_egg_transfer_consents_participants_idx
      ON pokemon_egg_transfer_consents (
        status, source_trainer_slug, destination_trainer_slug, expires_at_campaign_minute, consent_id
      );
  `)
}

function addBreedingEggWarmerCapabilityOperationKind(connection: DatabaseSync): void {
  const row = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'breeding_operations'
  `).get() as { readonly sql?: unknown } | undefined
  const sql = row?.sql
  const before = "'advance-egg-incubation', 'set-egg-incubation-pause', 'mark-egg-ready'"
  if (typeof sql !== 'string' || !sql.includes(before) || sql.includes('apply-egg-warmer-capability')) {
    throw new Error('Storage migration v25 requires the exact row-preserving v24 breeding_operations definition')
  }
  const foreignKeys = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
  if (foreignKeys !== 0) throw new Error('Storage migration v25 requires the migration runner to suspend foreign-key actions during the parent-table rebuild')
  connection.exec(`
    CREATE TABLE breeding_operations_v25 (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'preview-breeding', 'create-breeding-project', 'grant-breeding-consent',
        'revoke-breeding-consent', 'advance-breeding-project-time', 'resolve-breeding-check',
        'produce-egg', 'cancel-breeding-project', 'create-source-egg', 'transfer-egg',
        'advance-egg-incubation', 'set-egg-incubation-pause', 'apply-egg-warmer-capability',
        'mark-egg-ready', 'begin-hatch', 'resolve-hatch-special', 'complete-hatch', 'cancel-egg',
        'advance-campaign-clock', 'record-inheritance-learning', 'recover-breeding-operation'
      )),
      command_json TEXT NOT NULL CHECK (json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 32768),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      result_definition_sha256 TEXT CHECK (result_definition_sha256 IS NULL OR length(result_definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= created_at_campaign_minute),
      CHECK (
        (status = 'pending' AND result_json IS NULL AND result_definition_sha256 IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (status IN ('accepted', 'rejected') AND result_json IS NOT NULL AND result_definition_sha256 IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      )
    );
    INSERT INTO breeding_operations_v25 (
      operation_id, command_sha256, command_kind, command_json, status, result_json,
      result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    ) SELECT
      operation_id, command_sha256, command_kind, command_json, status, result_json,
      result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    FROM breeding_operations;
    DROP TABLE breeding_operations;
    ALTER TABLE breeding_operations_v25 RENAME TO breeding_operations;
    CREATE INDEX breeding_operations_status_created_idx
      ON breeding_operations (status, created_at_campaign_minute, operation_id);
  `)
}

function addPokemonEggTransferConsentSettlementOperationKind(connection: DatabaseSync): void {
  const row = connection.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'breeding_operations'
  `).get() as { readonly sql?: unknown } | undefined
  const sql = row?.sql
  if (typeof sql !== 'string') {
    throw new Error('Storage migration v28 requires the authoritative breeding_operations table')
  }
  if (sql.includes('settle-egg-transfer-consent')) return
  const before = "'create-source-egg', 'transfer-egg',\n        'advance-egg-incubation'"
  if (!sql.includes(before) || !sql.includes('apply-egg-warmer-capability')) {
    throw new Error('Storage migration v28 requires the exact row-preserving v27 breeding_operations definition')
  }
  const foreignKeys = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
  if (foreignKeys !== 0) throw new Error('Storage migration v28 requires the migration runner to suspend foreign-key actions during the operation-table rebuild')
  connection.exec(`
    CREATE TABLE breeding_operations_v28 (
      operation_id TEXT PRIMARY KEY,
      command_sha256 TEXT NOT NULL CHECK (length(command_sha256) = 64),
      command_kind TEXT NOT NULL CHECK (command_kind IN (
        'preview-breeding', 'create-breeding-project', 'grant-breeding-consent',
        'revoke-breeding-consent', 'advance-breeding-project-time', 'resolve-breeding-check',
        'produce-egg', 'cancel-breeding-project', 'create-source-egg', 'transfer-egg',
        'settle-egg-transfer-consent', 'advance-egg-incubation', 'set-egg-incubation-pause',
        'apply-egg-warmer-capability', 'mark-egg-ready', 'begin-hatch', 'resolve-hatch-special',
        'complete-hatch', 'cancel-egg', 'advance-campaign-clock', 'record-inheritance-learning',
        'recover-breeding-operation'
      )),
      command_json TEXT NOT NULL CHECK (json_valid(command_json) AND length(CAST(command_json AS BLOB)) <= 32768),
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
      result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
      result_definition_sha256 TEXT CHECK (result_definition_sha256 IS NULL OR length(result_definition_sha256) = 64),
      created_at_campaign_minute INTEGER NOT NULL CHECK (created_at_campaign_minute >= 0),
      settled_at_campaign_minute INTEGER CHECK (settled_at_campaign_minute IS NULL OR settled_at_campaign_minute >= created_at_campaign_minute),
      CHECK (
        (status = 'pending' AND result_json IS NULL AND result_definition_sha256 IS NULL AND settled_at_campaign_minute IS NULL)
        OR
        (status IN ('accepted', 'rejected') AND result_json IS NOT NULL AND result_definition_sha256 IS NOT NULL AND settled_at_campaign_minute IS NOT NULL)
      )
    );
    INSERT INTO breeding_operations_v28 (
      operation_id, command_sha256, command_kind, command_json, status, result_json,
      result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    ) SELECT
      operation_id, command_sha256, command_kind, command_json, status, result_json,
      result_definition_sha256, created_at_campaign_minute, settled_at_campaign_minute
    FROM breeding_operations;
    DROP TABLE breeding_operations;
    ALTER TABLE breeding_operations_v28 RENAME TO breeding_operations;
    CREATE INDEX breeding_operations_status_created_idx
      ON breeding_operations (status, created_at_campaign_minute, operation_id);
  `)
}

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
  const foreignKeysBefore = connection.prepare('PRAGMA foreign_keys').get()?.foreign_keys
  const suspendForeignKeyActions = fromVersion < 28 && foreignKeysBefore === 1
  if (suspendForeignKeyActions) connection.exec('PRAGMA foreign_keys = OFF')
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
    if (suspendForeignKeyActions) {
      connection.exec('PRAGMA foreign_keys = ON')
      const violations = connection.prepare('PRAGMA foreign_key_check').all()
      if (violations.length !== 0) throw new Error('Storage migration v25/v26/v27/v28 produced foreign-key violations')
    }
    return {
      fromVersion,
      toVersion: currentVersion,
      appliedVersions,
    }
  } catch (error) {
    if (connection.isTransaction) connection.exec('ROLLBACK')
    if (suspendForeignKeyActions) connection.exec('PRAGMA foreign_keys = ON')
    throw error
  }
}
