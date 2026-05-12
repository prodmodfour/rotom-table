import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { sanitizeFolderPath } from '#shared/paths'
import type { SheetKind } from '#shared/sheets'
import {
  joinSafeUnderRoot,
  pruneEmptyParents,
  relativeToProjectRoot,
} from './fsPaths'
import { walkDirectories } from './jsonFiles'
import { sheetRootFor, sheetRoots } from './sheetPaths'

export interface DeleteFolderResult {
  count: number
  removed: string[]
}

export interface MoveFolderResult {
  moved: boolean
  count: number
}

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
