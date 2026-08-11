import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import resilienceCertificationJson from '../../data/breeding-automation/resilience-certification.json'
import semanticClosureJson from '../../data/breeding-automation/semantic-closure-manifest.json'
import wholeSpeciesConformanceJson from '../../data/breeding-automation/whole-species-conformance.json'
import interactionCertificationJson from '../../data/breeding-automation/interaction-certification.json'
import operationContractJson from '../../data/breeding-automation/operation-contract.json'
import rulesetJson from '../../data/breeding-automation/ruleset.json'
import { stableJsonStringify } from '../../shared/automation/stableJson'
import {
  BREEDING_OPERATION_COMMAND_KINDS,
  BREEDING_OPERATION_OUTCOME_KINDS,
} from '../../shared/breeding/operations'

const ROOT = resolve(import.meta.dirname, '../..')
const hash = (value: unknown): string => createHash('sha256').update(stableJsonStringify(value)).digest('hex')
const readJson = (path: string): Record<string, any> => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as Record<string, any>
const report = resilienceCertificationJson as Record<string, any>
const operationContract = operationContractJson as Record<string, any>
const filesBelow = (path: string): string[] => readdirSync(path, { withFileTypes: true }).flatMap(entry => (
  entry.isDirectory() ? filesBelow(join(path, entry.name)) : entry.isFile() ? [join(path, entry.name)] : []
))

const EXPECTED_DIMENSIONS = [
  'transaction-failure-injection',
  'concurrency',
  'idempotency',
  'correction',
  'abandonment',
  'disaster-recovery',
]

describe('BR-083 breeding resilience certification', () => {
  it('is self-hashed and bound to current operation, persistence, recovery, and interaction authority', () => {
    expect(report).toMatchObject({
      schemaVersion: 1,
      reportId: 'ptu-1.05-breeding-resilience-certification-v1',
      rulesetId: rulesetJson.rulesetId,
      rulesetDefinitionSha256: rulesetJson.definitionSha256,
      sourceManifestSha256: semanticClosureJson.sourceManifestSha256,
      definitionSha256: hash(report.definition),
    })
    expect(report.definition).toMatchObject({
      ticket: 'BR-083',
      status: 'certified',
      certificationScope: {
        phaseOne: 'durable-command-read-set-receipt-roll-and-offer-evidence-before-mechanics-application',
        phaseTwo: 'one-caller-owned-synchronous-transaction-for-all-aggregate-ledger-and-realtime-participants',
        exactRetry: 'same-command-and-immutable-evidence-only-no-reroll-remutation-or-republication',
        pendingRecovery: 'explicit-current-authority-only',
        randomness: 'persist-before-application-and-reuse-after-failure',
        campaignTime: 'sole-correction-cooldown-expiry-and-progress-authority',
      },
      bindings: {
        semanticClosureDefinitionSha256: semanticClosureJson.definitionSha256,
        wholeSpeciesConformanceDefinitionSha256: wholeSpeciesConformanceJson.definitionSha256,
        interactionCertificationDefinitionSha256: interactionCertificationJson.definitionSha256,
        operationContractDefinitionSha256: operationContract.definitionSha256,
        campaignOperationLedgerContractDefinitionSha256: readJson('data/breeding-automation/campaign-operation-ledger-contract.json').definitionSha256,
        transactionCoordinatorContractDefinitionSha256: readJson('data/breeding-automation/transaction-coordinator-contract.json').definitionSha256,
        persistenceConformanceContractDefinitionSha256: readJson('data/breeding-automation/persistence-conformance-contract.json').definitionSha256,
        hatchResilienceContractDefinitionSha256: readJson('data/breeding-automation/hatch-resilience-contract.json').definitionSha256,
        lifecycleRecoveryContractDefinitionSha256: readJson('data/breeding-automation/lifecycle-recovery-contract.json').definitionSha256,
        readinessCorrectionContractDefinitionSha256: readJson('data/breeding-automation/readiness-correction-contract.json').definitionSha256,
        campaignClockBatchContractDefinitionSha256: readJson('data/breeding-automation/campaign-clock-incubation-batch-contract.json').definitionSha256,
        archiveRuntimeContractDefinitionSha256: readJson('data/breeding-automation/archive-storage-runtime-contract.json').definitionSha256,
        realtimeContractDefinitionSha256: readJson('data/breeding-automation/realtime-contract.json').definitionSha256,
        eggTransferContractDefinitionSha256: readJson('data/breeding-automation/egg-transfer-contract.json').definitionSha256,
        inheritanceLearningContractDefinitionSha256: readJson('data/breeding-automation/inheritance-learning-contract.json').definitionSha256,
      },
    })
    expect(semanticClosureJson.definition.operations).toMatchObject({
      resilienceCertificationOwner: 'BR-083',
      resilienceCertificationStatus: 'certified-current-semantics',
      artifactIds: expect.arrayContaining(['breeding-resilience-certification']),
    })
  })

  it('classifies every strict command kind exactly once without promoting preview or cancellation declarations', () => {
    const coverage = report.definition.operationCoverage as Record<string, any>
    expect(coverage.commandKinds).toEqual(BREEDING_OPERATION_COMMAND_KINDS)
    expect(coverage.commandKinds).toEqual(operationContract.definition.command.commandKinds)
    expect(coverage.outcomeKinds).toEqual(BREEDING_OPERATION_OUTCOME_KINDS)
    expect(coverage.dispositions).toHaveLength(22)
    expect(coverage.dispositions.map((row: Record<string, any>) => row.commandKind)).toEqual(BREEDING_OPERATION_COMMAND_KINDS)
    expect(new Set(coverage.dispositions.map((row: Record<string, any>) => row.commandKind)).size).toBe(22)

    const byKind = new Map(coverage.dispositions.map((row: Record<string, any>) => [row.commandKind, row]))
    expect(byKind.get('preview-breeding')).toMatchObject({
      certificationStatus: 'projection-only-non-mutating',
      owningSurfaceId: 'preview-and-project-creation',
    })
    expect(byKind.get('cancel-egg')).toMatchObject({
      certificationStatus: 'declared-fail-closed-no-owning-reducer',
      owningSurfaceId: 'declared-egg-cancellation-boundary',
    })
    expect(byKind.get('recover-breeding-operation')).toMatchObject({
      certificationStatus: 'active-recovery-controller',
      owningSurfaceId: 'operation-recovery-controller',
    })
    expect(coverage.dispositions.filter((row: Record<string, any>) => row.certificationStatus === 'active-transactional-runtime')).toHaveLength(19)
    expect(coverage.dispositions.every((row: Record<string, any>) => typeof row.owningSurfaceId === 'string')).toBe(true)

    const useCaseSources = filesBelow(resolve(ROOT, 'server/useCases'))
      .filter(path => path.endsWith('.ts'))
      .map(path => readFileSync(path, 'utf8'))
      .join('\n')
    expect(useCaseSources).not.toContain("'cancel-egg'")
    expect(useCaseSources).not.toContain('"cancel-egg"')
  })

  it('closes every mutation and recovery surface with existing runtime and executable evidence', () => {
    const surfaces = report.definition.surfaces as Record<string, any>[]
    expect(surfaces).toHaveLength(13)
    expect(new Set(surfaces.map(row => row.surfaceId)).size).toBe(surfaces.length)
    const ownedKinds = surfaces.flatMap(row => row.operationKinds)
    expect(ownedKinds).toEqual(expect.arrayContaining([...BREEDING_OPERATION_COMMAND_KINDS]))
    expect(new Set(ownedKinds).size).toBe(BREEDING_OPERATION_COMMAND_KINDS.length)
    expect(ownedKinds).toHaveLength(BREEDING_OPERATION_COMMAND_KINDS.length)
    for (const surface of surfaces) {
      expect(surface.runtimePaths.length).toBeGreaterThan(0)
      expect(surface.runtimePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
      expect(surface.evidencePaths.length).toBeGreaterThan(0)
      expect(surface.evidencePaths.every((path: string) => existsSync(resolve(ROOT, path)) && path.startsWith('tests/'))).toBe(true)
      expect(surface.certifiedRecovery).toEqual(expect.any(String))
      expect(surface.certifiedRecovery.length).toBeGreaterThan(60)
    }
    expect(report.definition.atomicParticipantFamilies).toHaveLength(19)
    expect(new Set(report.definition.atomicParticipantFamilies).size).toBe(19)
    expect(report.definition.recoveryInvariants).toContain('no-accepted-partial-transaction')
    expect(report.definition.recoveryInvariants).toContain('abandonment-never-deletes-command-read-set-receipt-roll-or-offer-evidence')
    expect(report.definition.recoveryInvariants).toContain('post-commit-publication-failure-never-rolls-back-authoritative-state')
  })

  it('binds all six hazard dimensions to exact focused assertions', () => {
    expect(report.definition.dimensions).toEqual(EXPECTED_DIMENSIONS)
    const hazards = report.definition.hazardMatrix as Record<string, any>[]
    expect(hazards.map(row => row.dimension)).toEqual(EXPECTED_DIMENSIONS)
    expect(hazards.map(row => row.cases.length)).toEqual([9, 6, 10, 5, 5, 10])
    expect(hazards.flatMap(row => row.cases)).toHaveLength(45)
    const caseIds = hazards.flatMap(row => row.cases.map((entry: Record<string, any>) => entry.caseId))
    expect(new Set(caseIds).size).toBe(caseIds.length)
    for (const hazard of hazards) {
      for (const certification of hazard.cases as Record<string, any>[]) {
        const evidencePath = resolve(ROOT, certification.evidencePath)
        expect(existsSync(evidencePath), certification.caseId).toBe(true)
        const source = readFileSync(evidencePath, 'utf8')
        expect(source, `${certification.caseId}: ${certification.requiredNeedle}`).toContain(certification.requiredNeedle)
        expect(certification.expectedOutcome).toEqual(expect.any(String))
        expect(certification.expectedOutcome.length).toBeGreaterThan(10)
      }
    }
  })

  it('certifies bounded restart, replay, correction, and abandonment outcomes without overlapping BR-085', () => {
    expect(report.definition.certificationScope.deferredToBR085)
      .toBe('legacy-migration-export-import-reference-version-and-orphan-repair-release-acceptance')
    expect(report.definition.summary).toEqual({
      commandKindsCertified: 22,
      activeTransactionalCommands: 19,
      activeRecoveryControllers: 1,
      projectionOnlyCommands: 1,
      declaredFailClosedCommands: 1,
      surfacesCertified: 13,
      hazardDimensionsCertified: 6,
      hazardCasesCertified: 45,
      result: 'pass',
    })
    expect(report.definition.evidencePaths).toContain('tests/server/breedingResilienceCertification.test.ts')
    expect(report.definition.evidencePaths.every((path: string) => existsSync(resolve(ROOT, path)))).toBe(true)
    expect(new Set(report.definition.evidencePaths).size).toBe(report.definition.evidencePaths.length)
  })
})
