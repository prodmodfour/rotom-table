import { validateSlug } from '#shared/paths'
import { isSheetKind, type SheetKind } from '#shared/sheets'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredRevision,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export interface StoredSheetDocument<TDocument = unknown> {
  readonly kind: SheetKind
  readonly slug: string
  readonly document: TDocument
  readonly revision: number
  readonly updatedAt: number
}

export interface SaveSheetDocumentInput<TDocument = unknown> {
  readonly kind: SheetKind
  readonly slug: string
  readonly document: TDocument
  readonly revision: number
  readonly updatedAt: number
}

export interface SheetRepository<TDocument = unknown> {
  get(kind: SheetKind, slug: string): StoredSheetDocument<TDocument> | null
  list(kind?: SheetKind): readonly StoredSheetDocument<TDocument>[]
  save(input: SaveSheetDocumentInput<TDocument>): StoredSheetDocument<TDocument>
  delete(kind: SheetKind, slug: string): boolean
}

interface SheetRow {
  readonly kind: unknown
  readonly slug: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly updated_at: unknown
}

const parseSheetKind = (value: unknown, label = 'sheet kind'): SheetKind => {
  if (!isSheetKind(value)) throw new Error(`${label} must be "pokemon" or "trainer"`)
  return value
}

const rowToSheetDocument = <TDocument>(row: SheetRow): StoredSheetDocument<TDocument> => {
  const kind = parseSheetKind(row.kind, 'sheets.kind')
  if (typeof row.slug !== 'string') throw new Error('sheets.slug must be a string')
  if (typeof row.document_json !== 'string') throw new Error('sheets.document_json must be a string')

  const slug = validateSlug(row.slug, 'sheets.slug')
  return {
    kind,
    slug,
    document: parseStoredDocumentJson<TDocument>(row.document_json, `${kind} sheet ${slug}`),
    revision: parseStoredRevision(row.revision, `${kind} sheet ${slug} revision`),
    updatedAt: parseStoredTimestamp(row.updated_at, `${kind} sheet ${slug} updated_at`),
  }
}

const normalizeInput = <TDocument>(input: SaveSheetDocumentInput<TDocument>): SaveSheetDocumentInput<TDocument> => ({
  kind: parseSheetKind(input.kind),
  slug: validateSlug(input.slug, 'sheet slug'),
  document: cloneStoredJson(input.document),
  revision: parseStoredRevision(input.revision, 'sheet revision'),
  updatedAt: parseStoredTimestamp(input.updatedAt, 'sheet updatedAt'),
})

export const createSqliteSheetRepository = <TDocument = unknown>(
  database: RotomDatabase = getRotomDatabase(),
): SheetRepository<TDocument> => ({
  get: (kind, slug) => {
    const parsedKind = parseSheetKind(kind)
    const parsedSlug = validateSlug(slug, 'sheet slug')
    const row = database.connection.prepare(`
      SELECT kind, slug, document_json, revision, updated_at
      FROM sheets
      WHERE kind = ? AND slug = ?
    `).get(parsedKind, parsedSlug) as unknown as SheetRow | undefined
    return row ? rowToSheetDocument<TDocument>(row) : null
  },
  list: (kind) => {
    if (kind === undefined) {
      return database.connection.prepare(`
        SELECT kind, slug, document_json, revision, updated_at
        FROM sheets
        ORDER BY kind ASC, slug ASC
      `).all().map((row) => rowToSheetDocument<TDocument>(row as unknown as SheetRow))
    }

    const parsedKind = parseSheetKind(kind)
    return database.connection.prepare(`
      SELECT kind, slug, document_json, revision, updated_at
      FROM sheets
      WHERE kind = ?
      ORDER BY slug ASC
    `).all(parsedKind).map((row) => rowToSheetDocument<TDocument>(row as unknown as SheetRow))
  },
  save: (input) => database.withTransaction(() => {
    const normalized = normalizeInput(input)
    database.connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(kind, slug) DO UPDATE SET
        document_json = excluded.document_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(
      normalized.kind,
      normalized.slug,
      stringifyStoredDocument(normalized.document),
      normalized.revision,
      normalized.updatedAt,
    )
    return {
      kind: normalized.kind,
      slug: normalized.slug,
      document: cloneStoredJson(normalized.document),
      revision: normalized.revision,
      updatedAt: normalized.updatedAt,
    }
  }),
  delete: (kind, slug) => database.withTransaction(() => {
    const parsedKind = parseSheetKind(kind)
    const parsedSlug = validateSlug(slug, 'sheet slug')
    const result = database.connection.prepare('DELETE FROM sheets WHERE kind = ? AND slug = ?').run(parsedKind, parsedSlug)
    return Number(result.changes) > 0
  }),
})

const defaultSheetRepository = <TDocument = unknown>(): SheetRepository<TDocument> =>
  createSqliteSheetRepository<TDocument>(getRotomDatabase())

export const sqliteSheetRepository: SheetRepository = {
  get: (kind, slug) => defaultSheetRepository().get(kind, slug),
  list: (kind) => defaultSheetRepository().list(kind),
  save: (input) => defaultSheetRepository().save(input),
  delete: (kind, slug) => defaultSheetRepository().delete(kind, slug),
}
