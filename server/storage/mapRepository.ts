import { validateSlug } from '#shared/paths'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredRevision,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export interface StoredMapDocument<TDocument = unknown> {
  readonly slug: string
  readonly document: TDocument
  readonly revision: number
  readonly updatedAt: number
}

export interface SaveMapDocumentInput<TDocument = unknown> {
  readonly slug: string
  readonly document: TDocument
  readonly revision: number
  readonly updatedAt: number
}

export interface MapRepository<TDocument = unknown> {
  get(slug: string): StoredMapDocument<TDocument> | null
  list(): readonly StoredMapDocument<TDocument>[]
  save(input: SaveMapDocumentInput<TDocument>): StoredMapDocument<TDocument>
  delete(slug: string): boolean
}

interface MapRow {
  readonly slug: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly updated_at: unknown
}

const rowToMapDocument = <TDocument>(row: MapRow): StoredMapDocument<TDocument> => {
  if (typeof row.slug !== 'string') throw new Error('maps.slug must be a string')
  if (typeof row.document_json !== 'string') throw new Error('maps.document_json must be a string')

  const slug = validateSlug(row.slug, 'maps.slug')
  return {
    slug,
    document: parseStoredDocumentJson<TDocument>(row.document_json, `map ${slug}`),
    revision: parseStoredRevision(row.revision, `map ${slug} revision`),
    updatedAt: parseStoredTimestamp(row.updated_at, `map ${slug} updated_at`),
  }
}

const normalizeInput = <TDocument>(input: SaveMapDocumentInput<TDocument>): SaveMapDocumentInput<TDocument> => ({
  slug: validateSlug(input.slug, 'map slug'),
  document: cloneStoredJson(input.document),
  revision: parseStoredRevision(input.revision, 'map revision'),
  updatedAt: parseStoredTimestamp(input.updatedAt, 'map updatedAt'),
})

export const createSqliteMapRepository = <TDocument = unknown>(
  database: RotomDatabase = getRotomDatabase(),
): MapRepository<TDocument> => ({
  get: (slug) => {
    const parsedSlug = validateSlug(slug, 'map slug')
    const row = database.connection.prepare(`
      SELECT slug, document_json, revision, updated_at
      FROM maps
      WHERE slug = ?
    `).get(parsedSlug) as unknown as MapRow | undefined
    return row ? rowToMapDocument<TDocument>(row) : null
  },
  list: () => database.connection.prepare(`
    SELECT slug, document_json, revision, updated_at
    FROM maps
    ORDER BY slug ASC
  `).all().map((row) => rowToMapDocument<TDocument>(row as unknown as MapRow)),
  save: (input) => database.withTransaction(() => {
    const normalized = normalizeInput(input)
    database.connection.prepare(`
      INSERT INTO maps (slug, document_json, revision, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        document_json = excluded.document_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(
      normalized.slug,
      stringifyStoredDocument(normalized.document),
      normalized.revision,
      normalized.updatedAt,
    )
    return {
      slug: normalized.slug,
      document: cloneStoredJson(normalized.document),
      revision: normalized.revision,
      updatedAt: normalized.updatedAt,
    }
  }),
  delete: (slug) => database.withTransaction(() => {
    const parsedSlug = validateSlug(slug, 'map slug')
    const result = database.connection.prepare('DELETE FROM maps WHERE slug = ?').run(parsedSlug)
    return Number(result.changes) > 0
  }),
})

const defaultMapRepository = <TDocument = unknown>(): MapRepository<TDocument> =>
  createSqliteMapRepository<TDocument>(getRotomDatabase())

export const sqliteMapRepository: MapRepository = {
  get: (slug) => defaultMapRepository().get(slug),
  list: () => defaultMapRepository().list(),
  save: (input) => defaultMapRepository().save(input),
  delete: (slug) => defaultMapRepository().delete(slug),
}
