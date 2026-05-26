import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Track 2 Quick Tunnel caveat', () => {
  const caveat = readText('docs/track-2-quick-tunnel-caveat.md')

  it('keeps Quick Tunnel scoped to temporary development smoke tests', () => {
    expect(caveat).toContain('Quick Tunnel is **not** the supported remote hosting path')
    expect(caveat).toContain('LAN / same Wi-Fi remains the primary supported path')
    expect(caveat).toContain('named Cloudflare Tunnel with a stable hostname remains the supported remote path')
    expect(caveat).toContain('temporary `trycloudflare.com` URL')
    expect(caveat).toContain('Do **not** use Quick Tunnel for:')
    expect(caveat).toContain('a recurring or scheduled campaign session')
    expect(caveat).toContain('a player-facing URL that needs to remain stable between game nights')
  })

  it('documents a guarded smoke command without presenting it as campaign setup', () => {
    expect(caveat).toContain('npm run dev:session:tunnel')
    expect(caveat).toContain('ROTOM_ENABLE_SESSION_HOST=1 npm run dev -- --host 127.0.0.1 --port 3000')
    expect(caveat).toContain('cloudflared tunnel --url http://localhost:3000')
    expect(caveat).toContain('https://temporary-name.trycloudflare.com')
    expect(caveat).toContain('wss://temporary-name.trycloudflare.com/api/sessions/socket')
    expect(caveat).toContain('Use that URL only for the smoke test')
    expect(caveat).toContain('Stop at the first surprising exposure, auth, cache, or socket behaviour')
  })

  it('documents safety and architecture boundaries', () => {
    expect(caveat).toContain('bypassing the explicit `ROTOM_ENABLE_SESSION_HOST=1` runtime gate')
    expect(caveat).toContain('treating the existing `/login` GM/player role picker as public authentication')
    expect(caveat).toContain('adding a database, SaaS service, Durable Objects, Redis, Postgres, or cloud persistence layer')
    expect(caveat).toContain('does not make the app multi-tenant')
    expect(caveat).toContain('does not change the server-authoritative session model')
    expect(caveat).toContain('private maps, generated sheets, `data/sessions/` snapshots/event logs, join codes, GM keys, Quick Tunnel URLs')
  })

  it('documents legacy SSE limitations explicitly', () => {
    expect(caveat).toContain('## Legacy SSE limitations')
    expect(caveat).toContain('`GET /api/events` is the existing SSE stream')
    expect(caveat).toContain('Legacy SSE is one-way server-to-browser transport')
    expect(caveat).toContain('It does not carry client commands, command acknowledgements, command rejections, presence, heartbeat, reconnect handshakes, `opId` idempotency, or session revision conflict handling')
    expect(caveat).toContain('whole saved map or sheet payloads')
    expect(caveat).toContain('last-writer-wins local workflow')
    expect(caveat).toContain('A Quick Tunnel URL does not make SSE a supported public session transport')
    expect(caveat).toContain('Track 2 live sessions use the WebSocket route at `/api/sessions/socket`')
  })

  it('documents cleanup and accidental exposure response', () => {
    expect(caveat).toContain('Stop `cloudflared tunnel --url http://localhost:3000` with `Ctrl+C`')
    expect(caveat).toContain('unset ROTOM_ENABLE_SESSION_HOST')
    expect(caveat).toContain('Remove-Item Env:ROTOM_ENABLE_SESSION_HOST')
    expect(caveat).toContain('Run `git status --short`')
    expect(caveat).toContain('stop the tunnel, restart without the host flag or start a new session to rotate the join code')
  })

  it('is linked from primary Track 2 docs', () => {
    expect(readText('README.md')).toContain('docs/track-2-quick-tunnel-caveat.md')
    expect(readText('docs/README.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/local-development.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-roadmap.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-glossary.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-validation-matrix.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-websocket-protocol.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-lan-hosting.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-cloudflare-tunnel-hosting.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-session-lobby.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-client-integration.md')).toContain('track-2-quick-tunnel-caveat.md')
    expect(readText('docs/track-2-multi-tab-smoke.md')).toContain('track-2-quick-tunnel-caveat.md')
  })
})
