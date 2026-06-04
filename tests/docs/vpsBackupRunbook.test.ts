import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('private VPS backup runbook docs', () => {
  it('documents before and after session archives for ROTOM_CAMPAIGN_ROOT', () => {
    const backupRunbook = readProductFile('docs/private-vps-backups.md')

    expect(backupRunbook).toContain('# Private VPS backup runbook')
    expect(backupRunbook).toContain('ROTOM_CAMPAIGN_ROOT')
    expect(backupRunbook).toContain('/srv/rotom-table/campaign')
    expect(backupRunbook).toContain('/srv/rotom-table/backups')
    expect(backupRunbook).toContain('Before a session')
    expect(backupRunbook).toContain('After a session')
    expect(backupRunbook).toContain('$(date -u +%Y%m%dT%H%M%SZ)')
    expect(backupRunbook).toContain('rotom-campaign-${SESSION_TAG}-${STAMP}.tar.gz')
    expect(backupRunbook).toContain('sudo tar -C')
  })

  it('includes private deployment config backup notes without encouraging committed secrets', () => {
    const backupRunbook = readProductFile('docs/private-vps-backups.md')

    expect(backupRunbook).toContain('/etc/rotom-table/rotom-table.env')
    expect(backupRunbook).toContain('/etc/systemd/system/rotom-table.service')
    expect(backupRunbook).toContain('ROTOM_ENABLE_HOSTED_WRITES=1')
    expect(backupRunbook).toContain('do not commit them to Git')
    expect(backupRunbook).toContain('.env.vps.example')
    expect(backupRunbook).toContain('credentials with placeholders')
  })

  it('keeps retention and Git hygiene guidance visible from VPS docs', () => {
    const backupRunbook = readProductFile('docs/private-vps-backups.md')
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')
    const docsIndex = readProductFile('docs/README.md')

    expect(backupRunbook).toContain('## Retention guidance')
    expect(backupRunbook).toContain('off-host copy')
    expect(backupRunbook).toContain('Do not create backup archives under `/srv/rotom-table/app`')
    expect(backupRunbook).toContain('no backup archives or private campaign files are staged')
    expect(privateVpsDoc).toContain('[Private VPS backup runbook](private-vps-backups.md)')
    expect(docsIndex).toContain('[Private VPS backup runbook](private-vps-backups.md)')
  })

  it('documents a temporary restore smoke check before trusting an archive', () => {
    const backupRunbook = readProductFile('docs/private-vps-backups.md')
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')
    const docsIndex = readProductFile('docs/README.md')

    expect(backupRunbook).toContain('## Restore smoke check')
    expect(backupRunbook).toContain('RESTORE_ROOT="$(sudo mktemp -d /srv/rotom-table/restore-smoke.XXXXXX)"')
    expect(backupRunbook).toContain('sudo chown -R rotom-table:rotom-table "$RESTORE_ROOT"')
    expect(backupRunbook).toContain('ROTOM_CAMPAIGN_ROOT="$RESTORED_CAMPAIGN_ROOT"')
    expect(backupRunbook).toContain('NITRO_PORT=3100')
    expect(backupRunbook).toContain('ROTOM_ENABLE_HOSTED_WRITES=1')
    expect(backupRunbook).toContain('/maps')
    expect(backupRunbook).toContain('/sheets')
    expect(backupRunbook).toContain('/players')
    expect(backupRunbook).toContain('/encounter-tables')
    expect(backupRunbook).toContain('test write persists after restart')
    expect(backupRunbook).toContain('restored maps/sheets/trainers/player profiles/encounter tables do not load')
    expect(privateVpsDoc).toContain('temporary restore smoke check')
    expect(docsIndex).toContain('temporary restore smoke checks')
  })
})
