import { describe, expect, it } from 'vitest'
import creationFixtures from '../../data/onboarding/fixtures/creation-fixtures.json'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteOnboardingRepository } from '../../server/storage/onboardingRepository'
import {
  acknowledgeOnboardingCorrectionUseCase,
  applyOnboardingCorrectionUseCase,
} from '../../server/useCases/onboardingCorrections'
import { approveOnboardingSubmissionUseCase } from '../../server/useCases/onboardingApproval'
import { submitOnboardingDraftUseCase } from '../../server/useCases/onboardingSubmission'
import {
  createOnboardingSlotUseCase,
  publishOnboardingPolicyUseCase,
  saveOnboardingDraftUseCase,
} from '../../server/useCases/onboardingWorkflows'
import {
  CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
  parseCampaignOnboardingPolicyContent,
} from '../../shared/onboarding/policy'
import type { LinkedCharacterRef, PlayerProfile } from '../../shared/playerProfiles'

const PROFILE = {
  schemaVersion: 1,
  id: 'profile_correctuser1',
  displayName: 'Correction Tester',
  linkedCharacters: [],
} as unknown as PlayerProfile

const OTHER = {
  schemaVersion: 1,
  id: 'profile_otheruser99',
  displayName: 'Other',
  linkedCharacters: [],
} as unknown as PlayerProfile

const fixture = creationFixtures.fixtures.find(entry => entry.fixtureId === 'default-level1-single-starter')!

const policyContent = () => {
  const raw = fixture.policy as Record<string, any>
  return parseCampaignOnboardingPolicyContent({
    schemaVersion: CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
    trainer: {
      startingLevel: raw.trainer.startingLevel,
      startingMoney: { kind: 'canonical-baseline' },
      featureRestriction: { mode: 'all-canonical' },
      edgeRestriction: { mode: 'all-canonical' },
      milestoneCollection: 'during-onboarding',
    },
    pokemon: {
      starterCount: raw.pokemon.starterCount,
      starterLevel: raw.pokemon.starterLevel,
      starterPool: { mode: 'any-canonical' },
      stageRestriction: 'unrestricted',
      additionalMoveSources: [],
      startingLoyalty: { kind: 'canonical-baseline' },
      caughtBallPolicy: 'standard-metadata',
    },
    packages: { trainerItems: [], starterHeldItems: [] },
    workflow: {
      unresolvedChoicePolicy: 'all-required-resolved',
      deferrableDecisions: [],
      approval: 'gm-review-required',
      destinations: { trainerFolder: 'players', pokemonFolder: 'players' },
    },
  })
}

const harness = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  const repository = createSqliteOnboardingRepository(database)
  const profileState = { profile: { ...PROFILE, linkedCharacters: [] as LinkedCharacterRef[] } }
  const dependencies = {
    repository,
    readProfile: () => profileState.profile as PlayerProfile,
    applyProfileLinks: (_: string, refs: readonly LinkedCharacterRef[]) => {
      profileState.profile = {
        ...profileState.profile,
        linkedCharacters: [...profileState.profile.linkedCharacters, ...refs],
      }
    },
    publishSlotChanged: () => {},
    publishDraftChanged: () => {},
    publishPolicyPublished: () => {},
  }
  publishOnboardingPolicyUseCase({ role: 'gm', content: policyContent(), display: { name: 'Corrections' } }, dependencies)
  const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE.id }, dependencies)

  const raw = fixture.trainerBuild as Record<string, any>
  const document = {
    ...(created.draft.draft as unknown as Record<string, any>),
    trainerBuild: {
      name: raw.name,
      identity: {},
      statAllocation: raw.statAllocation,
      background: raw.background,
      trainingFeatureId: raw.trainingFeature,
      edges: raw.edges.map((edge: any, index: number) => ({
        entryId: `edge-${index + 1}`, canonicalId: edge.name, grantLevel: null, choices: edge.choices ?? {},
      })),
      features: raw.features.map((feature: any, index: number) => ({
        entryId: `feature-${index + 1}`, canonicalId: feature.name, isClassAnchor: feature.isClassAnchor === true, choices: feature.choices ?? {},
      })),
      milestoneChoices: [],
    },
    pokemonBuilds: (fixture.pokemonBuilds as Record<string, any>[]).map((build, index) => ({
      buildId: `starter-${index + 1}`,
      speciesId: build.species,
      nickname: build.nickname,
      natureId: build.nature,
      gender: build.gender,
      abilityIds: build.abilities,
      moveIds: build.moves,
      addedStats: build.addedStats,
      heldItemId: null,
      caughtBallId: null,
      teamSlot: build.teamSlot,
    })),
    deferredDecisions: [],
  }
  const saved = saveOnboardingDraftUseCase({
    role: 'player', profile: profileState.profile as PlayerProfile,
    draftId: created.draft.draft.draftId, expectedRevision: 0, document,
  }, dependencies)
  submitOnboardingDraftUseCase({
    role: 'player', profile: profileState.profile as PlayerProfile,
    draftId: created.draft.draft.draftId, expectedRevision: saved.revision, operationId: 'onbop_submit-corr',
  }, dependencies)
  return { database, repository, dependencies, created, profileState }
}

describe('bounded GM corrections and acknowledgement (P9-055)', () => {
  it('applies a receipt-backed rename, creates a new immutable submission, and gates approval on acknowledgement', () => {
    const { database, repository, dependencies, created, profileState } = harness()
    const draftId = created.draft.draft.draftId

    const corrected = applyOnboardingCorrectionUseCase({
      role: 'gm',
      draftId,
      submissionRevision: 1,
      scope: 'trainer-name',
      value: 'Rowan the Renamed',
      rationale: 'Name collides with an existing NPC.',
      requiresAcknowledgement: true,
      operationId: 'onbop_correct-1',
    }, dependencies)
    expect(corrected.submissionRevision).toBe(2)

    /* Both snapshots retained; the new one carries the corrected value. */
    expect(repository.listSubmissions(draftId)).toHaveLength(2)
    expect(repository.getSubmission(draftId, 1)!.snapshot.trainerBuild.name).toBe('Rowan Vale')
    expect(repository.getSubmission(draftId, 2)!.snapshot.trainerBuild.name).toBe('Rowan the Renamed')

    /* Receipt visible to the player with before/after. */
    const playerEntries = repository.listReviewEntries(draftId)
    const receipt = playerEntries.find(entry => entry.kind === 'correction')!
    expect(receipt.payload).toMatchObject({
      scope: 'trainer-name',
      before: 'Rowan Vale',
      after: 'Rowan the Renamed',
      requiresAcknowledgement: true,
    })

    /* Approval blocked until acknowledged. */
    expect(() => approveOnboardingSubmissionUseCase({
      role: 'gm', draftId, submissionRevision: 2, confirmDeviations: false, operationId: 'onbop_approve-corr',
    }, dependencies)).toThrow(/acknowledgement/)

    /* Unrelated players cannot acknowledge. */
    expect(() => acknowledgeOnboardingCorrectionUseCase({
      role: 'player', profile: OTHER, draftId, correctionEntryId: receipt.entryId, operationId: 'onbop_ack-x',
    }, dependencies)).toThrow(/not found/i)

    acknowledgeOnboardingCorrectionUseCase({
      role: 'player', profile: profileState.profile as PlayerProfile,
      draftId, correctionEntryId: receipt.entryId, operationId: 'onbop_ack-1',
    }, dependencies)

    const approved = approveOnboardingSubmissionUseCase({
      role: 'gm', draftId, submissionRevision: 2, confirmDeviations: false, operationId: 'onbop_approve-corr-2',
    }, dependencies)
    expect(approved.ok).toBe(true)

    /* The committed sheet carries the corrected name. */
    const trainerRow = database.connection.prepare(
      "SELECT document_json FROM sheets WHERE kind = 'trainer'",
    ).get() as { document_json: string }
    expect(JSON.parse(trainerRow.document_json).name).toBe('Rowan the Renamed')
    database.close()
  })

  it('rejects corrections that would break hard invariants or wrong review targets', () => {
    const { database, dependencies, created } = harness()
    const draftId = created.draft.draft.draftId

    // Clearing a Trainer name is never a legal correction.
    expect(() => applyOnboardingCorrectionUseCase({
      role: 'gm', draftId, submissionRevision: 1, scope: 'trainer-name', value: null,
      rationale: 'x', requiresAcknowledgement: false, operationId: 'onbop_correct-null',
    }, dependencies)).toThrow(/replacement/)

    // Stale submission target conflicts.
    expect(() => applyOnboardingCorrectionUseCase({
      role: 'gm', draftId, submissionRevision: 7, scope: 'trainer-name', value: 'X',
      rationale: 'x', requiresAcknowledgement: false, operationId: 'onbop_correct-stale',
    }, dependencies)).toThrow(/submission 1/)

    // Player role cannot correct.
    expect(() => applyOnboardingCorrectionUseCase({
      role: 'player', draftId, submissionRevision: 1, scope: 'trainer-name', value: 'X',
      rationale: 'x', requiresAcknowledgement: false, operationId: 'onbop_correct-role',
    }, dependencies)).toThrow(/GM role/)

    // Out-of-range starter index.
    expect(() => applyOnboardingCorrectionUseCase({
      role: 'gm', draftId, submissionRevision: 1, scope: 'pokemon-nickname', buildIndex: 9, value: 'X',
      rationale: 'x', requiresAcknowledgement: false, operationId: 'onbop_correct-idx',
    }, dependencies)).toThrow(/buildIndex/)
    database.close()
  })

  it('replays correction and acknowledgement operations exactly', () => {
    const { database, repository, dependencies, created, profileState } = harness()
    const draftId = created.draft.draft.draftId

    const first = applyOnboardingCorrectionUseCase({
      role: 'gm', draftId, submissionRevision: 1, scope: 'pokemon-nickname', buildIndex: 0, value: 'Sproutling',
      rationale: 'Tone', requiresAcknowledgement: false, operationId: 'onbop_correct-replay',
    }, dependencies)
    const replay = applyOnboardingCorrectionUseCase({
      role: 'gm', draftId, submissionRevision: 1, scope: 'pokemon-nickname', buildIndex: 0, value: 'Sproutling',
      rationale: 'Tone', requiresAcknowledgement: false, operationId: 'onbop_correct-replay',
    }, dependencies)
    expect(replay).toEqual(first)
    expect(repository.listSubmissions(draftId)).toHaveLength(2)

    // Same op ID with different material conflicts.
    expect(() => applyOnboardingCorrectionUseCase({
      role: 'gm', draftId, submissionRevision: 2, scope: 'pokemon-nickname', buildIndex: 0, value: 'Else',
      rationale: 'Tone', requiresAcknowledgement: false, operationId: 'onbop_correct-replay',
    }, dependencies)).toThrow(/different material/)

    // Acknowledgement of a non-required correction is idempotent and harmless.
    const receipt = repository.listReviewEntries(draftId).find(entry => entry.kind === 'correction')!
    const ackFirst = acknowledgeOnboardingCorrectionUseCase({
      role: 'player', profile: profileState.profile as PlayerProfile,
      draftId, correctionEntryId: receipt.entryId, operationId: 'onbop_ack-replay',
    }, dependencies)
    const ackReplay = acknowledgeOnboardingCorrectionUseCase({
      role: 'player', profile: profileState.profile as PlayerProfile,
      draftId, correctionEntryId: receipt.entryId, operationId: 'onbop_ack-replay',
    }, dependencies)
    expect(ackReplay).toEqual(ackFirst)
    database.close()
  })
})
