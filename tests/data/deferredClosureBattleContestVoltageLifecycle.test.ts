import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-voltage-lifecycle-certification.v1.json'
import contests from '../../data/reference/contests.json'
import reviewedMigration from '../../scripts/reviewed-data/deferred-closure-battle-contest-voltage-lifecycle.v1.json'
import { battleContestVariant, contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-072 Battle Contest Voltage lifecycle certification', () => {
  it('is one reviewed, source-hash-bound successor with exact runtime and evidence bytes', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-072', status: 'certified', runtimeProseParsing: false })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    expect(certification.reviewedMigration.sha256).toBe(sha256(certification.reviewedMigration.path))
    expect(reviewedMigration).toMatchObject({ migrationId: 'deferred-closure:battle-contest-voltage-lifecycle:v1', ticket: 'P11-072', status: 'reviewed' })
    expect(acceptedSuccessorHead(reviewedMigration.target.path, reviewedMigration.target.afterSha256)).toBe(sha256(reviewedMigration.target.path))
    for (const source of reviewedMigration.sources) expect(source.sha256).toBe(sha256(source.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('certifies exact KO, damage-over-time, recall, exception, ownership, and privacy semantics', () => {
    const battle = contests.variants.find(row => row.id === 'battle')!
    expect(battle.voltagePolicy).toEqual(reviewedMigration.voltagePolicy)
    expect(battleContestVariant.voltagePolicy).toEqual(reviewedMigration.voltagePolicy)
    expect(certification.acceptance).toMatchObject({
      attackKoDelta: 2,
      damageOverTimeKoRecipient: 'single-opposing-active-pokemon',
      recallDelta: -2,
      minimumVoltage: 0,
      maximumVoltage: 5,
      canonicalMoveExceptionCount: 3,
      reviewedJugglerProviderCount: 2,
      clientAuthoredConsequenceFields: 0,
      encounterDocumentWrites: 0,
      encounterMapWrites: 0,
      publicLifecycleAuthorityFields: 0,
      variantCompletionState: 'structured',
      nextTicket: 'P11-073',
    })
    expect(contestVariantIsNative('battle')).toBe(true)
  })
})
