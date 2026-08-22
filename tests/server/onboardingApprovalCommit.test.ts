import { describe, expect, it } from 'vitest'
import creationFixtures from '../../data/onboarding/fixtures/creation-fixtures.json'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteOnboardingRepository } from '../../server/storage/onboardingRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  approveOnboardingSubmissionUseCase,
  loadOnboardingReviewUseCase,
  requestOnboardingChangesUseCase,
} from '../../server/useCases/onboardingApproval'
import { submitOnboardingDraftUseCase } from '../../server/useCases/onboardingSubmission'
import {
  createOnboardingSlotUseCase,
  publishOnboardingPolicyUseCase,
  saveOnboardingDraftUseCase,
} from '../../server/useCases/onboardingWorkflows'
import { onboardingCreationCatalog } from '../../shared/onboarding/catalog'
import {
  CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
  parseCampaignOnboardingPolicyContent,
} from '../../shared/onboarding/policy'
import type { LinkedCharacterRef, PlayerProfile } from '../../shared/playerProfiles'
import { computeTrainerFormulaMaxHp } from '../../src/utils/ptuHp'
import { resolveTrainerStats } from '../../src/utils/sheets/trainerDerived'

type CreationFixture = (typeof creationFixtures)['fixtures'][number]

const PROFILE = {
  schemaVersion: 1,
  id: 'profile_commituser1',
  displayName: 'Commit Tester',
  linkedCharacters: [],
} as unknown as PlayerProfile

const fixtureById = (id: string): CreationFixture =>
  creationFixtures.fixtures.find(fixture => fixture.fixtureId === id)!

const policyContentFromFixture = (fixture: CreationFixture) => {
  const raw = fixture.policy as Record<string, any>
  return parseCampaignOnboardingPolicyContent({
    schemaVersion: CAMPAIGN_ONBOARDING_POLICY_SCHEMA_VERSION,
    trainer: {
      startingLevel: raw.trainer.startingLevel,
      startingMoney: raw.trainer.startingMoney === 'canonical-baseline'
        ? { kind: 'canonical-baseline' }
        : { kind: 'explicit', amount: raw.trainer.startingMoney },
      featureRestriction: { mode: 'all-canonical' },
      edgeRestriction: { mode: 'all-canonical' },
      milestoneCollection: raw.trainer.milestoneCollection ?? 'during-onboarding',
    },
    pokemon: {
      starterCount: raw.pokemon.starterCount,
      starterLevel: raw.pokemon.starterLevel,
      starterPool: raw.pokemon.starterPool.mode === 'curated-list'
        ? { mode: 'curated-list', speciesIds: raw.pokemon.starterPool.species }
        : { mode: 'any-canonical' },
      stageRestriction: 'unrestricted',
      additionalMoveSources: [],
      startingLoyalty: { kind: 'canonical-baseline' },
      caughtBallPolicy: raw.pokemon.caughtBallPolicy ?? 'standard-metadata',
    },
    packages: {
      trainerItems: raw.packages.trainerItems ?? [],
      starterHeldItems: raw.packages.starterHeldItems ?? [],
    },
    workflow: {
      unresolvedChoicePolicy: raw.workflow.unresolvedChoicePolicy,
      deferrableDecisions: raw.workflow.deferrableDecisions ?? [],
      approval: raw.workflow.approval,
      destinations: raw.workflow.destinations,
    },
  })
}

const draftDocumentFromFixture = (fixture: CreationFixture, baseDraft: Record<string, any>) => {
  const raw = fixture.trainerBuild as Record<string, any>
  return {
    ...baseDraft,
    trainerBuild: {
      name: raw.name,
      identity: {},
      statAllocation: raw.statAllocation,
      background: raw.background,
      trainingFeatureId: raw.trainingFeature,
      edges: [
        ...raw.edges.map((edge: any, index: number) => ({
          entryId: `edge-${index + 1}`,
          canonicalId: edge.name,
          grantLevel: null,
          choices: edge.choices ?? {},
        })),
        ...(raw.bonusSkillEdges ?? []).map((edge: any, index: number) => ({
          entryId: `bonus-${index + 1}`,
          canonicalId: edge.name,
          grantLevel: edge.grantLevel,
          choices: edge.choices ?? {},
        })),
      ],
      features: raw.features.map((feature: any, index: number) => ({
        entryId: `feature-${index + 1}`,
        canonicalId: feature.name,
        isClassAnchor: feature.isClassAnchor === true,
        choices: feature.choices ?? {},
      })),
      milestoneChoices: raw.milestoneChoices ?? [],
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
      heldItemId: build.heldItem,
      caughtBallId: null,
      teamSlot: build.teamSlot,
    })),
    deferredDecisions: (fixture as Record<string, any>).deferredDecisions ?? [],
  }
}

const harness = (fixtureId: string) => {
  const database = openRotomDatabase({ path: ':memory:' })
  const repository = createSqliteOnboardingRepository(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const profileState = { profile: { ...PROFILE, linkedCharacters: [] as LinkedCharacterRef[] } }

  const dependencies = {
    repository,
    readProfile: () => profileState.profile as PlayerProfile,
    listProfiles: () => [profileState.profile as PlayerProfile],
    applyProfileLinks: (profileId: string, refs: readonly LinkedCharacterRef[]) => {
      void profileId
      profileState.profile = {
        ...profileState.profile,
        linkedCharacters: [...profileState.profile.linkedCharacters, ...refs],
      }
    },
    publishSlotChanged: () => {},
    publishDraftChanged: () => {},
    publishPolicyPublished: () => {},
  }

  const fixture = fixtureById(fixtureId)
  publishOnboardingPolicyUseCase({
    role: 'gm',
    content: policyContentFromFixture(fixture),
    display: { name: fixture.title },
  }, dependencies)

  const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE.id }, dependencies)
  const document = draftDocumentFromFixture(fixture, created.draft.draft as unknown as Record<string, any>)
  const saved = saveOnboardingDraftUseCase({
    role: 'player',
    profile: profileState.profile as PlayerProfile,
    draftId: created.draft.draft.draftId,
    expectedRevision: 0,
    document,
  }, dependencies)

  return { database, repository, sheetRepository, dependencies, fixture, created, saved, profileState }
}

describe('onboarding submission, review, and atomic approval (P9-051..P9-059)', () => {
  it('runs the default fixture from draft to committed package with exact retry', () => {
    const { database, repository, sheetRepository, dependencies, fixture, created, saved, profileState } = harness('default-level1-single-starter')

    const submitted = submitOnboardingDraftUseCase({
      role: 'player',
      profile: profileState.profile as PlayerProfile,
      draftId: created.draft.draft.draftId,
      expectedRevision: saved.revision,
      operationId: 'onbop_submit-1',
    }, dependencies)
    expect(submitted.submissionRevision).toBe(1)
    expect(submitted.validation.blockingCount).toBe(0)

    // Exact submit retry replays without a second snapshot.
    const submitReplay = submitOnboardingDraftUseCase({
      role: 'player',
      profile: profileState.profile as PlayerProfile,
      draftId: created.draft.draft.draftId,
      expectedRevision: saved.revision,
      operationId: 'onbop_submit-1',
    }, dependencies)
    expect(submitReplay.submissionRevision).toBe(1)
    expect(repository.listSubmissions(created.draft.draft.draftId)).toHaveLength(1)

    const review = loadOnboardingReviewUseCase({ role: 'gm', draftId: created.draft.draft.draftId }, dependencies)
    expect(review.validation.submittable).toBe(true)
    expect(review.deviationsRequiringConfirmation).toHaveLength(0)
    expect(review.planPreview.writeSet.sheets).toHaveLength(2)
    expect(review.planPreview.writeSet.team.currentTeam).toHaveLength(1)

    const approved = approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: false,
      operationId: 'onbop_approve-1',
    }, dependencies)
    expect(approved.ok).toBe(true)
    expect(approved.profileLinksApplied).toBe(true)

    /* The committed package is ordinary sheet authority. */
    const trainer = sheetRepository.getByRef('trainer', approved.trainerSlug)
    expect(trainer).not.toBeNull()
    const trainerSheet = trainer!.sheet as Record<string, any>
    expect(trainerSheet.name).toBe(fixture.trainerBuild.name)
    expect(trainerSheet.level).toBe(1)
    expect(trainerSheet.trainingFeature).toBe('Focused Training')
    expect(trainerSheet.currentTeam).toEqual(approved.pokemonSlugs)
    expect(trainerSheet.money).toBe(5000)
    expect(trainerSheet.classes).toEqual([{ name: 'Ace Trainer' }])

    // Runtime derivation parity with the fixture preview (no onboarding-only math).
    const stats = resolveTrainerStats(trainerSheet as never)
    const hpRow = stats.find(stat => stat.key === 'hp')!
    expect(computeTrainerFormulaMaxHp(trainerSheet.level, hpRow.baseTotal))
      .toBe(fixture.expected.derivedPreview.trainer.maxHp)

    const pokemon = sheetRepository.getByRef('pokemon', approved.pokemonSlugs[0]!)
    expect(pokemon).not.toBeNull()
    const pokemonSheet = pokemon!.sheet as Record<string, any>
    expect(pokemonSheet.species).toBe('Bulbasaur')
    expect(pokemonSheet.level).toBe(5)
    expect(pokemonSheet.loyalty).toBe(2)
    expect(pokemonSheet.caughtBall).toBe('Basic Ball')
    expect((pokemonSheet.movelist as { name: string }[]).map(move => move.name)).toEqual(['Tackle', 'Growl'])
    expect((pokemonSheet.abilities as { name: string }[]).map(ability => ability.name)).toEqual(['Overgrow'])

    /* Profile links, slot closure, completion, and lifecycle. */
    expect(profileState.profile.linkedCharacters).toHaveLength(2)
    expect(repository.getSlot(created.slot.slotId)?.status).toBe('completed')
    expect(repository.getDraft(created.draft.draft.draftId)?.state).toBe('completed')
    const completion = repository.getCompletionBySlot(created.slot.slotId)
    expect(completion?.refs.profileLinksApplied).toBe(true)

    /* Exact approve retry returns the original result and creates nothing new. */
    const replay = approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: false,
      operationId: 'onbop_approve-1',
    }, dependencies)
    expect(replay.completionRecordId).toBe(approved.completionRecordId)
    expect(profileState.profile.linkedCharacters).toHaveLength(2)
    expect(sheetRepository.list('trainer')).toHaveLength(1)
    expect(sheetRepository.list('pokemon')).toHaveLength(1)

    /* Durable completion events exist for both audiences. */
    const events = database.connection.prepare(
      "SELECT event_type, access_json FROM realtime_events WHERE event_type = 'onboarding.completed'",
    ).all() as { event_type: string, access_json: string }[]
    expect(events).toHaveLength(2)
    expect(events.some(event => event.access_json.includes('gm-only'))).toBe(true)
    expect(events.some(event => event.access_json.includes('player-profile-access'))).toBe(true)
    database.close()
  })

  it('blocks submission of an invalid package and keeps the draft editable', () => {
    const { database, repository, dependencies, created, saved, profileState } = harness('default-level1-single-starter')

    // Break the package: clear the training feature.
    const broken = {
      ...saved.draft,
      trainerBuild: { ...saved.draft.trainerBuild, trainingFeatureId: null },
    }
    const savedBroken = saveOnboardingDraftUseCase({
      role: 'player',
      profile: profileState.profile as PlayerProfile,
      draftId: created.draft.draft.draftId,
      expectedRevision: saved.revision,
      document: broken,
    }, dependencies)

    expect(() => submitOnboardingDraftUseCase({
      role: 'player',
      profile: profileState.profile as PlayerProfile,
      draftId: created.draft.draft.draftId,
      expectedRevision: savedBroken.revision,
      operationId: 'onbop_submit-broken',
    }, dependencies)).toThrow(/blocked/i)

    expect(repository.getDraft(created.draft.draft.draftId)?.state).toBe('draft')
    expect(repository.listSubmissions(created.draft.draft.draftId)).toHaveLength(0)
    database.close()
  })

  it('requires explicit GM confirmation for reviewed-clause deviations', () => {
    const { database, dependencies, created, saved, profileState } = harness('class-subchoices')

    submitOnboardingDraftUseCase({
      role: 'player',
      profile: profileState.profile as PlayerProfile,
      draftId: created.draft.draft.draftId,
      expectedRevision: saved.revision,
      operationId: 'onbop_submit-clauses',
    }, dependencies)

    const review = loadOnboardingReviewUseCase({ role: 'gm', draftId: created.draft.draft.draftId }, dependencies)
    expect(review.deviationsRequiringConfirmation.length).toBeGreaterThan(0)

    expect(() => approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: false,
      operationId: 'onbop_approve-clauses',
    }, dependencies)).toThrow(/confirmation/)

    const approved = approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: true,
      operationId: 'onbop_approve-clauses-2',
    }, dependencies)
    expect(approved.ok).toBe(true)
    database.close()
  })

  it('supports change requests and resubmission bound to exact revisions', () => {
    const { database, repository, dependencies, created, saved, profileState } = harness('default-level1-single-starter')

    submitOnboardingDraftUseCase({
      role: 'player',
      profile: profileState.profile as PlayerProfile,
      draftId: created.draft.draft.draftId,
      expectedRevision: saved.revision,
      operationId: 'onbop_submit-cr',
    }, dependencies)

    requestOnboardingChangesUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      reasons: ['stat-allocation'],
      comment: 'Shift one point из Speed into Defense please.',
      gmOnlyNote: 'Watch this one.',
      operationId: 'onbop_changes-1',
    }, dependencies)

    const stored = repository.getDraft(created.draft.draft.draftId)!
    expect(stored.state).toBe('changes-requested')

    // Player-visible entries exclude the GM-only note structurally.
    expect(repository.listReviewEntries(created.draft.draft.draftId)).toHaveLength(1)
    expect(repository.listReviewEntries(created.draft.draft.draftId, { includeGmOnly: true })).toHaveLength(2)

    // Owner resubmits; a second immutable snapshot appears.
    const resubmitted = submitOnboardingDraftUseCase({
      role: 'player',
      profile: profileState.profile as PlayerProfile,
      draftId: created.draft.draft.draftId,
      expectedRevision: stored.revision,
      operationId: 'onbop_submit-cr2',
    }, dependencies)
    expect(resubmitted.submissionRevision).toBe(2)
    expect(repository.listSubmissions(created.draft.draft.draftId)).toHaveLength(2)

    // Approving the stale first submission is rejected.
    expect(() => approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: false,
      operationId: 'onbop_approve-stale',
    }, dependencies)).toThrow(/submission 2/)
    database.close()
  })

  it('rolls the entire commit back when a late write fails, then succeeds after repair', () => {
    const { database, repository, sheetRepository, dependencies, created, saved, profileState } = harness('multiple-starters')

    const submitted = submitOnboardingDraftUseCase({
      role: 'player',
      profile: profileState.profile as PlayerProfile,
      draftId: created.draft.draft.draftId,
      expectedRevision: saved.revision,
      operationId: 'onbop_submit-multi',
    }, dependencies)
    expect(submitted.validation.blockingCount).toBe(0)

    // Force the completion insert to collide: occupy the deterministic completion ID.
    database.connection.prepare(`
      INSERT INTO onboarding_completions (completion_id, slot_id, draft_id, submission_revision, policy_id, policy_version, refs_json, created_at)
      VALUES (?, ?, ?, 999, ?, ?, '{}', 1)
    `).run(
      `onbdone-${created.draft.draft.draftId}-1`,
      created.slot.slotId,
      created.draft.draft.draftId,
      created.slot.policyId,
      created.slot.policyVersion,
    )

    expect(() => approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: false,
      operationId: 'onbop_approve-multi',
    }, dependencies)).toThrow()

    /* Nothing partial: no sheets, links, closed slot, or lifecycle movement. */
    expect(sheetRepository.list('trainer')).toHaveLength(0)
    expect(sheetRepository.list('pokemon')).toHaveLength(0)
    expect(profileState.profile.linkedCharacters).toHaveLength(0)
    expect(repository.getSlot(created.slot.slotId)?.status).toBe('open')
    expect(repository.getDraft(created.draft.draft.draftId)?.state).toBe('submitted')
    expect(repository.findOperation('onbop_approve-multi')).toBeNull()

    // Remove the obstruction; a fresh operation commits the whole trio package.
    database.connection.prepare('DELETE FROM onboarding_completions WHERE submission_revision = 999').run()
    const approved = approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: false,
      operationId: 'onbop_approve-multi-2',
    }, dependencies)
    expect(approved.pokemonSlugs).toHaveLength(3)
    expect(sheetRepository.list('pokemon')).toHaveLength(3)
    const trainer = sheetRepository.getByRef('trainer', approved.trainerSlug)!.sheet as Record<string, any>
    expect(trainer.currentTeam).toHaveLength(3)
    expect(profileState.profile.linkedCharacters).toHaveLength(4)
    database.close()
  })

  it('finishes profile links on retry when the first link application fails (P9-058)', () => {
    const { database, repository, dependencies, created, saved, profileState } = harness('default-level1-single-starter')

    submitOnboardingDraftUseCase({
      role: 'player',
      profile: profileState.profile as PlayerProfile,
      draftId: created.draft.draft.draftId,
      expectedRevision: saved.revision,
      operationId: 'onbop_submit-links',
    }, dependencies)

    let failLinks = true
    const flakyDependencies = {
      ...dependencies,
      applyProfileLinks: (profileId: string, refs: readonly LinkedCharacterRef[]) => {
        if (failLinks) throw new Error('profile storage offline')
        dependencies.applyProfileLinks(profileId, refs)
      },
    }

    expect(() => approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: false,
      operationId: 'onbop_approve-links',
    }, flakyDependencies)).toThrow(/offline/)

    /* The SQLite package committed; links remain pending in the completion record. */
    expect(repository.getDraft(created.draft.draft.draftId)?.state).toBe('completed')
    const completion = repository.getCompletionBySlot(created.slot.slotId)
    expect(completion?.refs.profileLinksApplied).toBe(false)
    expect(profileState.profile.linkedCharacters).toHaveLength(0)

    /* Exact retry reconciles: same result, links applied exactly once. */
    failLinks = false
    const replay = approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: false,
      operationId: 'onbop_approve-links',
    }, flakyDependencies)
    expect(replay.profileLinksApplied).toBe(true)
    expect(profileState.profile.linkedCharacters).toHaveLength(2)
    expect(repository.getCompletionBySlot(created.slot.slotId)?.refs.profileLinksApplied).toBe(true)

    const again = approveOnboardingSubmissionUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      submissionRevision: 1,
      confirmDeviations: false,
      operationId: 'onbop_approve-links',
    }, flakyDependencies)
    expect(again.profileLinksApplied).toBe(true)
    expect(profileState.profile.linkedCharacters).toHaveLength(2)
    database.close()
  })
})
