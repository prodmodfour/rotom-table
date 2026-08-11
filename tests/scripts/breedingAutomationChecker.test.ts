import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import packageJson from '../../package.json'

const ROOT = resolve(import.meta.dirname, '../..')
const DONE_PLAN_PATH = 'implementation-plans/done/BREEDING_AND_EGG_LIFECYCLE_PLAN.md'

const runChecker = (...args: string[]) => spawnSync(
  'npx',
  ['vite-node', '--config', 'vitest.config.ts', 'scripts/check_breeding_automation.ts', ...args],
  { cwd: ROOT, encoding: 'utf8' },
)

describe('breeding automation checker', () => {
  it('passes the current source, registry, plan, coverage, gate, and synthetic-fixture state', () => {
    const result = runChecker('--check-plan')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const plan = readFileSync(resolve(ROOT, DONE_PLAN_PATH), 'utf8')
    const completedTickets = plan.match(/^- \[x\] \*\*BR-\d{3} .* — `DONE`$/gm)?.length ?? 0
    expect(result.stdout).toContain(`Breeding automation check passed: ${completedTickets}/90 tickets`)
    expect(result.stdout).toContain('30 frozen sources')
    expect(result.stdout).toContain('20 adjudications')
    expect(result.stdout).toContain('6 fixtures, 22 scripts')
  })

  it('certifies the archived complete plan and coverage ledger', () => {
    const result = runChecker('--check-plan', '--require-complete')
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stdout).toContain('Breeding automation check passed: 90/90 tickets')
  })

  it('exposes non-strict, plan, and complete commands and runs the non-strict check in the quality gate', () => {
    expect(packageJson.scripts['check:breeding-automation']).toContain('scripts/check_breeding_automation.ts')
    expect(packageJson.scripts['check:breeding-automation-plan']).toContain('--check-plan')
    expect(packageJson.scripts['check:breeding-automation-complete']).toContain('--check-plan --require-complete')
    expect(packageJson.scripts['check:breeding-family-resolutions']).toContain('scripts/build_breeding_family_resolutions.ts --check')
    expect(packageJson.scripts['check:breeding-compiler']).toContain('scripts/compile_breeding_registry.ts --check')
    const qualityGate = readFileSync(resolve(ROOT, 'scripts/quality-gate.sh'), 'utf8')
    expect(qualityGate).toContain('pp_section "Breeding automation metadata"')
    expect(qualityGate).toContain('run_cmd npm run check:breeding-automation')
    expect(qualityGate).toContain('pp_section "Breeding Family resolutions"')
    expect(qualityGate).toContain('run_cmd npm run check:breeding-family-resolutions')
    expect(qualityGate).toContain('pp_section "Breeding compiled registry"')
    expect(qualityGate).toContain('run_cmd npm run check:breeding-compiler')
  })
})
