import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('README private VPS deployment pointers', () => {
  it('keeps the local quick start visible while linking to the private VPS runbooks', () => {
    const readme = readProductFile('README.md')

    expect(readme).toContain('## Quick start')
    expect(readme).toContain('npm install')
    expect(readme).toContain('npm run dev')
    expect(readme).toContain('ROTOM_CAMPAIGN_ROOT=../my-rotom-campaign npm run dev')

    expect(readme).toContain('## Private VPS hosting')
    expect(readme).toContain('local-first by default')
    expect(readme).toContain('private trusted-table VPS path')
    expect(readme).toContain('outer access gate')
    expect(readme).toContain('not public authentication')
    expect(readme).toContain('not a public multi-user service')
    expect(readme).toContain('[private VPS hosting runbook](docs/private-vps-hosting.md)')
    expect(readme).toContain('[deployment smoke checklist](docs/private-vps-deployment-smoke-checklist.md)')
    expect(readme).toContain('[backup runbook](docs/private-vps-backups.md)')
  })
})
