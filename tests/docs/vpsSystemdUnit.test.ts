import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('private VPS systemd unit example', () => {
  it('runs the built server as a non-root service user from the app checkout', () => {
    const unit = readProductFile('deploy/systemd/rotom-table.service')

    expect(unit).toContain('User=rotom-table')
    expect(unit).toContain('Group=rotom-table')
    expect(unit).not.toContain('User=root')
    expect(unit).toContain('WorkingDirectory=/srv/rotom-table/app')
    expect(unit).toContain('ExecStart=/usr/bin/env npm run start')
  })

  it('loads private host settings from an external env file and restarts on failure', () => {
    const unit = readProductFile('deploy/systemd/rotom-table.service')

    expect(unit).toContain('EnvironmentFile=/etc/rotom-table/rotom-table.env')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('RestartSec=5s')
    expect(unit).toContain('WantedBy=multi-user.target')
  })

  it('documents the install location and private env file path without committing secrets', () => {
    const unit = readProductFile('deploy/systemd/rotom-table.service')
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(unit).not.toMatch(/PASSWORD|TOKEN|SECRET|BEGIN PRIVATE KEY/i)
    expect(privateVpsDoc).toContain('[`deploy/systemd/rotom-table.service`](../deploy/systemd/rotom-table.service)')
    expect(privateVpsDoc).toContain('/etc/systemd/system/rotom-table.service')
    expect(privateVpsDoc).toContain('/etc/rotom-table/rotom-table.env')
    expect(privateVpsDoc).toContain('0600')
    expect(privateVpsDoc).toContain('systemctl enable --now rotom-table.service')
  })
})
