import { describe, expect, it } from 'vitest'
import { openRotomDatabase } from '../../server/storage/database'
import {
  OnboardingRepositoryError,
  createSqliteOnboardingRepository,
  onboardingPayloadHash,
} from '../../server/storage/onboardingRepository'
import { defaultCampaignOnboardingPolicyContent } from '../../shared/onboarding/policy'
import { onboardingCreationCatalog } from '../../shared/onboarding/catalog'

const PROFILE_A = 'profile_playeralpha'
const PROFILE_B = 'profile_playerbeta'

const openRepo = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  return { database, repo: createSqliteOnboardingRepository(database) }
}

const publishDefault = (repo: ReturnType<typeof createSqliteOnboardingRepository>) =>
  repo.publishPolicy({
    content: defaultCampaignOnboardingPolicyContent(),
    display: { name: 'Default campaign start' },
    now: 1_700_000_000_000,
  })

describe('onboarding storage and migrations (P9-021)', () => {
  it('creates a fresh database with the onboarding tables', () => {
    const { database } = openRepo()
    const tables = (database.connection.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'onboarding%' ORDER BY name",
    ).all() as { name: string }[]).map(row => row.name)
    expect(tables).toEqual([
      'onboarding_completions',
      'onboarding_drafts',
      'onboarding_ops',
      'onboarding_policies',
      'onboarding_review_entries',
      'onboarding_slots',
      'onboarding_submissions',
    ])
    database.close()
  })

  it('publishes immutable policy versions with one active version', () => {
    const { database, repo } = openRepo()
    const first = publishDefault(repo)
    expect(first.identity.version).toBe(1)
    expect(first.identity.contentHash).toMatch(/^[0-9a-f]{64}$/)

    const second = repo.publishPolicy({
      content: {
        ...defaultCampaignOnboardingPolicyContent(),
        pokemon: {
          ...defaultCampaignOnboardingPolicyContent().pokemon,
          starterCount: 2,
        },
      },
      display: { name: 'Two starters' },
      policyId: first.identity.policyId,
      now: 1_700_000_100_000,
    })
    expect(second.identity.policyId).toBe(first.identity.policyId)
    expect(second.identity.version).toBe(2)
    expect(second.identity.contentHash).not.toBe(first.identity.contentHash)

    const active = repo.getActivePolicy()
    expect(active?.identity.version).toBe(2)
    // Historical version remains readable for bound drafts.
    expect(repo.getPolicy(first.identity.policyId, 1)?.content.pokemon.starterCount).toBe(1)

    // Display metadata edits never change identity.
    const relabeled = repo.updatePolicyDisplay(first.identity.policyId, 1, { name: 'Renamed v1' })
    expect(relabeled?.identity.contentHash).toBe(first.identity.contentHash)
    database.close()
  })

  it('creates one open slot per profile with a bound empty draft', () => {
    const { database, repo } = openRepo()
    publishDefault(repo)
    const catalog = onboardingCreationCatalog()
    const { slot, draft } = repo.createSlotWithDraft({
      profileId: PROFILE_A,
      catalogFingerprint: catalog.catalogFingerprint,
      now: 1_700_000_200_000,
    })
    expect(slot.status).toBe('open')
    expect(slot.activeDraftId).toBe(draft.draft.draftId)
    expect(draft.draft.policyVersion).toBe(1)
    expect(draft.draft.catalogFingerprint).toBe(catalog.catalogFingerprint)
    expect(draft.draft.pokemonBuilds).toHaveLength(1)

    expect(() => repo.createSlotWithDraft({
      profileId: PROFILE_A,
      catalogFingerprint: catalog.catalogFingerprint,
    })).toThrow(OnboardingRepositoryError)

    // A second profile is independent.
    const second = repo.createSlotWithDraft({
      profileId: PROFILE_B,
      catalogFingerprint: catalog.catalogFingerprint,
    })
    expect(second.slot.profileId).toBe(PROFILE_B)
    expect(repo.findOpenSlotByProfile(PROFILE_A)?.slotId).toBe(slot.slotId)
    database.close()
  })

  it('saves draft documents under CAS and rejects stale or identity-changing writes', () => {
    const { database, repo } = openRepo()
    publishDefault(repo)
    const { draft } = repo.createSlotWithDraft({
      profileId: PROFILE_A,
      catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
      now: 1_700_000_200_000,
    })

    const updated = repo.saveDraftDocument({
      draftId: draft.draft.draftId,
      expectedRevision: 0,
      document: { ...draft.draft, trainerBuild: { ...draft.draft.trainerBuild, name: 'Rowan Vale' } },
      now: 1_700_000_300_000,
    })
    expect(updated.revision).toBe(1)
    expect(updated.draft.trainerBuild.name).toBe('Rowan Vale')

    expect(() => repo.saveDraftDocument({
      draftId: draft.draft.draftId,
      expectedRevision: 0,
      document: updated.draft,
    })).toThrow(/revision/)

    expect(() => repo.saveDraftDocument({
      draftId: draft.draft.draftId,
      expectedRevision: 1,
      document: { ...updated.draft, profileId: PROFILE_B },
    })).toThrow(/identity/)

    expect(() => repo.saveDraftDocument({
      draftId: draft.draft.draftId,
      expectedRevision: 1,
      document: { ...updated.draft, state: 'submitted' },
    })).toThrow(/transitionDraft/)
    database.close()
  })

  it('drives lifecycle transitions with actor checks and submission snapshots', () => {
    const { database, repo } = openRepo()
    publishDefault(repo)
    const { draft } = repo.createSlotWithDraft({
      profileId: PROFILE_A,
      catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
    })

    const submitted = repo.transitionDraft({
      draftId: draft.draft.draftId,
      expectedRevision: 0,
      to: 'submitted',
      actor: 'owner-player',
    })
    expect(submitted.state).toBe('submitted')
    expect(submitted.draft.submissionRevision).toBe(1)

    repo.createSubmission({
      draftId: draft.draft.draftId,
      submissionRevision: 1,
      snapshot: submitted.draft,
      validation: { blockingCount: 0 },
      policyContentHash: 'a'.repeat(64),
      catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
    })
    expect(repo.getSubmission(draft.draft.draftId, 1)?.snapshot.state).toBe('submitted')

    expect(() => repo.transitionDraft({
      draftId: draft.draft.draftId,
      expectedRevision: submitted.revision,
      to: 'approved',
      actor: 'owner-player',
    })).toThrow(/actor/)

    const approved = repo.transitionDraft({
      draftId: draft.draft.draftId,
      expectedRevision: submitted.revision,
      to: 'approved',
      actor: 'gm',
    })
    expect(approved.state).toBe('approved')
    database.close()
  })

  it('journals operations for exact retry and records completions', () => {
    const { database, repo } = openRepo()
    publishDefault(repo)
    const { slot, draft } = repo.createSlotWithDraft({
      profileId: PROFILE_A,
      catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
    })

    const payloadHash = onboardingPayloadHash({ example: true })
    expect(repo.findOperation('onbop_commit-1')).toBeNull()
    repo.recordOperation({
      opId: 'onbop_commit-1',
      scope: 'commit',
      payloadHash,
      result: { ok: true },
    })
    expect(repo.findOperation('onbop_commit-1')?.result).toEqual({ ok: true })

    const completion = repo.recordCompletion({
      slotId: slot.slotId,
      draftId: draft.draft.draftId,
      submissionRevision: 1,
      refs: { trainerSlug: 'rowan-vale', pokemonSlugs: ['sprig'] },
    })
    expect(repo.getCompletionBySlot(slot.slotId)?.completionId).toBe(completion.completionId)

    const closed = repo.closeSlot(slot.slotId, 'completed')
    expect(closed.status).toBe('completed')

    // A completed slot frees the profile for a future slot.
    const again = repo.createSlotWithDraft({
      profileId: PROFILE_A,
      catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
    })
    expect(again.slot.slotId).not.toBe(slot.slotId)
    database.close()
  })

  it('separates gm-only review entries structurally', () => {
    const { database, repo } = openRepo()
    publishDefault(repo)
    const { draft } = repo.createSlotWithDraft({
      profileId: PROFILE_A,
      catalogFingerprint: onboardingCreationCatalog().catalogFingerprint,
    })
    repo.appendReviewEntry({
      draftId: draft.draft.draftId,
      submissionRevision: 1,
      kind: 'change-request',
      audience: 'table',
      payload: { reason: 'stat-budget', comment: 'Two points unspent.' },
    })
    repo.appendReviewEntry({
      draftId: draft.draft.draftId,
      submissionRevision: 1,
      kind: 'approval-note',
      audience: 'gm-only',
      payload: { note: 'Watch this build for min-maxing.' },
    })
    expect(repo.listReviewEntries(draft.draft.draftId)).toHaveLength(1)
    expect(repo.listReviewEntries(draft.draft.draftId, { includeGmOnly: true })).toHaveLength(2)
    database.close()
  })
})
