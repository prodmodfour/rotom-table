import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readRepoText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('private VPS live-play smoke docs', () => {
  it('documents the required multi-browser live-play command and reconnect smoke checks', () => {
    const smoke = readRepoText('docs/private-vps-live-play-smoke.md')

    expect(smoke).toContain('two different persistent player profiles')
    expect(smoke).toContain('Move Player A\'s token and Player B\'s token at nearly the same time')
    expect(smoke).toContain('Try a same-token conflict')
    expect(smoke).toContain('While one player moves a token, have the GM advance initiative')
    expect(smoke).toContain('Reconnect the disconnected browser')
    expect(smoke).toContain('Refresh both player browsers and the GM browser')
    expect(smoke).toContain('Restart the Node service')
    expect(smoke).toContain('/api/health` only proves that the built Nitro process can answer a simple no-secret request')
    expect(smoke).toContain('missed SSE events must not be treated as harmless')
  })

  it('keeps private VPS proxy docs covering SSE, command routes, health limits, and outer access gates', () => {
    const hosting = readRepoText('docs/private-vps-hosting.md')
    const deploymentSmoke = readRepoText('docs/private-vps-deployment-smoke-checklist.md')
    const readiness = readRepoText('docs/private-vps-readiness-summary.md')
    const docsIndex = readRepoText('docs/README.md')

    expect(hosting).toContain('`/api/health` is only a process health check')
    expect(hosting).toContain('GET /api/events` SSE stream')
    expect(hosting).toContain('mutating `/api/maps/*` command routes')
    expect(hosting).toContain('disable response buffering for `/api/events`')
    expect(hosting).toContain('Cloudflare Access')
    expect(hosting).toContain('all `/api/*` routes')
    expect(hosting).toContain('WebSocket upgrade paths')

    expect(deploymentSmoke).toContain('Private VPS live-play smoke checklist')
    expect(deploymentSmoke).toContain('/api/events` SSE streaming')
    expect(deploymentSmoke).toContain('mutating `/api/maps/*` command routes')

    expect(readiness).toContain('private VPS live-play smoke checklist')
    expect(docsIndex).toContain('[Private VPS live-play smoke checklist](private-vps-live-play-smoke.md)')
  })

  it('documents SSE heartbeat and revision reconciliation in live-play authority docs', () => {
    const livePlayAuthority = readRepoText('docs/live-play-authority.md')

    expect(livePlayAuthority).toContain('GET /api/events')
    expect(livePlayAuthority).toContain('heartbeat comments')
    expect(livePlayAuthority).toContain('SSE connect/disconnect events')
    expect(livePlayAuthority).toContain('possible missed-event gap')
    expect(livePlayAuthority).toContain('/api/maps/load?slug=<slug>')
  })
})
