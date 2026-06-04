import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('private VPS branch strategy docs', () => {
  it('keeps the deployment branch recommendation simple', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')

    expect(privateVpsDoc).toContain('## Branch and data separation strategy')
    expect(privateVpsDoc).toContain('prefer `main` as the deployable production-code line plus short-lived feature branches')
    expect(privateVpsDoc).toContain('Avoid maintaining long-lived `dev` and `production` branches unless there is a real staging environment')
  })

  it('prioritizes campaign-data separation over branch naming', () => {
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')
    const smokeChecklist = readProductFile('docs/private-vps-deployment-smoke-checklist.md')
    const backupRunbook = readProductFile('docs/private-vps-backups.md')

    expect(privateVpsDoc).toContain('Data separation matters more than branch names')
    expect(privateVpsDoc).toContain('never point staging and production at the same writable `ROTOM_CAMPAIGN_ROOT`')
    expect(smokeChecklist).toContain('branch names are not data-isolation boundaries')
    expect(smokeChecklist).toContain('staging plus production must never share the same writable campaign root')
    expect(backupRunbook).toContain('a later staging host must use a different writable `ROTOM_CAMPAIGN_ROOT` from the private production table')
  })
})
