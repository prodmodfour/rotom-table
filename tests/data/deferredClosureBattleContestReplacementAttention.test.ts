import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import certification from '../../data/deferred-closure/battle-contest-replacement-attention-certification.v1.json'
import contests from '../../data/reference/contests.json'
import { battleContestVariant, contestCatalog, contestVariantIsNative } from '../../shared/contests/catalog'
import { scoreContestAppealResults } from '../../shared/contests/effectResolution'
import { acceptedSuccessorHead } from '../helpers/deferredClosureSuccessors'

const sha256 = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')
const verifyBound = (row: { path: string, sha256: string }): void => expect(acceptedSuccessorHead(row.path, row.sha256), row.path).toBe(sha256(row.path))

describe('P11-073 Battle Contest replacement Center of Attention certification', () => {
  it('continues from P11-072 and binds exact Encounter, handoff, scoring, privacy, and evidence bytes', () => {
    expect(certification).toMatchObject({ schemaVersion: 1, ticket: 'P11-073', status: 'certified', runtimeProseParsing: false })
    expect(certification.predecessor.sha256).toBe(sha256(certification.predecessor.path))
    verifyBound(certification.canonicalVariantAuthority)
    for (const authority of certification.authorities) verifyBound(authority)
    for (const evidence of certification.evidence) verifyBound(evidence)
  })

  it('certifies one first-acting-turn window that reuses canonical center scoring and remains structured', () => {
    const battle = contests.variants.find(row => row.id === 'battle')!
    expect(battle.replacementPolicy).toEqual({ afterKo: 'center-of-attention-first-acting-turn' })
    expect(battleContestVariant.replacementPolicy).toEqual(battle.replacementPolicy)
    expect(scoreContestAppealResults([1, 6], 'reliable', true)).toEqual({
      appeal: contestCatalog.performance.centerScoring['6']!.appeal,
      fumble: contestCatalog.performance.centerScoring['1']!.fumble,
    })
    expect(scoreContestAppealResults([1, 6], 'reliable', false)).toEqual({
      appeal: contestCatalog.performance.normalScoring['6']!.appeal,
      fumble: contestCatalog.performance.normalScoring['1']!.fumble,
    })
    expect(certification.acceptance).toMatchObject({
      supportedKnockoutSources: ['accepted-move-ko', 'accepted-lifecycle-ko'],
      replacementSidePolicy: 'same-side-exactly-once',
      attentionWindow: 'first-authoritative-acting-turn',
      firstTurnScoringTable: 'canonical-center',
      laterTurnScoringTable: 'canonical-normal',
      clientAuthoredCenterFields: 0,
      encounterWritesFromContestEngine: 0,
      contestWritesFromEncounterEngine: 0,
      publicSourceIdentityFields: 0,
      variantCompletionState: 'structured',
      nextTicket: 'P11-074',
    })
    expect(contestVariantIsNative('battle')).toBe(true)
  })
})
