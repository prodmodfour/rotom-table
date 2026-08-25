import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-encounter-link-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { contestVariantIsNative } from '../../shared/contests/catalog'
import { CONTEST_OPERATION_ATOMICITY } from '../../shared/contests/architecture'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-068 Battle Contest Encounter-link certification', () => {
  it('continues exactly from Trainer-team Introductions and binds both existing authorities', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-068', status: 'certified', runtimeProseParsing: false, predecessor: { path: 'data/deferred-closure/battle-contest-introductions-certification.v1.json' } })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('certifies one server-derived normal opening and one all-or-none cross-authority revision step', () => {
    expect(contests.variants.find(row => row.id === 'battle')).toMatchObject({ completionState: 'native', trainerCount: 2, rosterPolicy: { pokemonPerTrainerMinimum: 3, pokemonPerTrainerMaximum: 6 } })
    expect(certification.acceptance).toMatchObject({ trainerTeams: 2, openingTrainers: 2, openingActivePokemon: 2, pokemonPerTrainerMinimum: 3, pokemonPerTrainerMaximum: 6, openingRound: 1, speedDerivedInitiative: true, activeScene: true, mapInteractionMode: 'live-play', contestRevisionStep: 1, encounterDocumentInitialRevision: 0, mapInitialRevision: 0, exactRetry: true, changedRetryConflicts: true, atomicRollback: true, setupWholeMapWritesAfterActivation: 0, encounterLinkCompletionState: 'native', variantCompletionState: 'structured', nextTicket: 'P11-069' })
    expect(CONTEST_OPERATION_ATOMICITY['create-battle-encounter']).toMatchObject({ atomicity: 'single-sqlite-transaction', exactRetry: true })
    expect(CONTEST_OPERATION_ATOMICITY['create-battle-encounter'].writeKinds).toEqual(expect.arrayContaining(['contest-document', 'encounter-document', 'encounter-map', 'encounter-scene', 'encounter-initiative']))
    expect(contestVariantIsNative('battle')).toBe(true)
  })

  it('binds accepted target frames and production desktop/narrow liveplay evidence', () => {
    expect(certification.designEvidence).toMatchObject({ workflow: 'ui-design-workflow-storyboard', frames: [{ id: 'f01-gm-ready-to-link', score: 10, hardFailures: 0 }, { id: 'f02-gm-linked', score: 10, hardFailures: 0 }], continuityReview: { status: 'accepted', hardFailures: 0 } })
    verifyBound(certification.designEvidence.flow)
    for (const frame of certification.designEvidence.frames) verifyBound(frame)
    verifyBound(certification.designEvidence.continuityReview)
    verifyBound(certification.designEvidence.contactSheet)
    expect(certification.liveplayEvidence).toMatchObject({ mode: 'production-liveplay', project: 'chromium', status: 'passed', seriousOrCriticalAxeViolations: 0, publicPrivateAuthorityLeaks: 0, maximumNarrowPageWidth: 322 })
    for (const screenshot of certification.liveplayEvidence.screenshots) verifyBound(screenshot)
    verifyBound(certification.liveplayEvidence.review)
  })

  it('keeps client mechanics and private binding evidence out of public authority', () => {
    expect(certification.acceptance).toMatchObject({ clientAuthoredMapFields: 0, clientAuthoredPlacementFields: 0, clientAuthoredInitiativeFields: 0, publicRawBindingFields: 0, publicSheetFields: 0, publicPoolFields: 0, publicOperationIdFields: 0 })
    const serialized = JSON.stringify(certification).toLowerCase()
    expect(serialized).not.toContain('runtimeproseparsing":true')
  })
})
