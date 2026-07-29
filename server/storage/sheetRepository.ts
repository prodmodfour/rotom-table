import { sanitizeFolderPath, validateSlug } from '#shared/paths'
import { nextRevision, normalizeRevision } from '#shared/sessionRevisions'
import { isSheetKind, SHEET_KINDS, type SheetKind } from '#shared/sheets'
import {
  capabilityCampaignStateHasContent,
  juicerHeldItemIsLegacyShellMirror,
  materializeJuicerCampaignStateAtTime,
  parseCapabilityCampaignState,
  reconcileJuicerHeldItemCustody,
} from '#shared/capabilityAutomation/campaignState'
import type { CharacterSheet } from '~/types/characterSheet'
import { sameJsonValue } from '~/utils/serialization'
import { pokemonHasResolvedCapability } from '~/utils/sheets/pokemonDerived'
import { stripDerivedSheetRuntimeFields } from '~/utils/sheets/persistence'
import {
  preservePokemonGmFieldsForPlayerSave,
  preservePokemonServerPrivateFieldsForSave,
} from '~/utils/sheets/pokemonGmFields'
import { stripLegacyTrainerSheetSkillRanks } from '~/utils/sheets/trainerSkillEntries'
import { getRotomDatabase, type RotomDatabase } from './database'
import {
  cloneStoredJson,
  parseStoredDocumentJson,
  parseStoredRevision,
  parseStoredTimestamp,
  stringifyStoredDocument,
} from './documentJson'
import {
  buildDefaultRuntimeSheet,
  isRuntimePlayerFolderPath,
  runtimeSheetNameFieldForKind,
  runtimeSheetNameSlug,
} from '../utils/sheetDocuments'
import { logicalSheetResourcePath } from '../utils/runtimeResourcePaths'
import {
  createSqliteMapRepository,
  sqliteMapRepository,
  type MapRepository,
  type RetargetMapSheetPlacementsResult,
} from './mapRepository'

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

export interface CreateSheetDocumentInput {
  readonly kind: SheetKind
  readonly folder?: string
  readonly now?: number
}

export interface CreateSheetDocumentResult extends PersistedSheet {
  readonly path: string
  readonly folder: string
}

export interface ReplaceSetupSheetInput {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly sheet: Record<string, unknown>
  readonly now?: number
  readonly preservePlayerFlag?: boolean
  readonly preservePokemonGmFields?: boolean
}

export interface ReplaceSetupSheetResult {
  readonly changed: boolean
  readonly sheet: PersistedSheet
  readonly path: string
}

export interface MoveSheetToFolderInput {
  readonly kind: SheetKind
  readonly slug: string
  readonly folder: string
  readonly now?: number
}

export interface MoveSheetToFolderResult {
  readonly moved: boolean
  readonly sheet: PersistedSheet
  readonly path: string
  readonly folder: string
}

export interface RenameSheetDocumentInput {
  readonly kind: SheetKind
  readonly slug: string
  readonly name: string
  readonly now?: number
  /** Test hook used to assert that sheet rename and map retargeting roll back atomically. */
  readonly failAfterSheetUpdate?: () => void
}

export interface RenameSheetDocumentResult {
  readonly oldSlug: string
  readonly newSlug: string
  readonly renamed: boolean
  readonly changed: boolean
  readonly sheet: PersistedSheet
  readonly path: string
  readonly mapUpdates: readonly RetargetMapSheetPlacementsResult[]
}

export interface DeleteSheetDocumentResult {
  readonly sheet: PersistedSheet
  readonly path: string
  readonly mapUpdates: readonly RetargetMapSheetPlacementsResult[]
}

export interface CreateSheetFolderResult {
  readonly created: boolean
  readonly folder: string
  readonly kind: SheetKind
}

export interface MoveSheetFolderResult {
  readonly moved: boolean
  readonly count: number
  readonly affectedSheets: readonly { readonly kind: SheetKind; readonly slug: string }[]
}

export interface DeleteSheetFolderResult {
  readonly count: number
  readonly removed: readonly string[]
  readonly deletedSheets: readonly { readonly kind: SheetKind; readonly slug: string }[]
  readonly deletedSheetResults: readonly DeleteSheetDocumentResult[]
}

export interface ApplyLivePlaySheetUpdateInput {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly nextSheet: Record<string, unknown>
  /** Exact server operation identity used for held-item custody evidence. */
  readonly sourceOperationId?: string
  /** Set only when authority proves an item replacement hidden by an unchanged legacy held-item label. */
  readonly heldItemCustodyChanged?: boolean
}

export type LivePlaySheetUpdateResult = 'applied' | 'stale'

export interface SheetRevisionExpectation {
  readonly kind: SheetKind
  readonly slug: string
  readonly revision: number
}

export interface SheetRevisionMismatch {
  readonly kind: SheetKind
  readonly slug: string
  readonly expectedRevision: number
  readonly currentRevision: number | null
}

export class SheetRevisionConflictError extends Error {
  readonly mismatches: readonly SheetRevisionMismatch[]

  constructor(mismatches: readonly SheetRevisionMismatch[]) {
    const details = mismatches.map((mismatch) => (
      `${mismatch.kind}/${mismatch.slug} expected revision ${mismatch.expectedRevision}, ${
        mismatch.currentRevision === null ? 'but it is missing' : `current revision is ${mismatch.currentRevision}`
      }`
    )).join('; ')
    super(`Consulted sheet revisions changed: ${details}`)
    this.name = 'SheetRevisionConflictError'
    this.mismatches = mismatches.map((mismatch) => ({ ...mismatch }))
  }
}

export interface SheetRepository<TDocument = unknown> {
  readonly database?: RotomDatabase
  get(kind: SheetKind, slug: string): StoredSheetDocument<TDocument> | null
  list(kind?: SheetKind): readonly StoredSheetDocument<TDocument>[]
  save(input: SaveSheetDocumentInput<TDocument>): StoredSheetDocument<TDocument>
  create(input: CreateSheetDocumentInput): CreateSheetDocumentResult
  replaceSetupSheet(input: ReplaceSetupSheetInput): ReplaceSetupSheetResult | null
  moveToFolder(input: MoveSheetToFolderInput): MoveSheetToFolderResult | null
  rename(input: RenameSheetDocumentInput): RenameSheetDocumentResult | null
  delete(kind: SheetKind, slug: string): boolean
  deleteDocument(kind: SheetKind, slug: string): DeleteSheetDocumentResult | null
  allocateSlug(kind: SheetKind, base?: string): string
  listFolders(kind?: SheetKind): readonly string[]
  createFolder(kind: SheetKind, folder: string, now?: number): CreateSheetFolderResult
  moveFolder(from: string, to: string, kind?: SheetKind, now?: number): MoveSheetFolderResult | null
  deleteFolder(folder: string, kind?: SheetKind): DeleteSheetFolderResult | null
  getByRef(kind: SheetKind, slug: string): PersistedSheet | null
  saveSetupSheet(kind: SheetKind, slug: string, sheet: Record<string, unknown>): PersistedSheet
  assertRevisions(expectations: readonly SheetRevisionExpectation[]): void
  applyLivePlayUpdate(input: ApplyLivePlaySheetUpdateInput): LivePlaySheetUpdateResult
}

interface SheetRow {
  readonly kind: unknown
  readonly slug: unknown
  readonly document_json: unknown
  readonly revision: unknown
  readonly updated_at: unknown
}

interface FolderRow {
  readonly path: unknown
}

const DEFAULT_BASE_SLUG: Record<SheetKind, string> = {
  pokemon: 'new-pokemon',
  trainer: 'new-trainer',
}

const MAX_SLUG_ALLOCATION_ATTEMPTS = 10000

const parseSheetKind = (value: unknown, label = 'sheet kind'): SheetKind => {
  if (!isSheetKind(value)) throw new Error(`${label} must be "pokemon" or "trainer"`)
  return value
}

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

const rowToSheetDocument = <TDocument>(row: SheetRow): StoredSheetDocument<TDocument> => {
  const kind = parseSheetKind(row.kind, 'sheets.kind')
  if (typeof row.slug !== 'string') throw new Error('sheets.slug must be a string')
  if (typeof row.document_json !== 'string') throw new Error('sheets.document_json must be a string')

  const slug = validateSlug(row.slug, 'sheets.slug')
  const revision = parseStoredRevision(row.revision, `${kind} sheet ${slug} revision`)
  const updatedAt = parseStoredTimestamp(row.updated_at, `${kind} sheet ${slug} updated_at`)
  return {
    kind,
    slug,
    document: documentWithAuthorityFields(
      parseStoredDocumentJson<TDocument>(row.document_json, `${kind} sheet ${slug}`),
      slug,
      revision,
      updatedAt,
    ),
    revision,
    updatedAt,
  }
}

const normalizeInput = <TDocument>(input: SaveSheetDocumentInput<TDocument>): SaveSheetDocumentInput<TDocument> => ({
  kind: parseSheetKind(input.kind),
  slug: validateSlug(input.slug, 'sheet slug'),
  document: cloneStoredJson(input.document),
  revision: parseStoredRevision(input.revision, 'sheet revision'),
  updatedAt: parseStoredTimestamp(input.updatedAt, 'sheet updatedAt'),
})

const sheetPayloadBase = (sheet: Record<string, unknown>): Record<string, unknown> => {
  const payload = stripDerivedSheetRuntimeFields(sheet) as Record<string, unknown>
  delete payload.sessionPlayerAccessible
  delete payload.playerProfileAccessible
  return payload
}

const normalizeSheetForStorage = (
  kind: SheetKind,
  slugInput: string,
  sheet: Record<string, unknown>,
  overrides: { readonly folder?: string; readonly revision?: number; readonly updatedAt?: number } = {},
): Record<string, unknown> => {
  parseSheetKind(kind)
  const slug = validateSlug(slugInput, 'sheet slug')
  const folder = normalizeFolder(overrides.folder ?? sheet.folder ?? '', `${kind} sheet folder`)
  const revision = normalizeRevision(overrides.revision ?? sheet.revision)
  const updatedAt = timestampOrNow(overrides.updatedAt ?? sheet.updatedAt, `${kind} sheet ${slug} updatedAt`)
  const payload = sheetPayloadBase(sheet)
  if (kind === 'trainer') stripLegacyTrainerSheetSkillRanks(payload)

  return {
    ...payload,
    slug,
    folder,
    revision,
    updatedAt,
  }
}

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

const storedDocumentToPersistedSheet = (stored: StoredSheetDocument): PersistedSheet => {
  if (!stored.document || typeof stored.document !== 'object' || Array.isArray(stored.document)) {
    throw new Error(`SQLite ${stored.kind} sheet ${stored.slug} document must be an object`)
  }
  const sheet = normalizeSheetForStorage(
    stored.kind,
    stored.slug,
    stored.document as Record<string, unknown>,
    {
      folder: (stored.document as Record<string, unknown>).folder as string | undefined,
      revision: stored.revision,
      updatedAt: stored.updatedAt,
    },
  )
  if (sheet.slug !== stored.slug) {
    throw new Error(`SQLite ${stored.kind} sheet ${stored.slug} document slug must match the row slug`)
  }
  return {
    kind: stored.kind,
    slug: stored.slug,
    sheet,
    revision: stored.revision,
    updatedAt: stored.updatedAt,
  }
}

const semanticSheetSnapshot = (sheet: Record<string, unknown>): Record<string, unknown> => {
  const snapshot = cloneStoredJson(sheet) as Record<string, unknown>
  delete snapshot.slug
  delete snapshot.folder
  delete snapshot.revision
  delete snapshot.updatedAt
  delete snapshot.createdAt
  delete snapshot.sessionPlayerAccessible
  delete snapshot.playerProfileAccessible
  return snapshot
}

const withReconciledJuicerCustody = (input: {
  readonly slug: string
  readonly currentSheet: Record<string, unknown>
  readonly nextSheet: Record<string, unknown>
  readonly nextRevision: number
  readonly updatedAt: number
  readonly sourceOperationId?: string
  readonly heldItemCustodyChanged?: boolean
}): Record<string, unknown> => {
  const candidate = cloneStoredJson(input.nextSheet) as Record<string, unknown>
  const pokemon = candidate as unknown as CharacterSheet
  const current = input.currentSheet as unknown as CharacterSheet
  const currentState = parseCapabilityCampaignState(current.capabilityCampaignState)
  const currentMaterialized = materializeJuicerCampaignStateAtTime({
    value: currentState,
    heldItemName: current.items?.held,
    now: input.updatedAt,
  })
  let requestedState = parseCapabilityCampaignState(pokemon.capabilityCampaignState)
  const currentItem = currentState.storedItems[0]
  const advancedCurrentItem = currentMaterialized.state.storedItems[0]
  const requestedItem = requestedState.storedItems[0]
  const copiedStaleCurrentItem = Boolean(
    currentItem && advancedCurrentItem && requestedItem
    && sameJsonValue(currentItem, requestedItem)
    && !sameJsonValue(currentItem, advancedCurrentItem),
  )
  let heldItemName = pokemon.items?.held ?? ''
  if (copiedStaleCurrentItem) {
    requestedState = parseCapabilityCampaignState({
      ...requestedState,
      storedItems: currentMaterialized.state.storedItems,
    })
    if (currentMaterialized.transitionedFromHeldBerry
      && heldItemName.trim().toLocaleLowerCase('en-US') === (current.items?.held ?? '').trim().toLocaleLowerCase('en-US')) {
      heldItemName = currentMaterialized.heldItemName
    }
  }
  const reconciled = reconcileJuicerHeldItemCustody({
    value: requestedState,
    sheetSlug: input.slug,
    heldItemName,
    hasJuicer: pokemon.species.trim().toLocaleLowerCase('en-US') === 'shuckle'
      && pokemonHasResolvedCapability(pokemon, 'Juicer'),
    now: input.updatedAt,
    sourceOperationId: input.sourceOperationId
      ?? `sheet-live:${input.slug}:revision:${input.nextRevision}`,
    forceCustodyReset: input.heldItemCustodyChanged === true,
  })
  const materialized = materializeJuicerCampaignStateAtTime({
    value: reconciled,
    heldItemName,
    now: input.updatedAt,
  })
  const state = materialized.state
  const legacyShellMirror = juicerHeldItemIsLegacyShellMirror(state, pokemon.items?.held)
  if (materialized.heldItemName !== (pokemon.items?.held ?? '') || legacyShellMirror) {
    candidate.items = { ...(pokemon.items ?? {}), held: legacyShellMirror ? '' : materialized.heldItemName }
  }
  if (capabilityCampaignStateHasContent(state)) candidate.capabilityCampaignState = state
  else delete candidate.capabilityCampaignState
  return candidate
}

export const createSqliteSheetRepository = <TDocument = unknown>(
  database: RotomDatabase = getRotomDatabase(),
  mapRepository: Pick<MapRepository, 'retargetSheetReferences' | 'removeSheetReferences'> = createSqliteMapRepository(database),
): SheetRepository<TDocument> => {
  const getRow = (kind: SheetKind, slug: string): SheetRow | undefined => {
    const parsedKind = parseSheetKind(kind)
    const parsedSlug = validateSlug(slug, 'sheet slug')
    return database.connection.prepare(`
      SELECT kind, slug, document_json, revision, updated_at
      FROM sheets
      WHERE kind = ? AND slug = ?
    `).get(parsedKind, parsedSlug) as unknown as SheetRow | undefined
  }

  const get = (kind: SheetKind, slug: string): StoredSheetDocument<TDocument> | null => {
    const row = getRow(kind, slug)
    return row ? rowToSheetDocument<TDocument>(row) : null
  }

  const getStoredForUpdate = (kind: SheetKind, slug: string): StoredSheetDocument | null => {
    const row = getRow(kind, slug)
    return row ? rowToSheetDocument(row) : null
  }

  const getPersistedForUpdate = (kind: SheetKind, slug: string): PersistedSheet | null => {
    const stored = getStoredForUpdate(kind, slug)
    return stored ? storedDocumentToPersistedSheet(stored) : null
  }

  const sheetExists = (kind: SheetKind, slug: string): boolean => getRow(kind, slug) !== undefined

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

  const upsertFolderRows = (kind: SheetKind, folder: string, updatedAt: number): void => {
    for (const prefix of folderPrefixes(folder)) {
      database.connection.prepare(`
        INSERT INTO sheet_folders (kind, path, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(kind, path) DO UPDATE SET updated_at = excluded.updated_at
      `).run(kind, prefix, updatedAt)
    }
  }

  const writeSheet = (
    kind: SheetKind,
    slug: string,
    sheet: Record<string, unknown>,
    mode: 'insert' | 'upsert' | 'update',
    expectedRevision?: number,
  ): void => {
    const parsedKind = parseSheetKind(kind)
    const parsedSlug = validateSlug(slug, 'sheet slug')
    const revision = normalizeRevision(sheet.revision)
    const updatedAt = timestampOrNow(sheet.updatedAt, `${parsedKind} sheet ${parsedSlug} updatedAt`)
    const folder = normalizeFolder(sheet.folder ?? '', `${parsedKind} sheet ${parsedSlug} folder`)
    const document = normalizeSheetForStorage(parsedKind, parsedSlug, sheet, { folder, revision, updatedAt })
    upsertFolderRows(parsedKind, folder, updatedAt)

    if (mode === 'insert') {
      database.connection.prepare(`
        INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(parsedKind, parsedSlug, stringifyStoredDocument(document), revision, updatedAt)
      return
    }

    if (mode === 'update') {
      if (expectedRevision === undefined) throw new Error('expected sheet revision is required for update')
      const result = database.connection.prepare(`
        UPDATE sheets
        SET document_json = ?, revision = ?, updated_at = ?
        WHERE kind = ? AND slug = ? AND revision = ?
      `).run(stringifyStoredDocument(document), revision, updatedAt, parsedKind, parsedSlug, expectedRevision)
      if (Number(result.changes) !== 1) throw new Error(`${parsedKind} sheet ${parsedSlug} changed before it could be updated`)
      return
    }

    database.connection.prepare(`
      INSERT INTO sheets (kind, slug, document_json, revision, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(kind, slug) DO UPDATE SET
        document_json = excluded.document_json,
        revision = excluded.revision,
        updated_at = excluded.updated_at
    `).run(parsedKind, parsedSlug, stringifyStoredDocument(document), revision, updatedAt)
  }

  const save = (input: SaveSheetDocumentInput<TDocument>): StoredSheetDocument<TDocument> =>
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
        if (typeof folder === 'string') upsertFolderRows(normalized.kind, normalizeFolder(folder, `${normalized.kind} sheet folder`), normalized.updatedAt)
      }
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
        stringifyStoredDocument(document),
        normalized.revision,
        normalized.updatedAt,
      )
      return {
        kind: normalized.kind,
        slug: normalized.slug,
        document,
        revision: normalized.revision,
        updatedAt: normalized.updatedAt,
      }
    })

  const allocateSlug = (kindInput: SheetKind, baseInput = ''): string => {
    const kind = parseSheetKind(kindInput)
    const root = runtimeSheetNameSlug(baseInput) || DEFAULT_BASE_SLUG[kind]
    if (!sheetExists(kind, root)) return root
    for (let index = 1; index < MAX_SLUG_ALLOCATION_ATTEMPTS; index += 1) {
      const candidate = `${root}-${index}`
      if (!sheetExists(kind, candidate)) return candidate
    }
    throw new Error('Could not allocate a free slug')
  }

  const create = (input: CreateSheetDocumentInput): CreateSheetDocumentResult => database.withTransaction(() => {
    const kind = parseSheetKind(input.kind)
    const folder = normalizeFolder(input.folder ?? '', 'sheet folder')
    const slug = allocateSlug(kind)
    const updatedAt = nowTimestamp(input.now)
    const sheet = normalizeSheetForStorage(kind, slug, buildDefaultRuntimeSheet(kind, slug, {
      playerAccessible: isRuntimePlayerFolderPath(folder),
      now: updatedAt,
    }), {
      folder,
      revision: 0,
      updatedAt,
    })
    writeSheet(kind, slug, sheet, 'insert')
    const persisted = getPersistedForUpdate(kind, slug)
    if (!persisted) throw new Error(`${kind} sheet ${slug} was not readable after create`)
    return {
      ...persisted,
      path: logicalSheetResourcePath(kind, { slug, folder }),
      folder,
    }
  })

  const saveSetupSheet = (kindInput: SheetKind, slugInput: string, sheetInput: Record<string, unknown>): PersistedSheet => database.withTransaction(() => {
    const kind = parseSheetKind(kindInput)
    const slug = validateSlug(slugInput, 'sheet slug')
    const revision = normalizeRevision(sheetInput.revision)
    const updatedAt = timestampOrNow(sheetInput.updatedAt, `${kind} sheet ${slug} updatedAt`)
    const folder = normalizeFolder(sheetInput.folder ?? '', `${kind} sheet ${slug} folder`)
    const sheet = normalizeSheetForStorage(kind, slug, sheetInput, { folder, revision, updatedAt })
    writeSheet(kind, slug, sheet, 'upsert')
    const persisted = getPersistedForUpdate(kind, slug)
    if (!persisted) throw new Error(`${kind} sheet ${slug} was not readable after save`)
    return persisted
  })

  const replaceSetupSheet = (input: ReplaceSetupSheetInput): ReplaceSetupSheetResult | null => database.withTransaction(() => {
    const kind = parseSheetKind(input.kind)
    const slug = validateSlug(input.slug, 'sheet slug')
    const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected sheet revision')
    const current = getPersistedForUpdate(kind, slug)
    if (!current) return null
    if (current.revision !== expectedRevision) throw new Error(`${kind} sheet ${slug} is stale; expected revision ${expectedRevision}, current revision ${current.revision}`)

    const currentSheet = current.sheet
    const inputSheet = kind === 'pokemon'
      ? preservePokemonServerPrivateFieldsForSave(
          input.preservePokemonGmFields
            ? preservePokemonGmFieldsForPlayerSave(input.sheet, currentSheet)
            : input.sheet,
          currentSheet,
        )
      : input.sheet
    const sourceWithServerFields = {
      ...inputSheet,
      slug,
      folder: currentSheet.folder ?? '',
      revision: current.revision,
      createdAt: currentSheet.createdAt,
      updatedAt: current.updatedAt,
      ...(input.preservePlayerFlag ? { player: currentSheet.player } : {}),
      ...(Object.prototype.hasOwnProperty.call(inputSheet, 'moveUsage') || currentSheet.moveUsage === undefined
        ? {}
        : { moveUsage: currentSheet.moveUsage }),
    }
    const candidate = normalizeSheetForStorage(kind, slug, sourceWithServerFields, {
      folder: currentSheet.folder as string | undefined,
      revision: current.revision,
      updatedAt: current.updatedAt,
    })

    if (sameJsonValue(semanticSheetSnapshot(currentSheet), semanticSheetSnapshot(candidate))) {
      return { changed: false, sheet: current, path: logicalSheetResourcePath(kind, current.sheet) }
    }

    const updatedAt = nowTimestamp(input.now)
    const nextSheet = normalizeSheetForStorage(kind, slug, candidate, {
      folder: currentSheet.folder as string | undefined,
      revision: nextRevision(current.revision),
      updatedAt,
    })
    writeSheet(kind, slug, nextSheet, 'update', current.revision)
    const persisted = getPersistedForUpdate(kind, slug)
    if (!persisted) throw new Error(`${kind} sheet ${slug} was not readable after setup save`)
    return { changed: true, sheet: persisted, path: logicalSheetResourcePath(kind, persisted.sheet) }
  })

  const moveToFolder = (input: MoveSheetToFolderInput): MoveSheetToFolderResult | null => database.withTransaction(() => {
    const kind = parseSheetKind(input.kind)
    const slug = validateSlug(input.slug, 'sheet slug')
    const folder = normalizeFolder(input.folder, 'sheet folder')
    const current = getPersistedForUpdate(kind, slug)
    if (!current) return null
    if ((current.sheet.folder ?? '') === folder) {
      return { moved: false, sheet: current, path: logicalSheetResourcePath(kind, current.sheet), folder }
    }

    const updatedAt = nowTimestamp(input.now)
    const nextSheet = normalizeSheetForStorage(kind, slug, current.sheet, {
      folder,
      revision: nextRevision(current.revision),
      updatedAt,
    })
    writeSheet(kind, slug, nextSheet, 'update', current.revision)
    const persisted = getPersistedForUpdate(kind, slug)
    if (!persisted) throw new Error(`${kind} sheet ${slug} was not readable after move`)
    return { moved: true, sheet: persisted, path: logicalSheetResourcePath(kind, persisted.sheet), folder }
  })

  const rename = (input: RenameSheetDocumentInput): RenameSheetDocumentResult | null => database.withTransaction(() => {
    const kind = parseSheetKind(input.kind)
    const slug = validateSlug(input.slug, 'sheet slug')
    const name = String(input.name ?? '').trim()
    if (!name) throw new Error('name is required')
    const current = getPersistedForUpdate(kind, slug)
    if (!current) return null

    const nameField = runtimeSheetNameFieldForKind(kind)
    const desiredSlug = runtimeSheetNameSlug(name)
    const newSlug = desiredSlug && desiredSlug !== slug
      ? (sheetExists(kind, desiredSlug) ? allocateSlug(kind, name) : desiredSlug)
      : slug
    const renamed = newSlug !== slug
    const changed = renamed || current.sheet[nameField] !== name
    if (!changed) {
      return {
        oldSlug: slug,
        newSlug: slug,
        renamed: false,
        changed: false,
        sheet: current,
        path: logicalSheetResourcePath(kind, current.sheet),
        mapUpdates: [],
      }
    }

    const updatedAt = nowTimestamp(input.now)
    const nextSheet = normalizeSheetForStorage(kind, newSlug, {
      ...current.sheet,
      slug: newSlug,
      [nameField]: name,
    }, {
      folder: current.sheet.folder as string | undefined,
      revision: nextRevision(current.revision),
      updatedAt,
    })

    if (renamed) {
      const result = database.connection.prepare(`
        UPDATE sheets
        SET slug = ?, document_json = ?, revision = ?, updated_at = ?
        WHERE kind = ? AND slug = ? AND revision = ?
      `).run(newSlug, stringifyStoredDocument(nextSheet), normalizeRevision(nextSheet.revision), nextSheet.updatedAt as number, kind, slug, current.revision)
      if (Number(result.changes) !== 1) throw new Error(`${kind} sheet ${slug} changed before it could be renamed`)
    } else {
      writeSheet(kind, slug, nextSheet, 'update', current.revision)
    }

    input.failAfterSheetUpdate?.()

    const mapUpdates = renamed
      ? mapRepository.retargetSheetReferences(kind, slug, newSlug, { now: () => updatedAt })
      : []
    const persisted = getPersistedForUpdate(kind, newSlug)
    if (!persisted) throw new Error(`${kind} sheet ${newSlug} was not readable after rename`)
    return {
      oldSlug: slug,
      newSlug,
      renamed,
      changed: true,
      sheet: persisted,
      path: logicalSheetResourcePath(kind, persisted.sheet),
      mapUpdates,
    }
  })

  const deleteDocument = (kindInput: SheetKind, slugInput: string): DeleteSheetDocumentResult | null => database.withTransaction(() => {
    const kind = parseSheetKind(kindInput)
    const slug = validateSlug(slugInput, 'sheet slug')
    const current = getPersistedForUpdate(kind, slug)
    if (!current) return null
    const updatedAt = Date.now()
    const mapUpdates = mapRepository.removeSheetReferences(kind, slug, { now: () => updatedAt })
    database.connection.prepare('DELETE FROM sheets WHERE kind = ? AND slug = ?').run(kind, slug)
    return {
      sheet: current,
      path: logicalSheetResourcePath(kind, current.sheet),
      mapUpdates,
    }
  })

  const remove = (kind: SheetKind, slug: string): boolean => deleteDocument(kind, slug) !== null

  const getByRef = (kind: SheetKind, slug: string): PersistedSheet | null => getPersistedForUpdate(kind, slug)

  const documentFolders = (kind: SheetKind): string[] => {
    const folders = new Set<string>()
    for (const stored of list(kind) as readonly StoredSheetDocument[]) {
      const sheet = storedDocumentToPersistedSheet(stored)
      for (const prefix of folderPrefixes(String(sheet.sheet.folder ?? ''))) folders.add(prefix)
    }
    return [...folders]
  }

  const listFoldersForKind = (kind: SheetKind): string[] => {
    const folders = new Set<string>(documentFolders(kind))
    const rows = database.connection.prepare(`
      SELECT path
      FROM sheet_folders
      WHERE kind = ?
      ORDER BY path ASC
    `).all(kind) as unknown as FolderRow[]
    for (const row of rows) {
      if (typeof row.path !== 'string') throw new Error('sheet_folders.path must be a string')
      folders.add(normalizeFolder(row.path, 'sheet folder'))
    }
    return [...folders].filter(Boolean).sort((left, right) => left.localeCompare(right))
  }

  const listFolders = (kind?: SheetKind): readonly string[] => {
    if (kind !== undefined) return listFoldersForKind(parseSheetKind(kind))
    const folders = new Set<string>()
    for (const sheetKind of SHEET_KINDS) for (const folder of listFoldersForKind(sheetKind)) folders.add(folder)
    return [...folders].sort((left, right) => left.localeCompare(right))
  }

  const createFolder = (kindInput: SheetKind, folderInput: string, now?: number): CreateSheetFolderResult => database.withTransaction(() => {
    const kind = parseSheetKind(kindInput)
    const folder = normalizeFolder(folderInput, 'sheet folder')
    if (!folder) throw new Error('folder must not be empty')
    const existed = listFoldersForKind(kind).includes(folder)
    upsertFolderRows(kind, folder, nowTimestamp(now))
    return { created: !existed, folder, kind }
  })

  const folderExists = (kind: SheetKind, folder: string): boolean => listFoldersForKind(kind).includes(folder)

  const folderHasResources = (kind: SheetKind, folder: string): boolean => {
    for (const stored of list(kind) as readonly StoredSheetDocument[]) {
      const sheet = storedDocumentToPersistedSheet(stored)
      const sheetFolder = String(sheet.sheet.folder ?? '')
      if (sheetFolder === folder || sheetFolder.startsWith(`${folder}/`)) return true
    }
    return false
  }

  const remapFolder = (folder: string, from: string, to: string): string => {
    if (folder === from) return to
    if (folder.startsWith(`${from}/`)) return `${to}${folder.slice(from.length)}`
    return folder
  }

  const moveFolderForKind = (kind: SheetKind, from: string, to: string, updatedAt: number): { moved: boolean; affected: Array<{ kind: SheetKind; slug: string }> } => {
    if (!folderExists(kind, from) && !folderHasResources(kind, from)) return { moved: false, affected: [] }
    if (folderExists(kind, to) || folderHasResources(kind, to)) throw new Error('Destination already exists')

    const affected: Array<{ kind: SheetKind; slug: string }> = []
    for (const stored of list(kind) as readonly StoredSheetDocument[]) {
      const current = storedDocumentToPersistedSheet(stored)
      const currentFolder = String(current.sheet.folder ?? '')
      if (currentFolder !== from && !currentFolder.startsWith(`${from}/`)) continue
      const nextFolder = remapFolder(currentFolder, from, to)
      const nextSheet = normalizeSheetForStorage(kind, current.slug, current.sheet, {
        folder: nextFolder,
        revision: nextRevision(current.revision),
        updatedAt,
      })
      writeSheet(kind, current.slug, nextSheet, 'update', current.revision)
      affected.push({ kind, slug: current.slug })
    }

    const rows = listFoldersForKind(kind).filter((folder) => folder === from || folder.startsWith(`${from}/`))
    for (const path of rows) database.connection.prepare('DELETE FROM sheet_folders WHERE kind = ? AND path = ?').run(kind, path)
    for (const path of rows) upsertFolderRows(kind, remapFolder(path, from, to), updatedAt)
    upsertFolderRows(kind, to, updatedAt)
    return { moved: true, affected }
  }

  const moveFolder = (fromInput: string, toInput: string, kindInput?: SheetKind, now?: number): MoveSheetFolderResult | null => database.withTransaction(() => {
    const from = normalizeFolder(fromInput, 'from')
    const to = normalizeFolder(toInput, 'to')
    if (!from || !to) throw new Error('folder must not be empty')
    if (from === to) return { moved: false, count: 0, affectedSheets: [] }
    if (to.startsWith(`${from}/`)) throw new Error('Cannot move a folder into itself or one of its descendants')

    const kinds = kindInput === undefined ? SHEET_KINDS : [parseSheetKind(kindInput)]
    const updatedAt = nowTimestamp(now)
    const affectedSheets: Array<{ kind: SheetKind; slug: string }> = []
    let movedKinds = 0
    for (const kind of kinds) {
      const result = moveFolderForKind(kind, from, to, updatedAt)
      if (result.moved) movedKinds += 1
      affectedSheets.push(...result.affected)
    }
    if (movedKinds === 0) return null
    return { moved: true, count: movedKinds, affectedSheets }
  })

  const deleteFolderForKind = (kind: SheetKind, folder: string): { removed: boolean; deleted: Array<{ kind: SheetKind; slug: string }>; deletedResults: DeleteSheetDocumentResult[] } => {
    if (!folderExists(kind, folder) && !folderHasResources(kind, folder)) return { removed: false, deleted: [], deletedResults: [] }
    const deleted: Array<{ kind: SheetKind; slug: string }> = []
    const deletedResults: DeleteSheetDocumentResult[] = []
    for (const stored of list(kind) as readonly StoredSheetDocument[]) {
      const sheet = storedDocumentToPersistedSheet(stored)
      const sheetFolder = String(sheet.sheet.folder ?? '')
      if (sheetFolder !== folder && !sheetFolder.startsWith(`${folder}/`)) continue
      const cleanup = deleteDocument(kind, sheet.slug)
      if (cleanup) {
        deleted.push({ kind, slug: sheet.slug })
        deletedResults.push(cleanup)
      }
    }
    database.connection.prepare('DELETE FROM sheet_folders WHERE kind = ? AND (path = ? OR path LIKE ?)').run(kind, folder, `${folder}/%`)
    return { removed: true, deleted, deletedResults }
  }

  const deleteFolder = (folderInput: string, kindInput?: SheetKind): DeleteSheetFolderResult | null => database.withTransaction(() => {
    const folder = normalizeFolder(folderInput, 'folder')
    if (!folder) throw new Error('folder must not be empty')
    const kinds = kindInput === undefined ? SHEET_KINDS : [parseSheetKind(kindInput)]
    const removed: string[] = []
    const deletedSheets: Array<{ kind: SheetKind; slug: string }> = []
    const deletedSheetResults: DeleteSheetDocumentResult[] = []
    for (const kind of kinds) {
      const result = deleteFolderForKind(kind, folder)
      if (!result.removed) continue
      removed.push(logicalSheetResourcePath(kind, { slug: '', folder }).replace(/\/\.json$/, ''))
      deletedSheets.push(...result.deleted)
      deletedSheetResults.push(...result.deletedResults)
    }
    if (removed.length === 0) return null
    return { count: removed.length, removed, deletedSheets, deletedSheetResults }
  })

  const assertRevisions = (expectations: readonly SheetRevisionExpectation[]): void => {
    database.withTransaction(() => {
      const expectedByRef = new Map<string, SheetRevisionExpectation>()
      for (const expectation of expectations) {
        const kind = parseSheetKind(expectation.kind)
        const slug = validateSlug(expectation.slug, 'sheet slug')
        const revision = parseStoredRevision(expectation.revision, `expected ${kind} sheet ${slug} revision`)
        const key = `${kind}:${slug}`
        const existing = expectedByRef.get(key)
        if (existing && existing.revision !== revision) {
          throw new Error(`${kind} sheet ${slug} has conflicting expected revisions ${existing.revision} and ${revision}`)
        }
        expectedByRef.set(key, { kind, slug, revision })
      }

      const mismatches: SheetRevisionMismatch[] = []
      for (const expectation of expectedByRef.values()) {
        const current = getStoredForUpdate(expectation.kind, expectation.slug)
        if (current?.revision === expectation.revision) continue
        mismatches.push({
          kind: expectation.kind,
          slug: expectation.slug,
          expectedRevision: expectation.revision,
          currentRevision: current?.revision ?? null,
        })
      }
      if (mismatches.length > 0) throw new SheetRevisionConflictError(mismatches)
    })
  }

  const applyLivePlayUpdate = (input: ApplyLivePlaySheetUpdateInput): LivePlaySheetUpdateResult =>
    database.withTransaction(() => {
      const kind = parseSheetKind(input.kind)
      const slug = validateSlug(input.slug, 'sheet slug')
      const expectedRevision = parseStoredRevision(input.expectedRevision, 'expected sheet revision')
      const current = getPersistedForUpdate(kind, slug)
      if (!current) return 'stale'
      if (current.revision !== expectedRevision) return 'stale'

      const revision = nextRevision(expectedRevision)
      const updatedAt = timestampOrNow(input.nextSheet.updatedAt, `live-play ${kind} sheet ${slug} updatedAt`)
      const custodyReconciled = kind === 'pokemon'
        ? withReconciledJuicerCustody({
            slug,
            currentSheet: current.sheet,
            nextSheet: input.nextSheet,
            nextRevision: revision,
            updatedAt,
            ...(input.sourceOperationId ? { sourceOperationId: input.sourceOperationId } : {}),
            ...(input.heldItemCustodyChanged === true ? { heldItemCustodyChanged: true } : {}),
          })
        : input.nextSheet
      const nextSheet = normalizeSheetForStorage(kind, slug, {
        ...custodyReconciled,
        folder: current.sheet.folder ?? '',
      }, {
        folder: current.sheet.folder as string | undefined,
        revision,
        updatedAt,
      })
      try {
        writeSheet(kind, slug, nextSheet, 'update', expectedRevision)
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
    replaceSetupSheet,
    moveToFolder,
    rename,
    delete: remove,
    deleteDocument,
    allocateSlug,
    listFolders,
    createFolder,
    moveFolder,
    deleteFolder,
    getByRef,
    saveSetupSheet,
    assertRevisions,
    applyLivePlayUpdate,
  }
}

const defaultSheetRepository = <TDocument = unknown>(): SheetRepository<TDocument> =>
  createSqliteSheetRepository<TDocument>(getRotomDatabase(), sqliteMapRepository)

export const sqliteSheetRepository: SheetRepository = {
  get: (kind, slug) => defaultSheetRepository().get(kind, slug),
  list: (kind) => defaultSheetRepository().list(kind),
  save: (input) => defaultSheetRepository().save(input),
  create: (input) => defaultSheetRepository().create(input),
  replaceSetupSheet: (input) => defaultSheetRepository().replaceSetupSheet(input),
  moveToFolder: (input) => defaultSheetRepository().moveToFolder(input),
  rename: (input) => defaultSheetRepository().rename(input),
  delete: (kind, slug) => defaultSheetRepository().delete(kind, slug),
  deleteDocument: (kind, slug) => defaultSheetRepository().deleteDocument(kind, slug),
  allocateSlug: (kind, base) => defaultSheetRepository().allocateSlug(kind, base),
  listFolders: (kind) => defaultSheetRepository().listFolders(kind),
  createFolder: (kind, folder, now) => defaultSheetRepository().createFolder(kind, folder, now),
  moveFolder: (from, to, kind, now) => defaultSheetRepository().moveFolder(from, to, kind, now),
  deleteFolder: (folder, kind) => defaultSheetRepository().deleteFolder(folder, kind),
  getByRef: (kind, slug) => defaultSheetRepository().getByRef(kind, slug),
  saveSetupSheet: (kind, slug, sheet) => defaultSheetRepository().saveSetupSheet(kind, slug, sheet),
  assertRevisions: (expectations) => defaultSheetRepository().assertRevisions(expectations),
  applyLivePlayUpdate: (input) => defaultSheetRepository().applyLivePlayUpdate(input),
}
