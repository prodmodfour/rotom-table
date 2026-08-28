import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const run = (script: string): string => execFileSync(process.execPath, [script], {
  cwd: root,
  encoding: 'utf8',
}).trim()

describe('release final-acceptance evidence', () => {
  it('verifies the immutable final candidate and optional operator-local evidence', () => {
    expect(run('scripts/release-readiness/check-final-candidate-evidence.mjs'))
      .toMatch(/^Final candidate evidence passed: v1\.0\.0-rc\.7/u)
  })

  it('proves the pre-dossier rule-7 sweep has zero unresolved findings', () => {
    expect(run('scripts/release-readiness/check-zero-unresolved.mjs'))
      .toContain('62/62 due rubric rows final')
  })

  it('keeps the dossier ready for an explicit owner decision without authorizing release', () => {
    expect(run('scripts/release-readiness/check-acceptance-dossier.mjs'))
      .toContain('owner go/no-go remains pending and authorizes 0 transactions')
  })

  it('registers all three final-acceptance checkers directly in the full quality gate', () => {
    const gate = readFileSync(resolve(root, 'scripts/quality-gate.sh'), 'utf8')
    for (const script of [
      'check-final-candidate-evidence.mjs',
      'check-zero-unresolved.mjs',
      'check-acceptance-dossier.mjs',
    ]) {
      expect(gate).toContain(`run_cmd node scripts/release-readiness/${script}`)
    }
  })
})
