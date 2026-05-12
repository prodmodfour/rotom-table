import { readdirSync, rmdirSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep, join } from 'node:path'
import { sanitizeFolderPath as sanitizeSharedFolderPath, type SanitizeFolderPathOptions } from '#shared/paths'

export const PROJECT_ROOT = resolve(process.cwd())

export const relativeToProjectRoot = (absPath: string): string =>
  relative(PROJECT_ROOT, absPath).split(sep).join('/')

export const ensureInsideRoot = (root: string, target: string): void => {
  const resolvedRoot = resolve(root)
  const resolvedTarget = resolve(target)
  const rel = relative(resolvedRoot, resolvedTarget)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return
  throw new Error('Invalid path: outside root')
}

export const sanitizeFolderPath = (
  path: string,
  options: SanitizeFolderPathOptions = {},
): string => sanitizeSharedFolderPath(path, options)

export const joinSafeUnderRoot = (root: string, folder = '', fileName?: string): string => {
  const resolvedRoot = resolve(root)
  const target = fileName === undefined
    ? resolve(resolvedRoot, folder)
    : resolve(join(resolvedRoot, folder), fileName)
  ensureInsideRoot(resolvedRoot, target)
  return target
}

export const pruneEmptyParents = (path: string, root: string): void => {
  const resolvedRoot = resolve(root)
  let parent = dirname(resolve(path))
  while (parent !== resolvedRoot) {
    try {
      ensureInsideRoot(resolvedRoot, parent)
      if (readdirSync(parent).length > 0) break
      rmdirSync(parent)
    } catch {
      break
    }
    parent = dirname(parent)
  }
}
