import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  parseBreedingAdjudicationIdSyntax,
  parsePokemonEggIdSyntax,
  type BreedingAdjudicationId,
  type PokemonEggId,
} from '#shared/breeding/ids'
import type { BreedingGmAdjudicationRecordV1 } from '#shared/breeding/ledgers'
import {
  parseAuthoritativeBreedingGmAdjudicationRecordV1,
  validateBreedingGmAdjudicationSuccessor,
} from '../domain/breeding/ledgers'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  assertBreedingStoredColumn,
  BreedingRepositoryCorruptionError,
  BreedingRepositoryIdentityCollisionError,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryRevision,
  parseStrictStoredBreedingJson,
  type BreedingRepositoryReplaceResult,
} from './breedingRepositorySupport'

interface AdjudicationRow {
  readonly adjudication_id: unknown
  readonly document_json: unknown
  readonly definition_sha256: unknown
  readonly revision: unknown
  readonly status: unknown
  readonly adjudication_kind: unknown
  readonly target_kind: unknown
  readonly target_id: unknown
  readonly offer_id: unknown
  readonly created_operation_id: unknown
  readonly settlement_operation_id: unknown
  readonly created_at_campaign_minute: unknown
  readonly settled_at_campaign_minute: unknown
}
export interface BreedingGmAdjudicationRepository {
  readonly database: RotomDatabase
  get(adjudicationId: BreedingAdjudicationId | string): BreedingGmAdjudicationRecordV1 | null
  listHatchSpecialByEgg(eggId: PokemonEggId | string): readonly BreedingGmAdjudicationRecordV1[]
  insert(record: BreedingGmAdjudicationRecordV1): BreedingGmAdjudicationRecordV1
  replace(input: { readonly expectedRevision: number, readonly record: BreedingGmAdjudicationRecordV1 }): BreedingRepositoryReplaceResult<BreedingGmAdjudicationRecordV1>
}
export class BreedingGmAdjudicationRepositoryTransactionError extends Error {
  constructor() {
    super('Breeding GM-adjudication mutation requires a caller-owned SQLite transaction.')
    this.name = 'BreedingGmAdjudicationRepositoryTransactionError'
  }
}
const TABLE = 'breeding_gm_adjudications'
const SELECT = `
  SELECT adjudication_id, document_json, definition_sha256, revision, status,
         adjudication_kind, target_kind, target_id, offer_id, created_operation_id,
         settlement_operation_id, created_at_campaign_minute, settled_at_campaign_minute
  FROM breeding_gm_adjudications
`
const adjudicationId = (value: unknown): BreedingAdjudicationId => parseBreedingAdjudicationIdSyntax(value)
  ?? (() => { throw new Error('adjudicationId must be a Breeding adjudication ID.') })()
const eggId = (value: unknown): PokemonEggId => parsePokemonEggIdSyntax(value)
  ?? (() => { throw new Error('eggId must be a Pokémon Egg ID.') })()
const targetParts = (record: BreedingGmAdjudicationRecordV1): readonly [string, string] => {
  if (record.target.kind === 'breeding-project') return ['breeding-project', record.target.projectId]
  if (record.target.kind === 'pokemon-egg') return ['pokemon-egg', record.target.eggId]
  if (record.target.kind === 'pokemon-sheet') return ['pokemon-sheet', record.target.sheetSlug]
  return ['trainer-sheet', record.target.sheetSlug]
}
const rowToRecord = (row: AdjudicationRow): BreedingGmAdjudicationRecordV1 => {
  const identity = adjudicationId(row.adjudication_id)
  const record = parseStrictStoredBreedingJson({
    table: TABLE,
    identity,
    json: row.document_json,
    parse: parseAuthoritativeBreedingGmAdjudicationRecordV1,
  })
  const revision = parseBreedingRepositoryRevision(row.revision, `${TABLE}.${identity}.revision`)
  const createdAt = parseBreedingRepositoryCampaignMinute(row.created_at_campaign_minute, `${TABLE}.${identity}.created_at_campaign_minute`)
  const settledAt = row.settled_at_campaign_minute === null ? null
    : parseBreedingRepositoryCampaignMinute(row.settled_at_campaign_minute, `${TABLE}.${identity}.settled_at_campaign_minute`)
  const [targetKind, targetId] = targetParts(record)
  assertBreedingStoredColumn(record.adjudicationId === identity, TABLE, identity, 'adjudication_id')
  assertBreedingStoredColumn(record.definitionSha256 === row.definition_sha256, TABLE, identity, 'definition_sha256')
  assertBreedingStoredColumn(record.revision === revision && record.status === row.status, TABLE, identity, 'revision/status')
  assertBreedingStoredColumn(record.adjudicationKind === row.adjudication_kind, TABLE, identity, 'adjudication_kind')
  assertBreedingStoredColumn(targetKind === row.target_kind && targetId === row.target_id, TABLE, identity, 'target')
  assertBreedingStoredColumn(record.offerId === row.offer_id, TABLE, identity, 'offer_id')
  assertBreedingStoredColumn(record.createdOperationId === row.created_operation_id
    && record.settlementOperationId === row.settlement_operation_id, TABLE, identity, 'operation IDs')
  assertBreedingStoredColumn(record.createdAtCampaignMinute === createdAt
    && record.settledAtCampaignMinute === settledAt, TABLE, identity, 'campaign minutes')
  return record
}
const values = (record: BreedingGmAdjudicationRecordV1): readonly (string | number | null)[] => {
  const [targetKind, targetId] = targetParts(record)
  return [record.adjudicationId, stableJsonStringify(record), record.definitionSha256, record.revision,
    record.status, record.adjudicationKind, targetKind, targetId, record.offerId,
    record.createdOperationId, record.settlementOperationId, record.createdAtCampaignMinute,
    record.settledAtCampaignMinute]
}
export const createSqliteBreedingGmAdjudicationRepository = (
  database: RotomDatabase = getRotomDatabase(),
): BreedingGmAdjudicationRepository => {
  const get = (input: BreedingAdjudicationId | string): BreedingGmAdjudicationRecordV1 | null => {
    const identity = adjudicationId(input)
    const row = database.connection.prepare(`${SELECT} WHERE adjudication_id = ?`).get(identity) as unknown as AdjudicationRow | undefined
    return row ? rowToRecord(row) : null
  }
  const listHatchSpecialByEgg = (input: PokemonEggId | string): readonly BreedingGmAdjudicationRecordV1[] => {
    const identity = eggId(input)
    const rows = database.connection.prepare(`${SELECT}
      WHERE adjudication_kind = 'hatch-special-result'
        AND target_kind = 'pokemon-egg' AND target_id = ?
      ORDER BY adjudication_id
      LIMIT 3
    `).all(identity) as unknown as AdjudicationRow[]
    if (rows.length > 1) {
      throw new BreedingRepositoryCorruptionError(TABLE, identity, 'at most one hatch-special adjudication per Egg')
    }
    return Object.freeze(rows.map(rowToRecord))
  }
  const insert = (input: BreedingGmAdjudicationRecordV1): BreedingGmAdjudicationRecordV1 => {
    if (!database.connection.isTransaction) throw new BreedingGmAdjudicationRepositoryTransactionError()
    const record = parseAuthoritativeBreedingGmAdjudicationRecordV1(input)
    if (record.revision !== 0 || record.status !== 'pending') {
      throw new BreedingRepositoryIdentityCollisionError('Breeding GM adjudication initial state', record.adjudicationId)
    }
    const existing = get(record.adjudicationId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, record)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Breeding GM adjudication', record.adjudicationId)
    }
    if (record.adjudicationKind === 'hatch-special-result' && record.target.kind === 'pokemon-egg') {
      const current = listHatchSpecialByEgg(record.target.eggId)[0]
      if (current) throw new BreedingRepositoryIdentityCollisionError('Egg hatch-special adjudication', record.target.eggId)
    }
    try {
      database.connection.prepare(`
        INSERT INTO breeding_gm_adjudications (
          adjudication_id, document_json, definition_sha256, revision, status,
          adjudication_kind, target_kind, target_id, offer_id, created_operation_id,
          settlement_operation_id, created_at_campaign_minute, settled_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...values(record))
    }
    catch (error) {
      const raced = get(record.adjudicationId)
      if (raced && exactBreedingDocumentReplay(raced, record)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Breeding GM adjudication', record.adjudicationId)
      throw error
    }
    return get(record.adjudicationId) ?? (() => { throw new Error('Inserted Breeding GM adjudication was not readable.') })()
  }
  const replace: BreedingGmAdjudicationRepository['replace'] = input => {
    if (!database.connection.isTransaction) throw new BreedingGmAdjudicationRepositoryTransactionError()
    const expectedRevision = parseBreedingRepositoryRevision(input.expectedRevision, 'expectedRevision')
    const proposed = parseAuthoritativeBreedingGmAdjudicationRecordV1(input.record)
    const current = get(proposed.adjudicationId)
    if (!current) return Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
    if (current.revision !== expectedRevision) return Object.freeze({ kind: 'stale', expectedRevision, currentRevision: current.revision })
    const record = validateBreedingGmAdjudicationSuccessor(current, proposed)
    const [targetKind, targetId] = targetParts(record)
    const result = database.connection.prepare(`
      UPDATE breeding_gm_adjudications SET
        document_json=?, definition_sha256=?, revision=?, status=?, adjudication_kind=?,
        target_kind=?, target_id=?, offer_id=?, created_operation_id=?, settlement_operation_id=?,
        created_at_campaign_minute=?, settled_at_campaign_minute=?
      WHERE adjudication_id=? AND revision=?
    `).run(stableJsonStringify(record), record.definitionSha256, record.revision, record.status,
      record.adjudicationKind, targetKind, targetId, record.offerId, record.createdOperationId,
      record.settlementOperationId, record.createdAtCampaignMinute, record.settledAtCampaignMinute,
      record.adjudicationId, expectedRevision)
    if (Number(result.changes) === 1) return Object.freeze({ kind: 'applied', document: record })
    const raced = get(record.adjudicationId)
    return raced ? Object.freeze({ kind: 'stale', expectedRevision, currentRevision: raced.revision })
      : Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
  }
  return Object.freeze({ database, get, listHatchSpecialByEgg, insert, replace })
}
