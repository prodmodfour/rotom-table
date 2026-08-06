import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingArchiveRecordKind,
  BreedingArchiveRecordV1,
  BreedingArchiveV1,
  BreedingCampaignClockArchiveRecordV1,
} from '#shared/breeding/archives'
import type {
  BreedingAuthorizationReceiptV1,
  BreedingGmOverrideEvidenceV1,
} from '#shared/breeding/authorization'
import type {
  BreedingCheckRecordV1,
  BreedingGmAdjudicationRecordV1,
  BreedingOptionOfferRecordV1,
  BreedingRollRecordV1,
} from '#shared/breeding/ledgers'
import type {
  BreedingInheritanceLearningRecordV1,
  PokemonBreedingOriginV1,
} from '#shared/breeding/lineage'
import {
  breedingConflictScopeKey,
  type BreedingOperationCommandV1,
  type BreedingOperationResultV1,
} from '#shared/breeding/operations'
import type { BreedingOperationReadSetV1 } from '#shared/breeding/readSets'
import type { BreedingIncubationSegmentResultV1 } from '#shared/breeding/incubation'
import {
  createBreedingCampaignClockArchiveRecordV1,
  parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1,
} from '../domain/breeding/archives'
import {
  parseAuthoritativeBreedingAuthorizationReceiptV1,
} from '../domain/breeding/authorization'
import {
  parseAuthoritativeBreedingCheckRecordV1,
  parseAuthoritativeBreedingGmAdjudicationRecordV1,
  parseAuthoritativeBreedingOptionOfferRecordV1,
  parseAuthoritativeBreedingRollRecordV1,
} from '../domain/breeding/ledgers'
import {
  parseAuthoritativeBreedingInheritanceLearningRecordV1,
  parseAuthoritativePokemonBreedingOriginV1,
} from '../domain/breeding/lineage'
import { createBreedingOperationCommandHash } from '../domain/breeding/operations'
import { parseAuthoritativeBreedingOperationReadSetV1 } from '../domain/breeding/readSets'
import { createSqliteBreedingConsentRepository } from './breedingConsentRepository'
import { createSqliteBreedingIncubationSegmentRepository } from './breedingIncubationSegmentRepository'
import { createSqliteBreedingOperationRepository } from './breedingOperationRepository'
import { createSqliteBreedingProjectRepository } from './breedingProjectRepository'
import { createSqliteCampaignClockRepository } from './campaignClockRepository'
import { getRotomDatabase, type RotomDatabase } from './database'
import { createSqlitePokemonEggRepository } from './pokemonEggRepository'
import {
  BreedingRepositoryCorruptionError,
  assertBreedingStoredColumn,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'
import { createSqliteTrainerSpeciesAcquisitionRepository } from './trainerSpeciesAcquisitionRepository'

export interface ReadBreedingArchiveStateInput {
  readonly purpose: 'campaign-backup' | 'gm-audit'
}
export type BreedingArchiveRecordCollection = Readonly<Partial<
  Record<BreedingArchiveRecordKind, readonly BreedingArchiveRecordV1[]>
>>
export interface BreedingArchiveStateRepository {
  readonly database: RotomDatabase
  readRecords(input: ReadBreedingArchiveStateInput): BreedingArchiveRecordCollection
  replaceWithCampaignBackup(archive: BreedingArchiveV1): void
  hasCampaignAuthority(): boolean
  tableCounts(): Readonly<Record<string, number>>
}

export type BreedingArchiveStateErrorCode =
  | 'breeding.archive.pending-operation'
  | 'breeding.archive.unsupported-row'
  | 'breeding.archive.transaction-required'
  | 'breeding.archive.restore-records'

export class BreedingArchiveStateError extends Error {
  readonly code: BreedingArchiveStateErrorCode
  readonly table: string
  constructor(code: BreedingArchiveStateErrorCode, table: string, message: string) {
    super(`Breeding archive state ${table}: ${message}`)
    this.name = 'BreedingArchiveStateError'
    this.code = code
    this.table = table
  }
}

interface IdRow { readonly id: unknown }
interface JsonRow extends Readonly<Record<string, unknown>> {
  readonly id: unknown
  readonly json: unknown
  readonly definition_sha256?: unknown
}

const AUTHORITY_TABLES = Object.freeze([
  'breeding_authorization_receipts',
  'breeding_checks',
  'breeding_consents',
  'breeding_gm_adjudications',
  'breeding_gm_overrides',
  'breeding_inheritance_learning_records',
  'breeding_incubation_segments',
  'breeding_operation_scopes',
  'breeding_operations',
  'breeding_option_offers',
  'breeding_projects',
  'breeding_read_sets',
  'breeding_rolls',
  'pokemon_breeding_origins',
  'pokemon_eggs',
  'trainer_species_acquisitions',
] as const)
const DELETE_ORDER = Object.freeze([
  'breeding_inheritance_learning_records',
  'breeding_incubation_segments',
  'pokemon_breeding_origins',
  'trainer_species_acquisitions',
  'breeding_gm_adjudications',
  'breeding_option_offers',
  'breeding_checks',
  'breeding_rolls',
  'breeding_consents',
  'breeding_gm_overrides',
  'breeding_authorization_receipts',
  'breeding_read_sets',
  'breeding_projects',
  'pokemon_eggs',
  'breeding_operation_scopes',
  'breeding_operations',
] as const)

const text = (value: unknown, table: string, identity: string, field: string): string => {
  if (typeof value !== 'string') throw new BreedingRepositoryCorruptionError(table, identity, field)
  return value
}
const rowsById = (
  database: RotomDatabase,
  table: string,
  identityColumn: string,
): readonly string[] => (database.connection.prepare(`
  SELECT ${identityColumn} AS id FROM ${table} ORDER BY ${identityColumn} ASC
`).all() as unknown as IdRow[]).map(row => text(row.id, table, 'unknown', identityColumn))

const readJsonRecords = <Value extends object>(input: {
  readonly database: RotomDatabase
  readonly table: string
  readonly identityColumn: string
  readonly jsonColumn: string
  readonly parse: (value: unknown, path?: string) => Value
  readonly identity: (value: Value) => string
  readonly definitionSha256: (value: Value) => string
  readonly definitionColumn?: string
  readonly validateColumns?: (row: JsonRow, value: Value, identity: string) => void
}): readonly Value[] => {
  const rows = input.database.connection.prepare(`
    SELECT *, ${input.identityColumn} AS id, ${input.jsonColumn} AS json
    FROM ${input.table}
    ORDER BY ${input.identityColumn} ASC
  `).all() as unknown as JsonRow[]
  return Object.freeze(rows.map(row => {
    const identity = text(row.id, input.table, 'unknown', input.identityColumn)
    const value = parseStrictStoredBreedingJson({
      table: input.table,
      identity,
      json: row.json,
      parse: input.parse,
    })
    const definitionColumn = input.definitionColumn ?? 'definition_sha256'
    if (input.identity(value) !== identity || input.definitionSha256(value) !== row[definitionColumn]) {
      throw new BreedingRepositoryCorruptionError(input.table, identity, `identity or ${definitionColumn}`)
    }
    input.validateColumns?.(row, value, identity)
    return value
  }))
}

const recordsOf = <Value extends BreedingArchiveRecordV1>(
  archive: BreedingArchiveV1,
  kind: BreedingArchiveRecordKind,
): readonly Value[] => archive.chunks
  .filter(chunk => chunk.recordKind === kind)
  .flatMap(chunk => [...chunk.records]) as Value[]

const targetKindAndId = (
  target: BreedingOptionOfferRecordV1['target'] | BreedingGmAdjudicationRecordV1['target'],
): readonly [string, string] => {
  if (target.kind === 'breeding-project') return [target.kind, target.projectId]
  if (target.kind === 'pokemon-egg') return [target.kind, target.eggId]
  return [target.kind, target.sheetSlug]
}

const strictArchivePurpose = (archive: BreedingArchiveV1): void => {
  if (archive.purpose !== 'campaign-backup') {
    throw new BreedingArchiveStateError(
      'breeding.archive.restore-records',
      'archive',
      'restore accepts only a validated campaign-backup archive.',
    )
  }
}

export const createSqliteBreedingArchiveStateRepository = (
  database: RotomDatabase = getRotomDatabase(),
): BreedingArchiveStateRepository => {
  const projects = createSqliteBreedingProjectRepository(database)
  const eggs = createSqlitePokemonEggRepository(database)
  const consents = createSqliteBreedingConsentRepository(database)
  const acquisitions = createSqliteTrainerSpeciesAcquisitionRepository(database)
  const operations = createSqliteBreedingOperationRepository(database)
  const incubationSegments = createSqliteBreedingIncubationSegmentRepository(database)
  const campaignClock = createSqliteCampaignClockRepository(database)

  const readRecords = (input: ReadBreedingArchiveStateInput): BreedingArchiveRecordCollection => {
    const records: Partial<Record<BreedingArchiveRecordKind, BreedingArchiveRecordV1[]>> = {}
    const set = (kind: BreedingArchiveRecordKind, values: readonly BreedingArchiveRecordV1[]): void => {
      if (values.length > 0) records[kind] = [...values]
    }

    const projectRecords = rowsById(database, 'breeding_projects', 'project_id')
      .map(identity => projects.get(identity) ?? (() => {
        throw new BreedingRepositoryCorruptionError('breeding_projects', identity, 'read visibility')
      })())
    const eggRecords = rowsById(database, 'pokemon_eggs', 'egg_id')
      .map(identity => eggs.get(identity) ?? (() => {
        throw new BreedingRepositoryCorruptionError('pokemon_eggs', identity, 'read visibility')
      })())
    const consentRecords = rowsById(database, 'breeding_consents', 'consent_id')
      .map(identity => consents.get(identity) ?? (() => {
        throw new BreedingRepositoryCorruptionError('breeding_consents', identity, 'read visibility')
      })())
    const acquisitionRecords = (database.connection.prepare(`
      SELECT trainer_sheet_slug, species_id
      FROM trainer_species_acquisitions
      ORDER BY trainer_sheet_slug ASC, species_id ASC
    `).all() as unknown as Array<{ trainer_sheet_slug: unknown, species_id: unknown }>).map(row => {
      const trainer = text(row.trainer_sheet_slug, 'trainer_species_acquisitions', 'unknown', 'trainer_sheet_slug')
      const species = text(row.species_id, 'trainer_species_acquisitions', trainer, 'species_id')
      const value = acquisitions.get(trainer, species) ?? (() => {
        throw new BreedingRepositoryCorruptionError('trainer_species_acquisitions', `${trainer}/${species}`, 'read visibility')
      })()
      return parseAuthoritativeBreedingSpeciesAcquisitionArchiveRecordV1(value)
    })

    set('project', projectRecords)
    set('egg', eggRecords)
    set('consent', consentRecords)
    set('species-acquisition', acquisitionRecords)
    set('incubation-segment', rowsById(database, 'breeding_incubation_segments', 'operation_id')
      .map(identity => incubationSegments.get(identity) ?? (() => {
        throw new BreedingRepositoryCorruptionError('breeding_incubation_segments', identity, 'read visibility')
      })()))
    set('roll', readJsonRecords({
      database, table: 'breeding_rolls', identityColumn: 'roll_record_id', jsonColumn: 'record_json',
      parse: parseAuthoritativeBreedingRollRecordV1, identity: value => value.rollRecordId,
      definitionSha256: value => value.definitionSha256,
      validateColumns: (row, value, identity) => {
        assertBreedingStoredColumn(value.operationId === row.operation_id, 'breeding_rolls', identity, 'operation_id')
        assertBreedingStoredColumn(value.operationRollOrdinal === row.operation_roll_ordinal, 'breeding_rolls', identity, 'operation_roll_ordinal')
        assertBreedingStoredColumn(value.commandSha256 === row.command_sha256, 'breeding_rolls', identity, 'command_sha256')
        assertBreedingStoredColumn(value.purpose === row.purpose, 'breeding_rolls', identity, 'purpose')
        assertBreedingStoredColumn(value.generatedAtCampaignMinute === row.generated_at_campaign_minute, 'breeding_rolls', identity, 'generated_at_campaign_minute')
      },
    }))
    set('check', readJsonRecords({
      database, table: 'breeding_checks', identityColumn: 'check_record_id', jsonColumn: 'record_json',
      parse: parseAuthoritativeBreedingCheckRecordV1, identity: value => value.checkRecordId,
      definitionSha256: value => value.definitionSha256,
      validateColumns: (row, value, identity) => {
        assertBreedingStoredColumn(value.projectId === row.project_id, 'breeding_checks', identity, 'project_id')
        assertBreedingStoredColumn(value.operationId === row.operation_id, 'breeding_checks', identity, 'operation_id')
        assertBreedingStoredColumn(value.rollRecordId === row.roll_record_id, 'breeding_checks', identity, 'roll_record_id')
        assertBreedingStoredColumn(value.commandSha256 === row.command_sha256, 'breeding_checks', identity, 'command_sha256')
        assertBreedingStoredColumn(value.outcome === row.outcome, 'breeding_checks', identity, 'outcome')
        assertBreedingStoredColumn(value.resolvedAtCampaignMinute === row.resolved_at_campaign_minute, 'breeding_checks', identity, 'resolved_at_campaign_minute')
      },
    }))
    set('offer', readJsonRecords({
      database, table: 'breeding_option_offers', identityColumn: 'offer_id', jsonColumn: 'document_json',
      parse: parseAuthoritativeBreedingOptionOfferRecordV1, identity: value => value.offerId,
      definitionSha256: value => value.definitionSha256,
      validateColumns: (row, value, identity) => {
        const [targetKind, targetId] = targetKindAndId(value.target)
        assertBreedingStoredColumn(value.revision === row.revision, 'breeding_option_offers', identity, 'revision')
        assertBreedingStoredColumn(value.status === row.status, 'breeding_option_offers', identity, 'status')
        assertBreedingStoredColumn(value.choiceKind === row.choice_kind, 'breeding_option_offers', identity, 'choice_kind')
        assertBreedingStoredColumn(targetKind === row.target_kind && targetId === row.target_id, 'breeding_option_offers', identity, 'target')
        assertBreedingStoredColumn(value.chooserProfileId === row.chooser_profile_id, 'breeding_option_offers', identity, 'chooser_profile_id')
        assertBreedingStoredColumn(value.issuedOperationId === row.issued_operation_id, 'breeding_option_offers', identity, 'issued_operation_id')
        assertBreedingStoredColumn(value.settlementOperationId === row.settlement_operation_id, 'breeding_option_offers', identity, 'settlement_operation_id')
        assertBreedingStoredColumn(value.issuedAtCampaignMinute === row.issued_at_campaign_minute, 'breeding_option_offers', identity, 'issued_at_campaign_minute')
        assertBreedingStoredColumn(value.expiresAtCampaignMinute === row.expires_at_campaign_minute, 'breeding_option_offers', identity, 'expires_at_campaign_minute')
        assertBreedingStoredColumn(value.settledAtCampaignMinute === row.settled_at_campaign_minute, 'breeding_option_offers', identity, 'settled_at_campaign_minute')
      },
    }))
    set('adjudication', readJsonRecords({
      database, table: 'breeding_gm_adjudications', identityColumn: 'adjudication_id', jsonColumn: 'document_json',
      parse: parseAuthoritativeBreedingGmAdjudicationRecordV1, identity: value => value.adjudicationId,
      definitionSha256: value => value.definitionSha256,
      validateColumns: (row, value, identity) => {
        const [targetKind, targetId] = targetKindAndId(value.target)
        assertBreedingStoredColumn(value.revision === row.revision, 'breeding_gm_adjudications', identity, 'revision')
        assertBreedingStoredColumn(value.status === row.status, 'breeding_gm_adjudications', identity, 'status')
        assertBreedingStoredColumn(value.adjudicationKind === row.adjudication_kind, 'breeding_gm_adjudications', identity, 'adjudication_kind')
        assertBreedingStoredColumn(targetKind === row.target_kind && targetId === row.target_id, 'breeding_gm_adjudications', identity, 'target')
        assertBreedingStoredColumn(value.offerId === row.offer_id, 'breeding_gm_adjudications', identity, 'offer_id')
        assertBreedingStoredColumn(value.createdOperationId === row.created_operation_id, 'breeding_gm_adjudications', identity, 'created_operation_id')
        assertBreedingStoredColumn(value.settlementOperationId === row.settlement_operation_id, 'breeding_gm_adjudications', identity, 'settlement_operation_id')
        assertBreedingStoredColumn(value.createdAtCampaignMinute === row.created_at_campaign_minute, 'breeding_gm_adjudications', identity, 'created_at_campaign_minute')
        assertBreedingStoredColumn(value.settledAtCampaignMinute === row.settled_at_campaign_minute, 'breeding_gm_adjudications', identity, 'settled_at_campaign_minute')
      },
    }))
    set('read-set', readJsonRecords({
      database, table: 'breeding_read_sets', identityColumn: 'read_set_id', jsonColumn: 'document_json',
      parse: parseAuthoritativeBreedingOperationReadSetV1, identity: value => value.readSetId,
      definitionSha256: value => value.definitionSha256,
      validateColumns: (row, value, identity) => {
        assertBreedingStoredColumn(value.operationId === row.operation_id, 'breeding_read_sets', identity, 'operation_id')
        assertBreedingStoredColumn(value.commandSha256 === row.command_sha256, 'breeding_read_sets', identity, 'command_sha256')
        assertBreedingStoredColumn(value.capturedAtCampaignMinute === row.captured_at_campaign_minute, 'breeding_read_sets', identity, 'captured_at_campaign_minute')
      },
    }))
    set('authorization-receipt', readJsonRecords({
      database, table: 'breeding_authorization_receipts', identityColumn: 'operation_id', jsonColumn: 'document_json',
      parse: parseAuthoritativeBreedingAuthorizationReceiptV1, identity: value => value.operationId,
      definitionSha256: value => value.definitionSha256,
      validateColumns: (row, value, identity) => {
        assertBreedingStoredColumn(value.commandSha256 === row.command_sha256, 'breeding_authorization_receipts', identity, 'command_sha256')
        assertBreedingStoredColumn(value.readSetDefinitionSha256 === row.read_set_definition_sha256, 'breeding_authorization_receipts', identity, 'read_set_definition_sha256')
        assertBreedingStoredColumn(Number(value.authorized) === row.authorized, 'breeding_authorization_receipts', identity, 'authorized')
        assertBreedingStoredColumn(value.evaluatedAtCampaignMinute === row.evaluated_at_campaign_minute, 'breeding_authorization_receipts', identity, 'evaluated_at_campaign_minute')
      },
    }))
    set('origin', readJsonRecords({
      database, table: 'pokemon_breeding_origins', identityColumn: 'origin_id', jsonColumn: 'document_json',
      parse: parseAuthoritativePokemonBreedingOriginV1, identity: value => value.originId,
      definitionSha256: value => value.lineageDefinitionSha256,
      definitionColumn: 'lineage_definition_sha256',
      validateColumns: (row, value, identity) => {
        assertBreedingStoredColumn(value.eggId === row.egg_id, 'pokemon_breeding_origins', identity, 'egg_id')
        assertBreedingStoredColumn(value.childSheetSlug === row.child_sheet_slug, 'pokemon_breeding_origins', identity, 'child_sheet_slug')
        assertBreedingStoredColumn(value.hatchOperationId === row.hatch_operation_id, 'pokemon_breeding_origins', identity, 'hatch_operation_id')
        assertBreedingStoredColumn(value.hatchedAtCampaignMinute === row.created_at_campaign_minute, 'pokemon_breeding_origins', identity, 'created_at_campaign_minute')
      },
    }))
    set('inheritance-learning', readJsonRecords({
      database, table: 'breeding_inheritance_learning_records', identityColumn: 'learning_record_id', jsonColumn: 'record_json',
      parse: parseAuthoritativeBreedingInheritanceLearningRecordV1, identity: value => value.learningRecordId,
      definitionSha256: value => value.definitionSha256,
      validateColumns: (row, value, identity) => {
        assertBreedingStoredColumn(value.originId === row.origin_id, 'breeding_inheritance_learning_records', identity, 'origin_id')
        assertBreedingStoredColumn(value.eggId === row.egg_id, 'breeding_inheritance_learning_records', identity, 'egg_id')
        assertBreedingStoredColumn(value.childSheetSlug === row.child_sheet_slug, 'breeding_inheritance_learning_records', identity, 'child_sheet_slug')
        assertBreedingStoredColumn(value.checkpointLevel === row.checkpoint_level, 'breeding_inheritance_learning_records', identity, 'checkpoint_level')
        assertBreedingStoredColumn(value.operationId === row.operation_id, 'breeding_inheritance_learning_records', identity, 'operation_id')
        assertBreedingStoredColumn(value.recordedAtCampaignMinute === row.created_at_campaign_minute, 'breeding_inheritance_learning_records', identity, 'created_at_campaign_minute')
      },
    }))

    const overrideCount = Number((database.connection.prepare(`
      SELECT COUNT(*) AS count FROM breeding_gm_overrides
    `).get() as { count: number }).count)
    if (overrideCount > 0) {
      // The frozen v1 archive contract has no GM-override record kind. Omitting
      // these private authorization records would manufacture an incomplete audit.
      throw new BreedingArchiveStateError(
        'breeding.archive.unsupported-row',
        'breeding_gm_overrides',
        'v1 cannot export stored GM override evidence without loss.',
      )
    }

    const commands: BreedingOperationCommandV1[] = []
    const results: BreedingOperationResultV1[] = []
    for (const identity of rowsById(database, 'breeding_operations', 'operation_id')) {
      const operation = operations.get(identity) ?? (() => {
        throw new BreedingRepositoryCorruptionError('breeding_operations', identity, 'read visibility')
      })()
      commands.push(operation.command)
      if (operation.result) results.push(operation.result)
      else if (input.purpose === 'campaign-backup') {
        throw new BreedingArchiveStateError(
          'breeding.archive.pending-operation',
          'breeding_operations',
          'campaign backup requires every pending operation to be recovered or settled first.',
        )
      }
    }
    set('operation-command', commands)
    set('operation-result', results)

    const clock = campaignClock.get()
    const clockRecord = createBreedingCampaignClockArchiveRecordV1({
      revision: clock.revision,
      campaignMinute: clock.campaignMinute,
      lastOperationId: clock.lastOperationId,
    })
    set('campaign-clock', [clockRecord])

    return Object.freeze(Object.fromEntries(
      Object.entries(records).map(([kind, values]) => [kind, Object.freeze(values)]),
    )) as BreedingArchiveRecordCollection
  }

  const hasCampaignAuthority = (): boolean => {
    const clock = campaignClock.get()
    if (clock.revision !== 0 || clock.campaignMinute !== 0 || clock.lastOperationId !== null) return true
    return AUTHORITY_TABLES.some(table => Number((database.connection
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count) > 0)
  }

  const tableCounts = (): Readonly<Record<string, number>> => Object.freeze(Object.fromEntries([
    ...AUTHORITY_TABLES,
    'campaign_clock',
    'breeding_archives',
    'breeding_archive_import_requests',
    'breeding_archive_restore_receipts',
  ].map(table => [table, Number((database.connection
    .prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)])))

  const replaceWithCampaignBackup = (archive: BreedingArchiveV1): void => {
    strictArchivePurpose(archive)
    if (!database.connection.isTransaction) {
      throw new BreedingArchiveStateError(
        'breeding.archive.transaction-required',
        'restore',
        'must participate in one caller-owned SQLite transaction.',
      )
    }
    database.connection.exec('PRAGMA defer_foreign_keys = ON')
    database.connection.prepare(`
      UPDATE campaign_clock
      SET revision = 0, campaign_minute = 0, last_operation_id = NULL
      WHERE singleton = 1
    `).run()
    for (const table of DELETE_ORDER) database.connection.exec(`DELETE FROM ${table}`)

    const commands = recordsOf<BreedingOperationCommandV1>(archive, 'operation-command')
    const results = new Map(recordsOf<BreedingOperationResultV1>(archive, 'operation-result')
      .map(result => [result.operationId, result]))
    const readSets = new Map(recordsOf<BreedingOperationReadSetV1>(archive, 'read-set')
      .map(value => [value.operationId, value]))
    const receipts = new Map(recordsOf<BreedingAuthorizationReceiptV1>(archive, 'authorization-receipt')
      .map(value => [value.operationId, value]))

    for (const command of commands) {
      const result = results.get(command.operationId)
      if (!result) {
        throw new BreedingArchiveStateError(
          'breeding.archive.restore-records',
          'operation-result',
          'campaign backup cannot restore a command without its terminal result.',
        )
      }
      const readSet = readSets.get(command.operationId)
      const receipt = receipts.get(command.operationId)
      const times = [readSet?.capturedAtCampaignMinute, receipt?.evaluatedAtCampaignMinute]
        .filter((value): value is number => value !== undefined)
      const terminalMinute = result.ok
        ? (result.committedAtCampaignMinute ?? receipt?.evaluatedAtCampaignMinute)
        : receipt?.evaluatedAtCampaignMinute
      if (terminalMinute === undefined) {
        throw new BreedingArchiveStateError(
          'breeding.archive.restore-records',
          'operation-result',
          'must retain a terminal campaign-minute checkpoint through result or authorization evidence.',
        )
      }
      const createdAt = times.length > 0 ? Math.min(...times, terminalMinute) : terminalMinute
      const commandHash = createBreedingOperationCommandHash(command)
      database.connection.prepare(`
        INSERT INTO breeding_operations (
          operation_id, command_sha256, command_kind, command_json, status,
          result_json, result_definition_sha256, created_at_campaign_minute,
          settled_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        command.operationId,
        commandHash,
        command.commandKind,
        stableJsonStringify(command),
        result.ok ? 'accepted' : 'rejected',
        stableJsonStringify(result),
        result.resultDefinitionSha256,
        createdAt,
        terminalMinute,
      )
      for (const scope of command.scopes) database.connection.prepare(`
        INSERT INTO breeding_operation_scopes (
          operation_id, scope_key, scope_kind, scope_json
        ) VALUES (?, ?, ?, ?)
      `).run(command.operationId, breedingConflictScopeKey(scope), scope.kind, stableJsonStringify(scope))
    }

    const projectRecords = recordsOf<Extract<BreedingArchiveRecordV1, { readonly projectId: unknown }>>(archive, 'project')
    for (const project of projectRecords) database.connection.prepare(`
      INSERT INTO breeding_projects (
        project_id, document_json, revision, status, owner_trainer_slug,
        breeder_trainer_slug, parent_a_slug, parent_b_slug, produced_egg_id,
        last_operation_id, created_at_campaign_minute, updated_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.projectId, stableJsonStringify(project), project.revision, project.status,
      project.ownerTrainerSlug, project.breederTrainerSlug,
      project.parentRefs[0].pokemonSheetSlug, project.parentRefs[1].pokemonSheetSlug,
      project.producedEggId, project.lastOperationId,
      project.createdAtCampaignMinute, project.updatedAtCampaignMinute,
    )

    const eggRecords = recordsOf<Extract<BreedingArchiveRecordV1, { readonly eggId: unknown, readonly status: unknown, readonly offspring: unknown }>>(archive, 'egg')
    for (const egg of eggRecords) database.connection.prepare(`
      INSERT INTO pokemon_eggs (
        egg_id, document_json, revision, status, owner_trainer_slug, source_kind,
        source_project_id, child_sheet_slug, last_operation_id,
        created_at_campaign_minute, updated_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      egg.eggId, stableJsonStringify(egg), egg.revision, egg.status,
      egg.ownerTrainerSlug, egg.source.kind,
      egg.source.kind === 'breeding' ? egg.source.projectId : null,
      egg.childSheetSlug, egg.lastOperationId,
      egg.createdAtCampaignMinute, egg.updatedAtCampaignMinute,
    )

    for (const segment of recordsOf<BreedingIncubationSegmentResultV1>(archive, 'incubation-segment')) database.connection.prepare(`
      INSERT INTO breeding_incubation_segments (
        operation_id, egg_id, egg_revision_before, egg_revision_after,
        command_kind, through_clock_revision, through_campaign_minute,
        record_json, definition_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      segment.operationId, segment.eggId, segment.eggRevisionBefore,
      segment.eggRevisionAfter, segment.commandKind, segment.throughClockRevision,
      segment.throughCampaignMinute, stableJsonStringify(segment), segment.definitionSha256,
    )

    for (const consent of recordsOf<Extract<BreedingArchiveRecordV1, { readonly consentId: unknown }>>(archive, 'consent')) database.connection.prepare(`
      INSERT INTO breeding_consents (
        consent_id, document_json, definition_sha256, revision, status, project_id,
        parent_sheet_slug, parent_sheet_revision, owner_trainer_slug,
        consenting_profile_id, expires_at_campaign_minute, grant_operation_id,
        settlement_operation_id, granted_at_campaign_minute, settled_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      consent.consentId, stableJsonStringify(consent), consent.definitionSha256,
      consent.revision, consent.status, consent.projectId, consent.parentSheetSlug,
      consent.parentSheetRevision, consent.ownerTrainerSlug, consent.consentingProfileId,
      consent.expiresAtCampaignMinute, consent.grantOperationId,
      consent.settlementOperationId, consent.grantedAtCampaignMinute,
      consent.settledAtCampaignMinute,
    )

    for (const roll of recordsOf<BreedingRollRecordV1>(archive, 'roll')) database.connection.prepare(`
      INSERT INTO breeding_rolls (
        roll_record_id, operation_id, operation_roll_ordinal, command_sha256,
        purpose, record_json, definition_sha256, generated_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      roll.rollRecordId, roll.operationId, roll.operationRollOrdinal,
      roll.commandSha256, roll.purpose, stableJsonStringify(roll),
      roll.definitionSha256, roll.generatedAtCampaignMinute,
    )

    for (const check of recordsOf<BreedingCheckRecordV1>(archive, 'check')) database.connection.prepare(`
      INSERT INTO breeding_checks (
        check_record_id, project_id, operation_id, roll_record_id, command_sha256,
        outcome, record_json, definition_sha256, resolved_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      check.checkRecordId, check.projectId, check.operationId, check.rollRecordId,
      check.commandSha256, check.outcome, stableJsonStringify(check),
      check.definitionSha256, check.resolvedAtCampaignMinute,
    )

    for (const offer of recordsOf<BreedingOptionOfferRecordV1>(archive, 'offer')) {
      const [targetKind, targetId] = targetKindAndId(offer.target)
      database.connection.prepare(`
        INSERT INTO breeding_option_offers (
          offer_id, document_json, definition_sha256, revision, status, choice_kind,
          target_kind, target_id, chooser_profile_id, issued_operation_id,
          settlement_operation_id, issued_at_campaign_minute,
          expires_at_campaign_minute, settled_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        offer.offerId, stableJsonStringify(offer), offer.definitionSha256,
        offer.revision, offer.status, offer.choiceKind, targetKind, targetId,
        offer.chooserProfileId, offer.issuedOperationId, offer.settlementOperationId,
        offer.issuedAtCampaignMinute, offer.expiresAtCampaignMinute,
        offer.settledAtCampaignMinute,
      )
    }

    for (const adjudication of recordsOf<BreedingGmAdjudicationRecordV1>(archive, 'adjudication')) {
      const [targetKind, targetId] = targetKindAndId(adjudication.target)
      database.connection.prepare(`
        INSERT INTO breeding_gm_adjudications (
          adjudication_id, document_json, definition_sha256, revision, status,
          adjudication_kind, target_kind, target_id, offer_id,
          created_operation_id, settlement_operation_id,
          created_at_campaign_minute, settled_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        adjudication.adjudicationId, stableJsonStringify(adjudication),
        adjudication.definitionSha256, adjudication.revision,
        adjudication.status, adjudication.adjudicationKind, targetKind, targetId,
        adjudication.offerId, adjudication.createdOperationId,
        adjudication.settlementOperationId, adjudication.createdAtCampaignMinute,
        adjudication.settledAtCampaignMinute,
      )
    }

    for (const readSet of recordsOf<BreedingOperationReadSetV1>(archive, 'read-set')) database.connection.prepare(`
      INSERT INTO breeding_read_sets (
        read_set_id, operation_id, command_sha256, document_json,
        definition_sha256, captured_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      readSet.readSetId, readSet.operationId, readSet.commandSha256,
      stableJsonStringify(readSet), readSet.definitionSha256,
      readSet.capturedAtCampaignMinute,
    )

    for (const receipt of recordsOf<BreedingAuthorizationReceiptV1>(archive, 'authorization-receipt')) database.connection.prepare(`
      INSERT INTO breeding_authorization_receipts (
        operation_id, command_sha256, read_set_definition_sha256, authorized,
        document_json, definition_sha256, evaluated_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      receipt.operationId, receipt.commandSha256, receipt.readSetDefinitionSha256,
      Number(receipt.authorized), stableJsonStringify(receipt),
      receipt.definitionSha256, receipt.evaluatedAtCampaignMinute,
    )

    // v1 campaign backups have no GM-override record kind. Validation rejects
    // exporting any nonempty override table, so a restorable archive is exactly empty here.
    const overrides: readonly BreedingGmOverrideEvidenceV1[] = []
    for (const override of overrides) database.connection.prepare(`
      INSERT INTO breeding_gm_overrides (
        override_id, operation_id, command_sha256, override_kind,
        document_json, definition_sha256, created_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      override.overrideId, override.operationId, override.commandSha256,
      override.overrideKind, stableJsonStringify(override),
      override.definitionSha256, override.createdAtCampaignMinute,
    )

    for (const origin of recordsOf<PokemonBreedingOriginV1>(archive, 'origin')) database.connection.prepare(`
      INSERT INTO pokemon_breeding_origins (
        origin_id, egg_id, child_sheet_slug, document_json,
        lineage_definition_sha256, hatch_operation_id, created_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      origin.originId, origin.eggId, origin.childSheetSlug,
      stableJsonStringify(origin), origin.lineageDefinitionSha256,
      origin.hatchOperationId, origin.hatchedAtCampaignMinute,
    )

    for (const learning of recordsOf<BreedingInheritanceLearningRecordV1>(archive, 'inheritance-learning')) database.connection.prepare(`
      INSERT INTO breeding_inheritance_learning_records (
        learning_record_id, origin_id, egg_id, child_sheet_slug,
        checkpoint_level, operation_id, record_json, definition_sha256,
        created_at_campaign_minute
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      learning.learningRecordId, learning.originId, learning.eggId,
      learning.childSheetSlug, learning.checkpointLevel, learning.operationId,
      stableJsonStringify(learning), learning.definitionSha256,
      learning.recordedAtCampaignMinute,
    )

    for (const acquisition of recordsOf<Extract<BreedingArchiveRecordV1, { readonly trainerSheetSlug: unknown, readonly speciesId: unknown }>>(archive, 'species-acquisition')) database.connection.prepare(`
      INSERT INTO trainer_species_acquisitions (
        trainer_sheet_slug, species_id, first_acquired_at_campaign_minute,
        source_egg_id, operation_id, record_json, definition_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      acquisition.trainerSheetSlug, acquisition.speciesId,
      acquisition.firstAcquiredAtCampaignMinute, acquisition.sourceEggId,
      acquisition.operationId, stableJsonStringify(acquisition),
      acquisition.definitionSha256,
    )

    const clocks = recordsOf<BreedingCampaignClockArchiveRecordV1>(archive, 'campaign-clock')
    if (clocks.length !== 1) {
      throw new BreedingArchiveStateError(
        'breeding.archive.restore-records',
        'campaign-clock',
        'must contain exactly one authoritative campaign clock.',
      )
    }
    const clock = clocks[0]!
    database.connection.prepare(`
      UPDATE campaign_clock
      SET revision = ?, campaign_minute = ?, last_operation_id = ?
      WHERE singleton = 1
    `).run(clock.revision, clock.campaignMinute, clock.lastOperationId)
  }

  return Object.freeze({ database, readRecords, replaceWithCampaignBackup, hasCampaignAuthority, tableCounts })
}
