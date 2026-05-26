import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))

describe('Track 2 final implementation review', () => {
  const review = readText('docs/track-2-final-implementation-review.md')

  it('records the ticket 097 scope, outcome, and final-handoff boundary', () => {
    expect(review).toContain('Ticket 097')
    expect(review).toContain('Audit date: 2026-05-26')
    expect(review).toContain('Outcome: pass for the implemented Track 2 scope')
    expect(review).toContain('not the autonomous completion marker')
    expect(review).toContain('ticket 098 still handles stale-note cleanup')
    expect(review).toContain('ticket 099 handles the controller-only completion status')
    expect(review).toContain('chunk 09 PR should be created/merged by the outer build loop only')
  })

  it('links all completed Track 2 chunk PRs and identifies the current final-audit branch', () => {
    for (const prNumber of [10, 11, 12, 13, 14, 15, 16, 17, 18]) {
      expect(review).toContain(`https://github.com/prodmodfour/rotom-table/pull/${prNumber}`)
    }

    const chunkIds = [
      '00-architecture-lock',
      '01-session-contracts',
      '02-session-state-persistence',
      '03-identity-join-lobby',
      '04-websocket-transport',
      '05-token-commands',
      '06-table-actions',
      '07-client-integration',
      '08-hosting-hardening',
      '09-final-audit',
    ]

    for (const chunkId of chunkIds) {
      expect(review).toContain(chunkId)
    }

    expect(review).toContain('Current branch `track2/09-final-audit-final-audit`')
    expect(review).toContain('chunk PR deferred until the outer controller finishes tickets 098-099')
  })

  it('links primary docs and source/test evidence that exists in the target repo', () => {
    const expectedDocPaths = [
      'docs/track-2-roadmap.md',
      'docs/track-2-glossary.md',
      'docs/track-2-validation-matrix.md',
      'docs/track-2-session-protocol.md',
      'docs/track-2-websocket-protocol.md',
      'docs/track-2-table-action-commands.md',
      'docs/track-2-client-integration.md',
      'docs/track-2-session-lobby.md',
      'docs/track-2-lan-hosting.md',
      'docs/track-2-cloudflare-tunnel-hosting.md',
      'docs/track-2-quick-tunnel-caveat.md',
      'docs/track-2-security-review.md',
      'docs/track-2-command-audit.md',
      'docs/track-2-lan-manual-smoke-results.md',
      'docs/track-2-named-tunnel-documentation-review.md',
      'docs/track-2-local-mode-no-regression-audit.md',
      'docs/track-2-final-session-security-audit.md',
      'docs/track-2-final-persistence-recovery-audit.md',
      'docs/track-2-concurrency-benchmark-notes.md',
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
      'tests/server/sessionIntegratedCommandAudit.test.ts',
      'tests/server/sessionTokenCommandTwoClientSmoke.test.ts',
      'tests/server/sessionHostingHardening.test.ts',
      'tests/composables/map-editor/sessionClientIntegration.test.ts',
      'tests/docs/track2FinalImplementationReview.test.ts',
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
    expect(review).toContain('No autonomous WAN/named-tunnel latency benchmark')
    expect(review).toContain('Session-mode clients must not become the authority by autosaving whole maps')
    expect(review).not.toContain('Quick Tunnel is the supported campaign')
    expect(review).not.toContain('Postgres is required')
    expect(review).not.toContain('gmKey=')
    expect(review).not.toContain('joinCode=')
  })

  it('is linked from primary Track 2 docs and the command audit follow-up list', () => {
    expect(readText('README.md')).toContain('docs/track-2-final-implementation-review.md')
    expect(readText('docs/README.md')).toContain('track-2-final-implementation-review.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-final-implementation-review.md')
    expect(readText('docs/track-2-validation-matrix.md')).toContain('track-2-final-implementation-review.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-final-implementation-review.md')
    expect(readText('docs/track-2-command-audit.md')).toContain('track-2-final-implementation-review.md')
  })
})
