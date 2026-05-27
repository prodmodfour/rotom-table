import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Live session LAN hosting runbook', () => {
  const runbook = readText('docs/live-session-lan-hosting.md')

  it('documents the explicit LAN host startup command and runtime gate', () => {
    expect(runbook).toContain('npm run dev:session:lan')
    expect(runbook).toContain('npm run dev:session:lan -- --print-only')
    expect(runbook).toContain('npm run dev:session:lan -- --port 3001')
    expect(runbook).toContain('ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 0.0.0.0 --port 3000')
    expect(runbook).toContain('npm run dev -- --host 0.0.0.0 --port 3000')
    expect(runbook).toContain('$env:ROTOM_ENABLE_SESSION_HOST = "1"')
    expect(runbook).toContain('Session hosting is disabled unless the exact runtime flag is set')
    expect(runbook).toContain('only starts the local Nuxt process with the explicit runtime gate and LAN binding')
  })

  it('documents IP discovery and safe private LAN addresses', () => {
    expect(runbook).toContain('ipconfig getifaddr en0')
    expect(runbook).toContain('hostname -I')
    expect(runbook).toContain('ip -4 addr show scope global')
    expect(runbook).toContain('ipconfig')
    expect(runbook).toContain('192.168.x.x')
    expect(runbook).toContain('10.x.x.x')
    expect(runbook).toContain('172.16.x.x')
    expect(runbook).toContain('Do not give players `localhost`, `127.0.0.1`, `0.0.0.0`, a `169.254.x.x` link-local address, or a public IP address')
  })

  it('documents player browser paths and WebSocket session mode boundaries', () => {
    expect(runbook).toContain('http://<GM-LAN-IP>:3000/sessions#player-lobby-title')
    expect(runbook).toContain('http://<GM-LAN-IP>:3000/maps/<map-slug>?session=1')
    expect(runbook).toContain('ws://192.168.1.42:3000/api/sessions/socket')
    expect(runbook).toContain('The plain `/maps/<slug>` route remains local-first')
    expect(runbook).toContain('use `/maps/<slug>?session=1` when the live table should use server-authoritative session commands')
  })

  it('requires real player device rehearsal and recovery checks before play', () => {
    expect(runbook).toContain('Real-device rehearsal before play')
    expect(runbook).toContain('actual phones, tablets, or laptops players expect to use at the table')
    expect(runbook).toContain('do not rely only on tabs on the GM machine')
    expect(runbook).toContain('fix that device/network issue before play')
    expect(runbook).toContain('No session map recovery')
    expect(runbook).toContain('No-token-assigned recovery')
    expect(runbook).toContain('uses the normal `/maps/<map-slug>` route with profile-linked characters')
    expect(runbook).toContain('GM uses **Assign map tokens** and **Assign control**')
  })

  it('documents LAN latency and concurrency expectations', () => {
    expect(runbook).toContain('LAN latency and concurrency expectations')
    expect(runbook).toContain('lowest-jitter live-session path for a small trusted table')
    expect(runbook).toContain('does not promise a millisecond latency target')
    expect(runbook).toContain("server's accepted revision order")
    expect(runbook).toContain('Event replay is currently unavailable for reconnect')
    expect(runbook).toContain('actor-scoped snapshot fallback')
    expect(runbook).toContain('live-session-concurrency-benchmark-notes.md')
    expect(runbook).toContain('`1-3s` or `>3s` timing buckets')
  })

  it('keeps safety, troubleshooting, and cleanup boundaries visible', () => {
    expect(runbook).toContain('not hardened public authentication')
    expect(runbook).toContain('Quick Tunnel is not the supported campaign-session path')
    expect(runbook).toContain('Do not add a database, cloud persistence layer, SaaS deployment target, or shared-document autosave model')
    expect(runbook).toContain('Player browser cannot load the page')
    expect(runbook).toContain('WebSocket stays disconnected/reconnecting')
    expect(runbook).toContain('No generated `data/sessions/` files, join codes, GM keys, or private campaign data are staged for commit')
  })

  it('is linked from primary Live session docs', () => {
    expect(readText('README.md')).toContain('docs/live-session-lan-hosting.md')
    expect(readText('docs/README.md')).toContain('live-session-lan-hosting.md')
    expect(readText('docs/local-development.md')).toContain('live-session-lan-hosting.md')
    expect(readText('docs/live-session-roadmap.md')).toContain('live-session-lan-hosting.md')
    expect(readText('docs/live-session-host-runtime.md')).toContain('live-session-lan-hosting.md')
    expect(readText('docs/live-session-lobby.md')).toContain('live-session-lan-hosting.md')
    expect(readText('docs/live-session-socket-protocol.md')).toContain('live-session-lan-hosting.md')
    expect(readText('docs/live-session-protocol.md')).toContain('live-session-lan-hosting.md')
  })
})
