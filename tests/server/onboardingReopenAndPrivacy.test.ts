import { describe, expect, it } from 'vitest'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteOnboardingRepository } from '../../server/storage/onboardingRepository'
import {
  cancelOnboardingSlotUseCase,
  createOnboardingSlotUseCase,
  loadOnboardingDraftUseCase,
  loadPlayerOnboardingHomeUseCase,
  publishOnboardingPolicyUseCase,
  saveOnboardingDraftUseCase,
} from '../../server/useCases/onboardingWorkflows'
import { submitOnboardingDraftUseCase } from '../../server/useCases/onboardingSubmission'
import { applyOnboardingCorrectionUseCase } from '../../server/useCases/onboardingCorrections'
import { defaultCampaignOnboardingPolicyContent } from '../../shared/onboarding/policy'
import { parseOnboardingDraft } from '../../shared/onboarding/draft'
import type { PlayerProfile } from '../../shared/playerProfiles'

const PROFILE_A = { schemaVersion: 1, id: 'profile_reopenalpha', displayName: 'Alpha', linkedCharacters: [] } as unknown as PlayerProfile
const PROFILE_B = { schemaVersion: 1, id: 'profile_reopenbeta0', displayName: 'Beta', linkedCharacters: [] } as unknown as PlayerProfile

const harness = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  const repository = createSqliteOnboardingRepository(database)
  const dependencies = {
    repository,
    readProfile: (id: string) => (id === PROFILE_A.id ? PROFILE_A : id === PROFILE_B.id ? PROFILE_B : null),
    listProfiles: () => [PROFILE_A, PROFILE_B],
    publishSlotChanged: () => {},
    publishDraftChanged: () => {},
    publishPolicyPublished: () => {},
  }
  publishOnboardingPolicyUseCase({
    role: 'gm',
    content: defaultCampaignOnboardingPolicyContent(),
    display: { name: 'Reopen tests' },
  }, dependencies)
  return { database, repository, dependencies }
}

describe('post-completion reopen policy (P9-078)', () => {
  it('keeps terminal drafts terminal: no saves, submissions, corrections, or transitions', () => {
    const { database, repository, dependencies } = harness()
    const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    const draftId = created.draft.draft.draftId

    // Drive the draft to a terminal cancelled state.
    cancelOnboardingSlotUseCase({
      role: 'gm', profile: null, slotId: created.slot.slotId, operationId: 'onbop_cancel-terminal',
    }, dependencies)
    const stored = repository.getDraft(draftId)!
    expect(stored.state).toBe('cancelled')

    // The archived draft never becomes competing authority again.
    expect(() => saveOnboardingDraftUseCase({
      role: 'player', profile: PROFILE_A, draftId,
      expectedRevision: stored.revision, document: stored.draft,
    }, dependencies)).toThrow(/cancelled/)
    expect(() => submitOnboardingDraftUseCase({
      role: 'player', profile: PROFILE_A, draftId,
      expectedRevision: stored.revision, operationId: 'onbop_submit-terminal',
    }, dependencies)).toThrow(/cancelled/)
    expect(() => applyOnboardingCorrectionUseCase({
      role: 'gm', draftId, submissionRevision: 0, scope: 'trainer-name', value: 'X',
      rationale: 'x', requiresAcknowledgement: false, operationId: 'onbop_correct-terminal',
    }, dependencies)).toThrow(/cancelled/)
    expect(() => repository.transitionDraft({
      draftId, expectedRevision: stored.revision, to: 'draft', actor: 'gm',
    })).toThrow(/terminal|illegal/i)

    // Recovery is a fresh slot, never reactivation.
    const fresh = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    expect(fresh.slot.slotId).not.toBe(created.slot.slotId)
    database.close()
  })
})

describe('onboarding privacy and abuse guards (P9-088)', () => {
  it('scopes the player home to the selected profile only', () => {
    const { database, dependencies } = harness()
    createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_B.id }, dependencies)

    const homeA = loadPlayerOnboardingHomeUseCase({ role: 'player', profile: PROFILE_A }, dependencies)
    expect(homeA.slot?.profileId).toBe(PROFILE_A.id)
    // No other profile's slot, draft, or identity leaks through the home projection.
    expect(JSON.stringify(homeA)).not.toContain(PROFILE_B.id)
    database.close()
  })

  it('denies draft probing by ID for unrelated and profileless principals without existence leaks', () => {
    const { database, dependencies } = harness()
    const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    const draftId = created.draft.draft.draftId

    for (const profile of [PROFILE_B, null]) {
      try {
        loadOnboardingDraftUseCase({ role: 'player', profile, draftId }, dependencies)
        expect.unreachable('unrelated principal read a private draft')
      } catch (error) {
        expect((error as { statusCode?: number }).statusCode).toBe(404)
        expect((error as Error).message).toBe('Draft not found')
      }
    }

    // Malformed IDs produce a bounded 400/404, never a crash or enumeration hint.
    try {
      loadOnboardingDraftUseCase({ role: 'player', profile: PROFILE_B, draftId: 'onbdraft_%%%%' }, dependencies)
      expect.unreachable('malformed ID accepted')
    } catch (error) {
      expect([400, 404]).toContain((error as { statusCode?: number }).statusCode)
    }
    database.close()
  })

  it('enforces payload bounds on draft documents', () => {
    const { database, dependencies } = harness()
    const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    const base = created.draft.draft

    // Oversized edge lists are rejected structurally.
    expect(() => parseOnboardingDraft({
      ...base,
      trainerBuild: {
        ...base.trainerBuild,
        edges: Array.from({ length: 61 }, (_, index) => ({
          entryId: `edge-${index + 1}`, canonicalId: 'Basic Skills', grantLevel: null, choices: {},
        })),
      },
    })).toThrow(/at most 60/)

    // Unknown stat keys are rejected rather than stored.
    expect(() => parseOnboardingDraft({
      ...base,
      trainerBuild: { ...base.trainerBuild, statAllocation: { ...base.trainerBuild.statAllocation, luck: 5 } },
    })).toThrow(/unknown stat key/)

    // Absurd text lengths are rejected.
    expect(() => parseOnboardingDraft({
      ...base,
      trainerBuild: { ...base.trainerBuild, name: 'x'.repeat(81) },
    })).toThrow(/at most 80/)
    database.close()
  })
})
