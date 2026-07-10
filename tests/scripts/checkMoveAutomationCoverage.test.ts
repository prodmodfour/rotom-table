import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import capabilitiesJson from '../../data/move-automation/capabilities.json'
import manifestJson from '../../data/move-automation/manifest.json'
import scenarioRequirementsJson from '../../data/move-automation/scenario-requirements.json'
import { EXPLICIT_MOVE_AUTOMATION_SCRIPTS } from '../../src/utils/move-automation/registry'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

type MutableManifest = {
  schemaVersion: number
  moves: Array<Record<string, any>>
}

type ManifestRows = MutableManifest['moves']

type MutableCapabilityCatalog = {
  schemaVersion: number
  capabilities: Array<Record<string, any>>
}

type MutableScenarioRequirements = {
  schemaVersion: number
  evidenceClasses: Array<Record<string, any>>
  requirements: Array<Record<string, any>>
}

const baseStatusCounts = (moves: ManifestRows) => ({
  complete: moves.filter(({ baseStatus }) => baseStatus === 'complete').length,
  assisted: moves.filter(({ baseStatus }) => baseStatus === 'assisted').length,
  blocked: moves.filter(({ baseStatus }) => baseStatus === 'blocked').length,
})

const runtimeCounts = (moves: ManifestRows) => ({
  'legacy-v1': moves.filter(({ runtime }) => runtime.kind === 'legacy-v1').length,
  'movespec-v2': moves.filter(({ runtime }) => runtime.kind === 'movespec-v2').length,
  unimplemented: moves.filter(({ runtime }) => runtime.kind === 'unimplemented').length,
})

const manifestMoveCount = manifestJson.moves.length
const currentBaseStatusCounts = baseStatusCounts(manifestJson.moves)
const currentRuntimeCounts = runtimeCounts(manifestJson.moves)
const manifestIsComplete = currentBaseStatusCounts.complete === manifestMoveCount
const currentLinkedRuntimeCount = manifestJson.moves.filter(({ runtime }) =>
  runtime.version !== null && runtime.definitionHash !== null && runtime.sourceModule !== null,
).length
const currentDefinitionHashCount = manifestJson.moves.filter(({ runtime }) =>
  runtime.definitionHash !== null,
).length

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

const writeCapabilities = (directory: string, catalog: MutableCapabilityCatalog): string => {
  const path = join(directory, 'capabilities.json')
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`)
  return path
}

const mutableCapabilities = (): MutableCapabilityCatalog =>
  structuredClone(capabilitiesJson) as MutableCapabilityCatalog

const writeScenarioRequirements = (
  directory: string,
  catalog: MutableScenarioRequirements,
): string => {
  const path = join(directory, 'scenario-requirements.json')
  writeFileSync(path, `${JSON.stringify(catalog, null, 2)}\n`)
  return path
}

const mutableScenarioRequirements = (): MutableScenarioRequirements =>
  structuredClone(scenarioRequirementsJson) as MutableScenarioRequirements

describe('move automation semantic coverage checker', () => {
  it('passes valid metadata and prints a semantic report', () => {
    const result = runChecker('--report')

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Move automation semantic validation report')
    expect(result.stdout).toContain(`Canonical catalog: ${manifestMoveCount}`)
    expect(result.stdout).toContain(`Manifest rows: ${manifestMoveCount}`)
    expect(result.stdout).toContain(
      `Base status: ${currentBaseStatusCounts.complete} complete, `
      + `${currentBaseStatusCounts.assisted} assisted, `
      + `${currentBaseStatusCounts.blocked} blocked`,
    )
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
      complete: manifestIsComplete,
      requireComplete: false,
      manifestMoves: manifestMoveCount,
      baseStatus: currentBaseStatusCounts,
      registry: { explicitLegacyScripts: EXPLICIT_MOVE_AUTOMATION_SCRIPTS.size },
      runtime: currentRuntimeCounts,
      issues: [],
    })
  })

  it('keeps final completeness as a separate policy', () => {
    const result = runChecker('--require-complete', '--report')
    expect(result.status).toBe(manifestIsComplete ? 0 : 1)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Metadata validation: PASS')
    expect(result.stdout).toContain(`Completion requirement: ${manifestIsComplete ? 'PASS' : 'FAIL'}`)
    if (!manifestIsComplete) {
      expect(result.stdout).toContain('ERROR [completion-required]')
      expect(result.stdout).toContain(
        `${currentBaseStatusCounts.complete} complete, `
        + `${currentBaseStatusCounts.assisted} assisted, and `
        + `${currentBaseStatusCounts.blocked} blocked`,
      )
    }
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

  it('resolves manifest blockers and capability dependencies through the typed catalog', () => {
    withTemporaryDirectory((directory) => {
      const manifest = mutableManifest()
      const blockedMove = manifest.moves.find(({ baseStatus }) => baseStatus === 'blocked')
      expect(blockedMove).toBeDefined()
      blockedMove!.blockerCodes = ['runtime.unknown']

      const blockerResult = runChecker(
        '--manifest', writeManifest(directory, manifest),
        '--json',
      )
      expect(blockerResult.status).toBe(1)
      expect(JSON.parse(blockerResult.stdout)).toMatchObject({
        issues: [{ code: 'unknown-capability', path: expect.stringContaining('blockerCodes[0]') }],
      })

      const capabilities = mutableCapabilities()
      capabilities.capabilities[0].dependencies = ['capability.unknown']
      const dependencyResult = runChecker(
        '--capabilities', writeCapabilities(directory, capabilities),
        '--json',
      )
      expect(dependencyResult.status).toBe(1)
      expect(JSON.parse(dependencyResult.stdout)).toMatchObject({
        issues: [{ code: 'unknown-capability-dependency' }],
      })
    })
  })

  it('validates the reviewed scenario-requirement catalog', () => {
    withTemporaryDirectory((directory) => {
      const requirements = mutableScenarioRequirements()
      requirements.requirements[0].requiredEvidenceClasses = ['evidence.unknown']
      const result = runChecker(
        '--scenario-requirements', writeScenarioRequirements(directory, requirements),
        '--json',
      )

      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        issues: [{
          code: 'unknown-evidence-class',
          path: 'scenarioRequirements.requirements[0].requiredEvidenceClasses[0]',
        }],
      })
    })
  })

  it('requires every selected evidence class or a reviewed not-applicable reason', () => {
    withTemporaryDirectory((directory) => {
      const reviewed = mutableManifest()
      const scratch = reviewed.moves.find(({ canonicalId }) => canonicalId === 'Scratch')
      expect(scratch).toBeDefined()
      Object.assign(scratch!, {
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        scenarioIds: ['scratch.hit'],
        conformanceEvidence: {
          requirementTags: ['branch.accuracy'],
          scenarios: [{ scenarioId: 'scratch.hit', evidenceClasses: ['hit'] }],
          notApplicable: [{
            evidenceClass: 'miss',
            reason: 'The reviewed canonical branch cannot miss.',
          }],
        },
        reviewedAt: '2026-07-10',
      })
      const manifestPath = writeManifest(directory, reviewed)
      writeFileSync(
        join(directory, 'scratch.ts'),
        "export const hit = { scenarioId: 'scratch.hit' }\n",
      )

      const accepted = runChecker(
        '--manifest', manifestPath,
        '--scenario-root', directory,
        '--json',
      )
      expect(accepted.status, `${accepted.stdout}\n${accepted.stderr}`).toBe(0)

      scratch!.conformanceEvidence.notApplicable = []
      writeManifest(directory, reviewed)
      const missing = runChecker(
        '--manifest', manifestPath,
        '--scenario-root', directory,
        '--json',
      )
      expect(missing.status).toBe(1)
      expect(JSON.parse(missing.stdout)).toMatchObject({
        issues: [{ code: 'missing-conformance-evidence' }],
      })

      scratch!.conformanceEvidence.notApplicable = [{
        evidenceClass: 'miss',
        reason: 'The reviewed canonical branch cannot miss.',
      }]
      scratch!.reviewedAt = null
      writeManifest(directory, reviewed)
      const unreviewed = runChecker(
        '--manifest', manifestPath,
        '--scenario-root', directory,
        '--json',
      )
      expect(unreviewed.status).toBe(1)
      expect(JSON.parse(unreviewed.stdout)).toMatchObject({
        issues: [{ code: 'invalid-conformance-evidence' }],
      })
    })
  })

  it('resolves registry, runtime, hash, and scenario references', () => {
    withTemporaryDirectory((directory) => {
      const invalidRegistry = mutableManifest()
      const hyperBeam = invalidRegistry.moves.find(({ canonicalId }) => canonicalId === 'Hyper Beam')
      expect(hyperBeam).toBeDefined()
      hyperBeam!.runtime = {
        kind: 'legacy-v1',
        version: 1,
        definitionHash: 'a'.repeat(64),
        sourceModule: 'src/utils/move-automation/scripts/singleTargetAttacks.ts',
      }
      const registryResult = runChecker(
        '--manifest',
        writeManifest(directory, invalidRegistry),
        '--json',
      )
      expect(registryResult.status).toBe(1)
      expect(JSON.parse(registryResult.stdout)).toMatchObject({
        issues: [{ code: 'missing-registry-reference' }],
      })

      const staleFingerprint = mutableManifest()
      const staleScratch = staleFingerprint.moves.find(({ canonicalId }) => canonicalId === 'Scratch')
      expect(staleScratch).toBeDefined()
      staleScratch!.runtime.definitionHash = 'a'.repeat(64)
      const driftResult = runChecker(
        '--manifest', writeManifest(directory, staleFingerprint), '--json',
      )
      expect(driftResult.status).toBe(1)
      expect(JSON.parse(driftResult.stdout)).toMatchObject({
        issues: [{ code: 'legacy-runtime-fingerprint-drift' }],
      })

      const reviewed = mutableManifest()
      const scratch = reviewed.moves.find(({ canonicalId }) => canonicalId === 'Scratch')
      expect(scratch).toBeDefined()
      Object.assign(scratch!, {
        baseStatus: 'complete',
        blockerCodes: [],
        limitations: [],
        manualSteps: [],
        scenarioIds: ['scratch.hit', 'scratch.miss', 'scratch.crit', 'scratch.immunity'],
        conformanceEvidence: {
          requirementTags: ['mechanic.damage'],
          scenarios: [
            { scenarioId: 'scratch.hit', evidenceClasses: ['hit'] },
            { scenarioId: 'scratch.miss', evidenceClasses: ['miss'] },
            { scenarioId: 'scratch.crit', evidenceClasses: ['crit'] },
            { scenarioId: 'scratch.immunity', evidenceClasses: ['immunity'] },
          ],
          notApplicable: [],
        },
        reviewedAt: '2026-07-10',
      })
      const manifestPath = writeManifest(directory, reviewed)
      const missingScenarioResult = runChecker('--manifest', manifestPath, '--json')
      expect(missingScenarioResult.status).toBe(1)
      expect(JSON.parse(missingScenarioResult.stdout)).toMatchObject({
        issues: [{ code: 'missing-scenario-reference' }],
      })

      writeFileSync(join(directory, 'scratch.ts'), [
        "export const hit = { scenarioId: 'scratch.hit' }",
        "export const miss = { scenarioId: 'scratch.miss' }",
        "export const crit = { scenarioId: 'scratch.crit' }",
        "export const immunity = { scenarioId: 'scratch.immunity' }",
        '',
      ].join('\n'))
      const linkedResult = runChecker(
        '--manifest', manifestPath,
        '--scenario-root', directory,
        '--json',
      )
      expect(linkedResult.status, `${linkedResult.stdout}\n${linkedResult.stderr}`).toBe(0)
      expect(JSON.parse(linkedResult.stdout)).toMatchObject({
        valid: true,
        baseStatus: baseStatusCounts(reviewed.moves),
        references: {
          discoveredScenarios: 4,
          linkedRuntimes: currentLinkedRuntimeCount,
          runtimeDefinitionHashes: currentDefinitionHashCount,
          scenarioReferences: 4,
        },
      })
    })
  })
})
