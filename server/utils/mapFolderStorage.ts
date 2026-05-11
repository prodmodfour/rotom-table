import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  joinSafeUnderRoot,
  pruneEmptyParents,
  relativeToProjectRoot,
} from './fsPaths'
import { walkDirectories } from './jsonFiles'
import { MAPS_ROOT } from './mapPaths'

export interface CreateMapFolderResult {
  created: boolean
  path: string
  folder: string
}

export interface MoveMapFolderResult {
  moved: boolean
}

export interface DeleteMapFolderResult {
  removed: string
}

export const listMapFolders = (root = MAPS_ROOT): string[] =>
  walkDirectories(root).sort((a, b) => a.localeCompare(b))

export const createMapFolder = (folder: string, root = MAPS_ROOT): CreateMapFolderResult => {
  const destination = joinSafeUnderRoot(root, folder)
  const existed = existsSync(destination)
  mkdirSync(destination, { recursive: true })

  return {
    created: !existed,
    path: relativeToProjectRoot(destination),
    folder,
  }
}

export const moveMapFolder = (
  from: string,
  to: string,
  root = MAPS_ROOT,
): MoveMapFolderResult | null => {
  if (from === to) return { moved: false }
  if (to.startsWith(`${from}/`)) {
    throw new Error('Cannot move a folder into itself or one of its descendants')
  }

  const source = joinSafeUnderRoot(root, from)
  const destination = joinSafeUnderRoot(root, to)
  if (!existsSync(source) || !statSync(source).isDirectory()) return null
  if (existsSync(destination)) throw new Error('Destination folder already exists')

  mkdirSync(dirname(destination), { recursive: true })
  renameSync(source, destination)
  pruneEmptyParents(source, root)

  return { moved: true }
}

export const deleteMapFolder = (folder: string, root = MAPS_ROOT): DeleteMapFolderResult | null => {
  const resolvedRoot = resolve(root)
  const dir = joinSafeUnderRoot(resolvedRoot, folder)
  if (dir === resolvedRoot) throw new Error('Invalid folder path')
  if (!existsSync(dir)) return null
  if (!statSync(dir).isDirectory()) throw new Error('Not a directory')

  rmSync(dir, { recursive: true, force: true })
  pruneEmptyParents(dir, resolvedRoot)

  return { removed: relativeToProjectRoot(dir) }
}
