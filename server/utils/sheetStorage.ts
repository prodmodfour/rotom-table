import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { dirname, relative } from 'node:path'
import { sanitizeFolderPath, validateSlug } from '#shared/paths'
import { stripDerivedSheetFolder } from '~/utils/sheets/persistence'
import {
  joinSafeUnderRoot,
  pruneEmptyParents,
  relativeToProjectRoot,
} from './fsPaths'
import {
  findFileByName,
  findJsonFileByField,
  readJsonFile,
  writeJsonFile,
} from './jsonFiles'
import { SHEET_KIND_CONFIG, sheetRootFor } from './sheetPaths'
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

export const readSheetFile = <T extends Record<string, unknown>>(
  kind: SheetKind,
  slug: string,
): { path: string; sheet: T } | null => {
  const path = findPersistedSheetFile(kind, slug)
  if (!path) return null
  return { path, sheet: readJsonFile<T>(path) }
}

export const stripDerivedSheetFields = stripDerivedSheetFolder

export const writeSheetFile = (path: string, sheet: Record<string, unknown>): void => {
  writeJsonFile(path, stripDerivedSheetFields(sheet))
}

export const allocateSheetSlug = (kind: SheetKind): string => {
  const root = sheetRootFor(kind)
  const base = SHEET_KIND_CONFIG[kind].defaultBaseSlug
  if (!findSheetFileInRoot(root, base)) return base
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${base}-${i}`
    if (!findSheetFileInRoot(root, candidate)) return candidate
  }
  throw new Error('Could not allocate a free slug')
}

export const buildDefaultSheet = (kind: SheetKind, slug: string): Record<string, unknown> => {
  if (kind === 'pokemon') {
    return {
      slug,
      nickname: 'New Pokémon',
      species: 'Bulbasaur',
      level: 1,
      player: false,
    }
  }
  return {
    slug,
    name: 'New Trainer',
    level: 1,
    player: false,
  }
}

export const createSheetFile = (kind: SheetKind, folderInput = ''): CreateSheetFileResult => {
  const folder = sanitizeFolderPath(folderInput, { allowEmpty: true })
  const root = sheetRootFor(kind)
  const slug = allocateSheetSlug(kind)
  const sheet = buildDefaultSheet(kind, slug)
  const filePath = joinSafeUnderRoot(root, folder, `${slug}.json`)
  writeJsonFile(filePath, sheet)
  return {
    kind,
    slug,
    folder,
    sheet,
    filePath,
    relativePath: relativeToProjectRoot(filePath),
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
    relativePath: relativeToProjectRoot(destPath),
  }
}

export const renameSheetFile = (
  kind: SheetKind,
  slugInput: string,
  name: string,
): RenameSheetFileResult | null => {
  const slug = validateSheetSlug(slugInput)
  const path = findSheetFile(kind, slug)
  if (!path) return null
  const json = readJsonFile<Record<string, unknown>>(path)
  const field = kind === 'pokemon' ? 'nickname' : 'name'
  json[field] = name
  writeSheetFile(path, json)
  return {
    name,
    sheet: stripDerivedSheetFields(json),
    filePath: path,
    relativePath: relativeToProjectRoot(path),
  }
}

export const deleteSheetFile = (kind: SheetKind, slugInput: string): SheetFileResult | null => {
  const slug = validateSheetSlug(slugInput)
  const root = sheetRootFor(kind)
  const path = findSheetFile(kind, slug)
  if (!path) return null
  unlinkSync(path)
  pruneEmptyParents(path, root)
  return { filePath: path, relativePath: relativeToProjectRoot(path) }
}
