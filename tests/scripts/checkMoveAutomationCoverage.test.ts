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

type ReportManifestRow = {
  canonicalId: string
  baseStatus: string
  blockerCodes: string[]
  rolloutCohortId: string | null
  scenarioIds: string[]
  conformanceEvidence: { requirementTags: string[] }
}

const reportManifestRows = manifestJson.moves as unknown as ReportManifestRow[]

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
const currentRequirementsUnassignedMoves = reportManifestRows
  .filter(move => move.conformanceEvidence.requirementTags.length === 0)
  .map(move => move.canonicalId)

const expectedSemanticStatusGroups = ['complete', 'assisted', 'blocked'].map(status => ({
  count: reportManifestRows.filter(move => move.baseStatus === status).length,
  moves: reportManifestRows
    .filter(move => move.baseStatus === status)
    .map(move => move.canonicalId),
  status,
}))

const expectedCapabilityBlockerGroups = [
  ...new Set(reportManifestRows.flatMap(move => move.blockerCodes)),
].sort().map((blockerCode) => {
  const capability = capabilitiesJson.capabilities.find(({ code }) => code === blockerCode)
  if (!capability)
    throw new Error(`Missing test capability ${blockerCode}`)
  const moves = reportManifestRows
    .filter(move => move.blockerCodes.includes(blockerCode))
    .map(move => move.canonicalId)
  return {
    blockerCode,
    count: moves.length,
    implementationStatus: capability.implementationStatus,
    moves,
    owningPhase: capability.owningPhase,
  }
})

const expectedCohortGroups: Array<{
  cohortId: string | null
  count: number
  moves: string[]
}> = [
  ...new Set(reportManifestRows
    .map(move => move.rolloutCohortId)
    .filter((cohortId): cohortId is string => cohortId !== null)),
].sort().map((cohortId) => {
  const moves = reportManifestRows
    .filter(move => move.rolloutCohortId === cohortId)
    .map(move => move.canonicalId)
  return { cohortId, count: moves.length, moves }
})
if (reportManifestRows.some(move => move.rolloutCohortId === null)) {
  const moves = reportManifestRows
    .filter(move => move.rolloutCohortId === null)
    .map(move => move.canonicalId)
  expectedCohortGroups.push({ cohortId: null, count: moves.length, moves })
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

const writeBaselineScenarioFixtures = (
  directory: string,
  excludedCanonicalIds: readonly string[] = [],
): number => {
  const excluded = new Set(excludedCanonicalIds)
  const scenarioIds = reportManifestRows.flatMap(row => (
    excluded.has(row.canonicalId) ? [] : row.scenarioIds
  ))
  writeFileSync(
    join(directory, 'baseline-scenarios.ts'),
    `${scenarioIds.map((scenarioId, index) => (
      `export const scenario${index + 1} = { scenarioId: '${scenarioId}' }`
    )).join('\n')}\n`,
  )
  return scenarioIds.length
}

describe('move automation semantic coverage checker', () => {
  it('prints a byte-stable Markdown progress report from reviewed metadata', () => {
    const first = runChecker('--report')
    const second = runChecker('--markdown')

    expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0)
    expect(second.status, `${second.stdout}\n${second.stderr}`).toBe(0)
    expect(first.stderr).toBe('')
    expect(second.stderr).toBe('')
    expect(second.stdout).toBe(first.stdout)
    expect(first.stdout).toContain('# Move automation semantic validation report')
    expect(first.stdout).toContain(`- Canonical catalog: **${manifestMoveCount}**`)
    expect(first.stdout).toContain(`- Manifest rows: **${manifestMoveCount}**`)
    expect(first.stdout).toContain(
      `- Base status: **${currentBaseStatusCounts.complete}** complete, `
      + `**${currentBaseStatusCounts.assisted}** assisted, `
      + `**${currentBaseStatusCounts.blocked}** blocked`,
    )
    expect(first.stdout).toContain('## Semantic status')
    expect(first.stdout).toContain('## Capability blockers')
    expect(first.stdout).toContain('## Rollout cohorts')
    expect(first.stdout).toContain('## Missing test evidence')
    expect(first.stdout).toContain('- Metadata validation: **PASS**')
    expect(first.stdout).toContain('- Completion requirement: **not enforced**')
    expect(first.stdout).toContain('Heuristic move-prose classification is informational only')
    expect(first.stdout).not.toContain('plain-single-target-damage')
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
      planning: {
        basis: 'reviewed-semantic-manifest',
        heuristicProseClassification: 'informational-only',
        schemaVersion: 1,
        groups: {
          semanticStatus: expectedSemanticStatusGroups,
          capabilityBlocker: expectedCapabilityBlockerGroups,
          cohort: expectedCohortGroups,
          missingTestEvidence: [{
            count: currentRequirementsUnassignedMoves.length,
            evidenceCode: 'requirements-unassigned',
            moves: currentRequirementsUnassignedMoves,
            summary: 'Reviewed scenario requirement tags have not been assigned.',
          }],
        },
      },
    })
  })

  it('groups assigned cohorts, blockers, and outstanding evidence classes', () => {
    withTemporaryDirectory((directory) => {
      const manifest = mutableManifest()
      const scratch = manifest.moves.find(({ canonicalId }) => canonicalId === 'Scratch')
      expect(scratch).toBeDefined()
      Object.assign(scratch!, {
        baseStatus: 'assisted',
        blockerCodes: ['targeting.authoritative'],
        rolloutCohortId: 'reg-024',
        scenarioIds: ['scratch.progress.hit'],
        conformanceEvidence: {
          requirementTags: ['mechanic.damage'],
          scenarios: [{
            scenarioId: 'scratch.progress.hit',
            evidenceClasses: ['hit'],
          }],
          notApplicable: [{
            evidenceClass: 'crit',
            reason: 'This fixture reviews the critical-hit branch as not applicable.',
          }],
        },
        reviewedAt: '2026-07-10',
      })
      const manifestPath = writeManifest(directory, manifest)
      writeFileSync(
        join(directory, 'scratch-progress.ts'),
        "export const hit = { scenarioId: 'scratch.progress.hit' }\n",
      )
      writeBaselineScenarioFixtures(directory, ['Scratch'])

      const first = runChecker(
        '--manifest', manifestPath,
        '--scenario-root', directory,
        '--json',
      )
      const second = runChecker(
        '--manifest', manifestPath,
        '--scenario-root', directory,
        '--json',
      )

      expect(first.status, `${first.stdout}\n${first.stderr}`).toBe(0)
      expect(second.stdout).toBe(first.stdout)
      const groups = JSON.parse(first.stdout).planning.groups
      const cohortIds = [...new Set(manifest.moves.flatMap(move => (
        typeof move.rolloutCohortId === 'string' ? [move.rolloutCohortId] : []
      )))].sort()
      const expectedCohorts: Array<{
        cohortId: string | null
        count: number
        moves: string[]
      }> = cohortIds.map((cohortId) => {
        const moves = manifest.moves
          .filter(move => move.rolloutCohortId === cohortId)
          .map(move => move.canonicalId as string)
        return { cohortId, count: moves.length, moves }
      })
      const unassignedCohortMoves = manifest.moves
        .filter(move => move.rolloutCohortId === null)
        .map(move => move.canonicalId)
      if (unassignedCohortMoves.length > 0) {
        expectedCohorts.push({
          cohortId: null,
          count: unassignedCohortMoves.length,
          moves: unassignedCohortMoves,
        })
      }
      expect(groups.cohort).toEqual(expectedCohorts)
      expect(groups.capabilityBlocker.find(
        ({ blockerCode }: { blockerCode: string }) => blockerCode === 'targeting.authoritative',
      )).toMatchObject({ moves: expect.arrayContaining(['Scratch']) })
      const unassignedMoves = manifest.moves
        .filter(move => (
          move.canonicalId !== 'Scratch'
          && move.conformanceEvidence.requirementTags.length === 0
        ))
        .map(move => move.canonicalId)
      expect(groups.missingTestEvidence).toEqual([
        {
          count: unassignedMoves.length,
          evidenceCode: 'requirements-unassigned',
          moves: unassignedMoves,
          summary: 'Reviewed scenario requirement tags have not been assigned.',
        },
        {
          count: 1,
          evidenceCode: 'immunity',
          moves: ['Scratch'],
          summary: scenarioRequirementsJson.evidenceClasses.find(({ code }) => code === 'immunity')?.summary,
        },
        {
          count: 1,
          evidenceCode: 'miss',
          moves: ['Scratch'],
          summary: scenarioRequirementsJson.evidenceClasses.find(({ code }) => code === 'miss')?.summary,
        },
      ])
    })
  })

  it('keeps final completeness as a separate policy', () => {
    const result = runChecker('--require-complete', '--report')
    expect(result.status).toBe(manifestIsComplete ? 0 : 1)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Metadata validation: **PASS**')
    expect(result.stdout).toContain(`Completion requirement: **${manifestIsComplete ? 'PASS' : 'FAIL'}**`)
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
      writeBaselineScenarioFixtures(directory, ['Scratch'])

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
      const staleLegacyRuntime = staleFingerprint.moves.find(({ runtime }) => (
        runtime.kind === 'legacy-v1'
      ))
      expect(staleLegacyRuntime).toBeDefined()
      staleLegacyRuntime!.runtime.definitionHash = 'a'.repeat(64)
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
      const baselineScenarioCount = writeBaselineScenarioFixtures(directory, ['Scratch'])
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
          discoveredScenarios: baselineScenarioCount + 4,
          linkedRuntimes: currentLinkedRuntimeCount,
          runtimeDefinitionHashes: currentDefinitionHashCount,
          scenarioReferences: baselineScenarioCount + 4,
        },
      })
    })
  })
})
