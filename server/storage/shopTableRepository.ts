import { slugify, validateSlug } from '#shared/paths'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  SHOP_DEFAULT_NAME,
  SHOP_DEFAULT_SLUG,
  normalizeShopTableDocument,
  type ShopTableDocument,
} from '~/types/shop'
import { sameJsonValue } from '~/utils/serialization'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredRevision,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export interface StoredShopTableDocument {
  readonly slug: string
  readonly document: ShopTableDocument
  readonly revision: number
  readonly updatedAt: number
}

export interface CreateShopTableInput {
  /** Exact slug to create. When omitted, a unique slug is allocated from the document/name/base. */
  readonly slug?: string
  readonly baseSlug?: string
  readonly name?: string
  readonly document?: unknown
  readonly now?: number
}

export interface ReplaceSetupShopInput {
  readonly slug: string
  readonly expectedRevision: number
  readonly document: unknown
  readonly now?: number
}

export type ReplaceSetupShopResult =
  | {
    readonly stale: false
    readonly changed: boolean
    readonly document: ShopTableDocument
  }
  | {
    readonly stale: true
    readonly current: ShopTableDocument | null
  }

export interface DeleteShopTableDocumentResult {
  readonly document: ShopTableDocument
}

export interface ApplyLivePlayShopUpdateInput {
  readonly slug: string
  readonly expectedRevision: number
  readonly nextDocument: unknown
  readonly now?: number
}

export type LivePlayShopUpdateResult =
  | {
    readonly status: 'applied'
    readonly document: ShopTableDocument
  }
  | {
    readonly status: 'stale'
    readonly current: ShopTableDocument | null
  }

export interface ShopTableRepository {
  readonly database?: RotomDatabase
  get(slug: string): StoredShopTableDocument | null
  list(): readonly StoredShopTableDocument[]
  create(input?: CreateShopTableInput): StoredShopTableDocument
  replaceSetupShop(input: ReplaceSetupShopInput): ReplaceSetupShopResult
  deleteDocument(slug: string): DeleteShopTableDocumentResult | null
  allocateSlug(base: string): string
  applyLivePlayUpdate(input: ApplyLivePlayShopUpdateInput): LivePlayShopUpdateResult
}

interface ShopTableRow {
  readonly slug: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly updated_at: unknown
}

const MAX_SLUG_ALLOCATION_ATTEMPTS = 10000

const timestampOrNow = (value: unknown, label: string): number => {
  if (value === undefined || value === null) return parseStoredTimestamp(Date.now(), label)
  return parseStoredTimestamp(value, label)
}

const nowTimestamp = (value?: number): number => timestampOrNow(value ?? Date.now(), 'timestamp')

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const documentSourceRecord = (document: unknown): Record<string, unknown> => (
  isRecord(document) ? document : {}
)

const stringValue = (value: unknown): string | undefined => (
  typeof value === 'string' ? value : undefined
)

const normalizeShopForStorage = (
  document: unknown,
  sourceLabel: string,
  overrides: {
    readonly slug?: string
    readonly revision?: number
    readonly updatedAt?: number
    readonly name?: string
  } = {},
): ShopTableDocument => {
  const source = documentSourceRecord(document)
  const slug = validateSlug(overrides.slug ?? source.slug ?? SHOP_DEFAULT_SLUG, `${sourceLabel} slug`)
  const revision = normalizeRevision(overrides.revision ?? source.revision)
  const updatedAt = timestampOrNow(overrides.updatedAt ?? source.updatedAt, `${sourceLabel} updatedAt`)
  const normalized = normalizeShopTableDocument(
    {
      ...source,
      slug,
      revision,
      updatedAt,
    },
    {
      slug,
      now: updatedAt,
      name: overrides.name,
    },
  )

  return {
    ...normalized,
    slug,
    revision,
    updatedAt,
  }
}

const rowToShopTableDocument = (row: ShopTableRow): StoredShopTableDocument => {
  if (typeof row.slug !== 'string') throw new Error('shop_tables.slug must be a string')
  if (typeof row.document_json !== 'string') throw new Error('shop_tables.document_json must be a string')

  const slug = validateSlug(row.slug, 'shop_tables.slug')
  const revision = parseStoredRevision(row.revision, `shop table ${slug} revision`)
  const updatedAt = parseStoredTimestamp(row.updated_at, `shop table ${slug} updated_at`)
  const document = normalizeShopForStorage(
    parseStoredDocumentJson(row.document_json, `shop table ${slug}`),
    `SQLite shop table ${slug}`,
    { slug, revision, updatedAt },
  )

  return { slug, document, revision, updatedAt }
}

const semanticShopSnapshot = (document: ShopTableDocument): Record<string, unknown> => {
  const snapshot = cloneStoredJson(document) as unknown as Record<string, unknown>
  delete snapshot.slug
  delete snapshot.revision
  delete snapshot.updatedAt
  return snapshot
}

const slugAllocationBase = (input: CreateShopTableInput, source: Record<string, unknown>): string => (
  input.baseSlug
  ?? input.name
  ?? stringValue(source.name)
  ?? stringValue(source.slug)
  ?? SHOP_DEFAULT_NAME
)

export const createSqliteShopTableRepository = (
  database: RotomDatabase = getRotomDatabase(),
): ShopTableRepository => {
  const getRow = (slugInput: string): ShopTableRow | undefined => {
    const slug = validateSlug(slugInput, 'shop slug')
    return database.connection.prepare(`
      SELECT slug, document_json, revision, updated_at
      FROM shop_tables
      WHERE slug = ?
    `).get(slug) as unknown as ShopTableRow | undefined
  }

  const get = (slug: string): StoredShopTableDocument | null => {
    const row = getRow(slug)
    return row ? rowToShopTableDocument(row) : null
  }

  const getDocumentForUpdate = (slug: string): ShopTableDocument | null => get(slug)?.document ?? null

  const shopExists = (slug: string): boolean => getRow(slug) !== undefined

  const list = (): readonly StoredShopTableDocument[] => database.connection.prepare(`
    SELECT slug, document_json, revision, updated_at
    FROM shop_tables
    ORDER BY slug ASC
  `).all().map((row) => rowToShopTableDocument(row as unknown as ShopTableRow))

  const writeDocument = (
    documentInput: ShopTableDocument,
    mode: 'insert' | 'update',
    expectedRevision?: number,
  ): void => {
    const document = normalizeShopForStorage(documentInput, `shop table ${documentInput.slug}`, {
      slug: documentInput.slug,
      revision: documentInput.revision,
      updatedAt: documentInput.updatedAt,
    })

    if (mode === 'insert') {
      database.connection.prepare(`
        INSERT INTO shop_tables (slug, document_json, revision, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(document.slug, stringifyStoredDocument(document), document.revision, document.updatedAt)
      return
    }

    if (expectedRevision === undefined) throw new Error('expected shop table revision is required for update')
    const result = database.connection.prepare(`
      UPDATE shop_tables
      SET document_json = ?, revision = ?, updated_at = ?
      WHERE slug = ? AND revision = ?
    `).run(stringifyStoredDocument(document), document.revision, document.updatedAt, document.slug, expectedRevision)
    if (Number(result.changes) !== 1) throw new Error(`Shop table ${document.slug} changed before it could be updated`)
  }

  const allocateSlug = (base: string): string => {
    const root = slugify(base) || SHOP_DEFAULT_SLUG
    if (!shopExists(root)) return root
    for (let index = 1; index < MAX_SLUG_ALLOCATION_ATTEMPTS; index += 1) {
      const candidate = `${root}-${index}`
      if (!shopExists(candidate)) return candidate
    }
    throw new Error('could not allocate shop table slug')
  }

  const create = (input: CreateShopTableInput = {}): StoredShopTableDocument => database.withTransaction(() => {
    const source = documentSourceRecord(input.document)
    const slug = input.slug === undefined
      ? allocateSlug(slugAllocationBase(input, source))
      : validateSlug(input.slug, 'shop slug')
    if (shopExists(slug)) throw new Error(`Shop table ${slug} already exists`)

    const updatedAt = nowTimestamp(input.now)
    const document = normalizeShopForStorage(input.document ?? {}, `new shop table ${slug}`, {
      slug,
      revision: 0,
      updatedAt,
      name: input.name,
    })
    writeDocument(document, 'insert')
    return { slug, document, revision: document.revision, updatedAt: document.updatedAt }
  })

  const replaceSetupShop = (input: ReplaceSetupShopInput): ReplaceSetupShopResult => database.withTransaction(() => {
    const slug = validateSlug(input.slug, 'shop slug')
    const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected shop table revision')
    const current = getDocumentForUpdate(slug)
    if (!current) return { stale: true, current: null }
    if (current.revision !== expectedRevision) return { stale: true, current }

    const candidate = normalizeShopForStorage(input.document, `setup shop table ${slug}`, {
      slug,
      revision: current.revision,
      updatedAt: current.updatedAt,
    })

    if (sameJsonValue(semanticShopSnapshot(current), semanticShopSnapshot(candidate))) {
      return { stale: false, changed: false, document: current }
    }

    const updatedAt = nowTimestamp(input.now)
    const nextDocument = normalizeShopForStorage(candidate, `setup shop table ${slug}`, {
      slug,
      revision: nextRevision(current.revision),
      updatedAt,
    })

    try {
      writeDocument(nextDocument, 'update', current.revision)
      return { stale: false, changed: true, document: nextDocument }
    } catch {
      return { stale: true, current: getDocumentForUpdate(slug) }
    }
  })

  const deleteDocument = (slugInput: string): DeleteShopTableDocumentResult | null => database.withTransaction(() => {
    const slug = validateSlug(slugInput, 'shop slug')
    const current = getDocumentForUpdate(slug)
    if (!current) return null
    database.connection.prepare('DELETE FROM shop_tables WHERE slug = ?').run(slug)
    return { document: current }
  })

  const applyLivePlayUpdate = (input: ApplyLivePlayShopUpdateInput): LivePlayShopUpdateResult => database.withTransaction(() => {
    const slug = validateSlug(input.slug, 'shop slug')
    const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected shop table revision')
    const current = getDocumentForUpdate(slug)
    if (!current) return { status: 'stale', current: null }
    if (current.revision !== expectedRevision) return { status: 'stale', current }

    const source = documentSourceRecord(input.nextDocument)
    const updatedAt = timestampOrNow(input.now ?? source.updatedAt, `live-play shop table ${slug} updatedAt`)
    const nextDocument = normalizeShopForStorage(input.nextDocument, `live-play shop table ${slug}`, {
      slug,
      revision: nextRevision(expectedRevision),
      updatedAt,
    })

    try {
      writeDocument(nextDocument, 'update', expectedRevision)
      return { status: 'applied', document: nextDocument }
    } catch {
      return { status: 'stale', current: getDocumentForUpdate(slug) }
    }
  })

  return {
    database,
    get,
    list,
    create,
    replaceSetupShop,
    deleteDocument,
    allocateSlug,
    applyLivePlayUpdate,
  }
}

const defaultShopTableRepository = (): ShopTableRepository =>
  createSqliteShopTableRepository(getRotomDatabase())

export const sqliteShopTableRepository: ShopTableRepository = {
  get: (slug) => defaultShopTableRepository().get(slug),
  list: () => defaultShopTableRepository().list(),
  create: (input) => defaultShopTableRepository().create(input),
  replaceSetupShop: (input) => defaultShopTableRepository().replaceSetupShop(input),
  deleteDocument: (slug) => defaultShopTableRepository().deleteDocument(slug),
  allocateSlug: (base) => defaultShopTableRepository().allocateSlug(base),
  applyLivePlayUpdate: (input) => defaultShopTableRepository().applyLivePlayUpdate(input),
}
