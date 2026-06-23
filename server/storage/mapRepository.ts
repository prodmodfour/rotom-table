import { validateSlug } from '#shared/paths'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { TabletopMap } from '~/types/map'
import { normalizeMapDocument } from '../utils/mapNormalization'
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

export interface ApplyLivePlayMapUpdateInput {
  readonly slug: string
  readonly expectedRevision: number
  readonly nextMap: TabletopMap
}

export type LivePlayMapUpdateResult = 'applied' | 'stale'

export interface MapRepository<TDocument = unknown> {
  get(slug: string): StoredMapDocument<TDocument> | null
  list(): readonly StoredMapDocument<TDocument>[]
  save(input: SaveMapDocumentInput<TDocument>): StoredMapDocument<TDocument>
  delete(slug: string): boolean
  getBySlug(slug: string): TabletopMap | null
  saveSetupMap(map: TabletopMap): TabletopMap
  applyLivePlayUpdate(input: ApplyLivePlayMapUpdateInput): LivePlayMapUpdateResult
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

const timestampOrNow = (value: unknown, label: string): number => {
  if (value === undefined || value === null) return parseStoredTimestamp(Date.now(), label)
  return parseStoredTimestamp(value, label)
}

const normalizeTabletopMapForStorage = (map: TabletopMap, sourceLabel: string): TabletopMap => {
  const normalized = normalizeMapDocument(map, { sourceLabel })
  return {
    ...normalized,
    revision: normalizeRevision(normalized.revision),
    updatedAt: timestampOrNow(normalized.updatedAt, `${sourceLabel} updatedAt`),
  }
}

const storedDocumentToTabletopMap = (stored: StoredMapDocument): TabletopMap => {
  const map = normalizeMapDocument(stored.document, { sourceLabel: `SQLite map ${stored.slug}` })
  if (map.slug !== stored.slug) {
    throw new Error(`SQLite map ${stored.slug} document slug must match the row slug`)
  }
  return {
    ...map,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
  }
}

export const createSqliteMapRepository = <TDocument = unknown>(
  database: RotomDatabase = getRotomDatabase(),
): MapRepository<TDocument> => {
  const get = (slug: string): StoredMapDocument<TDocument> | null => {
    const parsedSlug = validateSlug(slug, 'map slug')
    const row = database.connection.prepare(`
      SELECT slug, document_json, revision, updated_at
      FROM maps
      WHERE slug = ?
    `).get(parsedSlug) as unknown as MapRow | undefined
    return row ? rowToMapDocument<TDocument>(row) : null
  }

  const list = (): readonly StoredMapDocument<TDocument>[] => database.connection.prepare(`
    SELECT slug, document_json, revision, updated_at
    FROM maps
    ORDER BY slug ASC
  `).all().map((row) => rowToMapDocument<TDocument>(row as unknown as MapRow))

  const save = (input: SaveMapDocumentInput<TDocument>): StoredMapDocument<TDocument> =>
    database.withTransaction(() => {
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
    })

  const remove = (slug: string): boolean => database.withTransaction(() => {
    const parsedSlug = validateSlug(slug, 'map slug')
    const result = database.connection.prepare('DELETE FROM maps WHERE slug = ?').run(parsedSlug)
    return Number(result.changes) > 0
  })

  const getBySlug = (slug: string): TabletopMap | null => {
    const stored = get(slug)
    return stored ? storedDocumentToTabletopMap(stored as StoredMapDocument) : null
  }

  const saveSetupMap = (map: TabletopMap): TabletopMap => {
    const normalized = normalizeTabletopMapForStorage(map, `setup map ${map.slug}`)
    const stored = save({
      slug: normalized.slug,
      document: normalized as unknown as TDocument,
      revision: normalizeRevision(normalized.revision),
      updatedAt: timestampOrNow(normalized.updatedAt, `setup map ${normalized.slug} updatedAt`),
    })
    return storedDocumentToTabletopMap(stored as StoredMapDocument)
  }

  const applyLivePlayUpdate = (input: ApplyLivePlayMapUpdateInput): LivePlayMapUpdateResult =>
    database.withTransaction(() => {
      const slug = validateSlug(input.slug, 'map slug')
      const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected map revision')
      const row = database.connection.prepare(`
        SELECT slug, document_json, revision, updated_at
        FROM maps
        WHERE slug = ?
      `).get(slug) as unknown as MapRow | undefined
      if (!row) return 'stale'

      const current = rowToMapDocument(row)
      if (current.revision !== expectedRevision) return 'stale'

      const normalizedNext = normalizeTabletopMapForStorage(input.nextMap, `live-play map ${slug}`)
      if (normalizedNext.slug !== slug) {
        throw new Error(`live-play map update slug ${normalizedNext.slug} must match ${slug}`)
      }

      const revision = nextRevision(expectedRevision)
      const updatedAt = timestampOrNow(normalizedNext.updatedAt, `live-play map ${slug} updatedAt`)
      const document: TabletopMap = {
        ...normalizedNext,
        revision,
        updatedAt,
      }
      const result = database.connection.prepare(`
        UPDATE maps
        SET document_json = ?, revision = ?, updated_at = ?
        WHERE slug = ? AND revision = ?
      `).run(
        stringifyStoredDocument(document),
        revision,
        updatedAt,
        slug,
        expectedRevision,
      )

      return Number(result.changes) === 1 ? 'applied' : 'stale'
    })

  return {
    get,
    list,
    save,
    delete: remove,
    getBySlug,
    saveSetupMap,
    applyLivePlayUpdate,
  }
}

const defaultMapRepository = <TDocument = unknown>(): MapRepository<TDocument> =>
  createSqliteMapRepository<TDocument>(getRotomDatabase())

export const sqliteMapRepository: MapRepository = {
  get: (slug) => defaultMapRepository().get(slug),
  list: () => defaultMapRepository().list(),
  save: (input) => defaultMapRepository().save(input),
  delete: (slug) => defaultMapRepository().delete(slug),
  getBySlug: (slug) => defaultMapRepository().getBySlug(slug),
  saveSetupMap: (map) => defaultMapRepository().saveSetupMap(map),
  applyLivePlayUpdate: (input) => defaultMapRepository().applyLivePlayUpdate(input),
}
