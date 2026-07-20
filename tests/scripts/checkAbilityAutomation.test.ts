import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import capabilitiesJson from '../../data/ability-automation/capabilities.json'
import manifestJson from '../../data/ability-automation/manifest.json'

const repoRoot = resolve(import.meta.dirname, '../..')
const viteNode = resolve(repoRoot, 'node_modules/.bin/vite-node')

const runCheck = (...args: string[]) => spawnSync(
  viteNode,
  ['--config', 'vitest.config.ts', 'scripts/check_ability_automation.ts', ...args],
  { cwd: repoRoot, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
)

describe('ability automation repository checker', () => {
  it('accepts the exact canonical metadata and reports honest bootstrap counts', () => {
    const result = runCheck('--report')

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      canonical: 483,
      complete: manifestJson.abilities.filter(ability => ability.baseStatus === 'complete').length,
      assisted: manifestJson.abilities.filter(ability => ability.baseStatus === 'assisted').length,
      blocked: manifestJson.abilities.filter(ability => ability.baseStatus === 'blocked').length,
      unimplemented: manifestJson.abilities.filter(ability => ability.runtime.kind === 'unimplemented').length,
      registeredRuntimes: 0,
      capabilities: {
        planned: capabilitiesJson.capabilities.filter(capability => capability.implementationStatus === 'planned').length,
        implemented: capabilitiesJson.capabilities.filter(capability => capability.implementationStatus === 'implemented').length,
      },
      evidenceClasses: 48,
      evidenceRequirements: 30,
      legacyBaseline: {
        abilitiesWithFragments: 45,
        fragments: 55,
        uncoveredAbilities: 438,
      },
      privacyMatrix: {
        threats: 8,
        assets: 19,
      },
      planTicketsDone: null,
    })
  })

  it('validates ticket progress, cohort membership, manifest cohorts, and snapshots', () => {
    const result = runCheck('--check-plan', '--report')

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const plan = readFileSync(resolve(repoRoot, 'ABILITY_AUTOMATION_PLAN.md'), 'utf8')
    const done = [...plan.matchAll(/\*\*(AA-\d{3}) — .+\*\* — `DONE`/g)].length
    expect(JSON.parse(result.stdout)).toMatchObject({
      canonical: 483,
      planTicketsDone: done,
    })
  })

  it('keeps strict closure red until all canonical rows are genuinely complete', () => {
    const complete = manifestJson.abilities.filter(ability => ability.baseStatus === 'complete').length
    const result = runCheck('--require-complete')

    if (complete === 483) {
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    }
    else {
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Strict ability completion requires 483 complete')
    }
  })

  it('rejects unknown checker options', () => {
    const result = runCheck('--skip-validation')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Unknown ability automation check option')
  })
})
