import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseBreedingConsentIdSyntax, parseBreedingProjectIdSyntax, type BreedingConsentId, type BreedingProjectId } from '#shared/breeding/ids'
import { type BreedingConsentRecordV1 } from '#shared/breeding/ledgers'
import { isSlug } from '#shared/paths'
import { parseAuthoritativeBreedingConsentRecordV1, validateBreedingConsentSuccessor } from '../domain/breeding/ledgers'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  BreedingRepositoryIdentityCollisionError,
  assertBreedingStoredColumn,
  exactBreedingDocumentReplay,
  parseBreedingRepositoryCampaignMinute,
  parseBreedingRepositoryLimit,
  parseBreedingRepositoryRevision,
  parseStrictStoredBreedingJson,
  type BreedingRepositoryReplaceResult,
} from './breedingRepositorySupport'

interface BreedingConsentRow {
  readonly consent_id: unknown
  readonly document_json: unknown
  readonly definition_sha256: unknown
  readonly revision: unknown
  readonly status: unknown
  readonly project_id: unknown
  readonly parent_sheet_slug: unknown
  readonly parent_sheet_revision: unknown
  readonly owner_trainer_slug: unknown
  readonly consenting_profile_id: unknown
  readonly expires_at_campaign_minute: unknown
  readonly grant_operation_id: unknown
  readonly settlement_operation_id: unknown
  readonly granted_at_campaign_minute: unknown
  readonly settled_at_campaign_minute: unknown
}
export interface BreedingConsentRepository {
  readonly database: RotomDatabase
  get(consentId: BreedingConsentId | string): BreedingConsentRecordV1 | null
  listByProject(projectId: BreedingProjectId | string, limit?: number): readonly BreedingConsentRecordV1[]
  listCurrentlyUsableByProfile(profileId: string, atCampaignMinute: number, limit?: number): readonly BreedingConsentRecordV1[]
  findActiveForParent(projectId: BreedingProjectId | string, parentSheetSlug: string): BreedingConsentRecordV1 | null
  insert(record: BreedingConsentRecordV1): BreedingConsentRecordV1
  replace(input: { readonly expectedRevision: number, readonly record: BreedingConsentRecordV1 }): BreedingRepositoryReplaceResult<BreedingConsentRecordV1>
}
const TABLE = 'breeding_consents'
const SELECT = `
  SELECT consent_id, document_json, definition_sha256, revision, status, project_id,
         parent_sheet_slug, parent_sheet_revision, owner_trainer_slug, consenting_profile_id,
         expires_at_campaign_minute, grant_operation_id, settlement_operation_id,
         granted_at_campaign_minute, settled_at_campaign_minute
  FROM breeding_consents
`
const consentId = (value: unknown): BreedingConsentId => parseBreedingConsentIdSyntax(value) ?? (() => { throw new Error('consentId must be a breeding consent ID.') })()
const projectId = (value: unknown): BreedingProjectId => parseBreedingProjectIdSyntax(value) ?? (() => { throw new Error('projectId must be a breeding project ID.') })()
const slug = (value: unknown, label: string): string => isSlug(value) && value.length <= 160 ? value : (() => { throw new Error(`${label} must be a canonical bounded sheet slug.`) })()
const profileId = (value: unknown): string => typeof value === 'string' && /^profile_[A-Za-z0-9_-]{8,64}$/.test(value) ? value : (() => { throw new Error('profileId must be a player profile ID.') })()
const rowToConsent = (row: BreedingConsentRow): BreedingConsentRecordV1 => {
  const id = consentId(row.consent_id)
  const record = parseStrictStoredBreedingJson({ table: TABLE, identity: id, json: row.document_json, parse: parseAuthoritativeBreedingConsentRecordV1 })
  const revision = parseBreedingRepositoryRevision(row.revision, `${TABLE}.${id}.revision`)
  const parentRevision = parseBreedingRepositoryRevision(row.parent_sheet_revision, `${TABLE}.${id}.parent_sheet_revision`)
  const grantedAt = parseBreedingRepositoryCampaignMinute(row.granted_at_campaign_minute, `${TABLE}.${id}.granted_at_campaign_minute`)
  const expiresAt = row.expires_at_campaign_minute === null ? null : parseBreedingRepositoryCampaignMinute(row.expires_at_campaign_minute, `${TABLE}.${id}.expires_at_campaign_minute`)
  const settledAt = row.settled_at_campaign_minute === null ? null : parseBreedingRepositoryCampaignMinute(row.settled_at_campaign_minute, `${TABLE}.${id}.settled_at_campaign_minute`)
  assertBreedingStoredColumn(record.consentId === id, TABLE, id, 'consent_id')
  assertBreedingStoredColumn(record.definitionSha256 === row.definition_sha256, TABLE, id, 'definition_sha256')
  assertBreedingStoredColumn(record.revision === revision, TABLE, id, 'revision')
  assertBreedingStoredColumn(record.status === row.status, TABLE, id, 'status')
  assertBreedingStoredColumn(record.projectId === row.project_id, TABLE, id, 'project_id')
  assertBreedingStoredColumn(record.parentSheetSlug === row.parent_sheet_slug, TABLE, id, 'parent_sheet_slug')
  assertBreedingStoredColumn(record.parentSheetRevision === parentRevision, TABLE, id, 'parent_sheet_revision')
  assertBreedingStoredColumn(record.ownerTrainerSlug === row.owner_trainer_slug, TABLE, id, 'owner_trainer_slug')
  assertBreedingStoredColumn(record.consentingProfileId === row.consenting_profile_id, TABLE, id, 'consenting_profile_id')
  assertBreedingStoredColumn(record.expiresAtCampaignMinute === expiresAt, TABLE, id, 'expires_at_campaign_minute')
  assertBreedingStoredColumn(record.grantOperationId === row.grant_operation_id, TABLE, id, 'grant_operation_id')
  assertBreedingStoredColumn(record.settlementOperationId === row.settlement_operation_id, TABLE, id, 'settlement_operation_id')
  assertBreedingStoredColumn(record.grantedAtCampaignMinute === grantedAt, TABLE, id, 'granted_at_campaign_minute')
  assertBreedingStoredColumn(record.settledAtCampaignMinute === settledAt, TABLE, id, 'settled_at_campaign_minute')
  return record
}
export const createSqliteBreedingConsentRepository = (database: RotomDatabase = getRotomDatabase()): BreedingConsentRepository => {
  const get = (value: BreedingConsentId | string): BreedingConsentRecordV1 | null => {
    const id = consentId(value)
    const row = database.connection.prepare(`${SELECT} WHERE consent_id = ?`).get(id) as unknown as BreedingConsentRow | undefined
    return row ? rowToConsent(row) : null
  }
  const listByProject = (projectInput: BreedingProjectId | string, limitInput?: number): readonly BreedingConsentRecordV1[] => {
    const project = projectId(projectInput); const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT} WHERE project_id = ? ORDER BY parent_sheet_slug ASC, granted_at_campaign_minute ASC, consent_id ASC LIMIT ?`).all(project, limit) as unknown as BreedingConsentRow[]).map(rowToConsent)
  }
  const listCurrentlyUsableByProfile = (profileInput: string, atInput: number, limitInput?: number): readonly BreedingConsentRecordV1[] => {
    const profile = profileId(profileInput); const at = parseBreedingRepositoryCampaignMinute(atInput, 'atCampaignMinute'); const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT} WHERE consenting_profile_id = ? AND status = 'active' AND (expires_at_campaign_minute IS NULL OR expires_at_campaign_minute > ?) ORDER BY expires_at_campaign_minute ASC, consent_id ASC LIMIT ?`).all(profile, at, limit) as unknown as BreedingConsentRow[]).map(rowToConsent)
  }
  const findActiveForParent = (projectInput: BreedingProjectId | string, parentInput: string): BreedingConsentRecordV1 | null => {
    const project = projectId(projectInput); const parent = slug(parentInput, 'parentSheetSlug')
    const rows = database.connection.prepare(`${SELECT} WHERE project_id = ? AND parent_sheet_slug = ? AND status = 'active' ORDER BY consent_id ASC LIMIT 2`).all(project, parent) as unknown as BreedingConsentRow[]
    if (rows.length > 1) throw new Error('Stored breeding consents contain contradictory active parent grants.')
    return rows[0] ? rowToConsent(rows[0]) : null
  }
  const insert = (input: BreedingConsentRecordV1): BreedingConsentRecordV1 => {
    const record = parseAuthoritativeBreedingConsentRecordV1(input)
    if (record.revision !== 0 || record.status !== 'active') throw new Error('A new breeding consent must begin at active revision 0.')
    const existing = get(record.consentId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, record)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Breeding consent', record.consentId)
    }
    try {
      database.connection.prepare(`
        INSERT INTO breeding_consents (
          consent_id, document_json, definition_sha256, revision, status, project_id,
          parent_sheet_slug, parent_sheet_revision, owner_trainer_slug, consenting_profile_id,
          expires_at_campaign_minute, grant_operation_id, settlement_operation_id,
          granted_at_campaign_minute, settled_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.consentId, stableJsonStringify(record), record.definitionSha256, record.revision, record.status, record.projectId, record.parentSheetSlug, record.parentSheetRevision, record.ownerTrainerSlug, record.consentingProfileId, record.expiresAtCampaignMinute, record.grantOperationId, record.settlementOperationId, record.grantedAtCampaignMinute, record.settledAtCampaignMinute)
    }
    catch (error) {
      const raced = get(record.consentId)
      if (raced && exactBreedingDocumentReplay(raced, record)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Breeding consent', record.consentId)
      throw error
    }
    return get(record.consentId) ?? (() => { throw new Error('Inserted breeding consent was not readable.') })()
  }
  const replace: BreedingConsentRepository['replace'] = input => {
    const expectedRevision = parseBreedingRepositoryRevision(input.expectedRevision, 'expectedRevision')
    const proposed = parseAuthoritativeBreedingConsentRecordV1(input.record)
    const current = get(proposed.consentId)
    if (!current) return Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
    if (current.revision !== expectedRevision) return Object.freeze({ kind: 'stale', expectedRevision, currentRevision: current.revision })
    const record = validateBreedingConsentSuccessor(current, proposed)
    const result = database.connection.prepare(`
      UPDATE breeding_consents SET
        document_json = ?, definition_sha256 = ?, revision = ?, status = ?, project_id = ?,
        parent_sheet_slug = ?, parent_sheet_revision = ?, owner_trainer_slug = ?, consenting_profile_id = ?,
        expires_at_campaign_minute = ?, grant_operation_id = ?, settlement_operation_id = ?,
        granted_at_campaign_minute = ?, settled_at_campaign_minute = ?
      WHERE consent_id = ? AND revision = ?
    `).run(stableJsonStringify(record), record.definitionSha256, record.revision, record.status, record.projectId, record.parentSheetSlug, record.parentSheetRevision, record.ownerTrainerSlug, record.consentingProfileId, record.expiresAtCampaignMinute, record.grantOperationId, record.settlementOperationId, record.grantedAtCampaignMinute, record.settledAtCampaignMinute, record.consentId, expectedRevision)
    if (Number(result.changes) === 1) return Object.freeze({ kind: 'applied', document: record })
    const raced = get(record.consentId)
    return raced ? Object.freeze({ kind: 'stale', expectedRevision, currentRevision: raced.revision }) : Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
  }
  return Object.freeze({ database, get, listByProject, listCurrentlyUsableByProfile, findActiveForParent, insert, replace })
}
