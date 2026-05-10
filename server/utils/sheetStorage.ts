import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import {
  SHEET_KINDS,
  isSheetKind,
  type SheetKind,
} from '~/shared/sheets'
import { sanitizeFolderPath, validateSlug } from '~/shared/paths'
import { stripDerivedSheetFolder } from '~/utils/sheets/persistence'
import {
  PROJECT_ROOT,
  joinSafeUnderRoot,
  pruneEmptyParents,
  relativeToProjectRoot,
} from './fsPaths'
import {
  findFileByName,
  findJsonFileByField,
  readJsonFile,
  walkDirectories,
  writeJsonFile,
} from './jsonFiles'

export { SHEET_KINDS, isSheetKind, type SheetKind } from '~/shared/sheets'

export interface SheetKindConfig {
  kind: SheetKind
  root: string
  defaultBaseSlug: string
  displayName: string
}

export const SHEET_KIND_CONFIG: Record<SheetKind, SheetKindConfig> = {
  pokemon: {
    kind: 'pokemon',
    root: resolve(PROJECT_ROOT, 'data/sheets'),
    defaultBaseSlug: 'new-pokemon',
    displayName: 'Pokémon',
  },
  trainer: {
    kind: 'trainer',
    root: resolve(PROJECT_ROOT, 'data/trainers'),
    defaultBaseSlug: 'new-trainer',
    displayName: 'Trainer',
  },
}

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

export interface DeleteFolderResult {
  count: number
  removed: string[]
}

export interface MoveFolderResult {
  moved: boolean
  count: number
}

export const sheetRootFor = (kind: SheetKind): string => SHEET_KIND_CONFIG[kind].root

export const validateSheetSlug = (slug: string): string => validateSlug(slug)

export const folderFromSheetPath = (kind: SheetKind, filePath: string): string => {
  const rel = relative(sheetRootFor(kind), filePath).split(sep).join('/')
  const lastSlash = rel.lastIndexOf('/')
  if (lastSlash === -1) return ''
  return rel.slice(0, lastSlash)
}

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

const sheetRoots = (kind?: SheetKind): string[] => kind ? [sheetRootFor(kind)] : SHEET_KINDS.map(sheetRootFor)

export const listSheetFolders = (kind?: SheetKind): string[] => {
  const folders = new Set<string>()
  for (const root of sheetRoots(kind)) for (const folder of walkDirectories(root)) folders.add(folder)
  return Array.from(folders).sort((a, b) => a.localeCompare(b))
}

export const createSheetFolder = (
  folderInput: string,
  kind: SheetKind = 'pokemon',
): { created: boolean; path: string; folder: string } => {
  const folder = sanitizeFolderPath(folderInput)
  const root = sheetRootFor(kind)
  const dest = joinSafeUnderRoot(root, folder)
  const existed = existsSync(dest)
  mkdirSync(dest, { recursive: true })
  return { created: !existed, path: relativeToProjectRoot(dest), folder }
}

export const deleteSheetFolder = (folderInput: string): DeleteFolderResult | null => {
  const folder = sanitizeFolderPath(folderInput)
  const removed: string[] = []
  for (const root of sheetRoots()) {
    const dir = joinSafeUnderRoot(root, folder)
    if (!existsSync(dir)) continue
    if (!statSync(dir).isDirectory()) continue
    rmSync(dir, { recursive: true, force: true })
    pruneEmptyParents(dir, root)
    removed.push(relativeToProjectRoot(dir))
  }
  if (removed.length === 0) return null
  return { count: removed.length, removed }
}

export const moveSheetFolder = (fromInput: string, toInput: string): MoveFolderResult | null => {
  const from = sanitizeFolderPath(fromInput, { label: 'from' })
  const to = sanitizeFolderPath(toInput, { label: 'to' })

  if (from === to) return { moved: false, count: 0 }
  if (to.startsWith(from + '/')) throw new Error('Cannot move a folder into itself or one of its descendants')

  const moves: Array<{ src: string; dst: string; root: string }> = []
  for (const root of sheetRoots()) {
    const src = joinSafeUnderRoot(root, from)
    if (!existsSync(src)) continue
    if (!statSync(src).isDirectory()) continue
    const dst = joinSafeUnderRoot(root, to)
    if (existsSync(dst)) throw new Error(`Destination already exists in ${relativeToProjectRoot(root)}`)
    moves.push({ src, dst, root })
  }

  if (moves.length === 0) return null

  for (const { src, dst } of moves) {
    mkdirSync(dirname(dst), { recursive: true })
    renameSync(src, dst)
  }
  for (const { src, root } of moves) pruneEmptyParents(src, root)

  return { moved: true, count: moves.length }
}

