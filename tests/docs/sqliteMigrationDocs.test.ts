import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(testDir, '../..')

const readRepoText = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8')

describe('SQLite migration operator docs', () => {
  it('documents the private VPS JSON-to-SQLite migration command and guardrails', () => {
    const hosting = readRepoText('docs/private-vps-hosting.md')
    const campaignRepositories = readRepoText('docs/campaign-repositories.md')
    const livePlayAuthority = readRepoText('docs/live-play-authority.md')
    const backups = readRepoText('docs/private-vps-backups.md')

    expect(hosting).toContain('Migrating JSON campaign data to SQLite')
    expect(hosting).toContain('npm run migrate:sqlite')
    expect(hosting).toContain('ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign')
    expect(hosting).toContain('--backup-root /srv/rotom-table/backups')
    expect(hosting).toContain('refuses to run without an explicit existing `ROTOM_CAMPAIGN_ROOT`')
    expect(hosting).toContain('leaves the source JSON files in place')
    expect(hosting).toContain('skipped unchanged rows')
    expect(hosting).toContain('Current persistent player profiles remain JSON-backed')

    expect(campaignRepositories).toContain('ROTOM_CAMPAIGN_ROOT=/path/to/campaign npm run migrate:sqlite')
    expect(campaignRepositories).toContain('validates JSON-backed player profiles')
    expect(livePlayAuthority).toContain('Operators can migrate an existing private campaign with `npm run migrate:sqlite`')
    expect(livePlayAuthority).toContain('validates that imported maps/sheets can be loaded from the database')
    expect(backups).toContain('The SQLite migration command also creates a pre-migration backup')
  })
})
