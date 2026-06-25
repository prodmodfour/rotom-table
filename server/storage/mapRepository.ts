import { sanitizeFolderPath, slugify, validateSlug } from '#shared/paths'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import type { SheetKind } from '#shared/sheets'
import type { TabletopMap } from '~/types/map'
import { sameJsonValue } from '~/utils/serialization'
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

export interface CreateMapDocumentInput {
  readonly slug: string
  readonly map: TabletopMap
  readonly now?: number
}

export interface ReplaceSetupMapInput {
  readonly slug: string
  readonly expectedRevision: number
  readonly map: TabletopMap
  readonly now?: number
}

export interface ReplaceSetupMapResult {
  readonly changed: boolean
  readonly map: TabletopMap
}

export interface MoveMapToFolderInput {
  readonly slug: string
  readonly folder: string
  readonly now?: number
}

export interface MoveMapToFolderResult {
  readonly moved: boolean
  readonly map: TabletopMap
}

export interface RenameMapDocumentInput {
  readonly slug: string
  readonly name: string
  readonly now?: number
}

export interface RenameMapDocumentResult {
  readonly oldSlug: string
  readonly newSlug: string
  readonly renamed: boolean
  readonly changed: boolean
  readonly map: TabletopMap
}

export interface DeleteMapDocumentResult {
  readonly map: TabletopMap
}

export interface CreateMapFolderResult {
  readonly created: boolean
  readonly folder: string
}

export interface MoveMapFolderResult {
  readonly moved: boolean
  readonly affectedMapSlugs: readonly string[]
}

export interface DeleteMapFolderResult {
  readonly folder: string
  readonly deletedMapSlugs: readonly string[]
  readonly deletedMaps: readonly TabletopMap[]
}

export interface RetargetMapSheetPlacementsResult {
  readonly path: string
  readonly map: TabletopMap
  readonly placementCount: number
}

export interface RetargetMapSheetPlacementsOptions {
  readonly now?: () => number
}

export interface ApplyLivePlayMapUpdateInput {
  readonly slug: string
  readonly expectedRevision: number
  readonly nextMap: TabletopMap
}

export type LivePlayMapUpdateResult = 'applied' | 'stale'

export interface MapRepository<TDocument = unknown> {
  readonly database?: RotomDatabase
  get(slug: string): StoredMapDocument<TDocument> | null
  list(): readonly StoredMapDocument<TDocument>[]
  save(input: SaveMapDocumentInput<TDocument>): StoredMapDocument<TDocument>
  create(input: CreateMapDocumentInput): TabletopMap
  replaceSetupMap(input: ReplaceSetupMapInput): ReplaceSetupMapResult | null
  moveToFolder(input: MoveMapToFolderInput): MoveMapToFolderResult | null
  rename(input: RenameMapDocumentInput): RenameMapDocumentResult | null
  delete(slug: string): boolean
  deleteDocument(slug: string): DeleteMapDocumentResult | null
  allocateSlug(base: string): string
  listFolders(): readonly string[]
  createFolder(folder: string, now?: number): CreateMapFolderResult
  moveFolder(from: string, to: string, now?: number): MoveMapFolderResult | null
  deleteFolder(folder: string): DeleteMapFolderResult | null
  retargetSheetReferences(kind: SheetKind, oldSlug: string, newSlug: string, options?: RetargetMapSheetPlacementsOptions): RetargetMapSheetPlacementsResult[]
  removeSheetReferences(kind: SheetKind, slug: string, options?: RetargetMapSheetPlacementsOptions): RetargetMapSheetPlacementsResult[]
  clearOperationHistory(slug: string): void
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

interface FolderRow {
  readonly path: unknown
}

const DEFAULT_MAP_SLUG = 'untitled-map'
const MAX_SLUG_ALLOCATION_ATTEMPTS = 10000

const timestampOrNow = (value: unknown, label: string): number => {
  if (value === undefined || value === null) return parseStoredTimestamp(Date.now(), label)
  return parseStoredTimestamp(value, label)
}

const nowTimestamp = (value?: number): number => timestampOrNow(value ?? Date.now(), 'timestamp')

const normalizeFolder = (value: unknown, label = 'folder'): string => sanitizeFolderPath(String(value ?? ''), {
  allowEmpty: true,
  label,
})

const folderPrefixes = (folder: string): readonly string[] => {
  if (!folder) return []
  const parts = folder.split('/')
  return parts.map((_part, index) => parts.slice(0, index + 1).join('/'))
}

const rowToMapDocument = <TDocument>(row: MapRow): StoredMapDocument<TDocument> => {
  if (typeof row.slug !== 'string') throw new Error('maps.slug must be a string')
  if (typeof row.document_json !== 'string') throw new Error('maps.document_json must be a string')

  const slug = validateSlug(row.slug, 'maps.slug')
  const revision = parseStoredRevision(row.revision, `map ${slug} revision`)
  const updatedAt = parseStoredTimestamp(row.updated_at, `map ${slug} updated_at`)
  return {
    slug,
    document: documentWithAuthorityFields(
      parseStoredDocumentJson<TDocument>(row.document_json, `map ${slug}`),
      slug,
      revision,
      updatedAt,
    ),
    revision,
    updatedAt,
  }
}

const normalizeInput = <TDocument>(input: SaveMapDocumentInput<TDocument>): SaveMapDocumentInput<TDocument> => ({
  slug: validateSlug(input.slug, 'map slug'),
  document: cloneStoredJson(input.document),
  revision: parseStoredRevision(input.revision, 'map revision'),
  updatedAt: parseStoredTimestamp(input.updatedAt, 'map updatedAt'),
})

const documentWithAuthorityFields = <TDocument>(
  document: TDocument,
  slug: string,
  revision: number,
  updatedAt: number,
): TDocument => {
  const cloned = cloneStoredJson(document)
  if (cloned && typeof cloned === 'object' && !Array.isArray(cloned)) {
    const record = cloned as Record<string, unknown>
    record.slug = slug
    record.revision = revision
    record.updatedAt = updatedAt
  }
  return cloned
}

const normalizeTabletopMapForStorage = (
  map: TabletopMap,
  sourceLabel: string,
  overrides: { readonly slug?: string; readonly folder?: string; readonly revision?: number; readonly updatedAt?: number } = {},
): TabletopMap => {
  const slug = validateSlug(overrides.slug ?? map.slug, 'map slug')
  const folder = normalizeFolder(overrides.folder ?? map.folder ?? '', 'map folder')
  const revision = normalizeRevision(overrides.revision ?? map.revision)
  const updatedAt = timestampOrNow(overrides.updatedAt ?? map.updatedAt, `${sourceLabel} updatedAt`)
  const normalized = normalizeMapDocument({ ...map, slug, folder, revision, updatedAt }, { sourceLabel, folder })
  if (normalized.slug !== slug) throw new Error(`${sourceLabel} slug must match ${slug}`)
  return {
    ...normalized,
    slug,
    folder,
    revision,
    updatedAt,
  }
}

const storedDocumentToTabletopMap = (stored: StoredMapDocument): TabletopMap => {
  const map = normalizeMapDocument(stored.document, { sourceLabel: `SQLite map ${stored.slug}` })
  if (map.slug !== stored.slug) {
    throw new Error(`SQLite map ${stored.slug} document slug must match the row slug`)
  }
  return {
    ...map,
    folder: normalizeFolder(map.folder ?? '', `map ${stored.slug} folder`),
    revision: stored.revision,
    updatedAt: stored.updatedAt,
  }
}

const semanticMapSnapshot = (map: TabletopMap): Record<string, unknown> => {
  const snapshot = cloneStoredJson(map) as unknown as Record<string, unknown>
  delete snapshot.slug
  delete snapshot.folder
  delete snapshot.revision
  delete snapshot.createdAt
  delete snapshot.updatedAt
  return snapshot
}

const mapContainsSheetReferences = (map: TabletopMap, kind: SheetKind, slug: string): boolean => (
  (map.placements ?? []).some((placement) => placement.sheetKind === kind && placement.sheetSlug === slug)
)

export const createSqliteMapRepository = <TDocument = unknown>(
  database: RotomDatabase = getRotomDatabase(),
): MapRepository<TDocument> => {
  const getRow = (slug: string): MapRow | undefined => {
    const parsedSlug = validateSlug(slug, 'map slug')
    return database.connection.prepare(`
      SELECT slug, document_json, revision, updated_at
      FROM maps
      WHERE slug = ?
    `).get(parsedSlug) as unknown as MapRow | undefined
  }

  const get = (slug: string): StoredMapDocument<TDocument> | null => {
    const row = getRow(slug)
    return row ? rowToMapDocument<TDocument>(row) : null
  }

  const getStoredForUpdate = (slug: string): StoredMapDocument | null => {
    const row = getRow(slug)
    return row ? rowToMapDocument(row) : null
  }

  const getMapForUpdate = (slug: string): TabletopMap | null => {
    const stored = getStoredForUpdate(slug)
    return stored ? storedDocumentToTabletopMap(stored) : null
  }

  const mapExists = (slug: string): boolean => getRow(slug) !== undefined

  const list = (): readonly StoredMapDocument<TDocument>[] => database.connection.prepare(`
    SELECT slug, document_json, revision, updated_at
    FROM maps
    ORDER BY slug ASC
  `).all().map((row) => rowToMapDocument<TDocument>(row as unknown as MapRow))

  const upsertFolderRows = (folder: string, updatedAt: number): void => {
    for (const prefix of folderPrefixes(folder)) {
      database.connection.prepare(`
        INSERT INTO map_folders (path, updated_at)
        VALUES (?, ?)
        ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at
      `).run(prefix, updatedAt)
    }
  }

  const clearOperationHistory = (slug: string): void => {
    const parsedSlug = validateSlug(slug, 'map slug')
    database.connection.prepare('DELETE FROM live_play_ops WHERE map_slug = ?').run(parsedSlug)
  }

  const writeMap = (map: TabletopMap, mode: 'insert' | 'upsert' | 'update', expectedRevision?: number): void => {
    const revision = normalizeRevision(map.revision)
    const updatedAt = timestampOrNow(map.updatedAt, `map ${map.slug} updatedAt`)
    const document = { ...map, revision, updatedAt }
    upsertFolderRows(normalizeFolder(map.folder ?? '', `map ${map.slug} folder`), updatedAt)

    if (mode === 'insert') {
      database.connection.prepare(`
        INSERT INTO maps (slug, document_json, revision, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(map.slug, stringifyStoredDocument(document), revision, updatedAt)
      return
    }

    if (mode === 'update') {
      if (expectedRevision === undefined) throw new Error('expected map revision is required for update')
      const result = database.connection.prepare(`
        UPDATE maps
        SET document_json = ?, revision = ?, updated_at = ?
        WHERE slug = ? AND revision = ?
      `).run(stringifyStoredDocument(document), revision, updatedAt, map.slug, expectedRevision)
      if (Number(result.changes) !== 1) throw new Error(`Map ${map.slug} changed before it could be updated`)
      return
    }

    database.connection.prepare(`
      INSERT INTO maps (slug, document_json, revision, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        document_json = excluded.document_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(map.slug, stringifyStoredDocument(document), revision, updatedAt)
  }

  const save = (input: SaveMapDocumentInput<TDocument>): StoredMapDocument<TDocument> =>
    database.withTransaction(() => {
      const normalized = normalizeInput(input)
      const document = documentWithAuthorityFields(
        normalized.document,
        normalized.slug,
        normalized.revision,
        normalized.updatedAt,
      )
      if (document && typeof document === 'object' && !Array.isArray(document)) {
        const folder = (document as Record<string, unknown>).folder
        if (typeof folder === 'string') upsertFolderRows(normalizeFolder(folder, `map ${normalized.slug} folder`), normalized.updatedAt)
      }
      database.connection.prepare(`
        INSERT INTO maps (slug, document_json, revision, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(slug) DO UPDATE SET
          document_json = excluded.document_json,
          revision = excluded.revision,
          updated_at = excluded.updated_at
      `).run(
        normalized.slug,
        stringifyStoredDocument(document),
        normalized.revision,
        normalized.updatedAt,
      )
      return {
        slug: normalized.slug,
        document,
        revision: normalized.revision,
        updatedAt: normalized.updatedAt,
      }
    })

  const create = (input: CreateMapDocumentInput): TabletopMap => database.withTransaction(() => {
    const slug = validateSlug(input.slug, 'map slug')
    if (mapExists(slug)) throw new Error(`Map ${slug} already exists`)
    const timestamp = nowTimestamp(input.now)
    const map = normalizeTabletopMapForStorage(input.map, `new map ${slug}`, {
      slug,
      revision: 0,
      updatedAt: timestamp,
    })
    writeMap(map, 'insert')
    return map
  })

  const saveSetupMap = (map: TabletopMap): TabletopMap => database.withTransaction(() => {
    const normalized = normalizeTabletopMapForStorage(map, `setup map ${map.slug}`, {
      revision: normalizeRevision(map.revision),
      updatedAt: timestampOrNow(map.updatedAt, `setup map ${map.slug} updatedAt`),
    })
    writeMap(normalized, 'upsert')
    return normalized
  })

  const replaceSetupMap = (input: ReplaceSetupMapInput): ReplaceSetupMapResult | null => database.withTransaction(() => {
    const slug = validateSlug(input.slug, 'map slug')
    const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected map revision')
    const current = getMapForUpdate(slug)
    if (!current) return null
    if (current.revision !== expectedRevision) throw new Error(`Map ${slug} is stale; expected revision ${expectedRevision}, current revision ${current.revision}`)

    const sourceWithServerFields: TabletopMap = {
      ...input.map,
      slug,
      folder: current.folder ?? '',
      revision: current.revision,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      ...(Object.prototype.hasOwnProperty.call(input.map, 'moveUsage') || current.moveUsage === undefined
        ? {}
        : { moveUsage: current.moveUsage }),
    }
    const candidate = normalizeTabletopMapForStorage(sourceWithServerFields, `setup map ${slug}`, {
      slug,
      folder: current.folder ?? '',
      revision: current.revision,
      updatedAt: current.updatedAt,
    })

    if (sameJsonValue(semanticMapSnapshot(current), semanticMapSnapshot(candidate))) {
      return { changed: false, map: current }
    }

    const updatedAt = nowTimestamp(input.now)
    const nextMap = normalizeTabletopMapForStorage(candidate, `setup map ${slug}`, {
      slug,
      folder: current.folder ?? '',
      revision: nextRevision(normalizeRevision(current.revision)),
      updatedAt,
    })
    writeMap(nextMap, 'update', current.revision)
    clearOperationHistory(slug)
    return { changed: true, map: nextMap }
  })

  const moveToFolder = (input: MoveMapToFolderInput): MoveMapToFolderResult | null => database.withTransaction(() => {
    const slug = validateSlug(input.slug, 'map slug')
    const folder = normalizeFolder(input.folder, 'map folder')
    const current = getMapForUpdate(slug)
    if (!current) return null
    if ((current.folder ?? '') === folder) return { moved: false, map: current }

    const updatedAt = nowTimestamp(input.now)
    const nextMap = normalizeTabletopMapForStorage({ ...current, folder }, `map ${slug} move`, {
      slug,
      folder,
      revision: nextRevision(normalizeRevision(current.revision)),
      updatedAt,
    })
    writeMap(nextMap, 'update', current.revision)
    clearOperationHistory(slug)
    return { moved: true, map: nextMap }
  })

  const allocateSlug = (base: string): string => {
    const root = slugify(base) || DEFAULT_MAP_SLUG
    if (!mapExists(root)) return root
    for (let index = 1; index < MAX_SLUG_ALLOCATION_ATTEMPTS; index += 1) {
      const candidate = `${root}-${index}`
      if (!mapExists(candidate)) return candidate
    }
    throw new Error('could not allocate slug')
  }

  const migrateInteractionModeSlug = (oldSlug: string, newSlug: string, updatedAt: number): void => {
    const row = database.connection.prepare(`
      SELECT interaction_mode
      FROM map_interaction_modes
      WHERE slug = ?
    `).get(oldSlug) as { readonly interaction_mode?: unknown } | undefined
    database.connection.prepare('DELETE FROM map_interaction_modes WHERE slug IN (?, ?)').run(oldSlug, newSlug)
    if (typeof row?.interaction_mode === 'string') {
      database.connection.prepare(`
        INSERT INTO map_interaction_modes (slug, interaction_mode, updated_at)
        VALUES (?, ?, ?)
      `).run(newSlug, row.interaction_mode, updatedAt)
    }
  }

  const rename = (input: RenameMapDocumentInput): RenameMapDocumentResult | null => database.withTransaction(() => {
    const slug = validateSlug(input.slug, 'map slug')
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('name is required')
    const current = getMapForUpdate(slug)
    if (!current) return null

    const desiredSlug = slugify(name)
    const newSlug = desiredSlug && desiredSlug !== slug
      ? (mapExists(desiredSlug) ? allocateSlug(name) : desiredSlug)
      : slug
    const renamed = newSlug !== slug
    const changed = renamed || current.name !== name
    if (!changed) return { oldSlug: slug, newSlug: slug, renamed: false, changed: false, map: current }

    const updatedAt = nowTimestamp(input.now)
    const nextMap = normalizeTabletopMapForStorage({ ...current, slug: newSlug, name }, `map ${slug} rename`, {
      slug: newSlug,
      folder: current.folder ?? '',
      revision: nextRevision(normalizeRevision(current.revision)),
      updatedAt,
    })

    if (renamed) {
      const result = database.connection.prepare(`
        UPDATE maps
        SET slug = ?, document_json = ?, revision = ?, updated_at = ?
        WHERE slug = ? AND revision = ?
      `).run(newSlug, stringifyStoredDocument(nextMap), normalizeRevision(nextMap.revision), nextMap.updatedAt ?? updatedAt, slug, normalizeRevision(current.revision))
      if (Number(result.changes) !== 1) throw new Error(`Map ${slug} changed before it could be renamed`)
      migrateInteractionModeSlug(slug, newSlug, updatedAt)
      clearOperationHistory(slug)
      clearOperationHistory(newSlug)
    } else {
      writeMap(nextMap, 'update', current.revision)
      clearOperationHistory(slug)
    }
    return { oldSlug: slug, newSlug, renamed, changed: true, map: nextMap }
  })

  const deleteDocument = (slugInput: string): DeleteMapDocumentResult | null => database.withTransaction(() => {
    const slug = validateSlug(slugInput, 'map slug')
    const current = getMapForUpdate(slug)
    if (!current) return null
    database.connection.prepare('DELETE FROM maps WHERE slug = ?').run(slug)
    database.connection.prepare('DELETE FROM map_interaction_modes WHERE slug = ?').run(slug)
    clearOperationHistory(slug)
    return { map: current }
  })

  const remove = (slug: string): boolean => deleteDocument(slug) !== null

  const documentFolders = (): string[] => {
    const folders = new Set<string>()
    for (const stored of list() as readonly StoredMapDocument[]) {
      const map = storedDocumentToTabletopMap(stored)
      for (const prefix of folderPrefixes(map.folder ?? '')) folders.add(prefix)
    }
    return [...folders]
  }

  const listFolders = (): readonly string[] => {
    const folders = new Set<string>(documentFolders())
    const rows = database.connection.prepare(`
      SELECT path
      FROM map_folders
      ORDER BY path ASC
    `).all() as unknown as FolderRow[]
    for (const row of rows) {
      if (typeof row.path !== 'string') throw new Error('map_folders.path must be a string')
      folders.add(normalizeFolder(row.path, 'map folder'))
    }
    return [...folders].filter(Boolean).sort((left, right) => left.localeCompare(right))
  }

  const createFolder = (folderInput: string, now?: number): CreateMapFolderResult => database.withTransaction(() => {
    const folder = normalizeFolder(folderInput, 'map folder')
    if (!folder) throw new Error('folder must not be empty')
    const existed = listFolders().includes(folder)
    upsertFolderRows(folder, nowTimestamp(now))
    return { created: !existed, folder }
  })

  const folderExists = (folder: string): boolean => listFolders().includes(folder)

  const folderHasResources = (folder: string): boolean => {
    for (const stored of list() as readonly StoredMapDocument[]) {
      const map = storedDocumentToTabletopMap(stored)
      const mapFolder = map.folder ?? ''
      if (mapFolder === folder || mapFolder.startsWith(`${folder}/`)) return true
    }
    return false
  }

  const remapFolder = (folder: string, from: string, to: string): string => {
    if (folder === from) return to
    if (folder.startsWith(`${from}/`)) return `${to}${folder.slice(from.length)}`
    return folder
  }

  const moveFolder = (fromInput: string, toInput: string, now?: number): MoveMapFolderResult | null => database.withTransaction(() => {
    const from = normalizeFolder(fromInput, 'from')
    const to = normalizeFolder(toInput, 'to')
    if (!from || !to) throw new Error('folder must not be empty')
    if (from === to) return { moved: false, affectedMapSlugs: [] }
    if (to.startsWith(`${from}/`)) throw new Error('Cannot move a folder into itself or one of its descendants')
    if (!folderExists(from) && !folderHasResources(from)) return null
    if (folderExists(to) || folderHasResources(to)) throw new Error('Destination folder already exists')

    const updatedAt = nowTimestamp(now)
    const affectedMapSlugs: string[] = []
    for (const stored of list() as readonly StoredMapDocument[]) {
      const map = storedDocumentToTabletopMap(stored)
      const currentFolder = map.folder ?? ''
      if (currentFolder !== from && !currentFolder.startsWith(`${from}/`)) continue
      const nextFolder = remapFolder(currentFolder, from, to)
      const nextMap = normalizeTabletopMapForStorage({ ...map, folder: nextFolder }, `map ${map.slug} folder move`, {
        slug: map.slug,
        folder: nextFolder,
        revision: nextRevision(normalizeRevision(map.revision)),
        updatedAt,
      })
      writeMap(nextMap, 'update', map.revision)
      clearOperationHistory(map.slug)
      affectedMapSlugs.push(map.slug)
    }

    const rows = listFolders().filter((folder) => folder === from || folder.startsWith(`${from}/`))
    for (const path of rows) database.connection.prepare('DELETE FROM map_folders WHERE path = ?').run(path)
    for (const path of rows) upsertFolderRows(remapFolder(path, from, to), updatedAt)
    upsertFolderRows(to, updatedAt)

    return { moved: true, affectedMapSlugs }
  })

  const deleteFolder = (folderInput: string): DeleteMapFolderResult | null => database.withTransaction(() => {
    const folder = normalizeFolder(folderInput, 'folder')
    if (!folder) throw new Error('Invalid folder path')
    if (!folderExists(folder) && !folderHasResources(folder)) return null

    const deletedMapSlugs: string[] = []
    const deletedMaps: TabletopMap[] = []
    for (const stored of list() as readonly StoredMapDocument[]) {
      const map = storedDocumentToTabletopMap(stored)
      const mapFolder = map.folder ?? ''
      if (mapFolder !== folder && !mapFolder.startsWith(`${folder}/`)) continue
      database.connection.prepare('DELETE FROM maps WHERE slug = ?').run(map.slug)
      database.connection.prepare('DELETE FROM map_interaction_modes WHERE slug = ?').run(map.slug)
      clearOperationHistory(map.slug)
      deletedMapSlugs.push(map.slug)
      deletedMaps.push(map)
    }
    database.connection.prepare('DELETE FROM map_folders WHERE path = ? OR path LIKE ?').run(folder, `${folder}/%`)
    return { folder, deletedMapSlugs, deletedMaps }
  })

  const updateMapReferences = (
    kind: SheetKind,
    oldSlugInput: string,
    newSlugInput: string | null,
    options: RetargetMapSheetPlacementsOptions = {},
  ): RetargetMapSheetPlacementsResult[] => database.withTransaction(() => {
    const oldSlug = validateSlug(oldSlugInput, 'old sheet slug')
    const newSlug = newSlugInput === null ? null : validateSlug(newSlugInput, 'new sheet slug')
    if (newSlug !== null && oldSlug === newSlug) return []
    const updatedAt = options.now?.() ?? Date.now()
    const updated: RetargetMapSheetPlacementsResult[] = []

    for (const stored of list() as readonly StoredMapDocument[]) {
      const map = storedDocumentToTabletopMap(stored)
      if (!mapContainsSheetReferences(map, kind, oldSlug)) continue
      let placementCount = 0
      const placements = (map.placements ?? []).flatMap((placement) => {
        if (placement.sheetKind !== kind || placement.sheetSlug !== oldSlug) return [placement]
        placementCount += 1
        return newSlug === null ? [] : [{ ...placement, sheetSlug: newSlug }]
      })
      const nextMap = normalizeTabletopMapForStorage({ ...map, placements }, `map ${map.slug} sheet reference update`, {
        slug: map.slug,
        folder: map.folder ?? '',
        revision: nextRevision(normalizeRevision(map.revision)),
        updatedAt,
      })
      writeMap(nextMap, 'update', map.revision)
      clearOperationHistory(map.slug)
      updated.push({ path: `data/maps/${map.folder ? `${map.folder}/` : ''}${map.slug}.json`, map: nextMap, placementCount })
    }
    return updated
  })

  const retargetSheetReferences = (
    kind: SheetKind,
    oldSlug: string,
    newSlug: string,
    options: RetargetMapSheetPlacementsOptions = {},
  ): RetargetMapSheetPlacementsResult[] => updateMapReferences(kind, oldSlug, newSlug, options)

  const removeSheetReferences = (
    kind: SheetKind,
    slug: string,
    options: RetargetMapSheetPlacementsOptions = {},
  ): RetargetMapSheetPlacementsResult[] => updateMapReferences(kind, slug, null, options)

  const getBySlug = (slug: string): TabletopMap | null => getMapForUpdate(slug)

  const applyLivePlayUpdate = (input: ApplyLivePlayMapUpdateInput): LivePlayMapUpdateResult =>
    database.withTransaction(() => {
      const slug = validateSlug(input.slug, 'map slug')
      const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected map revision')
      const current = getMapForUpdate(slug)
      if (!current) return 'stale'
      if (current.revision !== expectedRevision) return 'stale'

      const revision = nextRevision(expectedRevision)
      const updatedAt = timestampOrNow(input.nextMap.updatedAt, `live-play map ${slug} updatedAt`)
      const normalizedNext = normalizeTabletopMapForStorage(input.nextMap, `live-play map ${slug}`, {
        slug,
        folder: current.folder ?? '',
        revision,
        updatedAt,
      })
      try {
        writeMap(normalizedNext, 'update', expectedRevision)
        return 'applied'
      } catch {
        return 'stale'
      }
    })

  return {
    database,
    get,
    list,
    save,
    create,
    replaceSetupMap,
    moveToFolder,
    rename,
    delete: remove,
    deleteDocument,
    allocateSlug,
    listFolders,
    createFolder,
    moveFolder,
    deleteFolder,
    retargetSheetReferences,
    removeSheetReferences,
    clearOperationHistory: (slug: string) => database.withTransaction(() => clearOperationHistory(slug)),
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
  create: (input) => defaultMapRepository().create(input),
  replaceSetupMap: (input) => defaultMapRepository().replaceSetupMap(input),
  moveToFolder: (input) => defaultMapRepository().moveToFolder(input),
  rename: (input) => defaultMapRepository().rename(input),
  delete: (slug) => defaultMapRepository().delete(slug),
  deleteDocument: (slug) => defaultMapRepository().deleteDocument(slug),
  allocateSlug: (base) => defaultMapRepository().allocateSlug(base),
  listFolders: () => defaultMapRepository().listFolders(),
  createFolder: (folder, now) => defaultMapRepository().createFolder(folder, now),
  moveFolder: (from, to, now) => defaultMapRepository().moveFolder(from, to, now),
  deleteFolder: (folder) => defaultMapRepository().deleteFolder(folder),
  retargetSheetReferences: (kind, oldSlug, newSlug, options) => defaultMapRepository().retargetSheetReferences(kind, oldSlug, newSlug, options),
  removeSheetReferences: (kind, slug, options) => defaultMapRepository().removeSheetReferences(kind, slug, options),
  clearOperationHistory: (slug) => defaultMapRepository().clearOperationHistory(slug),
  getBySlug: (slug) => defaultMapRepository().getBySlug(slug),
  saveSetupMap: (map) => defaultMapRepository().saveSetupMap(map),
  applyLivePlayUpdate: (input) => defaultMapRepository().applyLivePlayUpdate(input),
}
