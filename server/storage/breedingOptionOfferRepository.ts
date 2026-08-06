import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseBreedingOfferIdSyntax, parseBreedingOfferOptionIdSyntax, parseBreedingProjectIdSyntax, type BreedingOfferId, type BreedingOfferOptionId, type BreedingProjectId } from '#shared/breeding/ids'
import type { BreedingOptionOfferRecordV1 } from '#shared/breeding/ledgers'
import { parseAuthoritativeBreedingOptionOfferRecordV1, validateBreedingOptionOfferSuccessor } from '../domain/breeding/ledgers'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  assertBreedingStoredColumn,
  BreedingRepositoryIdentityCollisionError,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryLimit,
  parseBreedingRepositoryRevision,
  parseStrictStoredBreedingJson,
  type BreedingRepositoryReplaceResult,
} from './breedingRepositorySupport'

interface OfferRow {
  readonly offer_id: unknown
  readonly document_json: unknown
  readonly definition_sha256: unknown
  readonly revision: unknown
  readonly status: unknown
  readonly choice_kind: unknown
  readonly target_kind: unknown
  readonly target_id: unknown
  readonly chooser_profile_id: unknown
  readonly issued_operation_id: unknown
  readonly settlement_operation_id: unknown
  readonly issued_at_campaign_minute: unknown
  readonly expires_at_campaign_minute: unknown
  readonly settled_at_campaign_minute: unknown
}
export interface BreedingOptionOfferRepository {
  readonly database: RotomDatabase
  get(offerId: BreedingOfferId | string): BreedingOptionOfferRecordV1 | null
  listByProject(projectId: BreedingProjectId | string, limit?: number): readonly BreedingOptionOfferRecordV1[]
  findByProjectOptionIds(input: { readonly projectId: BreedingProjectId | string, readonly optionIds: readonly (BreedingOfferOptionId | string)[] }): readonly BreedingOptionOfferRecordV1[]
  findByTargetOptionIds(input: { readonly targetKind: 'pokemon-egg' | 'pokemon-sheet' | 'trainer-sheet', readonly targetId: string, readonly optionIds: readonly (BreedingOfferOptionId | string)[] }): readonly BreedingOptionOfferRecordV1[]
  insert(record: BreedingOptionOfferRecordV1): BreedingOptionOfferRecordV1
  replace(input: { readonly expectedRevision: number, readonly record: BreedingOptionOfferRecordV1 }): BreedingRepositoryReplaceResult<BreedingOptionOfferRecordV1>
}
export class BreedingOptionOfferRepositoryTransactionError extends Error {
  constructor() {
    super('Breeding option-offer mutation requires a caller-owned SQLite transaction.')
    this.name = 'BreedingOptionOfferRepositoryTransactionError'
  }
}
const TABLE = 'breeding_option_offers'
const SELECT = `
  SELECT offer_id, document_json, definition_sha256, revision, status, choice_kind,
         target_kind, target_id, chooser_profile_id, issued_operation_id,
         settlement_operation_id, issued_at_campaign_minute, expires_at_campaign_minute,
         settled_at_campaign_minute
  FROM breeding_option_offers
`
const offerId = (value: unknown): BreedingOfferId => parseBreedingOfferIdSyntax(value)
  ?? (() => { throw new Error('offerId must be a Breeding offer ID.') })()
const projectId = (value: unknown): BreedingProjectId => parseBreedingProjectIdSyntax(value)
  ?? (() => { throw new Error('projectId must be a Breeding Project ID.') })()
const optionId = (value: unknown): BreedingOfferOptionId => parseBreedingOfferOptionIdSyntax(value)
  ?? (() => { throw new Error('optionId must be a Breeding offer-option ID.') })()
const targetParts = (record: BreedingOptionOfferRecordV1): readonly [string, string] => {
  if (record.target.kind === 'breeding-project') return ['breeding-project', record.target.projectId]
  if (record.target.kind === 'pokemon-egg') return ['pokemon-egg', record.target.eggId]
  if (record.target.kind === 'pokemon-sheet') return ['pokemon-sheet', record.target.sheetSlug]
  return ['trainer-sheet', record.target.sheetSlug]
}
const rowToOffer = (row: OfferRow): BreedingOptionOfferRecordV1 => {
  const identity = offerId(row.offer_id)
  const record = parseStrictStoredBreedingJson({ table: TABLE, identity, json: row.document_json, parse: parseAuthoritativeBreedingOptionOfferRecordV1 })
  const revision = parseBreedingRepositoryRevision(row.revision, `${TABLE}.${identity}.revision`)
  const issuedAt = parseBreedingRepositoryCampaignMinute(row.issued_at_campaign_minute, `${TABLE}.${identity}.issued_at_campaign_minute`)
  const expiresAt = row.expires_at_campaign_minute === null ? null : parseBreedingRepositoryCampaignMinute(row.expires_at_campaign_minute, `${TABLE}.${identity}.expires_at_campaign_minute`)
  const settledAt = row.settled_at_campaign_minute === null ? null : parseBreedingRepositoryCampaignMinute(row.settled_at_campaign_minute, `${TABLE}.${identity}.settled_at_campaign_minute`)
  const [targetKind, targetId] = targetParts(record)
  assertBreedingStoredColumn(record.offerId === identity, TABLE, identity, 'offer_id')
  assertBreedingStoredColumn(record.definitionSha256 === row.definition_sha256, TABLE, identity, 'definition_sha256')
  assertBreedingStoredColumn(record.revision === revision && record.status === row.status, TABLE, identity, 'revision/status')
  assertBreedingStoredColumn(record.choiceKind === row.choice_kind, TABLE, identity, 'choice_kind')
  assertBreedingStoredColumn(targetKind === row.target_kind && targetId === row.target_id, TABLE, identity, 'target')
  assertBreedingStoredColumn(record.chooserProfileId === row.chooser_profile_id, TABLE, identity, 'chooser_profile_id')
  assertBreedingStoredColumn(record.issuedOperationId === row.issued_operation_id && record.settlementOperationId === row.settlement_operation_id, TABLE, identity, 'operation IDs')
  assertBreedingStoredColumn(record.issuedAtCampaignMinute === issuedAt && record.expiresAtCampaignMinute === expiresAt && record.settledAtCampaignMinute === settledAt, TABLE, identity, 'campaign minutes')
  return record
}
const values = (record: BreedingOptionOfferRecordV1): readonly unknown[] => {
  const [targetKind, targetId] = targetParts(record)
  return [record.offerId, stableJsonStringify(record), record.definitionSha256, record.revision, record.status,
    record.choiceKind, targetKind, targetId, record.chooserProfileId, record.issuedOperationId,
    record.settlementOperationId, record.issuedAtCampaignMinute, record.expiresAtCampaignMinute,
    record.settledAtCampaignMinute]
}
export const createSqliteBreedingOptionOfferRepository = (
  database: RotomDatabase = getRotomDatabase(),
): BreedingOptionOfferRepository => {
  const get = (input: BreedingOfferId | string): BreedingOptionOfferRecordV1 | null => {
    const identity = offerId(input)
    const row = database.connection.prepare(`${SELECT} WHERE offer_id = ?`).get(identity) as unknown as OfferRow | undefined
    return row ? rowToOffer(row) : null
  }
  const listByProject = (input: BreedingProjectId | string, limitInput?: number): readonly BreedingOptionOfferRecordV1[] => {
    const identity = projectId(input); const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT} WHERE target_kind = 'breeding-project' AND target_id = ? ORDER BY choice_kind, offer_id LIMIT ?`).all(identity, limit) as unknown as OfferRow[]).map(rowToOffer)
  }
  const findByProjectOptionIds: BreedingOptionOfferRepository['findByProjectOptionIds'] = input => {
    const identity = projectId(input.projectId)
    if (!Array.isArray(input.optionIds) || Object.getPrototypeOf(input.optionIds) !== Array.prototype
      || input.optionIds.length > 6 || Object.getOwnPropertySymbols(input.optionIds).length > 0
      || Object.getOwnPropertyNames(input.optionIds).length !== input.optionIds.length + 1) {
      throw new Error('optionIds must be one plain array of at most six offer-option IDs.')
    }
    const optionIds = input.optionIds.map(optionId)
    if (new Set(optionIds).size !== optionIds.length) throw new Error('optionIds must be unique.')
    if (optionIds.length === 0) return Object.freeze([])
    const placeholders = optionIds.map(() => '?').join(', ')
    const rows = database.connection.prepare(`
      ${SELECT}
      WHERE target_kind = 'breeding-project' AND target_id = ?
        AND EXISTS (
          SELECT 1 FROM json_each(breeding_option_offers.document_json, '$.options') AS option
          WHERE json_extract(option.value, '$.optionId') IN (${placeholders})
        )
      ORDER BY choice_kind, offer_id
      LIMIT 13
    `).all(identity, ...optionIds) as unknown as OfferRow[]
    if (rows.length > 12) throw new Error('Selected offer-option lookup exceeded the closed ambiguity bound.')
    return Object.freeze(rows.map(rowToOffer))
  }
  const findByTargetOptionIds: BreedingOptionOfferRepository['findByTargetOptionIds'] = input => {
    if (!['pokemon-egg', 'pokemon-sheet', 'trainer-sheet'].includes(input.targetKind)
      || typeof input.targetId !== 'string' || input.targetId.length < 1 || input.targetId.length > 160
      || !Array.isArray(input.optionIds) || Object.getPrototypeOf(input.optionIds) !== Array.prototype
      || input.optionIds.length > 9 || Object.getOwnPropertySymbols(input.optionIds).length > 0
      || Object.getOwnPropertyNames(input.optionIds).length !== input.optionIds.length + 1) {
      throw new Error('Target option lookup must use one bounded target and at most nine plain option IDs.')
    }
    const optionIds = input.optionIds.map(optionId)
    if (new Set(optionIds).size !== optionIds.length) throw new Error('optionIds must be unique.')
    if (optionIds.length === 0) return Object.freeze([])
    const placeholders = optionIds.map(() => '?').join(', ')
    const rows = database.connection.prepare(`
      ${SELECT}
      WHERE target_kind = ? AND target_id = ?
        AND EXISTS (
          SELECT 1 FROM json_each(breeding_option_offers.document_json, '$.options') AS option
          WHERE json_extract(option.value, '$.optionId') IN (${placeholders})
        )
      ORDER BY choice_kind, offer_id
      LIMIT 19
    `).all(input.targetKind, input.targetId, ...optionIds) as unknown as OfferRow[]
    if (rows.length > 18) throw new Error('Selected target offer-option lookup exceeded the closed ambiguity bound.')
    return Object.freeze(rows.map(rowToOffer))
  }
  const insert = (input: BreedingOptionOfferRecordV1): BreedingOptionOfferRecordV1 => {
    if (!database.connection.isTransaction) throw new BreedingOptionOfferRepositoryTransactionError()
    const record = parseAuthoritativeBreedingOptionOfferRecordV1(input)
    if (record.revision !== 0 || record.status !== 'active') throw new BreedingRepositoryIdentityCollisionError('Breeding option offer initial state', record.offerId)
    const existing = get(record.offerId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, record)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Breeding option offer', record.offerId)
    }
    try {
      database.connection.prepare(`
        INSERT INTO breeding_option_offers (
          offer_id, document_json, definition_sha256, revision, status, choice_kind,
          target_kind, target_id, chooser_profile_id, issued_operation_id,
          settlement_operation_id, issued_at_campaign_minute, expires_at_campaign_minute,
          settled_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(...values(record))
    }
    catch (error) {
      const raced = get(record.offerId)
      if (raced && exactBreedingDocumentReplay(raced, record)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Breeding option offer', record.offerId)
      throw error
    }
    return get(record.offerId) ?? (() => { throw new Error('Inserted Breeding option offer was not readable.') })()
  }
  const replace: BreedingOptionOfferRepository['replace'] = input => {
    if (!database.connection.isTransaction) throw new BreedingOptionOfferRepositoryTransactionError()
    const expectedRevision = parseBreedingRepositoryRevision(input.expectedRevision, 'expectedRevision')
    const proposed = parseAuthoritativeBreedingOptionOfferRecordV1(input.record)
    const current = get(proposed.offerId)
    if (!current) return Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
    if (current.revision !== expectedRevision) return Object.freeze({ kind: 'stale', expectedRevision, currentRevision: current.revision })
    const record = validateBreedingOptionOfferSuccessor(current, proposed)
    const [targetKind, targetId] = targetParts(record)
    const result = database.connection.prepare(`
      UPDATE breeding_option_offers SET
        document_json=?, definition_sha256=?, revision=?, status=?, choice_kind=?, target_kind=?, target_id=?,
        chooser_profile_id=?, issued_operation_id=?, settlement_operation_id=?, issued_at_campaign_minute=?,
        expires_at_campaign_minute=?, settled_at_campaign_minute=?
      WHERE offer_id=? AND revision=?
    `).run(stableJsonStringify(record), record.definitionSha256, record.revision, record.status, record.choiceKind,
      targetKind, targetId, record.chooserProfileId, record.issuedOperationId, record.settlementOperationId,
      record.issuedAtCampaignMinute, record.expiresAtCampaignMinute, record.settledAtCampaignMinute,
      record.offerId, expectedRevision)
    if (Number(result.changes) === 1) return Object.freeze({ kind: 'applied', document: record })
    const raced = get(record.offerId)
    return raced ? Object.freeze({ kind: 'stale', expectedRevision, currentRevision: raced.revision }) : Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
  }
  return Object.freeze({ database, get, listByProject, findByProjectOptionIds, findByTargetOptionIds, insert, replace })
}
