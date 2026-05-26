import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

const collectMarkdown = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true })

  return entries.flatMap((entry) => {
    const path = resolve(directory, entry.name)

    if (entry.isDirectory()) {
      return collectMarkdown(path)
    }

    return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  })
}

const markdownUnderReview = (): string[] => {
  const docs = collectMarkdown(resolve(repoRoot, 'docs'))
    .map((absolutePath) => relative(repoRoot, absolutePath))
    .filter((path) => path.startsWith('docs/live-session-') || path.startsWith('docs/adrs/'))

  return ['README.md', 'SECURITY.md', ...docs].sort()
}

describe('Live session stale-note cleanup', () => {
  const stalePhrases = [
    'later server and client work items',
    'not a claim that every command handler is already complete',
    'shared before individual command payloads are implemented',
    'not implemented yet receive `unsupported-message`',
    'then later command work routes',
    'Future work may replace specific local-mode behaviours',
    'future WebSocket handshakes',
    'the later WebSocket hello/client-identity flow',
    'future command application and reconnect work',
    'later command handlers to reject safely',
    'later server work must reject it safely',
    'Later implementation areas should keep these checks',
    'not yet wired to all map page buttons',
    'until their command-specific work lands',
    'awaits later client UI integration slices',
    'does not yet provide a full assignment editor',
    'not yet retain a built-in history',
    'Event replay is not yet implemented',
    'this review still handles stale-note cleanup',
    'the reviewed implementation span pending',
    '090-098 in this review, 099 pending',
    'this review handles the external completion status',
    'this review should run the full gate again',
    'not the live-session readiness summary',
    'implementation review deferred until the release process finishes this review',
    'release process finishes the reviewed implementation span',
    'later implementation areas',
    'later protocol documents',
    'future docs-only change',
    'future docs call it out',
    'when mentioned later',
  ]

  it('removes stale incomplete-reference wording from Live session docs', () => {
    const docs = markdownUnderReview()

    for (const path of docs) {
      const text = readText(path)

      for (const phrase of stalePhrases) {
        expect(text, `${path} still contains stale phrase: ${phrase}`).not.toContain(phrase)
      }
    }
  })

  it('records product readiness evidence without changing the locked architecture', () => {
    const review = readText('docs/live-session-implementation-review.md')
    const websocketProtocol = readText('docs/live-session-websocket-protocol.md')
    const sessionProtocol = readText('docs/live-session-protocol.md')

    expect(review).toContain('Keep live-session docs, tests, comments, and user-facing copy in product language')
    expect(review).toContain('live-session-readiness-summary.md')
    expect(review).toContain('tests/docs/liveSessionProductTerminologyCleanup.test.ts')
    expect(review).toContain('tests/docs/liveSessionReadinessSummary.test.ts')
    expect(websocketProtocol).toContain('authenticated command types outside the implemented Live session set')
    expect(websocketProtocol).toContain('useSessionMapSceneCommands')
    expect(sessionProtocol).toContain('implemented session behaviours for live session mode')
    expect(review).toContain('GM-hosted table sessions')
    expect(review).toContain('`WebSocket /api/sessions/socket`')
    expect(review).toContain('Server-authoritative commands')
    expect(review).toContain('Local-first JSON persistence')
  })
})
