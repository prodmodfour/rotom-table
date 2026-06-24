import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const forbiddenSpecifiers = new Set(['vue', 'h3', '#app', '#imports'])
const forbiddenPathSegments = [
  '/src/composables/',
  '/src/components/',
  '/src/pages/',
  '/server/api/',
]
const forbiddenSourcePatterns = [
  /useApiClient\b/,
  /useRealtime\b/,
  /\bwindow\.[A-Za-z_$]/,
  /\bdocument\.[A-Za-z_$]/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bHTMLElement\b/,
  /\bHTMLCanvasElement\b/,
]

const importSpecifierPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g

const existingTsPath = (pathWithoutExtension: string): string | null => {
  const candidates = [
    pathWithoutExtension,
    `${pathWithoutExtension}.ts`,
    `${pathWithoutExtension}.tsx`,
    resolve(pathWithoutExtension, 'index.ts'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const resolveLocalSpecifier = (fromFile: string, specifier: string): string | null => {
  if (specifier.startsWith('~/')) return existingTsPath(resolve(repoRoot, 'src', specifier.slice(2)))
  if (specifier.startsWith('~~/')) return existingTsPath(resolve(repoRoot, specifier.slice(3)))
  if (specifier.startsWith('#shared/')) return existingTsPath(resolve(repoRoot, 'shared', specifier.slice('#shared/'.length)))
  if (specifier.startsWith('.')) return existingTsPath(resolve(dirname(fromFile), specifier))
  return null
}

const filesInLocalImportGraph = (entry: string): string[] => {
  const visited = new Set<string>()
  const pending = [resolve(repoRoot, entry)]

  while (pending.length) {
    const file = pending.pop()!
    if (visited.has(file) || !file.endsWith('.ts')) continue
    visited.add(file)
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(importSpecifierPattern)) {
      const specifier = match[1]!
      const resolved = resolveLocalSpecifier(file, specifier)
      if (resolved) pending.push(resolved)
    }
  }

  return [...visited].sort()
}

describe('authoritative move-resolution server boundary', () => {
  it('keeps the pure server domain resolver away from client-only modules and browser APIs', () => {
    const offenders: string[] = []
    for (const file of filesInLocalImportGraph('server/domain/resolveAuthoritativeMove.ts')) {
      const normalized = file.replaceAll('\\', '/')
      for (const segment of forbiddenPathSegments) {
        if (normalized.includes(segment)) offenders.push(`${normalized} is under forbidden ${segment}`)
      }

      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(importSpecifierPattern)) {
        const specifier = match[1]!
        if (forbiddenSpecifiers.has(specifier)) offenders.push(`${normalized} imports ${specifier}`)
      }
      for (const pattern of forbiddenSourcePatterns) {
        if (pattern.test(source)) offenders.push(`${normalized} matches ${pattern}`)
      }
    }

    expect(offenders).toEqual([])
  })
})
