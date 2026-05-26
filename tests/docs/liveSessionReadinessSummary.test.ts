import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))

describe('live session readiness summary', () => {
  const summary = readText('docs/live-session-readiness-summary.md')

  it('records product readiness scope and standard validation', () => {
    expect(summary).toContain('# Live session readiness summary')
    expect(summary).toContain('Audit date: 2026-05-26')
    expect(summary).toContain('Outcome: ready for trusted-table live-session smoke testing')
    expect(summary).toContain('Session hosting remains opt-in')
    expect(summary).toContain('`ROTOM_ENABLE_SESSION_HOST=1`')
    expect(summary).toContain('`npm run typecheck`, `npm test`, and `npm run build`')
    expect(summary).toContain('No target-maintenance files, private/generated maps or sheets')
    expect(summary).toContain('documented limitations remain product limitations')
  })

  it('keeps locked architecture and non-goals explicit', () => {
    expect(summary).toContain('GM-hosted table sessions')
    expect(summary).toContain('LAN / same Wi-Fi remains the primary hosting path')
    expect(summary).toContain('named Cloudflare Tunnel with a stable hostname')
    expect(summary).toContain('Quick Tunnel remains a temporary development smoke-test option only')
    expect(summary).toContain('`WebSocket /api/sessions/socket`')
    expect(summary).toContain('server-authoritative command envelopes')
    expect(summary).toContain('Identity remains session-local')
    expect(summary).toContain('Persistence remains local-first JSON')
    expect(summary).toContain('Plain `/maps/<slug>` and sheet editors remain local-first')
    expect(summary).toContain('live session clients do not become authoritative by autosaving whole maps')

    expect(summary).not.toContain('Quick Tunnel is the supported campaign')
    expect(summary).not.toContain('Postgres is required')
    expect(summary).not.toContain('public multi-tenant app')
    expect(summary).not.toContain('gmKey=')
    expect(summary).not.toContain('joinCode=')
  })

  it('links readiness evidence and target tests that exist', () => {
    const expectedDocPaths = [
      'docs/live-session-implementation-review.md',
      'docs/live-session-command-audit.md',
      'docs/live-session-lan-manual-smoke-results.md',
      'docs/live-session-named-tunnel-documentation-review.md',
      'docs/live-session-local-mode-no-regression-audit.md',
      'docs/live-session-security-secret-hygiene-readiness.md',
      'docs/live-session-persistence-recovery-audit.md',
      'docs/live-session-concurrency-benchmark-notes.md',
    ]

    for (const path of expectedDocPaths) {
      expect(summary).toContain(path.replace('docs/', ''))
      expect(exists(path)).toBe(true)
    }

    const expectedTestPaths = [
      'tests/server/sessionIntegratedCommandAudit.test.ts',
      'tests/server/sessionWebSocketTransport.test.ts',
      'tests/server/sessionHostingHardening.test.ts',
      'tests/composables/map-editor/sessionClientIntegration.test.ts',
      'tests/docs/liveSessionProductTerminologyCleanup.test.ts',
      'tests/docs/liveSessionReadinessSummary.test.ts',
      'tests/docs/productTerminologyGuard.test.ts',
    ]

    for (const path of expectedTestPaths) {
      expect(summary).toContain(path)
      expect(exists(path)).toBe(true)
    }
  })

  it('is linked from primary live-session review entry points', () => {
    for (const path of [
      'README.md',
      'docs/README.md',
      'docs/live-session-roadmap.md',
      'docs/live-session-validation-matrix.md',
      'docs/live-session-implementation-review.md',
    ]) {
      expect(readText(path), `${path} should link the readiness summary`).toContain(
        'live-session-readiness-summary.md',
      )
    }
  })
})
