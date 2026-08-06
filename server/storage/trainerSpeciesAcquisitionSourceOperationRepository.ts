import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseBreedingOperationIdSyntax, type BreedingOperationId } from '#shared/breeding/ids'
import {
  parseBreedingSpeciesAcquisitionSourceSettlementV1,
  type BreedingSpeciesAcquisitionSourceSettlementV1,
} from '../domain/breeding/speciesAcquisitionIntegration'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  BreedingRepositoryCorruptionError,
  BreedingRepositoryIdentityCollisionError,
  assertBreedingStoredColumn,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryLimit,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'

interface SourceOperationRow {
  readonly operation_id: unknown
  readonly source_kind: unknown
  readonly source_event_id: unknown
  readonly trainer_sheet_slug: unknown
  readonly species_id: unknown
  readonly settled_at_campaign_minute: unknown
  readonly outcome: unknown
  readonly applied_reward_amount: unknown
  readonly record_json: unknown
  readonly definition_sha256: unknown
}
export type TrainerSpeciesAcquisitionSourceOperationInsertResult =
  | { readonly kind: 'inserted', readonly record: BreedingSpeciesAcquisitionSourceSettlementV1 }
  | { readonly kind: 'exact-replay', readonly record: BreedingSpeciesAcquisitionSourceSettlementV1 }
export interface TrainerSpeciesAcquisitionSourceOperationRepository {
  readonly database: RotomDatabase
  get(operationId: BreedingOperationId | string): BreedingSpeciesAcquisitionSourceSettlementV1 | null
  getBySourceEvent(sourceKind: string, sourceEventId: string): BreedingSpeciesAcquisitionSourceSettlementV1 | null
  listByTrainer(trainerSheetSlug: string, limit?: number): readonly BreedingSpeciesAcquisitionSourceSettlementV1[]
  insert(record: BreedingSpeciesAcquisitionSourceSettlementV1): TrainerSpeciesAcquisitionSourceOperationInsertResult
}
const TABLE = 'trainer_species_acquisition_source_operations'
const SELECT = `
  SELECT operation_id, source_kind, source_event_id, trainer_sheet_slug, species_id,
         settled_at_campaign_minute, outcome, applied_reward_amount,
         record_json, definition_sha256
  FROM trainer_species_acquisition_source_operations
`
const operationId = (value: unknown): BreedingOperationId => parseBreedingOperationIdSyntax(value)
  ?? (() => { throw new Error('operationId must be a typed Species acquisition operation ID.') })()
const trainerSlug = (value: unknown): string => typeof value === 'string' && /^[a-z0-9-]+$/.test(value) && value.length <= 160
  ? value : (() => { throw new Error('trainerSheetSlug must be a canonical bounded slug.') })()
const rowToRecord = (row: SourceOperationRow): BreedingSpeciesAcquisitionSourceSettlementV1 => {
  const id = operationId(row.operation_id)
  const record = parseStrictStoredBreedingJson({ table: TABLE, identity: id, json: row.record_json, parse: parseBreedingSpeciesAcquisitionSourceSettlementV1 })
  const minute = parseBreedingRepositoryCampaignMinute(row.settled_at_campaign_minute, `${TABLE}.${id}.settled_at_campaign_minute`)
  assertBreedingStoredColumn(record.evidence.operationId === id, TABLE, id, 'operation_id')
  assertBreedingStoredColumn(record.evidence.sourceKind === row.source_kind, TABLE, id, 'source_kind')
  assertBreedingStoredColumn(record.evidence.sourceEventId === row.source_event_id, TABLE, id, 'source_event_id')
  assertBreedingStoredColumn(record.evidence.trainerSheetSlug === row.trainer_sheet_slug, TABLE, id, 'trainer_sheet_slug')
  assertBreedingStoredColumn(record.evidence.speciesId === row.species_id, TABLE, id, 'species_id')
  assertBreedingStoredColumn(record.settledAtCampaignMinute === minute, TABLE, id, 'settled_at_campaign_minute')
  assertBreedingStoredColumn(record.outcome === row.outcome, TABLE, id, 'outcome')
  assertBreedingStoredColumn(record.appliedRewardAmount === row.applied_reward_amount, TABLE, id, 'applied_reward_amount')
  assertBreedingStoredColumn(record.definitionSha256 === row.definition_sha256, TABLE, id, 'definition_sha256')
  return record
}
export const createSqliteTrainerSpeciesAcquisitionSourceOperationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): TrainerSpeciesAcquisitionSourceOperationRepository => {
  const get = (operationInput: BreedingOperationId | string): BreedingSpeciesAcquisitionSourceSettlementV1 | null => {
    const id = operationId(operationInput)
    const row = database.connection.prepare(`${SELECT} WHERE operation_id = ?`).get(id) as unknown as SourceOperationRow | undefined
    return row ? rowToRecord(row) : null
  }
  const getBySourceEvent = (sourceKind: string, sourceEventId: string): BreedingSpeciesAcquisitionSourceSettlementV1 | null => {
    if (typeof sourceKind !== 'string' || typeof sourceEventId !== 'string') throw new Error('Source event lookup requires strings.')
    const row = database.connection.prepare(`${SELECT} WHERE source_kind = ? AND source_event_id = ?`).get(sourceKind, sourceEventId) as unknown as SourceOperationRow | undefined
    return row ? rowToRecord(row) : null
  }
  const listByTrainer = (trainerInput: string, limitInput?: number): readonly BreedingSpeciesAcquisitionSourceSettlementV1[] => {
    const trainer = trainerSlug(trainerInput); const limit = parseBreedingRepositoryLimit(limitInput)
    return Object.freeze((database.connection.prepare(`${SELECT} WHERE trainer_sheet_slug = ? ORDER BY settled_at_campaign_minute ASC, operation_id ASC LIMIT ?`).all(trainer, limit) as unknown as SourceOperationRow[]).map(rowToRecord))
  }
  const insert = (input: BreedingSpeciesAcquisitionSourceSettlementV1): TrainerSpeciesAcquisitionSourceOperationInsertResult => {
    const record = parseBreedingSpeciesAcquisitionSourceSettlementV1(input)
    const id = record.evidence.operationId
    const existing = get(id)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, record)) return Object.freeze({ kind: 'exact-replay', record: existing })
      throw new BreedingRepositoryIdentityCollisionError('Trainer Species acquisition source operation', id)
    }
    const existingEvent = getBySourceEvent(record.evidence.sourceKind, record.evidence.sourceEventId)
    if (existingEvent) {
      if (exactBreedingDocumentReplay(existingEvent, record)) return Object.freeze({ kind: 'exact-replay', record: existingEvent })
      throw new BreedingRepositoryIdentityCollisionError('Trainer Species acquisition source event', `${record.evidence.sourceKind}/${record.evidence.sourceEventId}`)
    }
    try {
      database.connection.prepare(`
        INSERT INTO trainer_species_acquisition_source_operations (
          operation_id, source_kind, source_event_id, trainer_sheet_slug, species_id,
          settled_at_campaign_minute, outcome, applied_reward_amount,
          record_json, definition_sha256
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, record.evidence.sourceKind, record.evidence.sourceEventId,
        record.evidence.trainerSheetSlug, record.evidence.speciesId,
        record.settledAtCampaignMinute, record.outcome, record.appliedRewardAmount,
        stableJsonStringify(record), record.definitionSha256,
      )
    }
    catch (error) {
      const raced = get(id)
      if (raced && exactBreedingDocumentReplay(raced, record)) return Object.freeze({ kind: 'exact-replay', record: raced })
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Trainer Species acquisition source operation', id)
      const racedEvent = getBySourceEvent(record.evidence.sourceKind, record.evidence.sourceEventId)
      if (racedEvent && exactBreedingDocumentReplay(racedEvent, record)) return Object.freeze({ kind: 'exact-replay', record: racedEvent })
      if (racedEvent) throw new BreedingRepositoryIdentityCollisionError('Trainer Species acquisition source event', `${record.evidence.sourceKind}/${record.evidence.sourceEventId}`)
      throw error
    }
    return Object.freeze({ kind: 'inserted', record: get(id) ?? (() => { throw new BreedingRepositoryCorruptionError(TABLE, id, 'inserted row readability') })() })
  }
  return Object.freeze({ database, get, getBySourceEvent, listByTrainer, insert })
}
