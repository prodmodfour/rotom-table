import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifestJson from '../../data/move-automation/manifest.json'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

type MutableManifest = {
  schemaVersion: number
  moves: Array<Record<string, any>>
}

const runChecker = (...args: string[]) => spawnSync(
  'python3',
  ['scripts/check_move_automation_coverage.py', ...args],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  },
)

const withTemporaryDirectory = (test: (directory: string) => void): void => {
  const directory = mkdtempSync(join(tmpdir(), 'rotom-move-coverage-'))
  try {
    test(directory)
  }
  finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const writeManifest = (directory: string, manifest: MutableManifest): string => {
  const path = join(directory, 'manifest.json')
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return path
}

const mutableManifest = (): MutableManifest => structuredClone(manifestJson) as MutableManifest

describe('move automation semantic coverage checker', () => {
  it('passes honest incomplete metadata and prints a semantic report', () => {
    const result = runChecker('--report')

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Move automation semantic validation report')
    expect(result.stdout).toContain('Canonical catalog: 776')
    expect(result.stdout).toContain('Manifest rows: 776')
    expect(result.stdout).toContain('Base status: 0 complete, 258 assisted, 518 blocked')
    expect(result.stdout).toContain('Metadata validation: PASS')
    expect(result.stdout).toContain('Completion requirement: not enforced')
  })

  it('emits byte-stable machine-readable output', () => {
    const first = runChecker('--json')
    const second = runChecker('--json')

    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0)
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0)
    expect(first.stderr).toBe('')
    expect(second.stdout).toBe(first.stdout)
    expect(JSON.parse(first.stdout)).toMatchObject({
      valid: true,
      metadataValid: true,
      complete: false,
      requireComplete: false,
      manifestMoves: 776,
      baseStatus: { complete: 0, assisted: 258, blocked: 518 },
      registry: { explicitLegacyScripts: 258 },
      runtime: { 'legacy-v1': 258, 'movespec-v2': 0, unimplemented: 518 },
      issues: [],
    })
  })

  it('keeps final completeness as a separate failing policy', () => {
    const result = runChecker('--require-complete', '--report')

    expect(result.status).toBe(1)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Metadata validation: PASS')
    expect(result.stdout).toContain('Completion requirement: FAIL')
    expect(result.stdout).toContain('ERROR [completion-required]')
    expect(result.stdout).toContain('0 complete, 258 assisted, and 518 blocked')
  })

  it('rejects incomplete catalog membership and provenance drift', () => {
    withTemporaryDirectory((directory) => {
      const missingRow = mutableManifest()
      missingRow.moves.pop()
      const missingResult = runChecker('--manifest', writeManifest(directory, missingRow), '--json')

      expect(missingResult.status).toBe(1)
      expect(JSON.parse(missingResult.stdout)).toMatchObject({
        valid: false,
        metadataValid: false,
        issues: [{ code: 'manifest-membership-mismatch', path: 'manifest.moves' }],
      })

      const staleProvenance = mutableManifest()
      staleProvenance.moves[0].rulesProvenance.sourceDataSha256 = 'b'.repeat(64)
      const staleResult = runChecker('--manifest', writeManifest(directory, staleProvenance), '--json')

      expect(staleResult.status).toBe(1)
      expect(JSON.parse(staleResult.stdout)).toMatchObject({
        issues: [{ code: 'provenance-mismatch' }],
      })
    })
  })

  it('resolves registry, runtime, hash, and scenario references', () => {
    withTemporaryDirectory((directory) => {
      const invalidRegistry = mutableManifest()
      const hyperBeam = invalidRegistry.moves.find(({ canonicalId }) => canonicalId === 'Hyper Beam')
      expect(hyperBeam).toBeDefined()
      hyperBeam!.runtime.kind = 'legacy-v1'
      const registryResult = runChecker(
        '--manifest',
        writeManifest(directory, invalidRegistry),
        '--json',
      )
      expect(registryResult.status).toBe(1)
      expect(JSON.parse(registryResult.stdout)).toMatchObject({
        issues: [{ code: 'missing-registry-reference' }],
      })

      const reviewed = mutableManifest()
      const scratch = reviewed.moves.find(({ canonicalId }) => canonicalId === 'Scratch')
      expect(scratch).toBeDefined()
      Object.assign(scratch!, {
        baseStatus: 'complete',
        runtime: {
          kind: 'legacy-v1',
          version: 1,
          definitionHash: 'a'.repeat(64),
          sourceModule: 'src/utils/move-automation/scripts/singleTargetAttacks.ts',
        },
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        scenarioIds: ['scratch.hit'],
        reviewedAt: '2026-07-10',
      })
      const manifestPath = writeManifest(directory, reviewed)
      const missingScenarioResult = runChecker('--manifest', manifestPath, '--json')
      expect(missingScenarioResult.status).toBe(1)
      expect(JSON.parse(missingScenarioResult.stdout)).toMatchObject({
        issues: [{ code: 'missing-scenario-reference' }],
      })

      writeFileSync(join(directory, 'scratch.ts'), "export const scratch = { scenarioId: 'scratch.hit' }\n")
      const linkedResult = runChecker(
        '--manifest', manifestPath,
        '--scenario-root', directory,
        '--json',
      )
      expect(linkedResult.status, `${linkedResult.stdout}\n${linkedResult.stderr}`).toBe(0)
      expect(JSON.parse(linkedResult.stdout)).toMatchObject({
        valid: true,
        baseStatus: { complete: 1, assisted: 257, blocked: 518 },
        references: {
          discoveredScenarios: 1,
          linkedRuntimes: 1,
          runtimeDefinitionHashes: 1,
          scenarioReferences: 1,
        },
      })
    })
  })
})
