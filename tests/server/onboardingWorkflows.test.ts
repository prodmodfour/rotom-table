import { describe, expect, it } from 'vitest'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteOnboardingRepository } from '../../server/storage/onboardingRepository'
import {
  OnboardingUseCaseError,
  cancelOnboardingSlotUseCase,
  createOnboardingSlotUseCase,
  loadGmOnboardingOverviewUseCase,
  loadOnboardingDraftUseCase,
  loadPlayerOnboardingHomeUseCase,
  migrateOnboardingDraftPolicyUseCase,
  publishOnboardingPolicyUseCase,
  restartOnboardingSlotUseCase,
  saveOnboardingDraftUseCase,
} from '../../server/useCases/onboardingWorkflows'
import { defaultCampaignOnboardingPolicyContent } from '../../shared/onboarding/policy'
import type { PlayerProfile } from '../../shared/playerProfiles'

const PROFILE_A = {
  schemaVersion: 1,
  id: 'profile_playeralpha',
  displayName: 'Alex',
  linkedCharacters: [],
} as unknown as PlayerProfile

const PROFILE_B = {
  schemaVersion: 1,
  id: 'profile_playerbeta',
  displayName: 'Bea',
  linkedCharacters: [],
} as unknown as PlayerProfile

const PROFILES = new Map([[PROFILE_A.id, PROFILE_A], [PROFILE_B.id, PROFILE_B]])

const noopPublishers = {
  publishSlotChanged: () => {},
  publishDraftChanged: () => {},
  publishPolicyPublished: () => {},
}

const testHarness = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  const repository = createSqliteOnboardingRepository(database)
  const dependencies = {
    repository,
    readProfile: (profileId: string) => PROFILES.get(profileId) ?? null,
    listProfiles: () => [...PROFILES.values()],
    ...noopPublishers,
  }
  const publish = () => publishOnboardingPolicyUseCase({
    role: 'gm',
    content: defaultCampaignOnboardingPolicyContent(),
    display: { name: 'Default start' },
  }, dependencies)
  return { database, repository, dependencies, publish }
}

describe('onboarding slots, ownership, and drafts (P9-024/P9-025/P9-030)', () => {
  it('requires GM role for policy publication and slot creation', () => {
    const { dependencies, database } = testHarness()
    expect(() => publishOnboardingPolicyUseCase({
      role: 'player',
      content: defaultCampaignOnboardingPolicyContent(),
      display: { name: 'X' },
    }, dependencies)).toThrow(OnboardingUseCaseError)
    expect(() => createOnboardingSlotUseCase({ role: 'player', profileId: PROFILE_A.id }, dependencies))
      .toThrow(/GM role required/)
    database.close()
  })

  it('creates a slot for an existing profile and routes the player home to it', () => {
    const { dependencies, publish, database } = testHarness()
    publish()
    const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    expect(created.slot.profileId).toBe(PROFILE_A.id)

    const home = loadPlayerOnboardingHomeUseCase({ role: 'player', profile: PROFILE_A }, dependencies)
    expect(home.slot?.slotId).toBe(created.slot.slotId)
    expect(home.draft?.draftId).toBe(created.draft.draft.draftId)
    expect(home.policy?.identity.version).toBe(1)

    const noSlot = loadPlayerOnboardingHomeUseCase({ role: 'player', profile: PROFILE_B }, dependencies)
    expect(noSlot.slot).toBeNull()
    database.close()
  })

  it('lets only the owning profile edit its draft; the GM cannot edit content', () => {
    const { dependencies, publish, database } = testHarness()
    publish()
    const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    const draftId = created.draft.draft.draftId

    const saved = saveOnboardingDraftUseCase({
      role: 'player',
      profile: PROFILE_A,
      draftId,
      expectedRevision: 0,
      document: { ...created.draft.draft, trainerBuild: { ...created.draft.draft.trainerBuild, name: 'Alex the Bold' } },
    }, dependencies)
    expect(saved.revision).toBe(1)

    // Unrelated player cannot even see the draft.
    expect(() => loadOnboardingDraftUseCase({ role: 'player', profile: PROFILE_B, draftId }, dependencies))
      .toThrow(/not found/i)
    expect(() => saveOnboardingDraftUseCase({
      role: 'player',
      profile: PROFILE_B,
      draftId,
      expectedRevision: 1,
      document: saved.draft,
    }, dependencies)).toThrow(/not found/i)

    // Profileless player is rejected.
    expect(() => saveOnboardingDraftUseCase({
      role: 'player',
      profile: null,
      draftId,
      expectedRevision: 1,
      document: saved.draft,
    }, dependencies)).toThrow(/not found/i)

    // The GM reads but does not edit.
    const gmView = loadOnboardingDraftUseCase({ role: 'gm', profile: null, draftId }, dependencies)
    expect(gmView.draft.trainerBuild.name).toBe('Alex the Bold')
    expect(() => saveOnboardingDraftUseCase({
      role: 'gm',
      profile: null,
      draftId,
      expectedRevision: 1,
      document: gmView.draft,
    }, dependencies)).toThrow(/owning player/)

    // Stale revision conflicts.
    expect(() => saveOnboardingDraftUseCase({
      role: 'player',
      profile: PROFILE_A,
      draftId,
      expectedRevision: 0,
      document: saved.draft,
    }, dependencies)).toThrow(/revision/)
    database.close()
  })

  it('keeps two players independent and lists both for the GM queue', () => {
    const { dependencies, publish, database } = testHarness()
    publish()
    const first = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    const second = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_B.id }, dependencies)

    saveOnboardingDraftUseCase({
      role: 'player',
      profile: PROFILE_A,
      draftId: first.draft.draft.draftId,
      expectedRevision: 0,
      document: { ...first.draft.draft, trainerBuild: { ...first.draft.draft.trainerBuild, name: 'Alex' } },
    }, dependencies)

    const homeB = loadPlayerOnboardingHomeUseCase({ role: 'player', profile: PROFILE_B }, dependencies)
    expect(homeB.draft?.trainerBuild.name).toBeNull()
    expect(homeB.draft?.draftId).toBe(second.draft.draft.draftId)

    const overview = loadGmOnboardingOverviewUseCase({ role: 'gm' }, dependencies)
    expect(overview.slots).toHaveLength(2)
    expect(overview.slots.map(slot => slot.profileDisplayName).sort()).toEqual(['Alex', 'Bea'])
    expect(overview.profilesWithoutSlots).toHaveLength(0)
    database.close()
  })

  it('binds drafts to their policy version while newer versions publish (P9-023)', () => {
    const { dependencies, publish, database } = testHarness()
    publish()
    const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    expect(created.draft.draft.policyVersion).toBe(1)

    const base = defaultCampaignOnboardingPolicyContent()
    publishOnboardingPolicyUseCase({
      role: 'gm',
      content: { ...base, pokemon: { ...base.pokemon, starterCount: 2 } },
      display: { name: 'Two starters' },
      policyId: loadGmOnboardingOverviewUseCase({ role: 'gm' }, dependencies).activePolicy!.identity.policyId,
    }, dependencies)

    // Existing draft remains stable on v1.
    const view = loadOnboardingDraftUseCase({ role: 'gm', profile: null, draftId: created.draft.draft.draftId }, dependencies)
    expect(view.draft.policyVersion).toBe(1)
    expect(view.policy?.identity.version).toBe(1)

    // Preview shows the migration consequence without mutating.
    const preview = migrateOnboardingDraftPolicyUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      apply: false,
    }, dependencies)
    expect(preview.applied).toBe(false)
    expect(preview.fromVersion).toBe(1)
    expect(preview.toVersion).toBe(2)

    // Explicit apply rebinds and grows starter shells.
    const applied = migrateOnboardingDraftPolicyUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      apply: true,
      expectedRevision: 0,
      operationId: 'onbop_migrate-1',
    }, dependencies)
    expect(applied.applied).toBe(true)
    const after = loadOnboardingDraftUseCase({ role: 'gm', profile: null, draftId: created.draft.draft.draftId }, dependencies)
    expect(after.draft.policyVersion).toBe(2)
    expect(after.draft.pokemonBuilds).toHaveLength(2)

    // Exact replay returns the original result without a second mutation.
    const replay = migrateOnboardingDraftPolicyUseCase({
      role: 'gm',
      draftId: created.draft.draft.draftId,
      apply: true,
      expectedRevision: 0,
      operationId: 'onbop_migrate-1',
    }, dependencies)
    expect(replay.applied).toBe(true)
    expect(loadOnboardingDraftUseCase({ role: 'gm', profile: null, draftId: created.draft.draft.draftId }, dependencies).revision)
      .toBe(after.revision)
    database.close()
  })

  it('cancels with owner or GM authority and journals exact retry (P9-028)', () => {
    const { dependencies, publish, database } = testHarness()
    publish()
    const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)

    // Unrelated player cannot cancel.
    expect(() => cancelOnboardingSlotUseCase({
      role: 'player',
      profile: PROFILE_B,
      slotId: created.slot.slotId,
      operationId: 'onbop_cancel-x',
    }, dependencies)).toThrow(/not found/i)

    const cancelled = cancelOnboardingSlotUseCase({
      role: 'player',
      profile: PROFILE_A,
      slotId: created.slot.slotId,
      operationId: 'onbop_cancel-1',
    }, dependencies)
    expect(cancelled.status).toBe('cancelled')

    // Exact retry returns the stored result.
    const replay = cancelOnboardingSlotUseCase({
      role: 'player',
      profile: PROFILE_A,
      slotId: created.slot.slotId,
      operationId: 'onbop_cancel-1',
    }, dependencies)
    expect(replay).toEqual(cancelled)

    // Draft mutations after cancellation are rejected.
    expect(() => saveOnboardingDraftUseCase({
      role: 'player',
      profile: PROFILE_A,
      draftId: created.draft.draft.draftId,
      expectedRevision: 1,
      document: created.draft.draft,
    }, dependencies)).toThrow(/cancelled/)

    // The profile can start over with a fresh GM slot.
    const again = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)
    expect(again.slot.slotId).not.toBe(created.slot.slotId)
    database.close()
  })

  it('restarts a slot under the active policy with immutable audit of the superseded draft', () => {
    const { dependencies, publish, repository, database } = testHarness()
    publish()
    const created = createOnboardingSlotUseCase({ role: 'gm', profileId: PROFILE_A.id }, dependencies)

    const restarted = restartOnboardingSlotUseCase({
      role: 'gm',
      slotId: created.slot.slotId,
      operationId: 'onbop_restart-1',
    }, dependencies)
    expect(restarted.supersededSlotId).toBe(created.slot.slotId)
    expect(restarted.slot.slotId).not.toBe(created.slot.slotId)

    const oldDraft = repository.getDraft(created.draft.draft.draftId)
    expect(oldDraft?.state).toBe('superseded')
    const oldSlot = repository.getSlot(created.slot.slotId)
    expect(oldSlot?.status).toBe('superseded')

    // The player home now points at the fresh draft.
    const home = loadPlayerOnboardingHomeUseCase({ role: 'player', profile: PROFILE_A }, dependencies)
    expect(home.slot?.slotId).toBe(restarted.slot.slotId)
    expect(home.draft?.trainerBuild.name).toBeNull()
    database.close()
  })

  it('creates a profile and slot together when asked (P9-024)', () => {
    const { dependencies, publish, database } = testHarness()
    publish()
    // createPlayerProfileUseCase writes to real profile storage; use a unique name.
    const marker = `Test Rookie ${Date.now()}`
    const created = createOnboardingSlotUseCase({
      role: 'gm',
      newProfileDisplayName: marker,
    }, dependencies)
    expect(created.profile.displayName).toBe(marker)
    expect(created.slot.profileId).toBe(created.profile.id)
    database.close()
  })
})
