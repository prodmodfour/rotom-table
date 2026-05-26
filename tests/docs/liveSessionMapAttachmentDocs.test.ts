import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Live session map attachment documentation', () => {
  const guide = readText('docs/live-session-map-attachment.md')

  it('documents the GM flow from session start to session map play', () => {
    expect(guide).toContain('Press **Start GM session**')
    expect(guide).toContain('**Attach current map to live session**')
    expect(guide).toContain('Share the player-facing URL and join code')
    expect(guide).toContain('**Visible session maps**')
    expect(guide).toContain('assigns controllable token and/or sheet resources')
    expect(guide).toContain('`/maps/<map-slug>?session=1`')
  })

  it('documents the attach-map endpoint and no-secret response boundary', () => {
    expect(guide).toContain('`ROTOM_ENABLE_SESSION_HOST=1`')
    expect(guide).toContain('POST /api/sessions/maps/attach')
    expect(guide).toContain('does not accept a browser-provided map document as authority')
    expect(guide).toContain('selectedMapBehavior')
    expect(guide).toContain('visibilityBehavior')
    expect(guide).toContain('A successful response returns no secrets and no map document')
  })

  it('keeps server-owned session map authority clear for operators', () => {
    expect(guide).toContain('server-owned session map copy')
    expect(guide).toContain('local seed is only a visual starting point')
    expect(guide).toContain('Accepted commands mutate the server-owned attached map')
    expect(guide).toContain('Reconnect asks the host for an authoritative snapshot')
    expect(guide).toContain('save them first and attach the map again')
  })

  it('is linked from primary live-session docs and runbooks', () => {
    expect(readText('README.md')).toContain('docs/live-session-map-attachment.md')
    expect(readText('docs/README.md')).toContain('live-session-map-attachment.md')
    expect(readText('docs/live-session-roadmap.md')).toContain('live-session-map-attachment.md')
    expect(readText('docs/live-session-protocol.md')).toContain('live-session-map-attachment.md')
    expect(readText('docs/live-session-client-integration.md')).toContain('live-session-map-attachment.md')
    expect(readText('docs/live-session-lobby.md')).toContain('live-session-map-attachment.md')
    expect(readText('docs/live-session-host-runtime.md')).toContain('live-session-map-attachment.md')
    expect(readText('docs/live-session-lan-hosting.md')).toContain('live-session-map-attachment.md')
    expect(readText('docs/live-session-cloudflare-tunnel-hosting.md')).toContain('live-session-map-attachment.md')
    expect(readText('docs/live-session-deployment-smoke-checklist.md')).toContain('live-session-map-attachment.md')
  })
})
