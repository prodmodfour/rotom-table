import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-single-spend-certification.v1.json'
import fixtures from '../../data/deferred-closure/failure-recovery-fixtures.v1.json'
import { contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-075 Battle Contest single-spend and convergent-randomness certification', () => {
  it('continues from P11-074 and hash-binds both engines, the accounting gate, fixtures, documentation, and evidence', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-075', status: 'certified', runtimeProseParsing: false })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verifyBound(certification.failureFixtureAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('certifies exact frequency, action, Contest Dice, and journal convergence under duplicate delivery and reconnect', () => {
    expect(certification.acceptance).toEqual({
      encounterOperationCountPerMove: 1,
      trackedFrequencySpendDelta: 1,
      untrackedFrequencySpendDelta: 0,
      actionResourceSpendDelta: 1,
      contestAppealsPerPokemonMove: 1,
      contestAppealsPerCanonicalExclusion: 0,
      teamDiceReceiptsPerSpendingAppeal: 1,
      duplicateDeliveryAdditionalRandomDraws: 0,
      reconnectAdditionalRandomDraws: 0,
      divergenceCode: 'battle-contest.accounting-divergence',
      convergenceProofPersistence: 'recomputable-from-existing-immutable-journals-and-hashes',
      encounterWritesFromContestEngine: 0,
      contestWritesFromEncounterEngine: 0,
      publicAccountingFields: 0,
      variantCompletionState: 'structured',
      nextTicket: 'P11-076',
    })
    const ids = new Set(fixtures.battleContestDualEngineFixtures.map(row => row.scenarioId))
    for (const scenarioId of certification.failureFixtureAuthority.scenarioIds) expect(ids.has(scenarioId), scenarioId).toBe(true)
    expect(fixtures.policies).toMatchObject({ serverOwnsRandomness: true, operationKey: 'operation-id-plus-command-hash', revisionPolicy: 'exact-read-set-before-write' })
    expect(contestVariantIsNative('battle')).toBe(true)
  })
})
