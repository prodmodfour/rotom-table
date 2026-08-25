import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-introductions-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-067 Battle Contest Trainer-team Introduction certification', () => {
  it('continues exactly from two-Trainer setup and binds every runtime authority', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-067', status: 'certified', runtimeProseParsing: false, predecessor: { path: 'data/deferred-closure/battle-contest-setup-certification.v1.json' } })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('certifies one Introduction per Trainer, team custody, single-spend accounting, and no initiative', () => {
    expect(contests.variants.find(row => row.id === 'battle')?.introductionPolicy).toEqual({ skillCheckPerTrainer: 1, contestDicePoolScope: 'trainer-team', usableBy: 'any-team-pokemon', affectsInitiative: false })
    expect(certification.acceptance).toMatchObject({ introductionsPerTrainer: 1, poolScope: 'trainer-team', usableBy: 'any-team-pokemon', assignsContestLetters: false, matchingAppealBonus: false, exactRetry: true, changedRetryConflicts: true, opponentPoolProjectionFields: 0, introductionCompletionState: 'native', variantCompletionState: 'structured', nextTicket: 'P11-068' })
    expect(contestVariantIsNative('battle')).toBe(true)
  })

  it('binds an accepted two-frame storyboard with continuous legal pool state', () => {
    expect(certification.designEvidence).toMatchObject({ workflow: 'ui-design-workflow-storyboard', frames: [{ id: 'f01-gm-first-introduction', score: 10, hardFailures: 0 }, { id: 'f02-gm-pools-ready', score: 10, hardFailures: 0 }], continuityReview: { status: 'accepted', hardFailures: 0 } })
    expect(sha256(certification.designEvidence.flow.path)).toBe(certification.designEvidence.flow.sha256)
    for (const frame of certification.designEvidence.frames) expect(sha256(frame.path), frame.id).toBe(frame.sha256)
    expect(sha256(certification.designEvidence.continuityReview.path)).toBe(certification.designEvidence.continuityReview.sha256)
    expect(certification.liveplayEvidence).toMatchObject({ mode: 'production-liveplay', project: 'chromium', status: 'passed', seriousOrCriticalAxeViolations: 0, publicPrivateAuthorityLeaks: 0 })
    for (const screenshot of certification.liveplayEvidence.screenshots) expect(sha256(screenshot.path), screenshot.state).toBe(screenshot.sha256)
    expect(sha256(certification.liveplayEvidence.review.path)).toBe(certification.liveplayEvidence.review.sha256)
  })

  it('keeps private authority out of public evidence after native activation', () => {
    expect(certification.acceptance.publicPoolProjectionFields).toBe(0)
    expect(certification.acceptance.opponentPoolProjectionFields).toBe(0)
    expect(certification.acceptance.publicOperationIdFields).toBe(0)
    expect(JSON.stringify(certification).toLowerCase()).not.toContain('runtimeproseparsing":true')
  })
})
