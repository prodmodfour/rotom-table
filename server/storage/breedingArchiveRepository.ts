import { stableJsonStringify } from '#shared/automation/stableJson'
import type {
  BreedingArchiveImportRequestV1,
  BreedingArchivePurpose,
  BreedingArchiveRestoreReceiptV1,
  BreedingArchiveV1,
} from '#shared/breeding/archives'
import {
  parseBreedingArchiveIdSyntax,
  parseBreedingArchiveRequestIdSyntax,
  type BreedingArchiveId,
  type BreedingArchiveRequestId,
} from '#shared/breeding/ids'
import {
  assertBreedingArchiveExactReplayV1,
  assertBreedingArchiveImportRequestExactReplayV1,
  assertBreedingArchiveRestoreReceiptExactReplayV1,
  parseAuthoritativeBreedingArchiveImportRequestV1,
  parseAuthoritativeBreedingArchiveRestoreReceiptV1,
  parseAuthoritativeBreedingArchiveV1,
} from '../domain/breeding/archives'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  BreedingRepositoryCorruptionError,
  BreedingRepositoryIdentityCollisionError,
  assertBreedingStoredColumn,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryLimit,
  parseStrictStoredBreedingJson,
} from './breedingRepositorySupport'

export interface StoredBreedingArchiveSummary {
  readonly archiveId: BreedingArchiveId
  readonly purpose: BreedingArchivePurpose
  readonly campaignIdentitySha256: string
  readonly createdAtCampaignMinute: number
  readonly archiveDefinitionSha256: string
}

export type BreedingArchiveRepositoryInsertResult<Value> =
  | { readonly kind: 'inserted', readonly value: Value }
  | { readonly kind: 'exact-replay', readonly value: Value }

export interface BreedingArchiveRepository {
  readonly database: RotomDatabase
  getArchive(archiveId: BreedingArchiveId | string): BreedingArchiveV1 | null
  listArchiveSummaries(campaignIdentitySha256: string, limit?: number): readonly StoredBreedingArchiveSummary[]
  insertArchive(archive: unknown): BreedingArchiveRepositoryInsertResult<BreedingArchiveV1>
  getImportRequest(requestId: BreedingArchiveRequestId | string): BreedingArchiveImportRequestV1 | null
  insertImportRequest(request: unknown): BreedingArchiveRepositoryInsertResult<BreedingArchiveImportRequestV1>
  getRestoreReceipt(requestId: BreedingArchiveRequestId | string): BreedingArchiveRestoreReceiptV1 | null
  insertRestoreReceipt(receipt: unknown): BreedingArchiveRepositoryInsertResult<BreedingArchiveRestoreReceiptV1>
}

interface ArchiveRow {
  readonly archive_id: unknown
  readonly purpose: unknown
  readonly campaign_identity_sha256: unknown
  readonly created_at_campaign_minute: unknown
  readonly archive_json: unknown
  readonly archive_definition_sha256: unknown
}
interface RequestRow {
  readonly request_id: unknown
  readonly archive_id: unknown
  readonly mode: unknown
  readonly target_campaign_identity_sha256: unknown
  readonly request_json: unknown
  readonly definition_sha256: unknown
  readonly requested_at_campaign_minute: unknown
}
interface ReceiptRow {
  readonly request_id: unknown
  readonly archive_id: unknown
  readonly accepted: unknown
  readonly reason_id: unknown
  readonly receipt_json: unknown
  readonly definition_sha256: unknown
  readonly committed_at_campaign_minute: unknown
}

const ARCHIVE_TABLE = 'breeding_archives'
const REQUEST_TABLE = 'breeding_archive_import_requests'
const RECEIPT_TABLE = 'breeding_archive_restore_receipts'
const SHA256 = /^[0-9a-f]{64}$/u

const archiveId = (value: unknown): BreedingArchiveId => parseBreedingArchiveIdSyntax(value)
  ?? (() => { throw new Error('archiveId must be a Breeding archive ID.') })()
const requestId = (value: unknown): BreedingArchiveRequestId => parseBreedingArchiveRequestIdSyntax(value)
  ?? (() => { throw new Error('requestId must be a Breeding archive request ID.') })()
const hash = (value: unknown, label: string): string => typeof value === 'string' && SHA256.test(value)
  ? value
  : (() => { throw new Error(`${label} must be a lowercase SHA-256 digest.`) })()

const archiveFromRow = (row: ArchiveRow): BreedingArchiveV1 => {
  const identity = archiveId(row.archive_id)
  const archive = parseStrictStoredBreedingJson({
    table: ARCHIVE_TABLE,
    identity,
    json: row.archive_json,
    parse: parseAuthoritativeBreedingArchiveV1,
  })
  const created = parseBreedingRepositoryCampaignMinute(
    row.created_at_campaign_minute,
    `${ARCHIVE_TABLE}.${identity}.created_at_campaign_minute`,
  )
  assertBreedingStoredColumn(archive.archiveId === identity, ARCHIVE_TABLE, identity, 'archive_id')
  assertBreedingStoredColumn(archive.purpose === row.purpose, ARCHIVE_TABLE, identity, 'purpose')
  assertBreedingStoredColumn(archive.campaignIdentitySha256 === row.campaign_identity_sha256, ARCHIVE_TABLE, identity, 'campaign_identity_sha256')
  assertBreedingStoredColumn(archive.createdAtCampaignMinute === created, ARCHIVE_TABLE, identity, 'created_at_campaign_minute')
  assertBreedingStoredColumn(archive.archiveDefinitionSha256 === row.archive_definition_sha256, ARCHIVE_TABLE, identity, 'archive_definition_sha256')
  return archive
}

const requestFromRow = (row: RequestRow): BreedingArchiveImportRequestV1 => {
  const identity = requestId(row.request_id)
  const request = parseStrictStoredBreedingJson({
    table: REQUEST_TABLE,
    identity,
    json: row.request_json,
    parse: parseAuthoritativeBreedingArchiveImportRequestV1,
  })
  const requested = parseBreedingRepositoryCampaignMinute(
    row.requested_at_campaign_minute,
    `${REQUEST_TABLE}.${identity}.requested_at_campaign_minute`,
  )
  assertBreedingStoredColumn(request.requestId === identity, REQUEST_TABLE, identity, 'request_id')
  assertBreedingStoredColumn(request.archiveId === row.archive_id, REQUEST_TABLE, identity, 'archive_id')
  assertBreedingStoredColumn(request.mode === row.mode, REQUEST_TABLE, identity, 'mode')
  assertBreedingStoredColumn(request.targetCampaignIdentitySha256 === row.target_campaign_identity_sha256, REQUEST_TABLE, identity, 'target_campaign_identity_sha256')
  assertBreedingStoredColumn(request.definitionSha256 === row.definition_sha256, REQUEST_TABLE, identity, 'definition_sha256')
  assertBreedingStoredColumn(request.requestedAtCampaignMinute === requested, REQUEST_TABLE, identity, 'requested_at_campaign_minute')
  return request
}

const receiptFromRow = (row: ReceiptRow): BreedingArchiveRestoreReceiptV1 => {
  const identity = requestId(row.request_id)
  const receipt = parseStrictStoredBreedingJson({
    table: RECEIPT_TABLE,
    identity,
    json: row.receipt_json,
    parse: parseAuthoritativeBreedingArchiveRestoreReceiptV1,
  })
  const committed = row.committed_at_campaign_minute === null
    ? null
    : parseBreedingRepositoryCampaignMinute(
        row.committed_at_campaign_minute,
        `${RECEIPT_TABLE}.${identity}.committed_at_campaign_minute`,
      )
  assertBreedingStoredColumn(receipt.requestId === identity, RECEIPT_TABLE, identity, 'request_id')
  assertBreedingStoredColumn(receipt.archiveId === row.archive_id, RECEIPT_TABLE, identity, 'archive_id')
  assertBreedingStoredColumn(Number(receipt.accepted) === Number(row.accepted), RECEIPT_TABLE, identity, 'accepted')
  assertBreedingStoredColumn(receipt.reasonId === row.reason_id, RECEIPT_TABLE, identity, 'reason_id')
  assertBreedingStoredColumn(receipt.definitionSha256 === row.definition_sha256, RECEIPT_TABLE, identity, 'definition_sha256')
  assertBreedingStoredColumn(receipt.committedAtCampaignMinute === committed, RECEIPT_TABLE, identity, 'committed_at_campaign_minute')
  return receipt
}

const archiveSelect = `
  SELECT archive_id, purpose, campaign_identity_sha256, created_at_campaign_minute,
         archive_json, archive_definition_sha256
  FROM breeding_archives
`
const requestSelect = `
  SELECT request_id, archive_id, mode, target_campaign_identity_sha256,
         request_json, definition_sha256, requested_at_campaign_minute
  FROM breeding_archive_import_requests
`
const receiptSelect = `
  SELECT request_id, archive_id, accepted, reason_id, receipt_json,
         definition_sha256, committed_at_campaign_minute
  FROM breeding_archive_restore_receipts
`

export const createSqliteBreedingArchiveRepository = (
  database: RotomDatabase = getRotomDatabase(),
): BreedingArchiveRepository => {
  const getArchive = (identityInput: BreedingArchiveId | string): BreedingArchiveV1 | null => {
    const identity = archiveId(identityInput)
    const row = database.connection.prepare(`${archiveSelect} WHERE archive_id = ?`).get(identity) as ArchiveRow | undefined
    return row ? archiveFromRow(row) : null
  }
  const listArchiveSummaries = (
    campaignIdentityInput: string,
    limitInput?: number,
  ): readonly StoredBreedingArchiveSummary[] => {
    const campaignIdentitySha256 = hash(campaignIdentityInput, 'campaignIdentitySha256')
    const limit = parseBreedingRepositoryLimit(limitInput)
    const rows = database.connection.prepare(`
      ${archiveSelect}
      WHERE campaign_identity_sha256 = ?
      ORDER BY created_at_campaign_minute DESC, archive_id ASC
      LIMIT ?
    `).all(campaignIdentitySha256, limit) as unknown as ArchiveRow[]
    return Object.freeze(rows.map(row => {
      const archive = archiveFromRow(row)
      return Object.freeze({
        archiveId: archive.archiveId,
        purpose: archive.purpose,
        campaignIdentitySha256: archive.campaignIdentitySha256,
        createdAtCampaignMinute: archive.createdAtCampaignMinute,
        archiveDefinitionSha256: archive.archiveDefinitionSha256,
      })
    }))
  }
  const insertArchive = (input: unknown): BreedingArchiveRepositoryInsertResult<BreedingArchiveV1> => {
    const archive = parseAuthoritativeBreedingArchiveV1(input)
    const existing = getArchive(archive.archiveId)
    if (existing) {
      try {
        return Object.freeze({ kind: 'exact-replay' as const, value: assertBreedingArchiveExactReplayV1(existing, archive) })
      }
      catch { throw new BreedingRepositoryIdentityCollisionError('Breeding archive', archive.archiveId) }
    }
    try {
      database.connection.prepare(`
        INSERT INTO breeding_archives (
          archive_id, purpose, campaign_identity_sha256, created_at_campaign_minute,
          archive_json, archive_definition_sha256
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        archive.archiveId,
        archive.purpose,
        archive.campaignIdentitySha256,
        archive.createdAtCampaignMinute,
        stableJsonStringify(archive),
        archive.archiveDefinitionSha256,
      )
    }
    catch (error) {
      const raced = getArchive(archive.archiveId)
      if (raced) {
        try {
          return Object.freeze({ kind: 'exact-replay' as const, value: assertBreedingArchiveExactReplayV1(raced, archive) })
        }
        catch { throw new BreedingRepositoryIdentityCollisionError('Breeding archive', archive.archiveId) }
      }
      throw error
    }
    return Object.freeze({ kind: 'inserted' as const, value: getArchive(archive.archiveId)
      ?? (() => { throw new BreedingRepositoryCorruptionError(ARCHIVE_TABLE, archive.archiveId, 'insert visibility') })() })
  }
  const getImportRequest = (
    identityInput: BreedingArchiveRequestId | string,
  ): BreedingArchiveImportRequestV1 | null => {
    const identity = requestId(identityInput)
    const row = database.connection.prepare(`${requestSelect} WHERE request_id = ?`).get(identity) as RequestRow | undefined
    return row ? requestFromRow(row) : null
  }
  const insertImportRequest = (
    input: unknown,
  ): BreedingArchiveRepositoryInsertResult<BreedingArchiveImportRequestV1> => {
    const request = parseAuthoritativeBreedingArchiveImportRequestV1(input)
    const existing = getImportRequest(request.requestId)
    if (existing) {
      try {
        return Object.freeze({ kind: 'exact-replay' as const, value: assertBreedingArchiveImportRequestExactReplayV1(existing, request) })
      }
      catch { throw new BreedingRepositoryIdentityCollisionError('Breeding archive import request', request.requestId) }
    }
    try {
      database.connection.prepare(`
        INSERT INTO breeding_archive_import_requests (
          request_id, archive_id, mode, target_campaign_identity_sha256,
          request_json, definition_sha256, requested_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        request.requestId,
        request.archiveId,
        request.mode,
        request.targetCampaignIdentitySha256,
        stableJsonStringify(request),
        request.definitionSha256,
        request.requestedAtCampaignMinute,
      )
    }
    catch (error) {
      const raced = getImportRequest(request.requestId)
      if (raced) {
        try {
          return Object.freeze({ kind: 'exact-replay' as const, value: assertBreedingArchiveImportRequestExactReplayV1(raced, request) })
        }
        catch { throw new BreedingRepositoryIdentityCollisionError('Breeding archive import request', request.requestId) }
      }
      throw error
    }
    return Object.freeze({ kind: 'inserted' as const, value: getImportRequest(request.requestId)
      ?? (() => { throw new BreedingRepositoryCorruptionError(REQUEST_TABLE, request.requestId, 'insert visibility') })() })
  }
  const getRestoreReceipt = (
    identityInput: BreedingArchiveRequestId | string,
  ): BreedingArchiveRestoreReceiptV1 | null => {
    const identity = requestId(identityInput)
    const row = database.connection.prepare(`${receiptSelect} WHERE request_id = ?`).get(identity) as ReceiptRow | undefined
    return row ? receiptFromRow(row) : null
  }
  const insertRestoreReceipt = (
    input: unknown,
  ): BreedingArchiveRepositoryInsertResult<BreedingArchiveRestoreReceiptV1> => {
    const receipt = parseAuthoritativeBreedingArchiveRestoreReceiptV1(input)
    const existing = getRestoreReceipt(receipt.requestId)
    if (existing) {
      try {
        return Object.freeze({ kind: 'exact-replay' as const, value: assertBreedingArchiveRestoreReceiptExactReplayV1(existing, receipt) })
      }
      catch { throw new BreedingRepositoryIdentityCollisionError('Breeding archive restore receipt', receipt.requestId) }
    }
    try {
      database.connection.prepare(`
        INSERT INTO breeding_archive_restore_receipts (
          request_id, archive_id, accepted, reason_id, receipt_json,
          definition_sha256, committed_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        receipt.requestId,
        receipt.archiveId,
        Number(receipt.accepted),
        receipt.reasonId,
        stableJsonStringify(receipt),
        receipt.definitionSha256,
        receipt.committedAtCampaignMinute,
      )
    }
    catch (error) {
      const raced = getRestoreReceipt(receipt.requestId)
      if (raced) {
        try {
          return Object.freeze({ kind: 'exact-replay' as const, value: assertBreedingArchiveRestoreReceiptExactReplayV1(raced, receipt) })
        }
        catch { throw new BreedingRepositoryIdentityCollisionError('Breeding archive restore receipt', receipt.requestId) }
      }
      throw error
    }
    return Object.freeze({ kind: 'inserted' as const, value: getRestoreReceipt(receipt.requestId)
      ?? (() => { throw new BreedingRepositoryCorruptionError(RECEIPT_TABLE, receipt.requestId, 'insert visibility') })() })
  }

  return Object.freeze({
    database,
    getArchive,
    listArchiveSummaries,
    insertArchive,
    getImportRequest,
    insertImportRequest,
    getRestoreReceipt,
    insertRestoreReceipt,
  })
}
