import { validateSlug } from '#shared/paths'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import {
  GROUP_INVENTORY_MAIN_SLUG,
  createDefaultGroupInventoryDocument,
  normalizeGroupInventoryDocument,
  type GroupInventoryDocument,
} from '~/types/groupInventory'
import { sameJsonValue } from '~/utils/serialization'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredRevision,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'

export interface StoredGroupInventoryDocument {
  readonly slug: string
  readonly document: GroupInventoryDocument
  readonly revision: number
  readonly updatedAt: number
}

export interface SaveGroupInventoryDocumentInput {
  readonly slug: string
  readonly document: unknown
  readonly revision: number
  readonly updatedAt: number
}

export interface GetOrCreateGroupInventoryInput {
  readonly slug?: string
  readonly now?: number
}

export interface ReplaceSetupInventoryInput {
  readonly slug?: string
  readonly expectedRevision: number
  readonly document: unknown
  readonly now?: number
}

export type ReplaceSetupInventoryResult =
  | {
    readonly stale: false
    readonly changed: boolean
    readonly document: GroupInventoryDocument
  }
  | {
    readonly stale: true
    readonly current: GroupInventoryDocument | null
  }

export interface ApplyLivePlayGroupInventoryUpdateInput {
  readonly slug?: string
  readonly expectedRevision: number
  readonly nextDocument: unknown
  readonly now?: number
}

export interface GroupInventoryRevisionExpectation {
  readonly slug: string
  readonly revision: number
}

export interface GroupInventoryRevisionMismatch {
  readonly slug: string
  readonly expectedRevision: number
  readonly currentRevision: number | null
}

export class GroupInventoryRevisionConflictError extends Error {
  readonly mismatches: readonly GroupInventoryRevisionMismatch[]

  constructor(mismatches: readonly GroupInventoryRevisionMismatch[]) {
    const details = mismatches.map(mismatch => (
      `${mismatch.slug} expected revision ${mismatch.expectedRevision}, ${
        mismatch.currentRevision === null
          ? 'but it is missing'
          : `current revision is ${mismatch.currentRevision}`
      }`
    )).join('; ')
    super(`Consulted group inventory revisions changed: ${details}`)
    this.name = 'GroupInventoryRevisionConflictError'
    this.mismatches = mismatches.map(mismatch => ({ ...mismatch }))
  }
}

export type LivePlayGroupInventoryUpdateResult =
  | {
    readonly status: 'applied'
    readonly document: GroupInventoryDocument
  }
  | {
    readonly status: 'stale'
    readonly current: GroupInventoryDocument | null
  }

export interface GroupInventoryRepository {
  readonly database?: RotomDatabase
  get(slug?: string): StoredGroupInventoryDocument | null
  getOrCreate(input?: GetOrCreateGroupInventoryInput): StoredGroupInventoryDocument
  save(input: SaveGroupInventoryDocumentInput): StoredGroupInventoryDocument
  replaceSetupInventory(input: ReplaceSetupInventoryInput): ReplaceSetupInventoryResult
  assertRevisions(expectations: readonly GroupInventoryRevisionExpectation[]): void
  applyLivePlayUpdate(input: ApplyLivePlayGroupInventoryUpdateInput): LivePlayGroupInventoryUpdateResult
}

interface GroupInventoryRow {
  readonly slug: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly updated_at: unknown
}

const timestampOrNow = (value: unknown, label: string): number => {
  if (value === undefined || value === null) return parseStoredTimestamp(Date.now(), label)
  return parseStoredTimestamp(value, label)
}

const nowTimestamp = (value?: number): number => timestampOrNow(value ?? Date.now(), 'timestamp')

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const defaultedSlug = (slug?: string): string => validateSlug(slug ?? GROUP_INVENTORY_MAIN_SLUG, 'group inventory slug')

const documentSourceRecord = (document: unknown): Record<string, unknown> => (
  isRecord(document) ? document : {}
)

const normalizeGroupInventoryForStorage = (
  document: unknown,
  sourceLabel: string,
  overrides: { readonly slug?: string; readonly revision?: number; readonly updatedAt?: number } = {},
): GroupInventoryDocument => {
  const source = documentSourceRecord(document)
  const slug = validateSlug(overrides.slug ?? source.slug ?? GROUP_INVENTORY_MAIN_SLUG, `${sourceLabel} slug`)
  const revision = normalizeRevision(overrides.revision ?? source.revision)
  const updatedAt = timestampOrNow(overrides.updatedAt ?? source.updatedAt, `${sourceLabel} updatedAt`)
  const normalized = normalizeGroupInventoryDocument(
    {
      ...source,
      slug,
      revision,
      updatedAt,
    },
    { slug, now: updatedAt },
  )

  return {
    ...normalized,
    slug,
    revision,
    updatedAt,
  }
}

const rowToGroupInventoryDocument = (row: GroupInventoryRow): StoredGroupInventoryDocument => {
  if (typeof row.slug !== 'string') throw new Error('group_inventories.slug must be a string')
  if (typeof row.document_json !== 'string') throw new Error('group_inventories.document_json must be a string')

  const slug = validateSlug(row.slug, 'group_inventories.slug')
  const revision = parseStoredRevision(row.revision, `group inventory ${slug} revision`)
  const updatedAt = parseStoredTimestamp(row.updated_at, `group inventory ${slug} updated_at`)
  const document = normalizeGroupInventoryForStorage(
    parseStoredDocumentJson(row.document_json, `group inventory ${slug}`),
    `SQLite group inventory ${slug}`,
    { slug, revision, updatedAt },
  )

  return { slug, document, revision, updatedAt }
}

const normalizeSaveInput = (input: SaveGroupInventoryDocumentInput): GroupInventoryDocument => {
  const slug = validateSlug(input.slug, 'group inventory slug')
  const revision = parseStoredRevision(input.revision, 'group inventory revision')
  const updatedAt = parseStoredTimestamp(input.updatedAt, 'group inventory updatedAt')
  return normalizeGroupInventoryForStorage(input.document, `group inventory ${slug}`, { slug, revision, updatedAt })
}

const semanticGroupInventorySnapshot = (document: GroupInventoryDocument): Record<string, unknown> => {
  const snapshot = cloneStoredJson(document) as unknown as Record<string, unknown>
  delete snapshot.slug
  delete snapshot.revision
  delete snapshot.updatedAt
  return snapshot
}

export const createSqliteGroupInventoryRepository = (
  database: RotomDatabase = getRotomDatabase(),
): GroupInventoryRepository => {
  const getRow = (slugInput?: string): GroupInventoryRow | undefined => {
    const slug = defaultedSlug(slugInput)
    return database.connection.prepare(`
      SELECT slug, document_json, revision, updated_at
      FROM group_inventories
      WHERE slug = ?
    `).get(slug) as unknown as GroupInventoryRow | undefined
  }

  const get = (slug?: string): StoredGroupInventoryDocument | null => {
    const row = getRow(slug)
    return row ? rowToGroupInventoryDocument(row) : null
  }

  const getForUpdate = (slug?: string): GroupInventoryDocument | null => get(slug)?.document ?? null

  const writeDocument = (
    documentInput: GroupInventoryDocument,
    mode: 'insert' | 'upsert' | 'update',
    expectedRevision?: number,
  ): void => {
    const document = normalizeGroupInventoryForStorage(documentInput, `group inventory ${documentInput.slug}`, {
      slug: documentInput.slug,
      revision: documentInput.revision,
      updatedAt: documentInput.updatedAt,
    })

    if (mode === 'insert') {
      database.connection.prepare(`
        INSERT INTO group_inventories (slug, document_json, revision, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(document.slug, stringifyStoredDocument(document), document.revision, document.updatedAt)
      return
    }

    if (mode === 'update') {
      if (expectedRevision === undefined) throw new Error('expected group inventory revision is required for update')
      const result = database.connection.prepare(`
        UPDATE group_inventories
        SET document_json = ?, revision = ?, updated_at = ?
        WHERE slug = ? AND revision = ?
      `).run(stringifyStoredDocument(document), document.revision, document.updatedAt, document.slug, expectedRevision)
      if (Number(result.changes) !== 1) throw new Error(`Group inventory ${document.slug} changed before it could be updated`)
      return
    }

    database.connection.prepare(`
      INSERT INTO group_inventories (slug, document_json, revision, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        document_json = excluded.document_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(document.slug, stringifyStoredDocument(document), document.revision, document.updatedAt)
  }

  const save = (input: SaveGroupInventoryDocumentInput): StoredGroupInventoryDocument =>
    database.withTransaction(() => {
      const document = normalizeSaveInput(input)
      writeDocument(document, 'upsert')
      return {
        slug: document.slug,
        document,
        revision: document.revision,
        updatedAt: document.updatedAt,
      }
    })

  const getOrCreate = (input: GetOrCreateGroupInventoryInput = {}): StoredGroupInventoryDocument =>
    database.withTransaction(() => {
      const slug = defaultedSlug(input.slug)
      const current = get(slug)
      if (current) return current

      const timestamp = nowTimestamp(input.now)
      const document = normalizeGroupInventoryForStorage(
        createDefaultGroupInventoryDocument({ slug, now: timestamp }),
        `new group inventory ${slug}`,
        { slug, revision: 0, updatedAt: timestamp },
      )
      writeDocument(document, 'insert')
      return { slug, document, revision: document.revision, updatedAt: document.updatedAt }
    })

  const replaceSetupInventory = (input: ReplaceSetupInventoryInput): ReplaceSetupInventoryResult =>
    database.withTransaction(() => {
      const slug = defaultedSlug(input.slug)
      const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected group inventory revision')
      const existing = getForUpdate(slug)
      const initialTimestamp = existing ? undefined : nowTimestamp(input.now)
      const current = existing ?? normalizeGroupInventoryForStorage(
        createDefaultGroupInventoryDocument({ slug, now: initialTimestamp }),
        `new group inventory ${slug}`,
        { slug, revision: 0, updatedAt: initialTimestamp },
      )

      if (current.revision !== expectedRevision) return { stale: true, current }

      const candidate = normalizeGroupInventoryForStorage(input.document, `setup group inventory ${slug}`, {
        slug,
        revision: current.revision,
        updatedAt: current.updatedAt,
      })

      if (sameJsonValue(semanticGroupInventorySnapshot(current), semanticGroupInventorySnapshot(candidate))) {
        if (!existing) writeDocument(current, 'insert')
        return { stale: false, changed: false, document: current }
      }

      const nextDocument = normalizeGroupInventoryForStorage(candidate, `setup group inventory ${slug}`, {
        slug,
        revision: nextRevision(current.revision),
        updatedAt: initialTimestamp ?? nowTimestamp(input.now),
      })

      try {
        writeDocument(nextDocument, existing ? 'update' : 'insert', current.revision)
      } catch {
        return { stale: true, current: getForUpdate(slug) }
      }

      return { stale: false, changed: true, document: nextDocument }
    })

  const assertRevisions = (
    expectations: readonly GroupInventoryRevisionExpectation[],
  ): void => {
    database.withTransaction(() => {
      const expectedBySlug = new Map<string, GroupInventoryRevisionExpectation>()
      for (const expectation of expectations) {
        const slug = defaultedSlug(expectation.slug)
        const revision = parseStoredRevision(
          expectation.revision,
          `expected group inventory ${slug} revision`,
        )
        const existing = expectedBySlug.get(slug)
        if (existing && existing.revision !== revision) {
          throw new Error(
            `Group inventory ${slug} has conflicting expected revisions ${existing.revision} and ${revision}`,
          )
        }
        expectedBySlug.set(slug, { slug, revision })
      }

      const mismatches: GroupInventoryRevisionMismatch[] = []
      for (const expectation of expectedBySlug.values()) {
        const current = get(expectation.slug)
        if (current?.revision === expectation.revision) continue
        mismatches.push({
          slug: expectation.slug,
          expectedRevision: expectation.revision,
          currentRevision: current?.revision ?? null,
        })
      }
      if (mismatches.length > 0) {
        throw new GroupInventoryRevisionConflictError(mismatches)
      }
    })
  }

  const applyLivePlayUpdate = (input: ApplyLivePlayGroupInventoryUpdateInput): LivePlayGroupInventoryUpdateResult =>
    database.withTransaction(() => {
      const slug = defaultedSlug(input.slug)
      const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected group inventory revision')
      const current = getForUpdate(slug)
      if (!current) return { status: 'stale', current: null }
      if (current.revision !== expectedRevision) return { status: 'stale', current }

      const source = documentSourceRecord(input.nextDocument)
      const updatedAt = timestampOrNow(input.now ?? source.updatedAt, `live-play group inventory ${slug} updatedAt`)
      const nextDocument = normalizeGroupInventoryForStorage(input.nextDocument, `live-play group inventory ${slug}`, {
        slug,
        revision: nextRevision(expectedRevision),
        updatedAt,
      })

      try {
        writeDocument(nextDocument, 'update', expectedRevision)
        return { status: 'applied', document: nextDocument }
      } catch {
        return { status: 'stale', current: getForUpdate(slug) }
      }
    })

  return {
    database,
    get,
    getOrCreate,
    save,
    replaceSetupInventory,
    assertRevisions,
    applyLivePlayUpdate,
  }
}

const defaultGroupInventoryRepository = (): GroupInventoryRepository =>
  createSqliteGroupInventoryRepository(getRotomDatabase())

export const sqliteGroupInventoryRepository: GroupInventoryRepository = {
  get: (slug) => defaultGroupInventoryRepository().get(slug),
  getOrCreate: (input) => defaultGroupInventoryRepository().getOrCreate(input),
  save: (input) => defaultGroupInventoryRepository().save(input),
  replaceSetupInventory: (input) => defaultGroupInventoryRepository().replaceSetupInventory(input),
  assertRevisions: (expectations) => defaultGroupInventoryRepository().assertRevisions(expectations),
  applyLivePlayUpdate: (input) => defaultGroupInventoryRepository().applyLivePlayUpdate(input),
}
