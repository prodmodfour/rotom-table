import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import packageJson from '../../package.json'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const qualityGatePath = join(repoRoot, 'scripts/quality-gate.sh')

describe('quality gate move automation validation', () => {
  it('runs the non-strict checker before typecheck, tests, and build', () => {
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
        'run check:move-automation',
        'run lint --if-present',
        'run typecheck --if-present',
        'test --if-present',
        'run build --if-present',
      ])
      expect(invocations).not.toContain('run check:move-automation-complete')
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps non-strict and strict checks as explicit package commands', () => {
    expect(packageJson.scripts['check:move-automation']).toBe(
      'python3 scripts/check_move_automation_coverage.py',
    )
    expect(packageJson.scripts['check:move-automation-complete']).toBe(
      'python3 scripts/check_move_automation_coverage.py --require-complete',
    )
  })
})
