import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-effects-certification.v1.json'
import contests from '../../data/reference/contests.json'
import reviewedMigration from '../../scripts/reviewed-data/deferred-closure-battle-contest-effects.v1.json'
import { battleContestVariant, contestCatalog, contestVariantIsNative } from '../../shared/contests/catalog'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-070 Battle Contest Effect certification', () => {
  it('is source-hash-bound to one reviewed canonical migration and its predecessor', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-070', status: 'certified', runtimeProseParsing: false })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    expect(certification.reviewedMigration.sha256).toBe(sha256(certification.reviewedMigration.path))
    expect(reviewedMigration).toMatchObject({ migrationId: 'deferred-closure:battle-contest-effects:v1', ticket: 'P11-070', status: 'reviewed' })
    expect(acceptedSuccessorHead(reviewedMigration.target.path, reviewedMigration.target.afterSha256)).toBe(sha256(reviewedMigration.target.path))
    for (const source of reviewedMigration.sources) expect(source.sha256).toBe(sha256(source.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('covers every canonical handler and exact linked-map Battle target policy', () => {
    const battle = contests.variants.find(row => row.id === 'battle')!
    expect(battle.contestEffectPolicy).toEqual(reviewedMigration.contestEffectPolicy)
    expect(battleContestVariant.contestEffectPolicy.supportedEffectIds).toEqual(contestCatalog.contestEffects.map(effect => effect.id))
    expect(certification.acceptance).toMatchObject({
      canonicalEffectHandlers: 22,
      unsupportedCanonicalEffects: 0,
      minimumOpposingOnFieldPokemon: 1,
      maximumOpposingOnFieldPokemon: 6,
      actorVoltageTargetScope: 'acting-pokemon',
      adjacentVoltageTargetScope: 'all-opposing-on-field-pokemon',
      indirectFumbleTargetScope: 'opposing-trainer-team',
      clientAuthoredAdjacencyFields: 0,
      encounterDocumentWrites: 0,
      encounterMapWrites: 0,
      legacyAppealsRescored: 0,
      variantCompletionState: 'structured',
      nextTicket: 'P11-071',
    })
    expect(contestVariantIsNative('battle')).toBe(true)
  })
})
