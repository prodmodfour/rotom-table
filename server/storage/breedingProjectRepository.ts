import { stableJsonStringify } from '#shared/automation/stableJson'
import { parseBreedingProjectIdSyntax, type BreedingProjectId } from '#shared/breeding/ids'
import { BREEDING_PROJECT_STATUSES, parseBreedingProjectDocumentV1, type BreedingProjectDocumentV1, type BreedingProjectStatus } from '#shared/breeding/project'
import { isSlug } from '#shared/paths'
import { validateBreedingProjectRevisionSuccessor } from '../domain/breeding/projectLifecycle'
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

interface BreedingProjectRow {
  readonly project_id: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly status: unknown
  readonly owner_trainer_slug: unknown
  readonly breeder_trainer_slug: unknown
  readonly parent_a_slug: unknown
  readonly parent_b_slug: unknown
  readonly produced_egg_id: unknown
  readonly last_operation_id: unknown
  readonly created_at_campaign_minute: unknown
  readonly updated_at_campaign_minute: unknown
}

export interface BreedingProjectRepository {
  readonly database: RotomDatabase
  get(projectId: BreedingProjectId | string): BreedingProjectDocumentV1 | null
  listByOwner(ownerTrainerSlug: string, limit?: number): readonly BreedingProjectDocumentV1[]
  listByParent(parentSheetSlug: string, limit?: number): readonly BreedingProjectDocumentV1[]
  listByStatuses(statuses: readonly BreedingProjectStatus[], limit?: number): readonly BreedingProjectDocumentV1[]
  insert(document: BreedingProjectDocumentV1): BreedingProjectDocumentV1
  replace(input: { readonly expectedRevision: number, readonly document: BreedingProjectDocumentV1 }): BreedingRepositoryReplaceResult<BreedingProjectDocumentV1>
}

const TABLE = 'breeding_projects'
const SELECT = `
  SELECT project_id, document_json, revision, status, owner_trainer_slug, breeder_trainer_slug,
         parent_a_slug, parent_b_slug, produced_egg_id, last_operation_id,
         created_at_campaign_minute, updated_at_campaign_minute
  FROM breeding_projects
`
const STATUS_SET = new Set<string>(BREEDING_PROJECT_STATUSES)
const projectId = (value: unknown): BreedingProjectId => parseBreedingProjectIdSyntax(value) ?? (() => { throw new Error('projectId must be a breeding project ID.') })()
const slug = (value: unknown, label: string): string => isSlug(value) && value.length <= 160 ? value : (() => { throw new Error(`${label} must be a canonical bounded sheet slug.`) })()
const rowToProject = (row: BreedingProjectRow): BreedingProjectDocumentV1 => {
  const id = projectId(row.project_id)
  const document = parseStrictStoredBreedingJson({ table: TABLE, identity: id, json: row.document_json, parse: parseBreedingProjectDocumentV1 })
  const revision = parseBreedingRepositoryRevision(row.revision, `${TABLE}.${id}.revision`)
  const created = parseBreedingRepositoryCampaignMinute(row.created_at_campaign_minute, `${TABLE}.${id}.created_at_campaign_minute`)
  const updated = parseBreedingRepositoryCampaignMinute(row.updated_at_campaign_minute, `${TABLE}.${id}.updated_at_campaign_minute`)
  assertBreedingStoredColumn(document.projectId === id, TABLE, id, 'project_id')
  assertBreedingStoredColumn(document.revision === revision, TABLE, id, 'revision')
  assertBreedingStoredColumn(document.status === row.status, TABLE, id, 'status')
  assertBreedingStoredColumn(document.ownerTrainerSlug === row.owner_trainer_slug, TABLE, id, 'owner_trainer_slug')
  assertBreedingStoredColumn(document.breederTrainerSlug === row.breeder_trainer_slug, TABLE, id, 'breeder_trainer_slug')
  assertBreedingStoredColumn(document.parentRefs[0].pokemonSheetSlug === row.parent_a_slug, TABLE, id, 'parent_a_slug')
  assertBreedingStoredColumn(document.parentRefs[1].pokemonSheetSlug === row.parent_b_slug, TABLE, id, 'parent_b_slug')
  assertBreedingStoredColumn(document.producedEggId === row.produced_egg_id, TABLE, id, 'produced_egg_id')
  assertBreedingStoredColumn(document.lastOperationId === row.last_operation_id, TABLE, id, 'last_operation_id')
  assertBreedingStoredColumn(document.createdAtCampaignMinute === created, TABLE, id, 'created_at_campaign_minute')
  assertBreedingStoredColumn(document.updatedAtCampaignMinute === updated, TABLE, id, 'updated_at_campaign_minute')
  return document
}
const parseStatuses = (values: readonly BreedingProjectStatus[]): readonly BreedingProjectStatus[] => {
  if (!Array.isArray(values) || values.length < 1 || values.length > BREEDING_PROJECT_STATUSES.length) throw new Error('Project status query must be a nonempty bounded array.')
  const statuses = [...values]
  if (statuses.some(value => !STATUS_SET.has(value)) || new Set(statuses).size !== statuses.length) throw new Error('Project status query contains an unknown or duplicate status.')
  return statuses.sort()
}

export const createSqliteBreedingProjectRepository = (database: RotomDatabase = getRotomDatabase()): BreedingProjectRepository => {
  const get = (value: BreedingProjectId | string): BreedingProjectDocumentV1 | null => {
    const id = projectId(value)
    const row = database.connection.prepare(`${SELECT} WHERE project_id = ?`).get(id) as unknown as BreedingProjectRow | undefined
    return row ? rowToProject(row) : null
  }
  const listByOwner = (ownerInput: string, limitInput?: number): readonly BreedingProjectDocumentV1[] => {
    const owner = slug(ownerInput, 'ownerTrainerSlug'); const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT} WHERE owner_trainer_slug = ? ORDER BY updated_at_campaign_minute DESC, project_id ASC LIMIT ?`).all(owner, limit) as unknown as BreedingProjectRow[]).map(rowToProject)
  }
  const listByParent = (parentInput: string, limitInput?: number): readonly BreedingProjectDocumentV1[] => {
    const parent = slug(parentInput, 'parentSheetSlug'); const limit = parseBreedingRepositoryLimit(limitInput)
    return (database.connection.prepare(`${SELECT} WHERE parent_a_slug = ? OR parent_b_slug = ? ORDER BY updated_at_campaign_minute DESC, project_id ASC LIMIT ?`).all(parent, parent, limit) as unknown as BreedingProjectRow[]).map(rowToProject)
  }
  const listByStatuses = (statusInput: readonly BreedingProjectStatus[], limitInput?: number): readonly BreedingProjectDocumentV1[] => {
    const statuses = parseStatuses(statusInput); const limit = parseBreedingRepositoryLimit(limitInput)
    const placeholders = statuses.map(() => '?').join(', ')
    return (database.connection.prepare(`${SELECT} WHERE status IN (${placeholders}) ORDER BY updated_at_campaign_minute ASC, project_id ASC LIMIT ?`).all(...statuses, limit) as unknown as BreedingProjectRow[]).map(rowToProject)
  }
  const insert = (input: BreedingProjectDocumentV1): BreedingProjectDocumentV1 => {
    const document = parseBreedingProjectDocumentV1(input)
    if (document.revision !== 0) throw new Error('A new breeding project must begin at revision 0.')
    const existing = get(document.projectId)
    if (existing) {
      if (exactBreedingDocumentReplay(existing, document)) return existing
      throw new BreedingRepositoryIdentityCollisionError('Breeding project', document.projectId)
    }
    try {
      database.connection.prepare(`
        INSERT INTO breeding_projects (
          project_id, document_json, revision, status, owner_trainer_slug, breeder_trainer_slug,
          parent_a_slug, parent_b_slug, produced_egg_id, last_operation_id,
          created_at_campaign_minute, updated_at_campaign_minute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(document.projectId, stableJsonStringify(document), document.revision, document.status, document.ownerTrainerSlug, document.breederTrainerSlug, document.parentRefs[0].pokemonSheetSlug, document.parentRefs[1].pokemonSheetSlug, document.producedEggId, document.lastOperationId, document.createdAtCampaignMinute, document.updatedAtCampaignMinute)
    }
    catch (error) {
      const raced = get(document.projectId)
      if (raced && exactBreedingDocumentReplay(raced, document)) return raced
      if (raced) throw new BreedingRepositoryIdentityCollisionError('Breeding project', document.projectId)
      throw error
    }
    return get(document.projectId) ?? (() => { throw new Error('Inserted breeding project was not readable.') })()
  }
  const replace: BreedingProjectRepository['replace'] = input => {
    const expectedRevision = parseBreedingRepositoryRevision(input.expectedRevision, 'expectedRevision')
    const proposed = parseBreedingProjectDocumentV1(input.document)
    const current = get(proposed.projectId)
    if (!current) return Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
    if (current.revision !== expectedRevision) return Object.freeze({ kind: 'stale', expectedRevision, currentRevision: current.revision })
    const document = validateBreedingProjectRevisionSuccessor(current, proposed)
    const result = database.connection.prepare(`
      UPDATE breeding_projects SET
        document_json = ?, revision = ?, status = ?, owner_trainer_slug = ?, breeder_trainer_slug = ?,
        parent_a_slug = ?, parent_b_slug = ?, produced_egg_id = ?, last_operation_id = ?,
        created_at_campaign_minute = ?, updated_at_campaign_minute = ?
      WHERE project_id = ? AND revision = ?
    `).run(stableJsonStringify(document), document.revision, document.status, document.ownerTrainerSlug, document.breederTrainerSlug, document.parentRefs[0].pokemonSheetSlug, document.parentRefs[1].pokemonSheetSlug, document.producedEggId, document.lastOperationId, document.createdAtCampaignMinute, document.updatedAtCampaignMinute, document.projectId, expectedRevision)
    if (Number(result.changes) === 1) return Object.freeze({ kind: 'applied', document })
    const raced = get(document.projectId)
    return raced ? Object.freeze({ kind: 'stale', expectedRevision, currentRevision: raced.revision }) : Object.freeze({ kind: 'missing', expectedRevision, currentRevision: null })
  }
  return Object.freeze({ database, get, listByOwner, listByParent, listByStatuses, insert, replace })
}
