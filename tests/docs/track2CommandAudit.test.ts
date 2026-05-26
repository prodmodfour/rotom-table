import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('Track 2 integrated command audit docs', () => {
  const audit = readText('docs/track-2-command-audit.md')

  it('records the automated multi-client command audit evidence', () => {
    expect(audit).toContain('tests/server/sessionIntegratedCommandAudit.test.ts')
    expect(audit).toContain('one GM socket, two player sockets in the same session, and a GM socket in a different session')
    expect(audit).toContain('handleSessionSocketMessage')
    expect(audit).toContain('real WebSocket dispatcher and server-authoritative use cases')
  })

  it('covers accepted command flows for movement, turning, HP, conditions, and initiative', () => {
    expect(audit).toContain('`moveToken`')
    expect(audit).toContain('`tokenMoved` patch')
    expect(audit).toContain('`turnToken`')
    expect(audit).toContain('`tokenTurned` patch')
    expect(audit).toContain('`modifyHp`')
    expect(audit).toContain('`hpModified` patch')
    expect(audit).toContain('`modifyConditions`')
    expect(audit).toContain('`conditionsModified` patch')
    expect(audit).toContain('`nextInitiative`')
    expect(audit).toContain('`initiativeUpdated` patch')
    expect(audit).toContain('unrelated session receives nothing')
  })

  it('covers reconnect, permission rejection, stale rejection, and no-whole-map boundaries', () => {
    expect(audit).toContain('`commandReject`/`reason: "unauthorized"`')
    expect(audit).toContain('`commandReject`/`reason: "stale"`')
    expect(audit).toContain('`baseRevision`')
    expect(audit).toContain('current authoritative token position')
    expect(audit).toContain('`snapshotRequired: true`')
    expect(audit).toContain('filtered `snapshot` at revision 5')
    expect(audit).toContain('do not include whole-map `placements`, `voxels`, or `fieldEffects`')
  })

  it('keeps locked architecture and data-hygiene boundaries explicit', () => {
    expect(audit).toContain('`WebSocket /api/sessions/socket`')
    expect(audit).toContain('server-owned session/map revision')
    expect(audit).toContain('no Quick Tunnel campaign path')
    expect(audit).toContain('public account system')
    expect(audit).toContain('SaaS host')
    expect(audit).toContain('cloud database')
    expect(audit).toContain('browser-owned whole-map autosave')
    expect(audit).toContain('without the GM key, join code, or the other player')
  })

  it('links from primary Track 2 protocol and review docs', () => {
    expect(readText('README.md')).toContain('docs/track-2-command-audit.md')
    expect(readText('docs/README.md')).toContain('track-2-command-audit.md')
    expect(readText('docs/track-2-session-protocol.md')).toContain('track-2-command-audit.md')
    expect(readText('docs/track-2-websocket-protocol.md')).toContain('track-2-command-audit.md')
    expect(readText('docs/track-2-validation-matrix.md')).toContain('track-2-command-audit.md')
  })
})
