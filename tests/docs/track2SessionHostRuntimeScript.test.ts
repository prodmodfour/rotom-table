import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Track 2 session host runtime scripts documentation', () => {
  const guide = readText('docs/track-2-session-host-runtime.md')

  it('documents npm scripts for explicit LAN and named-tunnel safe defaults', () => {
    expect(guide).toContain('npm run dev:session:lan')
    expect(guide).toContain('npm run dev:session:tunnel')
    expect(guide).toContain('0.0.0.0:3000')
    expect(guide).toContain('127.0.0.1:3000')
    expect(guide).toContain('ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000')
    expect(guide).toContain('ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000')
    expect(guide).toContain('npm run dev:session:lan -- --port 3001')
    expect(guide).toContain('npm run dev:session:lan -- --print-only')
  })

  it('keeps script boundaries safe and no-secret', () => {
    expect(guide).toContain('does not enable session hosting by itself')
    expect(guide).toContain('do **not** write `.env` files')
    expect(guide).toContain('not public authentication')
    expect(guide).toContain('WebSocket /api/sessions/socket')
    expect(guide).toContain('server-authoritative command envelopes')
    expect(guide).toContain('Quick Tunnel remains temporary development smoke-test only')
    expect(guide).toContain('generated `data/sessions/` snapshots/event logs')
    expect(guide).not.toContain('gmKey=')
    expect(guide).not.toContain('joinCode=')
  })

  it('exposes the package scripts and links the runtime guide from primary docs', () => {
    const packageJson = JSON.parse(readText('package.json'))
    expect(packageJson.scripts['dev:session:lan']).toBe('node scripts/session-host-dev.mjs --mode lan')
    expect(packageJson.scripts['dev:session:tunnel']).toBe('node scripts/session-host-dev.mjs --mode tunnel')

    expect(readText('README.md')).toContain('docs/track-2-session-host-runtime.md')
    expect(readText('README.md')).toContain('npm run dev:session:lan')
    expect(readText('docs/README.md')).toContain('track-2-session-host-runtime.md')
    expect(readText('docs/local-development.md')).toContain('track-2-session-host-runtime.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-session-host-runtime.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-session-host-runtime.md')
    expect(readText('docs/track-2-websocket-protocol.md')).toContain('track-2-session-host-runtime.md')
    expect(readText('docs/track-2-session-lobby.md')).toContain('track-2-session-host-runtime.md')
    expect(readText('docs/track-2-client-integration.md')).toContain('track-2-session-host-runtime.md')
    expect(readText('docs/track-2-multi-tab-smoke.md')).toContain('track-2-session-host-runtime.md')
    expect(readText('docs/track-2-lan-hosting.md')).toContain('track-2-session-host-runtime.md')
    expect(readText('docs/track-2-cloudflare-tunnel-hosting.md')).toContain('track-2-session-host-runtime.md')
  })
})
