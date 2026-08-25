import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-end-conditions-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { CONTEST_OPERATION_ATOMICITY } from '../../shared/contests/architecture'
import { battleContestVariant, contestVariantIsNative } from '../../shared/contests/catalog'
import { parseContestCommand } from '../../shared/contests/operations'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-074 Battle Contest end-condition certification', () => {
  it('continues from P11-073 and binds exact end, coordination, privacy, and evidence bytes', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-074', status: 'certified', runtimeProseParsing: false })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('preserves both source-derived endings and Appeal-only winner policy after native activation', () => {
    const battle = contests.variants.find(row => row.id === 'battle')!
    expect(battle.endPolicy).toEqual({
      conditions: ['round-budget-exhausted', 'one-trainer-all-pokemon-knocked-out'],
      score: 'appeal-points',
      winner: 'highest-appeal-points',
    })
    expect(battleContestVariant.endPolicy).toEqual(battle.endPolicy)
    expect(certification.acceptance).toMatchObject({
      endConditions: battle.endPolicy.conditions,
      roundBudgetAuthority: 'immutable-setup-budget-plus-accepted-round-boundary',
      knockoutAuthority: 'accepted-canonical-ko-plus-authoritative-whole-roster-hp',
      finalScore: 'appeal-points',
      winner: 'highest-appeal-points',
      tieResolution: 'shared-journaled-placement-randomness',
      terminalReceiptsPerContest: 1,
      clientAuthoredEndMechanicsFields: 0,
      encounterWritesFromContestEngine: 0,
      contestWritesFromEncounterEngine: 0,
      publicSourceIdentityFields: 0,
      variantCompletionState: 'structured',
      nextTicket: 'P11-075',
    })
    expect(contestVariantIsNative('battle')).toBe(true)
  })

  it('declares one exact-retry transaction and rejects client-authored end mechanics fields', () => {
    expect(CONTEST_OPERATION_ATOMICITY['end-battle-contest']).toMatchObject({
      atomicity: 'single-sqlite-transaction', exactRetry: true,
      readKinds: expect.arrayContaining(['contest-document', 'encounter-document', 'encounter-map', 'encounter-scene', 'live-play-operation', 'pokemon-sheet', 'contest-catalog']),
      writeKinds: ['contest-document', 'dice-journal'],
    })
    const base = {
      schemaVersion: 1, commandKind: 'end-battle-contest', contestId: 'contest:v1:end-policy',
      operationId: 'contest-op:v1:end-policy', expectedRevision: 8, clientId: null,
      sourceOperationId: 'op_end_policy_source', sourceResultId: 'event:end-policy-source',
    }
    expect(parseContestCommand(base)).toMatchObject(base)
    for (const forged of [
      { condition: 'round-budget-exhausted' }, { round: 6 }, { score: 99 }, { winnerContestantId: 'contestant:forged' }, { pokemonHitPoints: {} },
    ]) expect(() => parseContestCommand({ ...base, ...forged })).toThrow(/not recognized/i)
  })
})
