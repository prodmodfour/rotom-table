import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Live session named Cloudflare Tunnel runbook', () => {
  const runbook = readText('docs/live-session-cloudflare-tunnel-hosting.md')

  it('documents named tunnel setup with a stable hostname', () => {
    expect(runbook).toContain('cloudflared tunnel login')
    expect(runbook).toContain('cloudflared tunnel create rotom-table')
    expect(runbook).toContain('cloudflared tunnel route dns rotom-table table.example.com')
    expect(runbook).toContain('cloudflared tunnel run rotom-table')
    expect(runbook).toContain('https://table.example.com')
    expect(runbook).toContain('~/.cloudflared/config.yml')
    expect(runbook).toContain('service: http://localhost:3000')
    expect(runbook).toContain('http_status:404')
  })

  it('documents the explicit Rotom Table runtime gate and safe tunnel binding', () => {
    expect(runbook).toContain('npm run dev:session:tunnel')
    expect(runbook).toContain('npm run dev:session:tunnel -- --print-only')
    expect(runbook).toContain('ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000')
    expect(runbook).toContain('$env:ROTOM_ENABLE_SESSION_HOST = "1"')
    expect(runbook).toContain('prefer binding Rotom Table to loopback')
    expect(runbook).toContain('Do not bind to `0.0.0.0` casually')
    expect(runbook).toContain('session hosting enabled and a deliberate remote/tunnel exposure')
  })

  it('documents WebSocket, heartbeat, reconnect, and cache expectations', () => {
    expect(runbook).toContain('wss://table.example.com/api/sessions/socket')
    expect(runbook).toContain('Preserve the `/api/sessions/socket` path')
    expect(runbook).toContain('Do not add a Cloudflare rule that caches `/sessions`, `/maps/*`, `/api/sessions/*`, or WebSocket responses')
    expect(runbook).toContain('25 second interval and 60 second timeout')
    expect(runbook).toContain('lastSeenRevision')
    expect(runbook).toContain('snapshot fallback')
  })

  it('keeps public exposure safety boundaries visible', () => {
    expect(runbook).toContain('Quick Tunnel is not the supported campaign-session path')
    expect(runbook).toContain('not public auth')
    expect(runbook).toContain('Cloudflare Access is optional extra protection, not a replacement')
    expect(runbook).toContain('Do not add a database, cloud persistence layer, SaaS deployment target')
    expect(runbook).toContain('Tunnel credentials, `cert.pem`, tokens, private keys, real `.env` files, GM keys, join codes, snapshots, and event logs will stay out of the repository')
  })

  it('documents rollback and cleanup steps', () => {
    expect(runbook).toContain('Stop `cloudflared tunnel run rotom-table` with `Ctrl+C`')
    expect(runbook).toContain('unset ROTOM_ENABLE_SESSION_HOST')
    expect(runbook).toContain('Remove-Item Env:ROTOM_ENABLE_SESSION_HOST')
    expect(runbook).toContain('Remove or disable the public hostname/CNAME in the Cloudflare dashboard')
    expect(runbook).toContain('cloudflared tunnel delete rotom-table')
    expect(runbook).toContain('Check `git status --short`')
  })

  it('is linked from primary Live session docs', () => {
    expect(readText('README.md')).toContain('docs/live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/README.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/local-development.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/live-session-roadmap.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/live-session-protocol.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/live-session-websocket-protocol.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/live-session-lan-hosting.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/live-session-host-runtime.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/live-session-lobby.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/live-session-client-integration.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
    expect(readText('docs/live-session-multi-tab-smoke.md')).toContain('live-session-cloudflare-tunnel-hosting.md')
  })
})
