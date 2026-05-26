import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Track 2 client integration documentation', () => {
  const guide = readText('docs/track-2-client-integration.md')

  it('documents the explicit local-mode and session-mode boundary', () => {
    expect(guide).toContain('`/maps/<slug>`')
    expect(guide).toContain('`/maps/<slug>?session=1`')
    expect(guide).toContain('useEditableMap')
    expect(guide).toContain('useSessionMapEditorState')
    expect(guide).toContain('GET /api/events')
    expect(guide).toContain('WebSocket /api/sessions/socket')
    expect(guide).toContain('does not mutate the local autosaved map ref')
  })

  it('documents player-safe disconnect and conflict recovery', () => {
    expect(guide).toContain('Recovering from disconnects')
    expect(guide).toContain('Refresh the session snapshot')
    expect(guide).toContain('Recovered snapshot')
    expect(guide).toContain('Recovering from conflicts and rejections')
    expect(guide).toContain('`stale`')
    expect(guide).toContain('`conflict`')
    expect(guide).toContain('`unauthorized`')
    expect(guide).toContain('Do not switch to plain `/maps/<slug>`')
  })

  it('keeps the Track 2 safety and architecture boundaries visible', () => {
    expect(guide).toContain('ROTOM_ENABLE_SESSION_HOST=1')
    expect(guide).toContain('not public authentication')
    expect(guide).toContain('does not add accounts')
    expect(guide).toContain('does not add a database')
    expect(guide).toContain('Session clients must not use whole-map autosave as the live concurrency mechanism')
  })

  it('is linked from primary documentation indexes', () => {
    expect(readText('README.md')).toContain('docs/track-2-client-integration.md')
    expect(readText('docs/README.md')).toContain('track-2-client-integration.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-client-integration.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-client-integration.md')
  })
})
