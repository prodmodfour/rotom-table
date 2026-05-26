import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Live session LAN manual smoke results docs', () => {
  const results = readText('docs/live-session-lan-manual-smoke-results.md')

  it('records the guarded LAN startup and browser-client scope', () => {
    expect(results).toContain('2026-05-26')
    expect(results).toContain('`npm run dev:session:lan -- --port 31091`')
    expect(results).toContain('`http://<private-LAN-IP>:31091`')
    expect(results).toContain('Three separate Chromium browser contexts')
    expect(results).toContain('`GM browser`, `Player A browser`, and `Player B browser`')
    expect(results).toContain('8 characters')
  })

  it('records two-player join, WebSocket presence, and reconnect snapshot evidence', () => {
    expect(results).toContain('host flag `Enabled` and LAN/private exposure')
    expect(results).toContain('listed both players exactly once')
    expect(results).toContain('`ws://<private-LAN-IP>:31091/api/sessions/socket`')
    expect(results).toContain('server `hello` messages at revision `2`')
    expect(results).toContain('Same-session `presence` messages')
    expect(results).toContain('stale `lastSeenRevision: 0`')
    expect(results).toContain('`snapshotRequired: true`')
    expect(results).toContain('`reason: "reconnect"`')
  })

  it('documents the runtime import boundary fixed by the smoke pass', () => {
    expect(results).toContain('`globalThis._importMeta_.glob is not a function`')
    expect(results).toContain('`src/utils/sheets/pokemonDerived.ts`')
    expect(results).toContain('`src/utils/sheetSpawn.ts`')
    expect(results).toContain('`~~/data/reference/pokedex.json`')
    expect(results).toContain('instead of importing `~~/data/characterSheets`')
  })

  it('keeps locked architecture and no-secret boundaries explicit', () => {
    expect(results).toContain('`WebSocket /api/sessions/socket`')
    expect(results).toContain('reconnect used a server snapshot fallback')
    expect(results).toContain('Quick Tunnel was not used')
    expect(results).toContain('local trust switch, not public authentication')
    expect(results).toContain('Browser clients did not autosave whole maps')
    expect(results).toContain('Do not commit `data/sessions/`')
    expect(results).toContain('join codes, GM keys')
  })

  it('is linked from the main Live session docs', () => {
    expect(readText('README.md')).toContain('docs/live-session-lan-manual-smoke-results.md')
    expect(readText('docs/README.md')).toContain('live-session-lan-manual-smoke-results.md')
    expect(readText('docs/live-session-lan-hosting.md')).toContain('live-session-lan-manual-smoke-results.md')
    expect(readText('docs/live-session-deployment-smoke-checklist.md')).toContain('live-session-lan-manual-smoke-results.md')
    expect(readText('docs/live-session-protocol.md')).toContain('live-session-lan-manual-smoke-results.md')
    expect(readText('docs/live-session-websocket-protocol.md')).toContain('live-session-lan-manual-smoke-results.md')
    expect(readText('docs/live-session-validation-matrix.md')).toContain('live-session-lan-manual-smoke-results.md')
  })
})
