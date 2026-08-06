import type { DatabaseSync } from 'node:sqlite'

export const LATEST_STORAGE_SCHEMA_VERSION = 26

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
]

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
  const suspendForeignKeyActions = fromVersion < 26 && foreignKeysBefore === 1
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
      if (violations.length !== 0) throw new Error('Storage migration v25/v26 produced foreign-key violations')
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
