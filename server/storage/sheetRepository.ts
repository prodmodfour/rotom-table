import { validateSlug } from '#shared/paths'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import { isSheetKind, type SheetKind } from '#shared/sheets'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
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

export interface PersistedSheet {
  readonly kind: SheetKind
  readonly slug: string
  readonly sheet: Record<string, unknown>
  readonly revision: number
  readonly updatedAt: number
}

export interface ApplyLivePlaySheetUpdateInput {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly nextSheet: Record<string, unknown>
}

export type LivePlaySheetUpdateResult = 'applied' | 'stale'

export interface SheetRepository<TDocument = unknown> {
  get(kind: SheetKind, slug: string): StoredSheetDocument<TDocument> | null
  list(kind?: SheetKind): readonly StoredSheetDocument<TDocument>[]
  save(input: SaveSheetDocumentInput<TDocument>): StoredSheetDocument<TDocument>
  delete(kind: SheetKind, slug: string): boolean
  getByRef(kind: SheetKind, slug: string): Promise<PersistedSheet | null>
  saveSetupSheet(kind: SheetKind, slug: string, sheet: Record<string, unknown>): Promise<PersistedSheet>
  applyLivePlayUpdate(input: ApplyLivePlaySheetUpdateInput): Promise<LivePlaySheetUpdateResult>
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

const timestampOrNow = (value: unknown, label: string): number => {
  if (value === undefined || value === null) return parseStoredTimestamp(Date.now(), label)
  return parseStoredTimestamp(value, label)
}

const normalizeSheetForStorage = (
  kind: SheetKind,
  slug: string,
  sheet: Record<string, unknown>,
): Record<string, unknown> => {
  parseSheetKind(kind)
  const parsedSlug = validateSlug(slug, 'sheet slug')
  return {
    ...toPersistableSheetPayload(sheet),
    slug: parsedSlug,
    revision: normalizeRevision(sheet.revision),
  }
}

const storedDocumentToPersistedSheet = (stored: StoredSheetDocument): PersistedSheet => {
  const sheet = toPersistableSheetPayload(stored.document as Record<string, unknown>)
  if (sheet.slug !== stored.slug) {
    throw new Error(`SQLite ${stored.kind} sheet ${stored.slug} document slug must match the row slug`)
  }
  return {
    kind: stored.kind,
    slug: stored.slug,
    sheet: {
      ...sheet,
      revision: stored.revision,
    },
    revision: stored.revision,
    updatedAt: stored.updatedAt,
  }
}

export const createSqliteSheetRepository = <TDocument = unknown>(
  database: RotomDatabase = getRotomDatabase(),
): SheetRepository<TDocument> => {
  const get = (kind: SheetKind, slug: string): StoredSheetDocument<TDocument> | null => {
    const parsedKind = parseSheetKind(kind)
    const parsedSlug = validateSlug(slug, 'sheet slug')
    const row = database.connection.prepare(`
      SELECT kind, slug, document_json, revision, updated_at
      FROM sheets
      WHERE kind = ? AND slug = ?
    `).get(parsedKind, parsedSlug) as unknown as SheetRow | undefined
    return row ? rowToSheetDocument<TDocument>(row) : null
  }

  const list = (kind?: SheetKind): readonly StoredSheetDocument<TDocument>[] => {
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
  }

  const save = (input: SaveSheetDocumentInput<TDocument>): StoredSheetDocument<TDocument> =>
    database.withTransaction(() => {
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
    })

  const remove = (kind: SheetKind, slug: string): boolean => database.withTransaction(() => {
    const parsedKind = parseSheetKind(kind)
    const parsedSlug = validateSlug(slug, 'sheet slug')
    const result = database.connection.prepare('DELETE FROM sheets WHERE kind = ? AND slug = ?').run(parsedKind, parsedSlug)
    return Number(result.changes) > 0
  })

  const getByRef = async (kind: SheetKind, slug: string): Promise<PersistedSheet | null> => {
    const stored = get(kind, slug)
    return stored ? storedDocumentToPersistedSheet(stored as StoredSheetDocument) : null
  }

  const saveSetupSheet = async (
    kind: SheetKind,
    slug: string,
    sheet: Record<string, unknown>,
  ): Promise<PersistedSheet> => {
    const normalizedKind = parseSheetKind(kind)
    const normalizedSlug = validateSlug(slug, 'sheet slug')
    const document = normalizeSheetForStorage(normalizedKind, normalizedSlug, sheet)
    const revision = normalizeRevision(document.revision)
    const updatedAt = timestampOrNow(document.updatedAt, `${normalizedKind} sheet ${normalizedSlug} updatedAt`)
    const stored = save({
      kind: normalizedKind,
      slug: normalizedSlug,
      document: document as TDocument,
      revision,
      updatedAt,
    })
    return storedDocumentToPersistedSheet(stored as StoredSheetDocument)
  }

  const applyLivePlayUpdate = async (input: ApplyLivePlaySheetUpdateInput): Promise<LivePlaySheetUpdateResult> =>
    database.withTransaction(() => {
      const kind = parseSheetKind(input.kind)
      const slug = validateSlug(input.slug, 'sheet slug')
      const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected sheet revision')
      const row = database.connection.prepare(`
        SELECT kind, slug, document_json, revision, updated_at
        FROM sheets
        WHERE kind = ? AND slug = ?
      `).get(kind, slug) as unknown as SheetRow | undefined
      if (!row) return 'stale'

      const current = rowToSheetDocument(row)
      if (current.revision !== expectedRevision) return 'stale'

      const normalizedNext = normalizeSheetForStorage(kind, slug, input.nextSheet)
      const revision = nextRevision(expectedRevision)
      const updatedAt = timestampOrNow(normalizedNext.updatedAt, `live-play ${kind} sheet ${slug} updatedAt`)
      const document = {
        ...normalizedNext,
        revision,
      }
      const result = database.connection.prepare(`
        UPDATE sheets
        SET document_json = ?, revision = ?, updated_at = ?
        WHERE kind = ? AND slug = ? AND revision = ?
      `).run(
        stringifyStoredDocument(document),
        revision,
        updatedAt,
        kind,
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
    getByRef,
    saveSetupSheet,
    applyLivePlayUpdate,
  }
}

const defaultSheetRepository = <TDocument = unknown>(): SheetRepository<TDocument> =>
  createSqliteSheetRepository<TDocument>(getRotomDatabase())

export const sqliteSheetRepository: SheetRepository = {
  get: (kind, slug) => defaultSheetRepository().get(kind, slug),
  list: (kind) => defaultSheetRepository().list(kind),
  save: (input) => defaultSheetRepository().save(input),
  delete: (kind, slug) => defaultSheetRepository().delete(kind, slug),
  getByRef: (kind, slug) => defaultSheetRepository().getByRef(kind, slug),
  saveSetupSheet: (kind, slug, sheet) => defaultSheetRepository().saveSetupSheet(kind, slug, sheet),
  applyLivePlayUpdate: (input) => defaultSheetRepository().applyLivePlayUpdate(input),
}
