import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))

describe('Track 2 final session security audit', () => {
  const audit = readText('docs/track-2-final-session-security-audit.md')

  it('records the ticket 094 security audit outcome and scope', () => {
    expect(audit).toContain('Ticket 094')
    expect(audit).toContain('Audit date: 2026-05-26')
    expect(audit).toContain('Outcome: pass for the locked Track 2 trusted-table posture')
    expect(audit).toContain('auth/session/cookie/permission boundaries')
    expect(audit).toContain('public exposure warnings')
    expect(audit).toContain('remaining non-goals')
    expect(audit).toContain('did not create a live public tunnel')
    expect(audit).toContain('did not harden legacy local-first routes for arbitrary public internet users')
  })

  it('covers runtime-gated session HTTP authority boundaries', () => {
    expect(audit).toContain('ROTOM_ENABLE_SESSION_HOST=1')
    expect(audit).toContain('`POST /api/sessions/start`')
    expect(audit).toContain('`POST /api/sessions/join`')
    expect(audit).toContain('`POST /api/sessions/manage`')
    expect(audit).toContain('`POST /api/sessions/player-state`')
    expect(audit).toContain('`POST /api/sessions/assignments`')
    expect(audit).toContain('`requireGm(event)`')
    expect(audit).toContain('session-local `gmKey`')
    expect(audit).toContain('Duplicate display names remain labels, not authentication')

    for (const routePath of [
      'server/api/sessions/start.post.ts',
      'server/api/sessions/join.post.ts',
      'server/api/sessions/manage.post.ts',
      'server/api/sessions/player-state.post.ts',
      'server/api/sessions/assignments.post.ts',
    ]) {
      const route = readText(routePath)
      expect(route).toContain('assertSessionHostEnabled()')
      const guardIndex = route.indexOf('assertSessionHostEnabled()')
      const bodyIndex = route.indexOf('await readBody')
      if (bodyIndex !== -1) expect(guardIndex).toBeLessThan(bodyIndex)
    }

    const startRoute = readText('server/api/sessions/start.post.ts')
    expect(startRoute.indexOf('assertSessionHostEnabled()')).toBeLessThan(startRoute.indexOf('requireGm(event)'))
  })

  it('covers cookie and browser identity continuity without treating cookie hints as auth', () => {
    expect(audit).toContain('`rotom:session:identity` local storage')
    expect(audit).toContain('`rotom-session-identity` cookie')
    expect(audit).toContain('omits `gmKey`')
    expect(audit).toContain('all cookie hints reject `gmKey` or `joinCode` fields with the `secret-in-cookie` validation issue')
    expect(audit).toContain('not a hardened account/session cookie')
    expect(audit).toContain('**Forget in this browser**')
    expect(audit).toContain('do not trust the cookie hint as proof of control')

    const identity = readText('shared/sessionClientIdentity.ts')
    expect(identity).toContain("SESSION_CLIENT_IDENTITY_COOKIE = 'rotom-session-identity'")
    expect(identity).toContain("SESSION_CLIENT_IDENTITY_LOCAL_STORAGE_KEY = 'rotom:session:identity'")
    expect(identity).toContain("Omit<GmSessionClientIdentity, 'gmKey'>")
    expect(identity).toContain('secret-in-cookie')
    expect(identity).toContain('session identity cookies must not contain GM keys or join codes')

    const storage = readText('src/utils/sessionClientIdentityStorage.ts')
    expect(storage).toContain('window.localStorage.setItem')
    expect(storage).toContain('serializeSessionClientIdentityCookieHint(identity)')
    expect(storage).toContain('adapter.removeLocalItem(storageKey)')
    expect(storage).toContain('buildSessionClientIdentityClearCookie')
  })

  it('covers WebSocket actor validation, permissions, and player-filtered reconnect state', () => {
    expect(audit).toContain('`WebSocket /api/sessions/socket`')
    expect(audit).toContain('pending-hello')
    expect(audit).toContain('authenticated socket actor must match the command actor')
    expect(audit).toContain('Player commands recheck current GM-managed assignments and visibility')
    expect(audit).toContain('GM-only commands such as token spawn/delete, initiative lane changes, hazards, field effects, and terrain edits')
    expect(audit).toContain('safe `commandReject` frames')
    expect(audit).toContain('small same-session patches')
    expect(audit).toContain('filters snapshots to that player')
    expect(audit).toContain('excludes GM keys, join codes, hidden maps, and other players')

    const socketServer = readText('server/utils/sessionWebSocketServer.ts')
    expect(socketServer).toContain('const actorsMatch')
    expect(socketServer).toContain('Session WebSocket command actor does not match the authenticated socket')
    expect(socketServer).toContain('createSessionReconnectSnapshotState')
    expect(socketServer).toContain('connectedClients: state.connectedClients.filter')
    expect(socketServer).toContain('players: player === undefined ? [] : [player]')
    expect(socketServer).toContain('assignments: assignment === undefined ? [] : [assignment]')

    for (const coveragePath of [
      'tests/server/sessionWebSocketTransport.test.ts',
      'tests/server/sessionWebSocketFanout.test.ts',
      'tests/server/sessionIntegratedCommandAudit.test.ts',
      'tests/server/sessionMoveTokenWebSocketDispatch.test.ts',
      'tests/server/sessionModifyHpWebSocketDispatch.test.ts',
      'tests/server/sessionInitiativeWebSocketDispatch.test.ts',
      'tests/server/sessionTerrainWebSocketDispatch.test.ts',
    ]) {
      expect(audit).toContain(coveragePath)
      expect(exists(coveragePath)).toBe(true)
    }
  })

  it('covers public exposure warnings, hosting paths, and no-secret safety status', () => {
    expect(audit).toContain('`GET /api/sessions/safety`')
    expect(audit).toContain('no-secret counts/readiness and exposure classification')
    expect(audit).toContain('anyone who can reach the Rotom Table origin can load the local app')
    expect(audit).toContain('LAN remains primary')
    expect(audit).toContain('named Cloudflare Tunnel remains the supported remote path')
    expect(audit).toContain('Cloudflare Access/WAF/IP rules as optional outer protection only')
    expect(audit).toContain('Quick Tunnel remains documented only as a temporary development smoke-test option')

    const safety = readText('server/api/sessions/safety.get.ts')
    expect(safety).toContain('Returns a no-secret Track 2 hosting safety summary')
    expect(safety).toContain('endpoint is intentionally readable')
    expect(safety).toContain('while hosting is disabled')
    expect(safety).toContain('sessionSettings: hostEnabled ? summarizeSessionSettings() : undefined')

    const sharedSafety = readText('shared/sessionSafety.ts')
    expect(sharedSafety).toContain('host-enabled-without-active-session')
    expect(sharedSafety).toContain('remote-exposure-before-session-start')
    expect(sharedSafety).toContain('The existing GM/player role picker is still not public authentication')
  })

  it('keeps remaining non-goals and data-hygiene limitations explicit', () => {
    expect(audit).toContain('no full public account system, passwords, OAuth, SSO, MFA')
    expect(audit).toContain('no public multi-tenant hosting')
    expect(audit).toContain('no production-grade internet abuse controls such as IP rate limiting, CAPTCHA, bot detection')
    expect(audit).toContain('no encrypted-at-rest session snapshots/backups')
    expect(audit).toContain('no hosted database, Redis, Postgres, Durable Objects')
    expect(audit).toContain('no hardening claim for every legacy local-first mutating route')
    expect(audit).toContain('no browser-owned recovery authority')
    expect(audit).toContain('no Quick Tunnel campaign hosting and no legacy SSE session command transport')
    expect(audit).toContain('No real secrets, tunnel credentials, snapshots, event logs, private campaign files, or generated/private sheet data were added')
    expect(audit).not.toContain('Quick Tunnel remains the supported campaign-session path')
    expect(audit).not.toContain('gmKey=')
    expect(audit).not.toContain('joinCode=')
  })

  it('is linked from primary security and Track 2 docs', () => {
    expect(readText('README.md')).toContain('docs/track-2-final-session-security-audit.md')
    expect(readText('docs/README.md')).toContain('track-2-final-session-security-audit.md')
    expect(readText('SECURITY.md')).toContain('docs/track-2-final-session-security-audit.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-final-session-security-audit.md')
    expect(readText('docs/track-2-validation-matrix.md')).toContain('track-2-final-session-security-audit.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-final-session-security-audit.md')
    expect(readText('docs/track-2-security-review.md')).toContain('track-2-final-session-security-audit.md')
    expect(readText('docs/track-2-public-exposure-checks.md')).toContain('track-2-final-session-security-audit.md')
  })
})
