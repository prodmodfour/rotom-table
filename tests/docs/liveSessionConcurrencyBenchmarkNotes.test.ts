import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))

describe('Live session concurrency benchmark notes', () => {
  const notes = readText('docs/live-session-concurrency-benchmark-notes.md')

  it('records the this review scope, outcome, and measurement caveats', () => {
    expect(notes).toContain('This review')
    expect(notes).toContain('Audit date: 2026-05-26')
    expect(notes).toContain('Outcome: pass for the locked Live session small-table concurrency posture')
    expect(notes).toContain('not a load test, WAN benchmark, browser FPS benchmark, or numeric latency SLA')
    expect(notes).toContain('No millisecond latency target is claimed')
    expect(notes).toContain('separate Chromium contexts through a private LAN URL')
    expect(notes).toContain('No live named Cloudflare Tunnel')
  })

  it('summarizes multi-client command, fanout, permission, stale, and reconnect behaviour evidence', () => {
    const expectedEvidence = [
      'tests/server/sessionIntegratedCommandAudit.test.ts',
      'tests/server/sessionTokenCommandTwoClientSmoke.test.ts',
      'tests/server/sessionWebSocketTransport.test.ts',
      'tests/server/applyMoveTokenCommand.test.ts',
      'tests/composables/map-editor/sessionClientIntegration.test.ts',
    ]

    for (const evidencePath of expectedEvidence) {
      expect(notes).toContain(evidencePath)
      expect(exists(evidencePath)).toBe(true)
    }
    expect(notes).toContain('live-session-lan-manual-smoke-results.md')
    expect(exists('docs/live-session-lan-manual-smoke-results.md')).toBe(true)

    expect(notes).toContain('One GM socket, two same-session player sockets, and one unrelated-session socket')
    expect(notes).toContain('Accepted commands advanced revisions 1 through 5')
    expect(notes).toContain('same-session peers while the unrelated session received nothing')
    expect(notes).toContain('rejected as `unauthorized`')
    expect(notes).toContain('rejected as `stale` with current authoritative token state')
    expect(notes).toContain('`snapshotRequired: true`')
    expect(notes).toContain('`GM browser`, `Player A browser`, `Player B browser`')
    expect(notes).toContain('no page errors or warning/error console messages')
  })

  it('locks the latency-sensitive command path and heartbeat/reconnect boundaries to current source', () => {
    expect(notes).toContain('The local filesystem snapshot write is on the accepted-command path')
    expect(notes).toContain('commandAck')
    expect(notes).toContain('small `patch` message')
    expect(notes).toContain('25 second heartbeat interval')
    expect(notes).toContain('60 second stale timeout')
    expect(notes).toContain('`replayAvailable: false`')
    expect(notes).toContain('snapshot fallback')

    const socketServer = readText('server/utils/sessionWebSocketServer.ts')
    expect(socketServer).toContain('SESSION_SOCKET_HEARTBEAT_INTERVAL_MS = 25_000')
    expect(socketServer).toContain('SESSION_SOCKET_HEARTBEAT_TIMEOUT_MS = 60_000')
    expect(socketServer).toContain('SESSION_SOCKET_REPLAY_AVAILABLE = false')
    expect(socketServer).toContain('handleSessionSocketMessage')

    const snapshots = readText('server/utils/sessionSnapshots.ts')
    expect(snapshots).toContain('writeSessionSnapshot')

    const fanout = readText('server/utils/sessionWebSocketFanout.ts')
    expect(fanout).toContain('fanoutSessionServerMessage')
    expect(fanout).toContain('connection.sessionId !== sessionId')
  })

  it('keeps known performance limitations and locked architecture boundaries explicit', () => {
    expect(notes).toContain('trusted small table, not a public high-concurrency service')
    expect(notes).toContain('not a soak test for dozens of players')
    expect(notes).toContain('No real WAN/named-tunnel latency measurement was collected')
    expect(notes).toContain('WebSocket peer state, connected-client presence, and recent duplicate-`opId` tracking are process-local')
    expect(notes).toContain('Accepted command handlers persist local JSON snapshots')
    expect(notes).toContain('Map renderer performance still matters')
    expect(notes).toContain('Quick Tunnel remains development smoke-test only')
    expect(notes).toContain('cloud databases')
    expect(notes).toContain('browser-owned whole-map autosave')
    expect(notes).not.toContain('Quick Tunnel is the supported campaign')
    expect(notes).not.toContain('Postgres is required')
    expect(notes).not.toContain('gmKey=')
    expect(notes).not.toContain('joinCode=')
  })

  it('provides a no-secret operator benchmark checklist', () => {
    expect(notes).toContain('Operator benchmark checklist')
    expect(notes).toContain('`npm run dev:session:lan`')
    expect(notes).toContain('`npm run dev:session:tunnel`')
    expect(notes).toContain('`cloudflared tunnel run`')
    expect(notes).toContain('`/maps/<map-slug>?session=1`')
    expect(notes).toContain('`<250ms`, `250-1000ms`, `1-3s`, or `>3s`')
    expect(notes).toContain('Do not paste real join codes, GM keys')
    expect(notes).toContain('`git status --short`')
  })

  it('is linked from primary Live session docs and smoke/audit references', () => {
    expect(readText('README.md')).toContain('docs/live-session-concurrency-benchmark-notes.md')
    expect(readText('docs/README.md')).toContain('live-session-concurrency-benchmark-notes.md')
    expect(readText('docs/local-development.md')).toContain('live-session-concurrency-benchmark-notes.md')
    expect(readText('docs/live-session-roadmap.md')).toContain('live-session-concurrency-benchmark-notes.md')
    expect(readText('docs/live-session-validation-matrix.md')).toContain('live-session-concurrency-benchmark-notes.md')
    expect(readText('docs/live-session-protocol.md')).toContain('live-session-concurrency-benchmark-notes.md')
    expect(readText('docs/live-session-socket-protocol.md')).toContain('live-session-concurrency-benchmark-notes.md')
    expect(readText('docs/live-session-command-audit.md')).toContain('live-session-concurrency-benchmark-notes.md')
    expect(readText('docs/live-session-deployment-smoke-checklist.md')).toContain('live-session-concurrency-benchmark-notes.md')
    expect(readText('docs/live-session-lan-manual-smoke-results.md')).toContain('live-session-concurrency-benchmark-notes.md')
  })
})
