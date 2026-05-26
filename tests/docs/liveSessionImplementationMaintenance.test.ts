import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))

describe('live session implementation maintenance', () => {
  const review = readText('docs/live-session-implementation-maintenance.md')

  it('records product readiness scope and outcome', () => {
    expect(review).toContain('# Live session implementation maintenance')
    expect(review).toContain('Last checked: 2026-05-26')
    expect(review).toContain('Current maintenance baseline: the implemented live-session scope is ready for trusted-table use within the documented limits')
    expect(review).toContain('guarded GM-hosted session mode with WebSocket commands')
    expect(review).toContain('preserving local-first map and sheet workflows outside explicit session mode')
    expect(review).toContain('## Capability coverage')
    expect(review).toContain('## Maintenance notes')
  })

  it('links capability areas without release-process wording', () => {
    for (const area of [
      'Architecture and vocabulary',
      'Shared contracts',
      'State, persistence, and recovery',
      'Identity, lobby, and permissions',
      'Session socket transport',
      'Token commands',
      'Table action commands',
      'Client session mode',
      'Hosting and safety',
      'Readiness evidence',
    ]) {
      expect(review).toContain(area)
    }

    expect(review).not.toContain('Current branch')
    expect(review).not.toContain('pull/10')
    expect(review).not.toContain(['release', 'process workflow'].join(' '))
  })

  it('links primary docs and source/test evidence that exists in the target repo', () => {
    const expectedDocPaths = [
      'docs/live-session-roadmap.md',
      'docs/live-session-glossary.md',
      'docs/live-session-validation-matrix.md',
      'docs/live-session-protocol.md',
      'docs/live-session-socket-protocol.md',
      'docs/live-session-table-action-commands.md',
      'docs/live-session-client-integration.md',
      'docs/live-session-lobby.md',
      'docs/live-session-lan-hosting.md',
      'docs/live-session-cloudflare-tunnel-hosting.md',
      'docs/live-session-quick-tunnel-caveat.md',
      'docs/live-session-security-boundaries.md',
      'docs/live-session-command-flow-maintenance.md',
      'docs/live-session-lan-manual-smoke-results.md',
      'docs/live-session-named-tunnel-maintenance.md',
      'docs/live-session-local-mode-maintenance.md',
      'docs/live-session-security-secret-hygiene-readiness.md',
      'docs/live-session-persistence-recovery-maintenance.md',
      'docs/live-session-concurrency-benchmark-notes.md',
      'docs/live-session-readiness-summary.md',
    ]

    for (const path of expectedDocPaths) {
      expect(review).toContain(path.replace('docs/', ''))
      expect(exists(path)).toBe(true)
    }

    const expectedCodeAndTestPaths = [
      'shared/sessionCommands.ts',
      'shared/sessionMessages.ts',
      'shared/sessionTokenCommands.ts',
      'server/utils/sessionSnapshots.ts',
      'server/utils/sessionWebSocketServer.ts',
      'server/useCases/applyMoveTokenCommand.ts',
      'src/composables/map-editor/useSessionMap.ts',
      'tests/shared/sessionContractRegression.test.ts',
      'tests/server/sessionStateQuality.test.ts',
      'tests/server/sessionLobbyFlow.test.ts',
      'tests/server/sessionWebSocketTransport.test.ts',
      'tests/server/sessionIntegratedCommandFlow.test.ts',
      'tests/server/sessionTokenCommandTwoClientSmoke.test.ts',
      'tests/server/sessionHostingHardening.test.ts',
      'tests/composables/map-editor/sessionClientIntegration.test.ts',
      'tests/docs/liveSessionImplementationMaintenance.test.ts',
      'tests/docs/liveSessionDocsMaintenance.test.ts',
      'tests/docs/liveSessionReadinessSummary.test.ts',
      'tests/docs/productTerminologyGuard.test.ts',
    ]

    for (const path of expectedCodeAndTestPaths) {
      expect(review).toContain(path)
      expect(exists(path)).toBe(true)
    }
  })

  it('keeps locked architecture and known limitations explicit', () => {
    expect(review).toContain('GM-hosted table sessions')
    expect(review).toContain('LAN / same Wi-Fi as the primary hosting path')
    expect(review).toContain('named Cloudflare Tunnel and stable hostname')
    expect(review).toContain('Quick Tunnel documented only as a temporary development smoke-test option')
    expect(review).toContain('`WebSocket /api/sessions/socket`')
    expect(review).toContain('Server-authoritative commands')
    expect(review).toContain('Session-local identity only')
    expect(review).toContain('Local-first JSON persistence')
    expect(review).toContain('`ROTOM_ENABLE_SESSION_HOST=1`')
    expect(review).toContain('Plain `/maps/<slug>` and sheet editors remain local-first')

    expect(review).toContain('not a high-concurrency public service')
    expect(review).toContain('not public authentication')
    expect(review).toContain('No rate limiting, CAPTCHA, OAuth/MFA')
    expect(review).toContain('WebSocket peer tracking, connected-client presence, and recent duplicate-`opId` memory are process-local')
    expect(review).toContain('`replayAvailable: false`')
    expect(review).toContain('Accepted command latency includes local JSON snapshot')
    expect(review).toContain('No WAN/named-tunnel latency benchmark')
    expect(review).toContain('Session-mode clients must not become the authority by autosaving whole maps')
    expect(review).not.toContain('Quick Tunnel is the supported campaign')
    expect(review).not.toContain('Postgres is required')
    expect(review).not.toContain('gmKey=')
    expect(review).not.toContain('joinCode=')
  })

  it('is linked from primary live-session docs and the command-flow maintenance list', () => {
    expect(readText('README.md')).toContain('docs/live-session-implementation-maintenance.md')
    expect(readText('docs/README.md')).toContain('live-session-implementation-maintenance.md')
    expect(readText('docs/live-session-roadmap.md')).toContain('live-session-implementation-maintenance.md')
    expect(readText('docs/live-session-validation-matrix.md')).toContain('live-session-implementation-maintenance.md')
    expect(readText('docs/live-session-protocol.md')).toContain('live-session-implementation-maintenance.md')
    expect(readText('docs/live-session-command-flow-maintenance.md')).toContain('live-session-implementation-maintenance.md')
    expect(readText('docs/live-session-readiness-summary.md')).toContain('live-session-implementation-maintenance.md')
  })
})
