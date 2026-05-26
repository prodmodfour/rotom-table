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
    .filter((path) => path.startsWith('docs/track-2') || path.startsWith('docs/adrs/'))

  return ['README.md', 'SECURITY.md', ...docs].sort()
}

describe('Track 2 stale-note cleanup', () => {
  const stalePhrases = [
    'later server and client tickets',
    'not a claim that every command handler is already complete',
    'shared before individual command payloads are implemented',
    'not implemented yet receive `unsupported-message`',
    'then later command tickets route',
    'Future tickets may replace specific local-mode behaviours',
    'future WebSocket handshakes',
    'the later WebSocket hello/client-identity flow',
    'future command application and reconnect work',
    'later command handlers to reject safely',
    'later server work must reject it safely',
    'Later implementation tickets should keep these checks',
    'not yet wired to all map page buttons',
    'until their command-specific tickets land',
    'awaits later client UI integration slices',
    'does not yet provide a full assignment editor',
    'not yet retain a built-in history',
    'Event replay is not yet implemented',
    'ticket 098 still handles stale-note cleanup',
    'tickets 098-099 pending',
    '090-098 in this review, 099 pending',
    'ticket 099 handles the controller-only completion status',
    'ticket 099 should run the full gate again',
    'not the autonomous completion marker',
    'chunk PR deferred until the outer controller finishes ticket 099',
    'outer controller finishes tickets 098-099',
    'later implementation areas',
    'later protocol documents',
    'future docs-only change',
    'future docs call it out',
    'when mentioned later',
  ]

  it('removes stale future-ticket and incomplete-reference wording from Track 2 docs', () => {
    const docs = markdownUnderReview()

    for (const path of docs) {
      const text = readText(path)

      for (const phrase of stalePhrases) {
        expect(text, `${path} still contains stale phrase: ${phrase}`).not.toContain(phrase)
      }
    }
  })

  it('records the cleanup evidence without changing the locked architecture', () => {
    const review = readText('docs/track-2-final-implementation-review.md')
    const websocketProtocol = readText('docs/track-2-websocket-protocol.md')
    const sessionProtocol = readText('docs/track-2-session-protocol.md')

    expect(review).toContain('ticket 098 stale-note cleanup')
    expect(review).toContain('| `09-final-audit` | 090-099 |')
    expect(review).toContain('track-2-autonomous-completion-marker.md')
    expect(review).toContain('tests/docs/track2StaleNotesCleanup.test.ts')
    expect(review).toContain('tests/docs/track2AutonomousCompletionMarker.test.ts')
    expect(websocketProtocol).toContain('authenticated command types outside the implemented Track 2 set')
    expect(websocketProtocol).toContain('useSessionMapSceneCommands')
    expect(sessionProtocol).toContain('implemented session behaviours for Track 2 session mode')
    expect(review).toContain('GM-hosted table sessions')
    expect(review).toContain('`WebSocket /api/sessions/socket`')
    expect(review).toContain('Server-authoritative commands')
    expect(review).toContain('Local-first JSON persistence')
  })
})
