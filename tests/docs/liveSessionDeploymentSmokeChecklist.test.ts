import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Live session deployment smoke checklist', () => {
  const checklist = readText('docs/live-session-deployment-smoke-checklist.md')

  it('documents both supported deployment lanes and their guarded startup commands', () => {
    expect(checklist).toContain('LAN deployment lane')
    expect(checklist).toContain('Named Cloudflare Tunnel deployment lane')
    expect(checklist).toContain('npm run dev:session:lan')
    expect(checklist).toContain('ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000')
    expect(checklist).toContain('http://<GM-LAN-IP>:3000')
    expect(checklist).toContain('npm run dev:session:tunnel')
    expect(checklist).toContain('ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000')
    expect(checklist).toContain('cloudflared tunnel run rotom-table')
    expect(checklist).toContain('https://table.example.com')
    expect(checklist).toContain('wss://table.example.com/api/sessions/socket')
  })

  it('covers the required two-player deployment scenario', () => {
    expect(checklist).toContain('Two players')
    expect(checklist).toContain('Player A')
    expect(checklist).toContain('Player B')
    expect(checklist).toContain('GM, Player A, and Player B')
    expect(checklist).toContain('<base-url>/maps/<map-slug>?session=1')
    expect(checklist).toContain('three connected browser identities: GM, Player A, and Player B')
  })

  it('covers reconnect, token movement, initiative, and conflict rejection checks', () => {
    expect(checklist).toContain('Token move propagation')
    expect(checklist).toContain('tokenMoved')
    expect(checklist).toContain('Initiative propagation')
    expect(checklist).toContain('setInitiative')
    expect(checklist).toContain('nextInitiative')
    expect(checklist).toContain('initiativeUpdated')
    expect(checklist).toContain('Reconnect and snapshot recovery')
    expect(checklist).toContain('last-known revision')
    expect(checklist).toContain('snapshot fallback')
    expect(checklist).toContain('Conflict rejection')
    expect(checklist).toContain('commandReject')
    expect(checklist).toContain('stale` or `conflict')
    expect(checklist).toContain('does not increment the authoritative revision')
  })

  it('keeps safety and data-hygiene boundaries visible', () => {
    expect(checklist).toContain('Quick Tunnel is not being used for a campaign-session smoke')
    expect(checklist).toContain('not public authentication')
    expect(checklist).toContain('Do not use this checklist to introduce public accounts, SaaS hosting, a cloud database')
    expect(checklist).toContain('WebSocket commands, acknowledgements/rejections, presence, heartbeat, reconnect, and patch fanout are the live session channel')
    expect(checklist).toContain('Do not add Postgres, Redis, Durable Objects, a hosted database, public multi-tenancy, or SaaS deployment')
    expect(checklist).toContain('no generated `data/sessions/` files')
    expect(checklist).toContain('real `.env` files')
  })

  it('provides evidence and pass/fail/block guidance without requiring secrets', () => {
    expect(checklist).toContain('Evidence template')
    expect(checklist).toContain('| Token move |')
    expect(checklist).toContain('| Initiative |')
    expect(checklist).toContain('| Reconnect |')
    expect(checklist).toContain('| Conflict rejection |')
    expect(checklist).toContain('Pass, fail, or block guidance')
    expect(checklist).toContain('Do not paste real join codes, GM keys, snapshots, event logs')
  })

  it('is linked from primary live session hosting and operations docs', () => {
    expect(readText('README.md')).toContain('docs/live-session-deployment-smoke-checklist.md')
    expect(readText('docs/README.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/local-development.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-roadmap.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-validation-matrix.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-lan-hosting.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-cloudflare-tunnel-hosting.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-host-runtime.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-lobby.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-protocol.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-socket-protocol.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-multi-tab-smoke.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-public-exposure-checks.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-quick-tunnel-caveat.md')).toContain('live-session-deployment-smoke-checklist.md')
    expect(readText('docs/live-session-security-review.md')).toContain('live-session-deployment-smoke-checklist.md')
  })
})
