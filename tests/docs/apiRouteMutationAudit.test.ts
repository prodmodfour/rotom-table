import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const apiRoot = join(process.cwd(), 'server/api')
const auditPath = join(process.cwd(), 'docs/api-route-mutation-audit.md')

const mutatingSuffix = /\.(post|put|patch|delete)\.ts$/

const walkFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name)
  return entry.isDirectory() ? walkFiles(path) : [path]
})

const routeForApiFile = (filePath: string): string | null => {
  const rel = relative(apiRoot, filePath)
  const normalized = rel.split(sep).join('/')

  if (normalized === 'sessions/socket.ts') return '/api/sessions/socket'
  if (!mutatingSuffix.test(normalized)) return null

  return `/api/${normalized.replace(/\.ts$/, '').replace(/\.(post|put|patch|delete)$/, '')}`
}

const documentedAuditRoutes = (): string[] => {
  const markdown = readFileSync(auditPath, 'utf8')
  const routes = [...markdown.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1] ?? '')
  return routes.sort()
}

describe('API route mutation audit docs', () => {
  it('lists every non-GET API route and the legacy session socket', () => {
    const expectedRoutes = walkFiles(apiRoot)
      .map(routeForApiFile)
      .filter((route): route is string => route !== null)
      .sort()

    expect(documentedAuditRoutes()).toEqual(expectedRoutes)
  })
})
