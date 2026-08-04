import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import packageJson from '../../package.json'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const qualityGatePath = join(repoRoot, 'scripts/quality-gate.sh')

describe('quality gate automation validation', () => {
  it('runs strict semantic and budget checks before typecheck, tests, and build', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rotom-quality-gate-'))
    try {
      const binDirectory = join(directory, 'bin')
      const invocationLog = join(directory, 'npm-invocations.log')
      mkdirSync(binDirectory)
      mkdirSync(join(directory, 'scripts'))
      writeFileSync(join(directory, 'package-lock.json'), '{}\n')

      const fakeNpmPath = join(binDirectory, 'npm')
      writeFileSync(
        fakeNpmPath,
        '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$NPM_INVOCATIONS"\n',
      )
      chmodSync(fakeNpmPath, 0o755)

      const result = spawnSync('bash', [qualityGatePath], {
        cwd: directory,
        encoding: 'utf8',
        env: {
          ...process.env,
          NPM_INVOCATIONS: invocationLog,
          NO_COLOR: '1',
          PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
          TERM: 'dumb',
        },
      })

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      const invocations = readFileSync(invocationLog, 'utf8').trim().split('\n')
      expect(invocations).toEqual([
        'ci',
        'run check:ability-automation',
        'run check:ability-automation-budgets',
        'run check:ability-automation-plan',
        'run check:capability-automation-complete',
        'run check:edge-automation-complete',
        'run check:encounter-presentation',
        'run check:move-automation',
        'run check:move-automation-complete',
        'run check:move-automation-budgets',
        'run check:move-automation-menu-status',
        'run check:move-automation-legacy-links',
        'run lint --if-present',
        'run typecheck --if-present',
        'test --if-present',
        'run test:nuxt --if-present',
        'run test:e2e --if-present',
        'run build --if-present',
      ])
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps non-strict, strict, link, budget, and plan checks as explicit package commands', () => {
    expect(packageJson.scripts['check:ability-automation']).toContain(
      'scripts/check_ability_automation.ts',
    )
    expect(packageJson.scripts['check:ability-automation-complete']).toContain(
      '--require-complete --check-plan',
    )
    expect(packageJson.scripts['check:ability-automation-links']).toContain(
      'scripts/check_ability_automation.ts',
    )
    expect(packageJson.scripts['check:ability-automation-budgets']).toContain(
      'abilityAutomationMetadataBudgets.test.ts',
    )
    expect(packageJson.scripts['check:ability-automation-plan']).toContain('--check-plan')
    expect(packageJson.scripts['check:capability-automation']).toContain(
      'scripts/check_capability_automation.ts',
    )
    expect(packageJson.scripts['check:capability-automation-complete']).toContain('--check-plan')
    expect(packageJson.scripts['check:edge-automation']).toContain('scripts/check_edge_automation.ts')
    expect(packageJson.scripts['check:edge-automation-complete']).toContain('--check-plan')
    expect(packageJson.scripts['check:move-automation']).toBe(
      'python3 scripts/check_move_automation_coverage.py',
    )
    expect(packageJson.scripts['check:move-automation-complete']).toContain(
      'python3 scripts/check_move_automation_coverage.py --require-complete',
    )
    expect(packageJson.scripts['check:move-automation-complete']).toContain(
      'moveAutomationCanonicalCompletionAudit.test.ts',
    )
    expect(packageJson.scripts['check:move-automation-budgets']).toContain(
      'moveAutomationPerformanceBudgets.test.ts',
    )
    expect(packageJson.scripts['check:move-automation-menu-status']).toContain('--check')
    expect(packageJson.scripts['check:move-automation-legacy-links']).toContain('--check')
    expect(packageJson.scripts['check:encounter-presentation']).toContain(
      'check-encounter-presentation-contract.mjs',
    )
    expect(packageJson.scripts['test:nuxt']).toContain('vitest.nuxt.config.ts')
    expect(packageJson.scripts['test:e2e']).toContain('playwright test')
  })
})
