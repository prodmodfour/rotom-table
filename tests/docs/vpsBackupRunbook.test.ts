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
})
