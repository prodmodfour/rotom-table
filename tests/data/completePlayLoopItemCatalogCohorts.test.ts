import { describe, expect, it } from 'vitest'
import certification from '../../data/complete-play-loop/item-catalog-cohort-certification.v1.json'
import registry from '../../data/complete-play-loop/item-catalog-cohorts.v1.json'
import { ITEM_CATALOG_COHORT_SCHEMA_VERSION } from '../../shared/itemAutomation/catalogCohorts'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'

describe('P8-092 canonical item catalog cohort certification', () => {
  it('pins one bounded exact assignment for the complete canonical catalog', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1, ticket: 'P8-092', status: 'implemented',
      canonicalItemCount: 349, cohortCount: 19, maximumMembersPerCohort: 32,
      runtimeProseParsing: false,
    })
    expect(ITEM_CATALOG_COHORT_SCHEMA_VERSION).toBe(1)
    expect(registry).toMatchObject({
      itemCount: certification.canonicalItemCount,
      cohortCount: certification.cohortCount,
      cohortMemberLimit: certification.maximumMembersPerCohort,
      runtimeProseParsing: false,
    })
    expect(certification.assignment).toEqual({
      exactlyOneCohortPerCanonicalRow: true,
      unknownCanonicalIdentityFails: true,
      duplicateCanonicalIdentityFails: true,
      recordOrEffectFingerprintDriftFails: true,
      cohortDecisionGrantsRuntimeMechanics: false,
    })
  })

  it('requires all six evidence dimensions on every cohort', () => {
    expect(certification.requiredEvidencePerCohort).toEqual([
      'source-fingerprint', 'provider-requirements', 'implementation-state-decision',
      'executable-or-explicit-fail-closed-evidence', 'ui-projection-evidence', 'recovery-evidence',
    ])
    for (const cohort of registry.cohorts) {
      expect(cohort.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(cohort.providerRequirements.length).toBeGreaterThan(0)
      expect(cohort.sourceEvidence.length).toBeGreaterThan(0)
      expect(cohort.executableEvidence.length).toBeGreaterThan(0)
      expect(cohort.uiProjectionEvidence.length).toBeGreaterThan(0)
      expect(cohort.recoveryEvidence.length).toBeGreaterThan(0)
    }
  })

  it('records final action-level states without reclassifying mixed equipment cohorts', () => {
    const actionRows = registry.cohorts.flatMap(cohort => cohort.members)
      .flatMap(member => member.actionFinalStates.map(action => ({ canonicalId: member.canonicalId, ...action })))
    expect(actionRows).toHaveLength(15)
    expect(new Set(actionRows.map(row => row.actionId)).size).toBe(15)
    expect(actionRows).toContainEqual({
      canonicalId: 'Old Rod', actionId: 'equipment.fishing.old-rod', finalState: 'guided',
    })
    expect(actionRows).toContainEqual({
      canonicalId: 'Weighted Nets', actionId: 'equipment.weighted-nets.pull', finalState: 'native',
    })
    expect(actionRows.every(row => row.finalState === 'native' || row.finalState === 'guided')).toBe(true)
  })

  it('records exact P8-093 closure with no blocked catalog row', () => {
    expect(certification.implementationStateCounts).toEqual({
      native: 205, guided: 40, passive: 104, blocked: 0,
    })
    expect(certification.p8093Remediation).toEqual({
      captureRows: 25, interpretiveToolRows: 34, canonicalDataDefectRows: 1,
      closedRows: 60, remainingBlockedRows: 0,
      blockedRowsMayPassFinalAcceptance: false,
    })
    expect(registry.cohorts.filter(cohort => cohort.implementationState === 'blocked')).toEqual([])
    expect(certification.failClosed).toEqual(expect.arrayContaining([
      'cohort-over-32-members', 'duplicate-cohort-or-canonical-identity',
      'missing-source-executable-ui-or-recovery-evidence',
      'blocked-decision-without-remediation', 'canonical-catalog-drift',
      'stale-generated-registry',
    ]))
  })

  it('pins every policy, generator, runtime, test, document, and rubric source', () => {
    for (const source of Object.values(certification.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      expect(acceptedSuccessorHead(source.path, source.sha256), source.path)
        .toBe(repositoryFileSha256(source.path))
    }
  })
})
