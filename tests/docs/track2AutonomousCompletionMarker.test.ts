import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))

describe('Track 2 autonomous completion marker', () => {
  const marker = readText('docs/track-2-autonomous-completion-marker.md')

  it('records ticket 099 completion scope and final quality-gate handoff', () => {
    expect(marker).toContain('Ticket 099')
    expect(marker).toContain('Audit date: 2026-05-26')
    expect(marker).toContain('Outcome: complete for the locked Track 2 scope')
    expect(marker).toContain('Tickets 000-099 are accounted for')
    expect(marker).toContain('no known blocked tickets')
    expect(marker).toContain('`scripts/quality-gate.sh`')
    expect(marker).toContain('`npm run typecheck`, `npm test`, and `npm run build`')
    expect(marker).toContain('target pollution checks')
  })

  it('confirms chunk coverage without taking over the outer PR workflow', () => {
    expect(marker).toContain('Chunks `00-architecture-lock` through `08-hosting-hardening`')
    expect(marker).toContain('completed chunk PRs #10 through #18')
    expect(marker).toContain('Chunk `09-final-audit`')
    expect(marker).toContain('tickets 090-099')
    expect(marker).toContain('branch `track2/09-final-audit-final-audit`')
    expect(marker).toContain('outer autonomous controller remains responsible for creating and merging the chunk PR')
    expect(marker).toContain('This marker does not create or merge pull requests')
  })

  it('keeps locked architecture and non-goals explicit', () => {
    expect(marker).toContain('GM-hosted table sessions')
    expect(marker).toContain('LAN / same Wi-Fi remains the primary hosting path')
    expect(marker).toContain('named Cloudflare Tunnel with a stable hostname')
    expect(marker).toContain('Quick Tunnel remains a temporary development smoke-test option only')
    expect(marker).toContain('`WebSocket /api/sessions/socket`')
    expect(marker).toContain('server-authoritative command envelopes')
    expect(marker).toContain('Identity remains session-local')
    expect(marker).toContain('Persistence remains local-first JSON')
    expect(marker).toContain('`ROTOM_ENABLE_SESSION_HOST=1`')
    expect(marker).toContain('Plain `/maps/<slug>` and sheet editors remain local-first')
    expect(marker).toContain('live session clients do not become authoritative by autosaving whole maps')

    expect(marker).not.toContain('Quick Tunnel is the supported campaign')
    expect(marker).not.toContain('Postgres is required')
    expect(marker).not.toContain('public multi-tenant app')
    expect(marker).not.toContain('gmKey=')
    expect(marker).not.toContain('joinCode=')
  })

  it('links final audit evidence and target tests that exist', () => {
    const expectedDocPaths = [
      'docs/track-2-final-implementation-review.md',
      'docs/track-2-command-audit.md',
      'docs/track-2-lan-manual-smoke-results.md',
      'docs/track-2-named-tunnel-documentation-review.md',
      'docs/track-2-local-mode-no-regression-audit.md',
      'docs/track-2-final-session-security-audit.md',
      'docs/track-2-final-persistence-recovery-audit.md',
      'docs/track-2-concurrency-benchmark-notes.md',
    ]

    for (const path of expectedDocPaths) {
      expect(marker).toContain(path.replace('docs/', ''))
      expect(exists(path)).toBe(true)
    }

    const expectedTestPaths = [
      'tests/server/sessionIntegratedCommandAudit.test.ts',
      'tests/server/sessionWebSocketTransport.test.ts',
      'tests/server/sessionHostingHardening.test.ts',
      'tests/composables/map-editor/sessionClientIntegration.test.ts',
      'tests/docs/track2StaleNotesCleanup.test.ts',
      'tests/docs/track2AutonomousCompletionMarker.test.ts',
    ]

    for (const path of expectedTestPaths) {
      expect(marker).toContain(path)
      expect(exists(path)).toBe(true)
    }
  })

  it('is linked from primary Track 2 review entry points', () => {
    for (const path of [
      'README.md',
      'docs/README.md',
      'docs/track-2-roadmap.md',
      'docs/track-2-validation-matrix.md',
      'docs/track-2-final-implementation-review.md',
    ]) {
      expect(readText(path), `${path} should link the completion marker`).toContain(
        'track-2-autonomous-completion-marker.md',
      )
    }
  })
})
