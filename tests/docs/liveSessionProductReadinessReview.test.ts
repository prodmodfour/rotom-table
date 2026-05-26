import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))

describe('live session product readiness review', () => {
  const review = readText('docs/live-session-product-readiness-review.md')

  it('summarizes the product readiness outcome and locked architecture', () => {
    expect(review).toContain('# Live session product readiness review')
    expect(review).toContain('Last checked: 2026-05-26')
    expect(review).toContain('Current product readiness: ready for trusted-table live-session rehearsal and play within the documented limits')
    expect(review).toContain('Live sessions are GM-hosted table sessions')
    expect(review).toContain('LAN / same-Wi-Fi hosting is the primary path')
    expect(review).toContain('named Cloudflare Tunnel with a stable hostname')
    expect(review).toContain('`ROTOM_ENABLE_SESSION_HOST=1`')
    expect(review).toContain('`WebSocket /api/sessions/socket`')
    expect(review).toContain('Commands carry `opId`, `baseRevision`')
    expect(review).toContain('Identity is session-local')
    expect(review).toContain('Persistence stays local-first')
    expect(review).toContain('No database, hosted persistence service, Redis, Postgres, Durable Objects, or multi-tenant cloud layer is required')
    expect(review).toContain('Plain `/maps/<slug>` and sheet routes remain local-first')
    expect(review).toContain('session-mode clients do not gain authority by autosaving whole maps')
  })

  it('captures the real table flow from host startup through reconnect recovery', () => {
    for (const phrase of [
      'The GM starts Rotom Table with session hosting enabled',
      '**Attach current map to live session**',
      'Players join from the lobby with display names',
      '**Assign map tokens**',
      '**Assign control**',
      '**Visible session maps**',
      '`/maps/<map-slug>?session=1`',
      'Player movement and table actions are sent as session commands',
      'broadcasts same-session patches',
      'receive filtered snapshots',
      'private runtime data',
    ]) {
      expect(review).toContain(phrase)
    }
  })

  it('links current product documentation and existing validation evidence', () => {
    const expectedDocs = [
      'docs/live-session-roadmap.md',
      'docs/live-session-glossary.md',
      'docs/live-session-map-attachment.md',
      'docs/live-session-lobby.md',
      'docs/live-session-client-integration.md',
      'docs/live-session-protocol.md',
      'docs/live-session-socket-protocol.md',
      'docs/live-session-table-action-commands.md',
      'docs/live-session-validation-matrix.md',
      'docs/live-session-implementation-maintenance.md',
      'docs/live-session-readiness-summary.md',
      'docs/live-session-real-flow-smoke.md',
      'docs/live-session-deployment-smoke-checklist.md',
      'docs/live-session-concurrency-benchmark-notes.md',
      'docs/live-session-local-mode-maintenance.md',
      'docs/live-session-persistence-recovery-maintenance.md',
      'docs/live-session-security-secret-hygiene-readiness.md',
      'docs/live-session-lan-hosting.md',
      'docs/live-session-cloudflare-tunnel-hosting.md',
    ]

    for (const path of expectedDocs) {
      expect(review).toContain(path.replace('docs/', ''))
      expect(exists(path)).toBe(true)
    }

    const expectedTests = [
      'tests/server/sessionAcceptedPlayerMoveFlow.test.ts',
      'tests/server/sessionUnauthorizedPlayerControlFlow.test.ts',
      'tests/composables/sessionLobbyMapFlowIntegration.test.ts',
      'tests/composables/localFirstEditingNoRegression.test.ts',
      'tests/scripts/sessionRealFlowSmoke.test.ts',
      'tests/docs/productTerminologyGuard.test.ts',
    ]

    for (const path of expectedTests) {
      expect(review).toContain(path)
      expect(exists(path)).toBe(true)
    }
  })

  it('keeps limitations and the operator checklist visible', () => {
    for (const phrase of [
      'Live sessions assume trusted table participants',
      'They are not hardened public authentication',
      'Join codes and GM keys are session-local secrets',
      'Presence, connected peers, and recent duplicate-`opId` memory are process-local',
      'Event replay is unavailable for reconnect',
      'No WAN load/soak benchmark is recorded',
      'Quick Tunnel remains a temporary development smoke-test option',
      'must stay out of committed files',
      'Confirm the session-host safety banner',
      'Join from at least one real player device',
      'Move one assigned token',
      'Keep local-first editing expectations clear',
    ]) {
      expect(review).toContain(phrase)
    }

    expect(review).not.toContain('Quick Tunnel is the supported campaign')
    expect(review).not.toContain('Postgres is required')
    expect(review).not.toContain('gmKey=')
    expect(review).not.toContain('joinCode=')
  })

  it('is linked from primary product and developer entry points', () => {
    for (const path of [
      'README.md',
      'docs/README.md',
      'docs/live-session-readiness-summary.md',
      'docs/live-session-implementation-maintenance.md',
      'docs/live-session-validation-matrix.md',
    ]) {
      expect(readText(path), `${path} should link the product readiness review`).toContain(
        'live-session-product-readiness-review.md',
      )
    }
  })
})
