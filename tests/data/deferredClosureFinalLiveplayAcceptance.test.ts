import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/final-liveplay-acceptance-certification.v1.json'
import golden from '../../data/deferred-closure/integrated-golden-journeys-certification.v1.json'
import inventory from '../../data/deferred-closure/closure-inventory.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'
import { isLocalUiArtifactPath, readOptionalLocalUiArtifact } from '../helpers/localUiArtifacts'

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const verifyRepositoryEvidence = (row: { path: string, sha256: string }): void => {
  expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(repositoryFileSha256(row.path))
}

interface TraceManifest {
  readonly schemaVersion: number
  readonly ticket: string
  readonly status: string
  readonly results: {
    readonly projects: readonly string[]
    readonly scheduled: number
    readonly passed: number
    readonly failed: number
    readonly traceCount: number
    readonly criticalUsabilityDefects: number
    readonly hardFailures: number
  }
  readonly traces: readonly { project: string, journey: string, path: string, sha256: string }[]
  readonly visualEvidence: readonly { path: string, sha256: string }[]
}

describe('P11-091 final desktop and mobile liveplay acceptance', () => {
  it('binds the mechanics-complete golden authority to all 29 final inventory rows', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      ticket: 'P11-091',
      status: 'accepted',
      runtimeProseParsing: false,
      mechanicsGoldenAuthority: { knownRows: 29, coveredRows: 29, hardFailures: 0 },
    })
    verifyRepositoryEvidence(certification.predecessor)
    verifyRepositoryEvidence(certification.mechanicsGoldenAuthority)

    const expected = inventory.rows.map(row => row.id).sort()
    const covered = golden.inventoryCoverage.map(row => row.rowId).sort()
    expect(covered).toEqual(expected)
    expect(new Set(covered).size).toBe(29)
    expect(golden.acceptance).toMatchObject({
      closureInventoryRowsCovered: 29,
      exactRetryAdditionalAuthority: 0,
      privateAuthorityLeaks: 0,
    })
  })

  it('accepts every user-facing cohort on desktop and mobile production liveplay', () => {
    expect(certification.cohorts.map(row => row.cohortId).sort()).toEqual([
      'battle-contests',
      'generic-skill-checks',
      'item-actions',
      'ranged-and-weapon-actions',
      'trainer-participant-contests',
    ])
    for (const cohort of certification.cohorts) {
      expect(cohort.desktop, cohort.cohortId).toBe('passed')
      expect(cohort.mobile, cohort.cohortId).toBe('passed')
      expect(cohort.productionJourney).toBeTruthy()
    }
    expect(certification.browserAcceptance).toMatchObject({
      mode: 'production-build-liveplay',
      projects: ['chromium', 'mobile-chromium'],
      workers: 1,
      traceMode: 'on',
      scheduled: 16,
      passed: 16,
      failed: 0,
      traceCount: 16,
      criticalUsabilityDefects: 0,
      seriousOrCriticalAxeViolations: 0,
      horizontalPageOverflows: 0,
      publicPrivateAuthorityLeaks: 0,
      hardFailures: 0,
    })
  })

  it('retains exact multi-client and privacy acceptance boundaries', () => {
    expect(certification.multiClientConvergence).toEqual({
      genericSkillCheck: true,
      contestGmOwnerSpectator: true,
      battleContestGmOwnerSpectator: true,
      realtimeAfterCommitOnly: true,
      optimisticScoring: false,
      duplicateAcceptedRows: 0,
      changedInputOperationReuseAccepted: false,
    })
    expect(certification.visualAndTraceEvidence).toMatchObject({
      reviewStatus: 'accepted',
      tracesAreLocalRoleAuthorizedEvidence: true,
      tracesAreRuntimeAuthority: false,
    })
    for (const row of certification.supportingCertifications) verifyRepositoryEvidence(row)
    for (const row of certification.productionJourneyEvidence) verifyRepositoryEvidence(row)
  })

  it('verifies every locally available visual and passing Playwright trace byte', () => {
    const manifestRow = certification.visualAndTraceEvidence.traceManifest
    expect(isLocalUiArtifactPath(manifestRow.path)).toBe(true)
    const manifestBytes = readOptionalLocalUiArtifact(process.cwd(), manifestRow.path)
    if (!manifestBytes) return
    expect(sha256(manifestBytes)).toBe(manifestRow.sha256)

    const manifest = JSON.parse(manifestBytes.toString('utf8')) as TraceManifest
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      ticket: 'P11-091',
      status: 'accepted',
      results: {
        projects: ['chromium', 'mobile-chromium'],
        scheduled: 16,
        passed: 16,
        failed: 0,
        traceCount: 16,
        criticalUsabilityDefects: 0,
        hardFailures: 0,
      },
    })
    expect(manifest.traces).toHaveLength(16)
    expect(new Set(manifest.traces.map(row => row.path)).size).toBe(16)
    expect(manifest.traces.filter(row => row.project === 'chromium')).toHaveLength(8)
    expect(manifest.traces.filter(row => row.project === 'mobile-chromium')).toHaveLength(8)

    for (const row of [...manifest.traces, ...manifest.visualEvidence]) {
      expect(isLocalUiArtifactPath(row.path) || row.path.startsWith('tests/e2e/')).toBe(true)
      expect(row.path).not.toContain('..')
      const bytes = row.path.startsWith('.pi/artifacts/')
        ? readOptionalLocalUiArtifact(process.cwd(), row.path)
        : readFileSync(row.path)
      if (bytes) expect(sha256(bytes), row.path).toBe(row.sha256)
    }

    for (const row of [
      certification.visualAndTraceEvidence.contactSheet,
      certification.visualAndTraceEvidence.review,
    ]) {
      const bytes = readOptionalLocalUiArtifact(process.cwd(), row.path)
      if (bytes) expect(sha256(bytes), row.path).toBe(row.sha256)
    }
  })
})
