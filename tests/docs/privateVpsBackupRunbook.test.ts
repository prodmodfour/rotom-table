import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readRepoText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('private VPS backup and restore runbook docs', () => {
  it('documents SQLite-aware backup, verification, restore, and bad-deploy rollback steps', () => {
    const backups = readRepoText('docs/private-vps-backups.md')

    expect(backups).toContain('SQLite-backed live-play database')
    expect(backups).toContain('residual JSON campaign files')
    expect(backups).toContain('safe SQLite backup method')
    expect(backups).toContain('sudo systemctl stop rotom-table.service')
    expect(backups).toContain("sqlite3 \"$DB_PATH\" \".backup '$SQLITE_SNAPSHOT'\"")
    expect(backups).toContain('rotom-table.sqlite-wal')
    expect(backups).toContain('SESSION_TAG=pre-session')
    expect(backups).toContain('SESSION_TAG=post-session')
    expect(backups).toContain('gzip -t "$ARCHIVE"')
    expect(backups).toContain('PRAGMA integrity_check')
    expect(backups).toContain('temporary restore smoke')
    expect(backups).toContain('Rollback after a bad deploy')
    expect(backups).toContain('git checkout <known-good-commit-or-tag>')
    expect(backups).toContain('Do not create backup archives under `/srv/rotom-table/app`')
  })

  it('ties live-play smoke to pre-session backups, post-smoke backups, and rollback', () => {
    const smoke = readRepoText('docs/private-vps-live-play-smoke.md')

    expect(smoke).toContain('SESSION_TAG=pre-session')
    expect(smoke).toContain('Backup and rollback checkpoint')
    expect(smoke).toContain('rotom-table.sqlite')
    expect(smoke).toContain('residual JSON campaign files')
    expect(smoke).toContain('rollback-after-a-bad-deploy')
    expect(smoke).toContain('SESSION_TAG=post-session')
    expect(smoke).toContain('post-smoke')
  })
})
