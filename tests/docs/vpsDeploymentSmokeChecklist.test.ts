import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProductFile = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8')

describe('private VPS deployment smoke checklist docs', () => {
  it('covers the standard install, validation, build, start, and health checks', () => {
    const smokeChecklist = readProductFile('docs/private-vps-deployment-smoke-checklist.md')

    expect(smokeChecklist).toContain('# Private VPS deployment smoke checklist')
    expect(smokeChecklist).toContain('after every private VPS deploy')
    expect(smokeChecklist).toContain('Node.js 24 LTS')
    expect(smokeChecklist).toContain('npm ci')
    expect(smokeChecklist).toContain('npm run typecheck')
    expect(smokeChecklist).toContain('npm test')
    expect(smokeChecklist).toContain('npm run build')
    expect(smokeChecklist).toContain('npm run start')
    expect(smokeChecklist).toContain('curl -fsS http://127.0.0.1:3000/api/health')
  })

  it('keeps private VPS smoke tied to an outer gate and normal profile play', () => {
    const smokeChecklist = readProductFile('docs/private-vps-deployment-smoke-checklist.md')

    expect(smokeChecklist).toContain('outer access gate')
    expect(smokeChecklist).toContain('GM Login')
    expect(smokeChecklist).toContain('Player Login')
    expect(smokeChecklist).toContain('/players')
    expect(smokeChecklist).toContain('/maps/<slug>')
    expect(smokeChecklist).toContain('selected profile')
    expect(smokeChecklist).toContain('not public authentication')
  })

  it('requires disposable map and sheet writes to persist after restart without staging private data', () => {
    const smokeChecklist = readProductFile('docs/private-vps-deployment-smoke-checklist.md')

    expect(smokeChecklist).toContain('ROTOM_ENABLE_HOSTED_WRITES=1')
    expect(smokeChecklist).toContain('Write persistence after restart')
    expect(smokeChecklist).toContain('disposable map')
    expect(smokeChecklist).toContain('disposable sheet')
    expect(smokeChecklist).toContain('ROTOM_CAMPAIGN_ROOT')
    expect(smokeChecklist).toContain('sudo systemctl restart rotom-table.service')
    expect(smokeChecklist).toContain('git status --short')
    expect(smokeChecklist).toContain('no private data is staged in Git')
  })

  it('links the checklist from the private VPS docs and separates it from legacy sessions', () => {
    const smokeChecklist = readProductFile('docs/private-vps-deployment-smoke-checklist.md')
    const privateVpsDoc = readProductFile('docs/private-vps-hosting.md')
    const docsIndex = readProductFile('docs/README.md')

    expect(smokeChecklist).toContain("## Legacy `/sessions` boundary")
    expect(smokeChecklist).toContain('does not require players to use `/sessions`')
    expect(smokeChecklist).toContain('Legacy live-session deployment smoke checklist')
    expect(privateVpsDoc).toContain('[Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md)')
    expect(docsIndex).toContain('[Private VPS deployment smoke checklist](private-vps-deployment-smoke-checklist.md)')
  })
})
