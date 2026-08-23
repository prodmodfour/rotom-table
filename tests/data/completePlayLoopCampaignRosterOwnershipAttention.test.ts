import { describe, expect, it } from 'vitest'
import contract from '../../data/complete-play-loop/campaign-roster-ownership-attention.v1.json'
import { acceptedSuccessorHead, repositoryFileSha256 } from '../helpers/deferredClosureSuccessors'
import {
  CAMPAIGN_ATTENTION_ACTION_INTENTS,
  CAMPAIGN_ATTENTION_DECISION_KINDS,
  CAMPAIGN_ATTENTION_REASONS,
  CAMPAIGN_ATTENTION_SOURCE_EVENT_KINDS,
} from '../../shared/campaignAttention/model'
import {
  CAMPAIGN_EQUIPMENT_COMPATIBILITY_REASON_CODES,
  CAMPAIGN_PROFILE_LINK_LIMIT,
  CAMPAIGN_ROSTER_ENTRY_LIMIT,
  CAMPAIGN_ROSTER_OWNERSHIP_ATTENTION_LIMIT,
} from '../../server/domain/campaignAttention/rosterOwnershipDetector'
import { TRAINER_TEAM_LIMIT } from '../../src/utils/trainerPokemonLinks'

describe('P8-088 campaign roster and ownership attention evidence', () => {
  it('pins complete, bounded, read-only current authority', () => {
    expect(contract).toMatchObject({ schemaVersion: 1, ticket: 'P8-088', status: 'implemented' })
    expect(contract.limits).toEqual({
      recordsPerAuthorityCollection: CAMPAIGN_ROSTER_OWNERSHIP_ATTENTION_LIMIT,
      rosterEntriesPerTrainer: CAMPAIGN_ROSTER_ENTRY_LIMIT,
      profileLinksPerProfile: CAMPAIGN_PROFILE_LINK_LIMIT,
      projectedItems: CAMPAIGN_ROSTER_OWNERSHIP_ATTENTION_LIMIT,
    })
    expect(contract.authority).toEqual({
      completeCurrentSheets: true,
      completeHashBoundProfiles: true,
      completeSettlementSources: true,
      completeImmutableHistoryFacts: true,
      completeEggs: true,
      completeBreedingOrigins: true,
      completeBreedingOperations: true,
      exactSheetRevision: true,
      mutatesRoster: false,
      mutatesProfile: false,
      mutatesEgg: false,
      mutatesEquipment: false,
      parsesNamesOrProseForMechanics: false,
    })
  })

  it('binds capture and hatch review to immutable accepted sources', () => {
    expect(contract.capturePolicy).toEqual({
      requiresAtomicSettlementSource: true,
      requiresExactImmutableCaptureFact: true,
      requiresSameSettlementAndOperation: true,
      requiresSamePokemonSubject: true,
      requiresExactPostSettlementSheetAuthority: true,
      supportsTeamAndBoxResult: true,
      resolvedSourceRemainsTerminal: true,
      copiesCaughtBallOrReward: false,
    })
    expect(contract.hatchPolicy).toEqual({
      requiresAuthoritativeEgg: true,
      requiresSelfHashedLineage: true,
      requiresExactAcceptedCompleteHatchOperation: true,
      requiresExactChildAndOwnerSheets: true,
      requiresExactAggregateRevisions: true,
      requiresExactCommitMinute: true,
      requiresCurrentRosterOwner: true,
      automaticallyNamesChild: false,
      automaticallyMovesChild: false,
      automaticallyTransfersOwnership: false,
    })
  })

  it('keeps team, ownership, Profile, and equipment policies explicit', () => {
    expect(contract.rosterPolicy).toMatchObject({
      teamLimit: TRAINER_TEAM_LIMIT,
      exactCanonicalSlugs: true,
      teamAndBoxDisjoint: true,
      oneTrainerClaimPerAcquiredPokemon: true,
      hatchedChildMustMatchEggOwner: true,
      boxedDestinationsRemainReviewable: true,
      multipleProfilesMayShareOneTrainer: true,
    })
    expect(contract.equipmentPolicy.reasonCodes).toEqual([...CAMPAIGN_EQUIPMENT_COMPATIBILITY_REASON_CODES])
    expect(contract.equipmentPolicy).toMatchObject({
      usesStrictEquipmentState: true,
      usesCurrentReviewedCompatibility: true,
      noWriteReconciliation: true,
      unresolvedLegacyEntryRequiresReview: true,
      malformedStateIsBlocking: true,
      dynamicSuppressionOrBreakageAloneIsCompatibility: false,
    })
    expect(contract.failClosed).toEqual(expect.arrayContaining([
      'partial-read', 'duplicate-authority-identity', 'profile-hash-drift',
      'duplicate-roster-entry', 'team-box-overlap', 'duplicate-trainer-ownership',
      'missing-capture-fact', 'capture-source-fact-mismatch', 'missing-hatch-origin',
      'non-accepted-hatch-operation', 'hatch-command-result-mismatch',
      'malformed-equipment-state',
    ]))
  })

  it('uses only registered reason, decision, action, and source-event vocabulary', () => {
    const policies = [
      contract.projection.teamOverflow,
      contract.projection.captureReview,
      contract.projection.hatchReview,
      contract.projection.ownershipReview,
      contract.projection.equipmentReview,
    ]
    for (const [reason, _audience, _urgency, decision, action] of policies) {
      expect(CAMPAIGN_ATTENTION_REASONS).toContain(reason)
      expect(CAMPAIGN_ATTENTION_DECISION_KINDS).toContain(decision)
      expect(CAMPAIGN_ATTENTION_ACTION_INTENTS).toContain(action)
    }
    expect(CAMPAIGN_ATTENTION_SOURCE_EVENT_KINDS).toContain('profile-authority')
    expect(contract.projection).toMatchObject({
      profileAuthorityIsOpaque: true,
      actionsRequireFreshAuthority: true,
      actionsMutateOnNavigation: false,
    })
    expect(contract.doesNotCopy).toEqual(expect.arrayContaining([
      'character-name', 'nickname', 'roster-members', 'profile-id',
      'breeding-operation-id', 'settlement-operation-id', 'equipment-instance-id',
      'definition-hash', 'private-source-json',
    ]))
  })

  it('pins every executable, contract, test, and documentation source', () => {
    for (const source of Object.values(contract.sources)) {
      expect(source.sha256, source.path).toMatch(/^[a-f0-9]{64}$/)
      expect(acceptedSuccessorHead(source.path, source.sha256), source.path)
        .toBe(repositoryFileSha256(source.path))
    }
  })
})
