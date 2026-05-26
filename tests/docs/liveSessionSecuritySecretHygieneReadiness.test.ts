import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')
const exists = (relativePath: string): boolean => existsSync(resolve(repoRoot, relativePath))
const trackedFiles = (): string[] => execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .map((file) => file.trim())
  .filter(Boolean)

const isSensitiveTrackedPath = (relativePath: string): boolean => {
  const lower = relativePath.toLowerCase()

  if (lower === '.env' || (lower.startsWith('.env.') && lower !== '.env.example')) return true
  if (lower.includes('/.env') && !lower.endsWith('/.env.example')) return true
  if (lower.startsWith('data/sessions/')) return true
  if (lower.startsWith('data/maps/')) return true
  if (lower.startsWith('data/trainers/')) return true
  if (lower.startsWith('data/sheets/') && !lower.startsWith('data/sheets/examples/')) return true
  if (/(^|\/)snapshot\.json$/.test(lower)) return true
  if (/(^|\/)events\.jsonl$/.test(lower)) return true
  if (/(^|\/)cert\.pem$/.test(lower)) return true
  if (/(^|\/)(cloudflared|\.cloudflared)(\/|$)/.test(lower)) return true
  if (/(^|\/).*credential.*\.json$/.test(lower)) return true
  if (/(^|\/).*tunnel.*\.json$/.test(lower)) return true
  if (/(^|\/).*private.*\.(key|pem)$/.test(lower)) return true

  return false
}

describe('Live session security and secret-hygiene readiness', () => {
  const readiness = readText('docs/live-session-security-secret-hygiene-readiness.md')

  it('records the security readiness outcome and scope', () => {
    expect(readiness).toContain('This readiness review')
    expect(readiness).toContain('Review date: 2026-05-26')
    expect(readiness).toContain('Outcome: pass for the locked Live session trusted-table posture')
    expect(readiness).toContain('auth/session/cookie/permission boundaries')
    expect(readiness).toContain('public exposure warnings')
    expect(readiness).toContain('secret-hygiene checks')
    expect(readiness).toContain('remaining non-goals')
    expect(readiness).toContain('did not create a live public tunnel')
    expect(readiness).toContain('did not harden legacy local-first routes for arbitrary public internet users')
    expect(readiness).not.toContain('Audit date:')
  })

  it('covers runtime-gated session HTTP authority boundaries', () => {
    expect(readiness).toContain('ROTOM_ENABLE_SESSION_HOST=1')
    expect(readiness).toContain('`POST /api/sessions/start`')
    expect(readiness).toContain('`POST /api/sessions/join`')
    expect(readiness).toContain('`POST /api/sessions/manage`')
    expect(readiness).toContain('`POST /api/sessions/player-state`')
    expect(readiness).toContain('`POST /api/sessions/assignments`')
    expect(readiness).toContain('`requireGm(event)`')
    expect(readiness).toContain('session-local `gmKey`')
    expect(readiness).toContain('Duplicate display names remain labels, not authentication')

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
    expect(readiness).toContain('`rotom:session:identity` local storage')
    expect(readiness).toContain('`rotom-session-identity` cookie')
    expect(readiness).toContain('omits `gmKey`')
    expect(readiness).toContain('all cookie hints reject `gmKey` or `joinCode` fields with the `secret-in-cookie` validation issue')
    expect(readiness).toContain('not a hardened account/session cookie')
    expect(readiness).toContain('**Forget in this browser**')
    expect(readiness).toContain('do not trust the cookie hint as proof of control')

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
    expect(readiness).toContain('`WebSocket /api/sessions/socket`')
    expect(readiness).toContain('pending-hello')
    expect(readiness).toContain('authenticated socket actor must match the command actor')
    expect(readiness).toContain('Player commands recheck current GM-managed assignments and visibility')
    expect(readiness).toContain('GM-only commands such as token spawn/delete, initiative lane changes, hazards, field effects, and terrain edits')
    expect(readiness).toContain('safe `commandReject` frames')
    expect(readiness).toContain('small same-session patches')
    expect(readiness).toContain('filters snapshots to that player')
    expect(readiness).toContain('excludes GM keys, join codes, hidden maps, and other players')

    const socketServer = readText('server/utils/sessionWebSocketServer.ts')
    expect(socketServer).toContain('const actorsMatch')
    expect(socketServer).toContain('Session socket command actor does not match the authenticated socket')
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
      expect(readiness).toContain(coveragePath)
      expect(exists(coveragePath)).toBe(true)
    }
  })

  it('covers public exposure warnings, hosting paths, and no-secret safety status', () => {
    expect(readiness).toContain('`GET /api/sessions/safety`')
    expect(readiness).toContain('no-secret counts/readiness and exposure classification')
    expect(readiness).toContain('anyone who can reach the Rotom Table origin can load the local app')
    expect(readiness).toContain('LAN remains primary')
    expect(readiness).toContain('named Cloudflare Tunnel remains the supported remote path')
    expect(readiness).toContain('Cloudflare Access/WAF/IP rules as optional outer protection only')
    expect(readiness).toContain('Quick Tunnel remains documented only as a temporary development smoke-test option')

    const safety = readText('server/api/sessions/safety.get.ts')
    expect(safety).toContain('Returns a no-secret live session hosting safety summary')
    expect(safety).toContain('endpoint is intentionally readable')
    expect(safety).toContain('while hosting is disabled')
    expect(safety).toContain('sessionSettings: hostEnabled ? summarizeSessionSettings() : undefined')

    const sharedSafety = readText('shared/sessionSafety.ts')
    expect(sharedSafety).toContain('host-enabled-without-active-session')
    expect(sharedSafety).toContain('remote-exposure-before-session-start')
    expect(sharedSafety).toContain('The existing GM/player role picker is still not public authentication')
  })

  it('confirms committed paths exclude live-session secrets and private runtime data', () => {
    expect(readiness).toContain('## Repository secret-hygiene confirmation')
    expect(readiness).toContain('no real GM keys or join codes are documented')
    expect(readiness).toContain('no `data/sessions/` runtime directories, `snapshot.json` session snapshots, or `events.jsonl` event logs are tracked')
    expect(readiness).toContain('no private `data/maps/`, `data/trainers/`, or personal `data/sheets/` campaign files are tracked')
    expect(readiness).toContain('no Cloudflare `cert.pem`, tunnel credentials JSON, API tokens, private keys, real `.env` or `.env.*` files')
    expect(readiness).toContain("The second command should print nothing for this repository")

    const sensitivePaths = trackedFiles().filter(isSensitiveTrackedPath)
    expect(sensitivePaths).toEqual([])
  })

  it('keeps remaining non-goals and data-hygiene limitations explicit', () => {
    expect(readiness).toContain('no full public account system, passwords, OAuth, SSO, MFA')
    expect(readiness).toContain('no public multi-tenant hosting')
    expect(readiness).toContain('no production-grade internet abuse controls such as IP rate limiting, CAPTCHA, bot detection')
    expect(readiness).toContain('no encrypted-at-rest session snapshots/backups')
    expect(readiness).toContain('no hosted database, Redis, Postgres, Durable Objects')
    expect(readiness).toContain('no hardening claim for every legacy local-first mutating route')
    expect(readiness).toContain('no browser-owned recovery authority')
    expect(readiness).toContain('no Quick Tunnel campaign hosting and no legacy SSE session command transport')
    expect(readiness).toContain('No real GM keys, join codes, session snapshots, optional event logs, tunnel credentials, private maps, private campaign files, real `.env` files, or generated/private sheet data are present in tracked files')
    expect(readiness).not.toContain('Quick Tunnel remains the supported campaign-session path')
    expect(readiness).not.toContain('gmKey=')
    expect(readiness).not.toContain('joinCode=')
  })

  it('is linked from primary security and Live session docs', () => {
    expect(readText('README.md')).toContain('docs/live-session-security-secret-hygiene-readiness.md')
    expect(readText('docs/README.md')).toContain('live-session-security-secret-hygiene-readiness.md')
    expect(readText('SECURITY.md')).toContain('docs/live-session-security-secret-hygiene-readiness.md')
    expect(readText('docs/live-session-roadmap.md')).toContain('live-session-security-secret-hygiene-readiness.md')
    expect(readText('docs/live-session-validation-matrix.md')).toContain('live-session-security-secret-hygiene-readiness.md')
    expect(readText('docs/live-session-protocol.md')).toContain('live-session-security-secret-hygiene-readiness.md')
    expect(readText('docs/live-session-command-audit.md')).toContain('live-session-security-secret-hygiene-readiness.md')
    expect(readText('docs/live-session-security-review.md')).toContain('live-session-security-secret-hygiene-readiness.md')
    expect(readText('docs/live-session-public-exposure-checks.md')).toContain('live-session-security-secret-hygiene-readiness.md')
  })
})
