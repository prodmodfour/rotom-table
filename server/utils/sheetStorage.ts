import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { sanitizeFolderPath, slugify, validateSlug } from '#shared/paths'
import { stripDerivedSheetFolder, toPersistableSheetPayload } from '~/utils/sheets/persistence'
import { campaignPathLabel } from './campaignPaths'
import {
  joinSafeUnderRoot,
  pruneEmptyParents,
} from './fsPaths'
import {
  findFileByName,
  findJsonFileByField,
  readJsonFile,
  walkFiles,
  writeJsonFile,
} from './jsonFiles'
import { folderFromSheetPath, SHEET_KIND_CONFIG, sheetRootFor } from './sheetPaths'
import { pickRandomTrainerSpriteUrl } from './trainerSprites'
import type { SheetKind } from './sheetPaths'

export interface SheetFileResult {
  filePath: string
  relativePath: string
}

export interface MoveSheetFileResult extends SheetFileResult {
  moved: boolean
  folder: string
}

export interface CreateSheetFileResult extends SheetFileResult {
  kind: SheetKind
  slug: string
  folder: string
  sheet: Record<string, unknown>
}

export interface RenameSheetFileResult extends SheetFileResult {
  slug: string
  name: string
  sheet: Record<string, unknown>
}

export const validateSheetSlug = (slug: string): string => validateSlug(slug)

export const findSheetFileInRoot = (root: string, slug: string): string | null =>
  findFileByName(root, `${validateSheetSlug(slug)}.json`)

export const findSheetFileBySlugInRoot = (root: string, slug: string): string | null =>
  findJsonFileByField(root, 'slug', validateSheetSlug(slug))

export const findSheetFile = (kind: SheetKind, slug: string): string | null =>
  findSheetFileInRoot(sheetRootFor(kind), slug)

export const findSheetFileBySlug = (kind: SheetKind, slug: string): string | null =>
  findSheetFileBySlugInRoot(sheetRootFor(kind), slug)

export const findPersistedSheetFile = (kind: SheetKind, slug: string): string | null =>
  findSheetFile(kind, slug) ?? findSheetFileBySlug(kind, slug)

export const readSheetFile = <T extends object>(
  kind: SheetKind,
  slug: string,
): { path: string; sheet: T } | null => {
  const path = findPersistedSheetFile(kind, slug)
  if (!path) return null
  return { path, sheet: toPersistableSheetPayload(readJsonFile<T>(path)) as T }
}

export const withDerivedSheetFolder = <T extends object>(
  kind: SheetKind,
  path: string,
  sheet: T,
): T & { folder: string } => {
  const record = sheet as Record<string, unknown>
  return {
    ...(toPersistableSheetPayload(sheet) as T),
    folder: typeof record.folder === 'string' ? record.folder : folderFromSheetPath(kind, path),
  }
}

export const readSheetFileWithFolder = <T extends object>(
  kind: SheetKind,
  slug: string,
): { path: string; sheet: T & { folder: string } } | null => {
  const result = readSheetFile<T>(kind, slug)
  if (!result) return null
  return {
    path: result.path,
    sheet: withDerivedSheetFolder(kind, result.path, result.sheet),
  }
}

export const listSheetFiles = (kind: SheetKind): string[] =>
  walkFiles(sheetRootFor(kind), (entry) => entry.name.endsWith('.json'))

export const listSheetFilesWithFolders = <T extends object>(
  kind: SheetKind,
): Array<T & { folder: string }> =>
  listSheetFiles(kind).map((path) => withDerivedSheetFolder(kind, path, readJsonFile<T>(path)))

export const stripDerivedSheetFields = stripDerivedSheetFolder

export const writeSheetFile = (path: string, sheet: Record<string, unknown>): void => {
  writeJsonFile(path, toPersistableSheetPayload(sheet))
}

export const sheetNameFieldForKind = (kind: SheetKind): 'nickname' | 'name' =>
  kind === 'pokemon' ? 'nickname' : 'name'

export const sheetNameSlug = (name: string): string => slugify(name)

export interface AllocateSheetSlugOptions {
  excludePath?: string
}

export const allocateSheetSlug = (
  kind: SheetKind,
  baseInput = '',
  options: AllocateSheetSlugOptions = {},
): string => {
  const base = sheetNameSlug(baseInput) || SHEET_KIND_CONFIG[kind].defaultBaseSlug
  const basePath = findPersistedSheetFile(kind, base)
  if (!basePath || basePath === options.excludePath) return base
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${base}-${i}`
    const candidatePath = findPersistedSheetFile(kind, candidate)
    if (!candidatePath || candidatePath === options.excludePath) return candidate
  }
  throw new Error('Could not allocate a free slug')
}

export interface BuildDefaultSheetOptions {
  playerAccessible?: boolean
}

export const isPlayerFolderPath = (folder: string): boolean =>
  folder.split('/')[0]?.toLowerCase() === 'players'

export const buildDefaultSheet = (
  kind: SheetKind,
  slug: string,
  options: BuildDefaultSheetOptions = {},
): Record<string, unknown> => {
  const player = options.playerAccessible === true
  if (kind === 'pokemon') {
    return {
      revision: 0,
      slug,
      nickname: 'New Pokémon',
      species: '',
      level: 1,
      player,
    }
  }
  const portraitUrl = pickRandomTrainerSpriteUrl()
  return {
    revision: 0,
    slug,
    name: 'New Trainer',
    level: 1,
    player,
    ...(portraitUrl ? { portraitUrl } : {}),
  }
}

export const createSheetFile = (kind: SheetKind, folderInput = ''): CreateSheetFileResult => {
  const folder = sanitizeFolderPath(folderInput, { allowEmpty: true })
  const root = sheetRootFor(kind)
  const slug = allocateSheetSlug(kind)
  const sheet = buildDefaultSheet(kind, slug, {
    playerAccessible: isPlayerFolderPath(folder),
  })
  const filePath = joinSafeUnderRoot(root, folder, `${slug}.json`)
  writeJsonFile(filePath, sheet)
  return {
    kind,
    slug,
    folder,
    sheet,
    filePath,
    relativePath: campaignPathLabel(filePath),
  }
}

export const sheetIsPlayerAccessible = (kind: SheetKind, slug: string): boolean => {
  const path = findPersistedSheetFile(kind, slug)
  if (!path) return false
  try {
    const parsed = readJsonFile<{ player?: unknown }>(path)
    return parsed.player === true
  } catch {
    return false
  }
}

export const moveSheetFile = (
  kind: SheetKind,
  slugInput: string,
  folderInput: string,
): MoveSheetFileResult | null => {
  const slug = validateSheetSlug(slugInput)
  const folder = sanitizeFolderPath(folderInput, { allowEmpty: true })
  const root = sheetRootFor(kind)
  const currentPath = findSheetFile(kind, slug)
  if (!currentPath) return null

  const fileName = `${slug}.json`
  const destPath = joinSafeUnderRoot(root, folder, fileName)
  const destDir = dirname(destPath)

  let moved = false
  if (currentPath !== destPath) {
    if (existsSync(destPath)) throw new Error('A sheet with that name already exists in the target folder')
    mkdirSync(destDir, { recursive: true })
    renameSync(currentPath, destPath)
    pruneEmptyParents(currentPath, root)
    moved = true
  }

  try {
    const json = readJsonFile<Record<string, unknown>>(destPath)
    if (Object.prototype.hasOwnProperty.call(json, 'folder')) writeSheetFile(destPath, json)
  } catch (err) {
    console.warn('[sheets/move] rewrite failed for', destPath, err)
  }

  return {
    moved,
    folder,
    filePath: destPath,
    relativePath: campaignPathLabel(destPath),
  }
}

export const renameSheetFile = (
  kind: SheetKind,
  slugInput: string,
  name: string,
): RenameSheetFileResult | null => {
  const slug = validateSheetSlug(slugInput)
  const path = findPersistedSheetFile(kind, slug)
  if (!path) return null

  const json = readJsonFile<Record<string, unknown>>(path)
  const field = sheetNameFieldForKind(kind)
  const desiredSlug = sheetNameSlug(name)
  let newSlug = slug
  let newPath = path

  if (desiredSlug && desiredSlug !== slug) {
    const existing = findPersistedSheetFile(kind, desiredSlug)
    newSlug = existing && existing !== path
      ? allocateSheetSlug(kind, name, { excludePath: path })
      : desiredSlug
    newPath = join(dirname(path), `${newSlug}.json`)
    if (newPath !== path) {
      if (existsSync(newPath)) throw new Error(`Sheet ${newSlug}.json already exists`)
      renameSync(path, newPath)
    }
  }

  json.slug = newSlug
  json[field] = name
  writeSheetFile(newPath, json)
  return {
    slug: newSlug,
    name,
    sheet: stripDerivedSheetFields(json),
    filePath: newPath,
    relativePath: campaignPathLabel(newPath),
  }
}

export const deleteSheetFile = (kind: SheetKind, slugInput: string): SheetFileResult | null => {
  const slug = validateSheetSlug(slugInput)
  const root = sheetRootFor(kind)
  const path = findSheetFile(kind, slug)
  if (!path) return null
  unlinkSync(path)
  pruneEmptyParents(path, root)
  return { filePath: path, relativePath: campaignPathLabel(path) }
}
