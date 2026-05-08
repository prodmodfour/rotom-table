import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, type Dirent } from 'node:fs'
import { dirname, join } from 'node:path'

export type FilePredicate = (entry: Dirent, fullPath: string) => boolean

export const readJsonFile = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T

export const tryReadJsonFile = <T>(path: string): T | null => {
  try {
    return readJsonFile<T>(path)
  } catch {
    return null
  }
}

export const writeJsonFile = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

export const walkFiles = (root: string, predicate?: FilePredicate): string[] => {
  if (!existsSync(root)) return []
  const out: string[] = []
  const stack: string[] = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (entry.isFile() && (!predicate || predicate(entry, full))) out.push(full)
    }
  }
  return out
}

export const walkDirectories = (root: string): string[] => {
  if (!existsSync(root)) return []
  const out: string[] = []
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '' }]
  while (stack.length) {
    const { abs, rel } = stack.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      out.push(childRel)
      stack.push({ abs: join(abs, entry.name), rel: childRel })
    }
  }
  return out
}

export const findFileByName = (root: string, fileName: string): string | null =>
  walkFiles(root, (entry) => entry.name === fileName)[0] ?? null

export const findJsonFileByField = (root: string, field: string, expected: unknown): string | null => {
  for (const path of walkFiles(root, (entry) => entry.name.endsWith('.json'))) {
    const parsed = tryReadJsonFile<Record<string, unknown>>(path)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed[field] === expected) {
      return path
    }
  }
  return null
}
