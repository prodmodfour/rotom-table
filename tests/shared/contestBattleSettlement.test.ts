import { describe, expect, it } from 'vitest'
import {
  acceptBattleContestSettlementCoordination,
  createPreparedBattleContestSettlementCoordination,
  parseBattleContestSettlementCoordination,
} from '../../shared/contests/battleSettlement'

const prepared = () => createPreparedBattleContestSettlementCoordination({
  contestId: 'contest:v1:battle-settlement-contract',
  battleContestLinkId: 'battle-contest-link:v1:contract',
  encounterId: 'encounter:v1:battle-settlement-contract',
  mapSlug: 'battle-settlement-contract',
  encounterSettlementId: 'encounter-settlement:v1:contract',
  encounterSettlementOperationId: 'settlement-commit:v1:1800000000000:0123456789abcdef0123456789abcdef',
  expectedEncounterSettlementRevision: 3,
  encounterPlanDefinitionSha256: 'a'.repeat(64),
  contestRewardDefinitionSha256: 'b'.repeat(64),
  preparedByContestOperationId: 'contest-op:v1:battle-settlement-preview',
})

describe('Battle Contest combined settlement receipt contract', () => {
  it('binds one exact prepared Encounter plan and one accepted result with final Contest sheet writes', () => {
    const preview = prepared()
    expect(parseBattleContestSettlementCoordination(preview)).toEqual(preview)
    expect(preview).toMatchObject({
      status: 'prepared',
      acceptedByContestOperationId: null,
      encounterResultDefinitionSha256: null,
      contestSheetWrites: [],
    })

    const accepted = acceptBattleContestSettlementCoordination({
      prepared: preview,
      acceptedByContestOperationId: 'contest-op:v1:battle-settlement-commit',
      encounterResultDefinitionSha256: 'c'.repeat(64),
      encounterSettlementRevision: 4,
      encounterDocumentRevision: 9,
      encounterMapRevision: 27,
      contestSheetWrites: [
        { kind: 'pokemon', slug: 'pokemon-south-1', revision: 8, definitionSha256: 'e'.repeat(64) },
        { kind: 'trainer', slug: 'trainer-north', revision: 5, definitionSha256: 'd'.repeat(64) },
      ],
    })
    expect(parseBattleContestSettlementCoordination(accepted)).toEqual(accepted)
    expect(accepted).toMatchObject({
      status: 'accepted',
      acceptedByContestOperationId: 'contest-op:v1:battle-settlement-commit',
      encounterSettlementRevision: 4,
      encounterDocumentRevision: 9,
      encounterMapRevision: 27,
    })
    expect(accepted.contestSheetWrites.map(write => `${write.kind}:${write.slug}`)).toEqual([
      'pokemon:pokemon-south-1',
      'trainer:trainer-north',
    ])
    expect(accepted.combinedDefinitionSha256).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('rejects changed material, terminal evidence on a preview, and duplicate final sheet identities', () => {
    const preview = prepared()
    expect(() => parseBattleContestSettlementCoordination({ ...preview, encounterPlanDefinitionSha256: 'f'.repeat(64) }))
      .toThrow(/combined settlement evidence/i)
    expect(() => parseBattleContestSettlementCoordination({
      ...preview,
      acceptedByContestOperationId: 'contest-op:v1:forged',
    })).toThrow(/prepared evidence cannot retain accepted result/i)
    expect(() => acceptBattleContestSettlementCoordination({
      prepared: preview,
      acceptedByContestOperationId: 'contest-op:v1:battle-settlement-commit',
      encounterResultDefinitionSha256: 'c'.repeat(64),
      encounterSettlementRevision: 4,
      encounterDocumentRevision: 9,
      encounterMapRevision: null,
      contestSheetWrites: [
        { kind: 'pokemon', slug: 'pokemon-north-1', revision: 7, definitionSha256: 'd'.repeat(64) },
        { kind: 'pokemon', slug: 'pokemon-north-1', revision: 7, definitionSha256: 'd'.repeat(64) },
      ],
    })).toThrow(/unique final Contest sheet writes/i)
  })
})
