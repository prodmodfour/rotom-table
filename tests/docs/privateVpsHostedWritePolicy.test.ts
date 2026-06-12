import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readRepoText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('private VPS hosted-write policy docs', () => {
  it('documents database-backed live-play writes, campaign storage, backups, and explicit migrations', () => {
    const hosting = readRepoText('docs/private-vps-hosting.md')
    const audit = readRepoText('docs/api-route-mutation-audit.md')
    const envExample = readRepoText('.env.vps.example')
    const systemdUnit = readRepoText('deploy/systemd/rotom-table.service')

    expect(hosting).toContain('SQLite-backed live-play command routes')
    expect(hosting).toContain('before writing JSON or SQLite state')
    expect(hosting).toContain('database-backed live-play command persistence')
    expect(hosting).toContain('Migrations/imports still require explicit operator action such as `npm run migrate:sqlite`')
    expect(hosting).toContain('database plus WAL sidecars in backup/restore practice')

    expect(audit).toContain('filesystem-backed JSON writes and SQLite-backed live-play command writes')
    expect(audit).toContain('before invoking persistence use cases or player-profile resolution')
    expect(audit).toContain('Database-backed command routes write only to a database path in private operator-controlled campaign storage')
    expect(audit).toContain('Migration/import commands are explicit maintenance actions')

    expect(envExample).toContain('default live-play SQLite database outside the')
    expect(envExample).toContain('included in backups with WAL sidecars')
    expect(envExample).toContain('SQLite-backed live-play command results')

    expect(systemdUnit).toContain('SQLite databases/WAL sidecars')
    expect(systemdUnit).toContain('ROTOM_ENABLE_HOSTED_WRITES=1 opt-in only when the private host is ready')
  })
})
