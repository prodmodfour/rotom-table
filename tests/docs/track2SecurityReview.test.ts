import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Track 2 security review documentation', () => {
  const review = readText('docs/track-2-security-review.md')

  it('records the locked Track 2 security outcome without changing the architecture', () => {
    expect(review).toContain('trusted-table, GM-hosted feature')
    expect(review).toContain('ROTOM_ENABLE_SESSION_HOST=1')
    expect(review).toContain('WebSocket /api/sessions/socket')
    expect(review).toContain('server-authoritative command handlers')
    expect(review).toContain('not a hardened public service for anonymous internet users')
    expect(review).toContain('If any of those assumptions are false, do not treat Track 2 as secure enough for public exposure')
    expect(review).not.toContain('Quick Tunnel is the supported')
  })

  it('documents trust boundaries and no-secret data handling', () => {
    expect(review).toContain('| GM host process and filesystem |')
    expect(review).toContain('| Existing `/login` role picker |')
    expect(review).toContain('| Session-local credentials |')
    expect(review).toContain('| WebSocket command channel |')
    expect(review).toContain('| LAN or named tunnel network path |')
    expect(review).toContain('| Legacy local realtime/SSE |')
    expect(review).toContain('GM key')
    expect(review).toContain('Cloudflare `cert.pem`, tunnel credentials JSON, tokens, private keys')
    expect(review).toContain('Keep local/private and out of git')
    expect(review).not.toContain('gmKey=')
    expect(review).not.toContain('joinCode=')
  })

  it('documents join-code and session-local identity limits', () => {
    expect(review).toContain('join codes are session-local capabilities')
    expect(review).toContain('not account passwords')
    expect(review).toContain('8-character codes')
    expect(review).toContain('validators accept 6-12 characters')
    expect(review).toContain('does not grant GM authority')
    expect(review).toContain('duplicate display names are allowed')
    expect(review).toContain('does not currently provide production-grade public brute-force defenses')
    expect(review).toContain('start a fresh GM session')
  })

  it('documents named tunnel exposure risks and Quick Tunnel limits', () => {
    expect(review).toContain('A named Cloudflare Tunnel is the supported remote path')
    expect(review).toContain('public hostname reaches the normal Rotom Table origin')
    expect(review).toContain('Cache rules must not cache `/sessions`, `/maps/*`, `/api/sessions/*`, WebSocket traffic')
    expect(review).toContain('Cloudflare Access, WAF rules, and IP restrictions are optional outer protections')
    expect(review).toContain('Access challenges, proxy disconnects, sleeping laptops, and network changes can close WebSockets')
    expect(review).toContain('Quick Tunnel uses temporary `trycloudflare.com` hostnames and is development smoke-test only')
  })

  it('documents non-hardened areas and out-of-scope public-service hardening', () => {
    expect(review).toContain('full public authentication, passwords, OAuth, SSO, MFA')
    expect(review).toContain('anonymous public signup, public multi-tenancy')
    expect(review).toContain('rate limiting, CAPTCHA, bot detection')
    expect(review).toContain('encrypted-at-rest snapshots/backups')
    expect(review).toContain('Postgres, Redis, Durable Objects, cloud object storage')
    expect(review).toContain('hardening every legacy local-first mutating route')
    expect(review).toContain('separate architecture effort with real auth')
  })

  it('documents incident response and reviewer checklist coverage', () => {
    expect(review).toContain('Stop `cloudflared tunnel run ...` first')
    expect(review).toContain('restart it without `ROTOM_ENABLE_SESSION_HOST=1`')
    expect(review).toContain('start a fresh GM session before play continues')
    expect(review).toContain('Use **Forget in this browser**')
    expect(review).toContain('Private session/campaign/tunnel data stays out of docs, tests, git, issue trackers, and screenshots')
    expect(review).toContain('Out-of-scope hardening work is called out honestly')
  })

  it('is linked from primary docs, hosting runbooks, and security guidance', () => {
    expect(readText('README.md')).toContain('docs/track-2-security-review.md')
    expect(readText('docs/README.md')).toContain('track-2-security-review.md')
    expect(readText('SECURITY.md')).toContain('docs/track-2-security-review.md')
    expect(readText('docs/local-development.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-validation-matrix.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-websocket-protocol.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-session-host-runtime.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-public-exposure-checks.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-lan-hosting.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-cloudflare-tunnel-hosting.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-quick-tunnel-caveat.md')).toContain('track-2-security-review.md')
    expect(readText('docs/track-2-session-backup-recovery.md')).toContain('track-2-security-review.md')
  })
})
