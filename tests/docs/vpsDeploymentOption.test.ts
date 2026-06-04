import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('private VPS deployment option docs', () => {
  it('records systemd with a direct Node runtime as the primary process-management path', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(privateVpsDoc).toContain('systemd with a direct Node.js 24 runtime')
    expect(privateVpsDoc).toContain('npm run start')
    expect(privateVpsDoc).toContain('node .output/server/index.mjs')
    expect(privateVpsDoc).toContain('ROTOM_CAMPAIGN_ROOT=/srv/rotom-table/campaign')
  })

  it('defines restart and log access behavior for the chosen platform', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(privateVpsDoc).toContain('Restart=on-failure')
    expect(privateVpsDoc).toContain('RestartSec')
    expect(privateVpsDoc).toContain('systemctl restart rotom-table.service')
    expect(privateVpsDoc).toContain('journalctl -u rotom-table.service')
  })

  it('keeps the deployment choice scoped to private loopback hosting', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(privateVpsDoc).toContain('Docker and Compose are not the primary deployment path')
    expect(privateVpsDoc).toContain('bound to loopback')
    expect(privateVpsDoc).toContain('outer access gate')
  })
})
