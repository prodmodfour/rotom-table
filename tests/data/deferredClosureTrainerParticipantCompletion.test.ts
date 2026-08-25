import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import integrations from '../../data/deferred-closure/trainer-participant-integrations-certification.v1.json'
import projections from '../../data/deferred-closure/trainer-participant-projection-certification.v1.json'
import settlement from '../../data/deferred-closure/trainer-participant-settlement-certification.v1.json'
import cockpit from '../../data/deferred-closure/trainer-participant-cockpit-certification.v1.json'
import matrix from '../../data/deferred-closure/trainer-participant-variant-matrix-certification.v1.json'
import activation from '../../data/deferred-closure/trainer-participant-activation-certification.v1.json'
import contests from '../../data/reference/contests.json'
import integrationCoverage from '../../data/contests/integration-coverage.v1.json'
import { contestParticipantVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const certifications = [integrations, projections, settlement, cockpit, matrix, activation]

const verifyBoundRows = (rows: readonly { path: string, sha256: string }[]): void => {
  for (const row of rows) expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))
}

describe('P11-059 through P11-064 Trainer Participant completion', () => {
  it('keeps one contiguous certified predecessor chain', () => {
    expect(certifications.map(row => row.ticket)).toEqual(['P11-059','P11-060','P11-061','P11-062','P11-063','P11-064'])
    expect(certifications.every(row => row.schemaVersion === 1 && row.status === 'certified' && row.runtimeProseParsing === false)).toBe(true)
    for (let index = 1; index < certifications.length; index += 1) {
      const predecessor = certifications[index]!.predecessor
      const priorPath = [
        'data/deferred-closure/trainer-participant-integrations-certification.v1.json',
        'data/deferred-closure/trainer-participant-projection-certification.v1.json',
        'data/deferred-closure/trainer-participant-settlement-certification.v1.json',
        'data/deferred-closure/trainer-participant-cockpit-certification.v1.json',
        'data/deferred-closure/trainer-participant-variant-matrix-certification.v1.json',
      ][index - 1]!
      expect(predecessor.path).toBe(priorPath)
      expect(predecessor.sha256).toBe(sha256(priorPath))
    }
    expect(integrations.predecessor.sha256).toBe(sha256(integrations.predecessor.path))
  })

  it('hash-binds every repository authority and runtime evidence surface', () => {
    for (const certification of certifications) {
      verifyBoundRows(certification.authorities)
      if ('canonicalVariantAuthority' in certification) verifyBoundRows([certification.canonicalVariantAuthority])
      if ('evidence' in certification) verifyBoundRows(certification.evidence)
    }
    for (const row of activation.cohortCertifications) expect(sha256(row.path), row.ticket).toBe(row.sha256)
  })

  it('records accepted target-state design evidence without treating it as runtime authority', () => {
    expect(cockpit.designEvidence).toMatchObject({ workflow: 'ui-design-workflow', review: { score: 10, hardFailures: 0, status: 'accepted' } })
    for (const row of [cockpit.designEvidence.targetState, cockpit.designEvidence.review]) expect(sha256(row.path), row.path).toBe(row.sha256)
    const png = readFileSync(cockpit.designEvidence.targetState.path)
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual(cockpit.designEvidence.targetState.viewport)
  })

  it('activates the canonical row only after integrations, projections, settlement, cockpit, and matrix closure', () => {
    const row = contests.variants.find(candidate => candidate.id === 'trainer-participant')!
    expect(row).toMatchObject({ completionState: 'native', structuredSemanticsVersion: 1, compatibleBaseVariantIds: ['standard','supercontest','festival','rotation'] })
    expect(contestParticipantVariantIsNative('trainer-participant')).toBe(true)
    expect(contestParticipantVariantIsNative('battle')).toBe(false)
    expect(integrationCoverage.trainerParticipantCoverage).toMatchObject({ ticket: 'P11-059', status: 'native', coveredRows: 44, ordinaryFeatureAndAbilityLedgersReused: true, runtimeProseParsing: false })
    expect(activation.acceptance).toMatchObject({ completionState: 'native', normalIntegrationRows: 44, deterministicScenarios: 24, blockedCanonicalRows: 0, participantProgressionGates: 0, nextTicket: 'P11-065' })
  })
})
