import { statSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, relative, sep } from 'node:path'
import { validateSlug } from '#shared/paths'
import { SHEET_KINDS, type SheetKind } from '#shared/sheets'
import { normalizeRevision } from '#shared/sessionRevisions'
import { toPersistableSheetPayload } from '~/utils/sheets/persistence'
import { sheetRootFor } from '../utils/sheetPaths'
import { walkDirectories, walkFiles, type FilePredicate } from '../utils/jsonFiles'
import { migrateLegacyEquipmentDocuments } from '../domain/itemAutomation/equipmentMigration'
import { getRotomDatabase, type RotomDatabase } from './database'
import { sqliteSheetRepository, type SheetRepository } from './sheetRepository'

export interface ImportedSheetFromJson {
  readonly kind: SheetKind
  readonly slug: string
  readonly folder: string
  readonly revision: number
  readonly updatedAt: number
  readonly sourcePath: string
}

export interface ImportSheetsFromJsonResult {
  readonly roots: Record<SheetKind, string>
  readonly imported: readonly ImportedSheetFromJson[]
  readonly count: number
}

export interface ImportSheetsFromJsonOptions {
  readonly roots?: Partial<Record<SheetKind, string>>
  readonly repository?: Pick<SheetRepository, 'saveSetupSheet' | 'createFolder'>
    & Partial<Pick<SheetRepository, 'getByRef'>>
    & { readonly database?: RotomDatabase }
  readonly listFiles?: (root: string, predicate?: FilePredicate) => string[]
  readonly readFile?: (path: string) => string
  readonly updatedAtForFile?: (path: string) => number
}

const isJsonSheetFile: FilePredicate = (entry) => entry.name.endsWith('.json')

const folderFromRoot = (root: string, filePath: string): string => {
  const directory = dirname(relative(root, filePath)).split(sep).join('/')
  return directory === '.' ? '' : directory
}

const parseSheetJson = (kind: SheetKind, path: string, readFile: (path: string) => string): unknown => {
  try {
    return JSON.parse(readFile(path)) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${kind} sheet ${path} could not be imported: ${message}`)
  }
}

const slugFromFilePath = (path: string): string => validateSlug(basename(path, extname(path)), 'sheet file slug')

const normalizeImportedSheet = (
  kind: SheetKind,
  root: string,
  path: string,
  readFile: (path: string) => string,
  updatedAtForFile: (path: string) => number,
): { readonly slug: string; readonly sheet: Record<string, unknown> } => {
  const parsed = parseSheetJson(kind, path, readFile)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${kind} sheet ${path} must contain a JSON object`)
  }

  const payload = toPersistableSheetPayload(parsed)
  const slug = validateSlug(
    typeof payload.slug === 'string' && payload.slug.trim() ? payload.slug : slugFromFilePath(path),
    'sheet slug',
  )
  return {
    slug,
    sheet: {
      ...payload,
      slug,
      folder: folderFromRoot(root, path),
      revision: normalizeRevision(payload.revision),
      updatedAt: updatedAtForFile(path),
    },
  }
}

export const listJsonSheetImportFiles = (
  root: string,
  listFiles: (root: string, predicate?: FilePredicate) => string[] = walkFiles,
): string[] => listFiles(root, isJsonSheetFile).sort((left, right) => left.localeCompare(right))

const defaultUpdatedAtForFile = (path: string): number => Math.max(0, Math.round(statSync(path).mtimeMs))

export const importSheetsFromJson = async (
  options: ImportSheetsFromJsonOptions = {},
): Promise<ImportSheetsFromJsonResult> => {
  const roots: Record<SheetKind, string> = {
    pokemon: options.roots?.pokemon ?? sheetRootFor('pokemon'),
    trainer: options.roots?.trainer ?? sheetRootFor('trainer'),
  }
  const repository = options.repository ?? sqliteSheetRepository
  const listFiles = options.listFiles ?? walkFiles
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const updatedAtForFile = options.updatedAtForFile ?? defaultUpdatedAtForFile
  const imported: ImportedSheetFromJson[] = []

  for (const kind of SHEET_KINDS) {
    const root = roots[kind]
    for (const folder of walkDirectories(root)) {
      repository.createFolder(kind, folder)
    }
    for (const path of listJsonSheetImportFiles(root, listFiles)) {
      const normalized = normalizeImportedSheet(kind, root, path, readFile, updatedAtForFile)
      const saved = repository.saveSetupSheet(kind, normalized.slug, normalized.sheet)
      imported.push({
        kind,
        slug: saved.slug,
        folder: folderFromRoot(root, path),
        revision: saved.revision,
        updatedAt: saved.updatedAt,
        sourcePath: path,
      })
    }
  }

  const migrationDatabase = options.repository?.database ?? (options.repository ? null : getRotomDatabase())
  if (migrationDatabase) migrateLegacyEquipmentDocuments(migrationDatabase.connection)
  const finalized = imported.map((entry) => {
    const current = repository.getByRef?.(entry.kind, entry.slug)
    return current
      ? { ...entry, revision: current.revision, updatedAt: current.updatedAt }
      : entry
  })

  return {
    roots,
    imported: finalized,
    count: finalized.length,
  }
}
