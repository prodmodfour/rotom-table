import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Track 2 named tunnel documentation review', () => {
  const review = readText('docs/track-2-named-tunnel-documentation-review.md')
  const runbook = readText('docs/track-2-cloudflare-tunnel-hosting.md')

  it('records the ticket 092 review outcome and scope', () => {
    expect(review).toContain('Ticket 092')
    expect(review).toContain('Outcome: pass for documentation accuracy as of 2026-05-26')
    expect(review).toContain('documentation/audit record, not a live remote smoke result')
    expect(review).toContain('No real Cloudflare account, hostname, tunnel token, join code, GM key, snapshot, event log')
    expect(review).toContain('The review did not run a live public tunnel')
    expect(review).toContain('requires a real Cloudflare account, DNS zone, and stable hostname')
  })

  it('captures current Cloudflare named-tunnel command and config assumptions', () => {
    expect(review).toContain('cloudflared tunnel login')
    expect(review).toContain('cloudflared tunnel create')
    expect(review).toContain('cloudflared tunnel route dns')
    expect(review).toContain('cloudflared tunnel run')
    expect(review).toContain('~/.cloudflared/config.yml')
    expect(review).toContain('tunnel')
    expect(review).toContain('credentials-file')
    expect(review).toContain('service: http://localhost:3000')
    expect(review).toContain('service: http_status:404')
    expect(review).toContain('dashboard-managed tunnels only when they preserve the same stable hostname')
  })

  it('locks WebSocket, cache, optional edge protection, and credential safety warnings', () => {
    expect(review).toContain('wss://<stable-hostname>/api/sessions/socket')
    expect(review).toContain('wss://table.example.com/api/sessions/socket')
    expect(review).toContain('Cloudflare Tunnel supports WebSockets')
    expect(review).toContain('no caching for session paths and WebSocket traffic')
    expect(review).toContain('not to cache `/sessions`, `/maps/*`, `/api/sessions/*`, WebSocket responses, patches, snapshots, or lobby state')
    expect(review).toContain('Cloudflare Access, WAF rules, and IP restrictions')
    expect(review).toContain('optional outer protection')
    expect(review).toContain('`cert.pem` and tunnel credentials JSON files are credentials')
    expect(review).toContain('Tunnel credentials, `cert.pem`, tokens, private keys, real `.env` files')
  })

  it('keeps the locked Track 2 architecture boundaries explicit', () => {
    expect(review).toContain('LAN remains the primary supported hosting path; a named Cloudflare Tunnel with a stable hostname remains the supported remote path')
    expect(review).toContain('ROTOM_ENABLE_SESSION_HOST=1')
    expect(review).toContain('server-authoritative WebSocket commands')
    expect(review).toContain('Quick Tunnel and temporary `trycloudflare.com` URLs remain development-smoke-test only')
    expect(review).toContain('does not make Rotom Table a SaaS app, Cloudflare-hosted app, public multi-tenant service, or cloud database deployment')
    expect(review).toContain('browser-owned whole-map live autosave')
    expect(review).not.toContain('Quick Tunnel is the supported campaign-session path')
  })

  it('provides a pass/fail cross-check and operator checklist for named-tunnel docs', () => {
    expect(review).toContain('## Runbook cross-check')
    expect(review).toContain('| Stable remote hostname |')
    expect(review).toContain('| Local host binding |')
    expect(review).toContain('| WebSocket route |')
    expect(review).toContain('| Rollback/shutdown |')
    expect(review).toContain('| Architecture lock |')
    expect(review).toContain('## Operator checklist before a named-tunnel game')
    expect(review).toContain('cloudflared --version')
    expect(review).toContain('npm run dev:session:tunnel -- --print-only')
    expect(review).toContain('git status --short')
  })

  it('records the official documentation sources used for the review', () => {
    expect(review).toContain('tunnel-useful-commands')
    expect(review).toContain('configuration-file')
    expect(review).toContain('developers.cloudflare.com/tunnel/routing')
    expect(review).toContain('cloudflare-one/faq/cloudflare-tunnels-faq')
    expect(review).toContain('cache/how-to/cache-rules/settings')
    expect(review).toContain('tunnel-permissions')
    expect(review).toContain('Track 2 ADRs, roadmap, runtime, WebSocket, security, dependency, backup, and deployment smoke docs')
  })

  it('updates the named tunnel runbook with the review status', () => {
    expect(runbook).toContain('Ticket 092 review status')
    expect(runbook).toContain('reviewed on 2026-05-26 against official Cloudflare docs')
    expect(runbook).toContain('Track 2 named tunnel documentation review](track-2-named-tunnel-documentation-review.md)')
    expect(runbook).toContain('The review did not run a live public tunnel')
    expect(runbook).toContain('Use the [Track 2 deployment smoke checklist](track-2-deployment-smoke-checklist.md)')
  })

  it('is linked from primary Track 2 docs', () => {
    expect(readText('README.md')).toContain('docs/track-2-named-tunnel-documentation-review.md')
    expect(readText('docs/README.md')).toContain('track-2-named-tunnel-documentation-review.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-named-tunnel-documentation-review.md')
    expect(readText('docs/track-2-validation-matrix.md')).toContain('track-2-named-tunnel-documentation-review.md')
    expect(readText('docs/track-2-websocket-protocol.md')).toContain('track-2-named-tunnel-documentation-review.md')
    expect(runbook).toContain('track-2-named-tunnel-documentation-review.md')
  })
})
