import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Track 2 public exposure checks documentation', () => {
  const guide = readText('docs/track-2-public-exposure-checks.md')

  it('documents the no-secret safety endpoint fields and startup issue codes', () => {
    expect(guide).toContain('GET /api/sessions/safety')
    expect(guide).toContain('activeSessionCount')
    expect(guide).toContain('credentialedSessionCount')
    expect(guide).toContain('stateBackedSessionCount')
    expect(guide).toContain('host-enabled-without-active-session')
    expect(guide).toContain('remote-exposure-before-session-start')
    expect(guide).toContain('host-enabled-without-session-secrets')
    expect(guide).toContain('host-enabled-without-authoritative-state')
    expect(guide).toContain('host-enabled-session-readiness-unknown')
  })

  it('keeps public exposure response guidance aligned with Track 2 boundaries', () => {
    expect(guide).toContain('session-local GM key')
    expect(guide).toContain('player join code')
    expect(guide).toContain('named Cloudflare Tunnel')
    expect(guide).toContain('Quick Tunnel remains development-smoke-test only')
    expect(guide).toContain('not public authentication')
    expect(guide).toContain('WebSocket /api/sessions/socket')
    expect(guide).toContain('server-authoritative commands')
    expect(guide).toContain('No cloud database, SaaS deployment, public account provider')
    expect(guide).not.toContain('gmKey=')
    expect(guide).not.toContain('joinCode=')
  })

  it('links the public exposure checks from primary Track 2 docs and runbooks', () => {
    expect(readText('README.md')).toContain('docs/track-2-public-exposure-checks.md')
    expect(readText('docs/README.md')).toContain('track-2-public-exposure-checks.md')
    expect(readText('docs/local-development.md')).toContain('track-2-public-exposure-checks.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-public-exposure-checks.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-public-exposure-checks.md')
    expect(readText('docs/track-2-session-lobby.md')).toContain('track-2-public-exposure-checks.md')
    expect(readText('docs/track-2-session-host-runtime.md')).toContain('track-2-public-exposure-checks.md')
    expect(readText('docs/track-2-lan-hosting.md')).toContain('track-2-public-exposure-checks.md')
    expect(readText('docs/track-2-cloudflare-tunnel-hosting.md')).toContain('track-2-public-exposure-checks.md')
  })
})
