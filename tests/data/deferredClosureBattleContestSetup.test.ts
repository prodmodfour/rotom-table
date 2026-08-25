import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-setup-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { contestVariantAllowsSetup, contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-066 Battle Contest setup certification', () => {
  it('continues exactly from the reviewed blend contract and binds every runtime authority', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-066', status: 'certified', runtimeProseParsing: false, predecessor: { path: 'data/deferred-closure/battle-contest-blend-certification.v1.json' } })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('preserves strict Workshop setup under the final native catalog gate', () => {
    expect(contests.variants.find(row => row.id === 'battle')).toMatchObject({ completionState: 'native', trainerCount: 2, contestTypePolicy: 'fixed-selected-at-setup', rosterPolicy: { pokemonPerTrainerMinimum: 3, pokemonPerTrainerMaximum: 6, equalDeclaredCountRequired: true }, roundBudget: { formula: 'twice-pokemon-per-trainer', minimum: 6, maximum: 12 } })
    expect(contestVariantAllowsSetup('battle')).toBe(true)
    expect(contestVariantIsNative('battle')).toBe(true)
    expect(certification.acceptance).toMatchObject({ trainerTeams: 2, pokemonPerTrainerMinimum: 3, pokemonPerTrainerMaximum: 6, roundBudgetMinimum: 6, roundBudgetMaximum: 12, clientAuthoredRoundBudget: false, clientAuthoredConsent: false, publicRawAuthorityFields: 0, setupCompletionState: 'native', variantCompletionState: 'structured', nextTicket: 'P11-067' })
  })

  it('binds an accepted two-frame storyboard with continuous legal setup state', () => {
    expect(certification.designEvidence).toMatchObject({ workflow: 'ui-design-workflow-storyboard', frames: [{ id: 'f01-gm-first-team', score: 10, hardFailures: 0 }, { id: 'f02-gm-ready', score: 9, hardFailures: 0 }], continuityReview: { status: 'accepted', hardFailures: 0 } })
    expect(sha256(certification.designEvidence.flow.path)).toBe(certification.designEvidence.flow.sha256)
    for (const frame of certification.designEvidence.frames) expect(sha256(frame.path), frame.id).toBe(frame.sha256)
    expect(sha256(certification.designEvidence.continuityReview.path)).toBe(certification.designEvidence.continuityReview.sha256)
  })

  it('records no client-authored mechanic or private public authority', () => {
    const serialized = JSON.stringify(certification).toLowerCase()
    expect(serialized).not.toContain('runtimeproseparsing":true')
    expect(certification.acceptance.clientAuthoredRoundBudget).toBe(false)
    expect(certification.acceptance.clientAuthoredConsent).toBe(false)
    expect(certification.acceptance.publicRawAuthorityFields).toBe(0)
  })
})
