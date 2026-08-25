import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-accepted-move-appeals-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { CONTEST_OPERATION_ATOMICITY } from '../../shared/contests/architecture'
import { contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-069 Battle Contest accepted-Move Appeal certification', () => {
  it('continues exactly from the linked Encounter authority and hash-binds every runtime surface', () => {
    expect(certification).toMatchObject({
      schemaVersion: 1,
      ticket: 'P11-069',
      status: 'certified',
      runtimeProseParsing: false,
      predecessor: { path: 'data/deferred-closure/battle-contest-encounter-link-certification.v1.json' },
    })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('certifies one Contest-owned Appeal per accepted primary Move without cross-engine writes', () => {
    expect(certification.acceptance).toMatchObject({
      primaryAcceptedMoveHistoryRowsPerOperation: 1,
      abilityFollowupPrimaryHistoryRows: 0,
      scoredAppealsPerConsumedMoveFact: 1,
      missesProduceAppeal: true,
      struggleAppealRolls: 0,
      struggleContestDiceSpend: 0,
      maneuverAppealRolls: 0,
      maximumTeamDiceSpendPerAppeal: 3,
      contestRevisionStep: 1,
      exactRetryRerolls: 0,
      exactRetryAdditionalSpend: 0,
      encounterDocumentWrites: 0,
      encounterMapWrites: 0,
      clientAuthoredOutcomeFields: 0,
      battleEffectsDeferredTo: 'P11-070',
      pokemonVoltageDeferredTo: 'P11-071',
      variantCompletionState: 'structured',
      nextTicket: 'P11-070',
    })
    expect(CONTEST_OPERATION_ATOMICITY['score-battle-accepted-move']).toMatchObject({
      atomicity: 'single-sqlite-transaction',
      exactRetry: true,
      readKinds: expect.arrayContaining(['contest-document', 'encounter-document', 'encounter-map', 'encounter-scene', 'live-play-operation']),
      writeKinds: ['contest-document', 'dice-journal'],
    })
  })

  it('keeps source evidence private while preserving the historical structured certificate after native activation', () => {
    expect(contests.variants.find(row => row.id === 'battle')).toMatchObject({ completionState: 'native' })
    expect(contestVariantIsNative('battle')).toBe(true)
    expect(certification.acceptance).toMatchObject({ publicSourceIdentityFields: 0, publicHashFields: 0 })
    expect(JSON.stringify(certification).toLowerCase()).not.toContain('runtimeproseparsing":true')
  })
})
