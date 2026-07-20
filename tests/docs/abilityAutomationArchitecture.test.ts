import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8')

describe('ability automation architecture documentation', () => {
  it('records the separate authoritative AbilitySpec decision and all runtime modes', () => {
    const adr = read('docs/adrs/011-authoritative-ability-automation-runtime.md')

    expect(adr).toContain('versioned, server-interpreted `AbilitySpec` runtime')
    expect(adr).toContain('**Static provider:**')
    expect(adr).toContain('**Activated declaration:**')
    expect(adr).toContain('**Triggered subscription:**')
    expect(adr).toContain('typed accepted encounter events')
    expect(adr).toContain('effective-ability projection')
    expect(adr).toContain('Durable pending')
    expect(adr).toContain('There will be no dual write')
    expect(adr).toContain('483')
  })

  it('documents the authoring, evidence, source, privacy, and plan workflows', () => {
    const guide = read('docs/ability-automation.md')

    expect(guide).toContain('ABILITY_AUTOMATION_PLAN.md')
    expect(guide).toContain('source-adjudications.json')
    expect(guide).toContain('Do not scan logs')
    expect(guide).toContain('Scenario IDs alone are not evidence')
    expect(guide).toContain('npm run check:ability-automation-plan')
    expect(guide).toContain('npm run check:ability-automation-complete')
    expect(guide).toContain('Private prompt leak')
  })

  it('links the guide and ADR from the docs index and contributor entry point', () => {
    const index = read('docs/README.md')
    const contributing = read('CONTRIBUTING.md')

    expect(index).toContain('(ability-automation.md)')
    expect(index).toContain('(adrs/011-authoritative-ability-automation-runtime.md)')
    expect(contributing).toContain('docs/ability-automation.md')
    expect(contributing).toContain('ABILITY_AUTOMATION_PLAN.md')
  })
})
