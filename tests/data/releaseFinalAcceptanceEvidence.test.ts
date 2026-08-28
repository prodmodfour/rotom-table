import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const run = (script: string, env: NodeJS.ProcessEnv = process.env): string => execFileSync(process.execPath, [script], {
  cwd: root,
  encoding: 'utf8',
  env,
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

  it('preserves the pre-decision dossier without rewriting it as authorization', () => {
    expect(run('scripts/release-readiness/check-acceptance-dossier.mjs'))
      .toContain('owner go/no-go remains pending and authorizes 0 transactions')
  })

  it('proves the owner-approved final transaction while keeping publication unauthorized', () => {
    expect(run('scripts/release-readiness/check-final-acceptance.mjs', {
      ...process.env,
      ROTOM_RELEASE_TRANSACTION_PRETAG: '1',
    })).toContain('1.0.0 minted once, owner GO consumed once')
  })

  it('preserves failed v1.0.0 while gating the authorized v1.0.1 successor', () => {
    const artifact = JSON.parse(readFileSync(resolve(
      root,
      'data/release-readiness/released-identity-verification.v1.json',
    ), 'utf8'))
    if (artifact.status === 'PATCH_TRANSACTION_ACCEPTED_VERIFICATION_PENDING') {
      expect(run('scripts/release-readiness/check-released-identity.mjs', {
        ...process.env,
        ROTOM_RELEASE_TRANSACTION_PRETAG: '1',
      })).toContain('1.0.1 transaction accepted for reference generation')

      const gate = spawnSync(process.execPath, [
        'scripts/release-readiness/check-released-identity.mjs',
      ], { cwd: root, encoding: 'utf8' })
      expect(gate.status).toBe(1)
      expect(gate.stderr).toMatch(/(?:v1\.0\.1 must exist as an annotated tag|P13-085 verification is pending)/u)
    }
    else {
      expect(artifact.status).toBe('VERIFIED')
      expect(run('scripts/release-readiness/check-released-identity.mjs'))
        .toContain('two clean tagged builds reproduced every output checksum exactly')
    }
  })

  it('registers all five final-acceptance checkers directly in the full quality gate', () => {
    const gate = readFileSync(resolve(root, 'scripts/quality-gate.sh'), 'utf8')
    for (const script of [
      'check-final-candidate-evidence.mjs',
      'check-zero-unresolved.mjs',
      'check-acceptance-dossier.mjs',
      'check-final-acceptance.mjs',
      'check-released-identity.mjs',
    ]) {
      expect(gate).toContain(`run_cmd node scripts/release-readiness/${script}`)
    }
  })
})
