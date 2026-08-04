import { nextRevision } from '#shared/sessionRevisions'
import { parseEncounterDocument, type EncounterDocument } from '#shared/encounterDocuments/model'
import { stableJsonStringify } from '#shared/automation/stableJson'
import { getRotomDatabase, type RotomDatabase } from './database'

interface EncounterDocumentRow {
  readonly encounter_id: unknown
  readonly linked_map_slug: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly updated_at: unknown
}

export interface EncounterDocumentRepository {
  readonly database?: RotomDatabase
  get(encounterId: string): EncounterDocument | null
  findByMapSlug(mapSlug: string): EncounterDocument | null
  list(): readonly EncounterDocument[]
  create(document: EncounterDocument): EncounterDocument
  replace(input: { readonly expectedRevision: number, readonly document: EncounterDocument }): EncounterDocument | null
  delete(encounterId: string): boolean
}

const stableId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value)) throw new Error(`${label} must be a stable bounded ID.`)
  return value
}
const safeRevision = (value: unknown, label: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative safe integer.`)
  return Number(value)
}

const rowToDocument = (row: EncounterDocumentRow): EncounterDocument => {
  const encounterId = stableId(row.encounter_id, 'encounter_documents.encounter_id')
  const linkedMapSlug = stableId(row.linked_map_slug, 'encounter_documents.linked_map_slug')
  const revision = safeRevision(row.revision, `encounter ${encounterId} revision`)
  if (typeof row.document_json !== 'string') throw new Error(`encounter ${encounterId} document_json must be text.`)
  const parsed = JSON.parse(row.document_json) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`encounter ${encounterId} document must be an object.`)
  return parseEncounterDocument({
    ...(parsed as Record<string, unknown>),
    encounterId,
    linkedMapSlug,
    revision,
    updatedAt: safeRevision(row.updated_at, `encounter ${encounterId} updatedAt`),
  })
}

export const createSqliteEncounterDocumentRepository = (
  database: RotomDatabase = getRotomDatabase(),
): EncounterDocumentRepository => {
  const getRow = (encounterIdInput: string): EncounterDocumentRow | undefined => {
    const encounterId = stableId(encounterIdInput, 'encounterId')
    return database.connection.prepare(`
      SELECT encounter_id, linked_map_slug, document_json, revision, updated_at
      FROM encounter_documents
      WHERE encounter_id = ?
    `).get(encounterId) as unknown as EncounterDocumentRow | undefined
  }
  const get = (encounterId: string): EncounterDocument | null => {
    const row = getRow(encounterId)
    return row ? rowToDocument(row) : null
  }
  const findByMapSlug = (mapSlugInput: string): EncounterDocument | null => {
    const mapSlug = stableId(mapSlugInput, 'mapSlug')
    const rows = database.connection.prepare(`
      SELECT encounter_id, linked_map_slug, document_json, revision, updated_at
      FROM encounter_documents
      WHERE linked_map_slug = ?
      ORDER BY CASE json_extract(document_json, '$.lifecycle')
        WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END,
        updated_at DESC, encounter_id ASC
      LIMIT 2
    `).all(mapSlug) as unknown as EncounterDocumentRow[]
    if (rows.length > 1) {
      const documents = rows.map(rowToDocument)
      const equallyActive = documents.filter(document => document.lifecycle === documents[0]?.lifecycle)
      if (equallyActive.length > 1 && ['active', 'paused'].includes(equallyActive[0]!.lifecycle)) {
        throw new Error(`Map ${mapSlug} has contradictory ${equallyActive[0]!.lifecycle} encounter documents.`)
      }
    }
    return rows[0] ? rowToDocument(rows[0]) : null
  }
  const list = (): readonly EncounterDocument[] => (
    database.connection.prepare(`
      SELECT encounter_id, linked_map_slug, document_json, revision, updated_at
      FROM encounter_documents
      ORDER BY updated_at DESC, encounter_id ASC
    `).all() as unknown as EncounterDocumentRow[]
  ).map(rowToDocument)

  const create = (input: EncounterDocument): EncounterDocument => database.withTransaction(() => {
    const document = parseEncounterDocument(input)
    if (document.revision !== 0) throw new Error('New encounter document revision must be 0.')
    database.connection.prepare(`
      INSERT INTO encounter_documents (encounter_id, linked_map_slug, document_json, revision, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(document.encounterId, document.linkedMapSlug, stableJsonStringify(document), document.revision, document.updatedAt)
    return document
  })

  const replace = (input: { readonly expectedRevision: number, readonly document: EncounterDocument }): EncounterDocument | null => database.withTransaction(() => {
    const expectedRevision = safeRevision(input.expectedRevision, 'expectedRevision')
    const current = get(input.document.encounterId)
    if (!current) return null
    if (current.revision !== expectedRevision) throw new Error(`Encounter ${current.encounterId} changed before it could be updated.`)
    const document = parseEncounterDocument(input.document)
    if (document.linkedMapSlug !== current.linkedMapSlug) throw new Error('Director commands cannot relink an encounter battlefield.')
    if (document.revision !== nextRevision(expectedRevision)) throw new Error('Encounter replacement must advance exactly one revision.')
    const result = database.connection.prepare(`
      UPDATE encounter_documents
      SET document_json = ?, revision = ?, updated_at = ?
      WHERE encounter_id = ? AND revision = ?
    `).run(stableJsonStringify(document), document.revision, document.updatedAt, document.encounterId, expectedRevision)
    if (Number(result.changes) !== 1) throw new Error(`Encounter ${document.encounterId} changed before it could be updated.`)
    return document
  })

  const remove = (encounterIdInput: string): boolean => database.withTransaction(() => {
    const encounterId = stableId(encounterIdInput, 'encounterId')
    return Number(database.connection.prepare('DELETE FROM encounter_documents WHERE encounter_id = ?').run(encounterId).changes) === 1
  })

  return { database, get, findByMapSlug, list, create, replace, delete: remove }
}
