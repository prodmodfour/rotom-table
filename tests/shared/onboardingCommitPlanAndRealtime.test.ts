import { describe, expect, it } from 'vitest'
import {
  ONBOARDING_COMMIT_PLAN_SCHEMA_VERSION,
  OnboardingCommitPlanError,
  parseOnboardingCommitPlan,
} from '../../shared/onboarding/commitPlan'
import {
  ONBOARDING_EVENT_AUDIENCES,
  ONBOARDING_REALTIME_EVENT_TYPES,
  onboardingGmChannel,
  onboardingProfileChannel,
  parseOnboardingCompletedPayload,
  parseOnboardingDraftChangedPayload,
  parseOnboardingPolicyPublishedPayload,
  parseOnboardingReviewChangedPayload,
  parseOnboardingSlotChangedPayload,
} from '../../shared/onboarding/realtime'

const PROFILE_ID = 'profile_testplayer1'

const validPlan = () => ({
  schemaVersion: ONBOARDING_COMMIT_PLAN_SCHEMA_VERSION,
  operationId: 'onbop_commit-abc123',
  readSet: {
    draft: { draftId: 'onbdraft_aaaabbbb', revision: 7 },
    policy: { policyId: 'onbpol_ccccdddd', version: 2, contentHash: 'ab12cd34ef56ab12' },
    catalogFingerprint: '1234567890abcdef',
    profileId: PROFILE_ID,
    slotId: 'onbslot_eeeeffff',
    slugReservations: [
      { kind: 'trainer', slug: 'rowan-vale' },
      { kind: 'pokemon', slug: 'sprig' },
    ],
    folderDestinations: ['players/rowan'],
  },
  writeSet: {
    sheets: [
      { kind: 'trainer', slug: 'rowan-vale', folder: 'players/rowan', displayName: 'Rowan Vale', sourceBuildId: 'trainer' },
      { kind: 'pokemon', slug: 'sprig', folder: 'players/rowan', displayName: 'Sprig', sourceBuildId: 'starter-1' },
    ],
    profileLinks: [
      { profileId: PROFILE_ID, sheetKind: 'trainer', sheetSlug: 'rowan-vale' },
      { profileId: PROFILE_ID, sheetKind: 'pokemon', sheetSlug: 'sprig' },
    ],
    team: { trainerSlug: 'rowan-vale', currentTeam: ['sprig'], boxedPokemon: [] },
    startingMoney: 5000,
    inventoryRows: [
      { trainerSlug: 'rowan-vale', section: 'pokeBalls', itemId: 'Basic Ball', quantity: 5 },
    ],
    starterHeldItems: [],
    completionRecordId: 'onbcomplete-1',
    realtimeEventTypes: ['onboarding.completed'],
  },
})

describe('onboarding commit plan (P9-018)', () => {
  it('parses a coherent plan', () => {
    const plan = parseOnboardingCommitPlan(validPlan())
    expect(plan.writeSet.sheets).toHaveLength(2)
    expect(plan.readSet.slugReservations).toHaveLength(2)
  })

  it('rejects team references to unplanned sheets', () => {
    const plan = validPlan()
    plan.writeSet.team.currentTeam = ['ghost-pokemon']
    expect(() => parseOnboardingCommitPlan(plan)).toThrow(OnboardingCommitPlanError)
    expect(() => parseOnboardingCommitPlan(plan)).toThrow(/not a planned pokemon sheet/)
  })

  it('rejects unlinked sheets, missing reservations, and cross-profile links', () => {
    const missingLink = validPlan()
    missingLink.writeSet.profileLinks = missingLink.writeSet.profileLinks.slice(0, 1)
    expect(() => parseOnboardingCommitPlan(missingLink)).toThrow(/never profile-linked/)

    const missingReservation = validPlan()
    missingReservation.readSet.slugReservations = missingReservation.readSet.slugReservations.slice(0, 1)
    expect(() => parseOnboardingCommitPlan(missingReservation)).toThrow(/no slug reservation/)

    const crossProfile = validPlan()
    crossProfile.writeSet.profileLinks = crossProfile.writeSet.profileLinks.map((link, index) =>
      index === 0 ? { ...link, profileId: 'profile_otherplayer9' } : link)
    expect(() => parseOnboardingCommitPlan(crossProfile)).toThrow(/read-set profile/)
  })

  it('requires every pokemon to be teamed or boxed exactly once', () => {
    const unteamed = validPlan()
    unteamed.writeSet.team.currentTeam = []
    expect(() => parseOnboardingCommitPlan(unteamed)).toThrow(/teamed or boxed/)
  })

  it('rejects unknown schema versions', () => {
    const plan = validPlan() as Record<string, unknown>
    plan.schemaVersion = 99
    expect(() => parseOnboardingCommitPlan(plan)).toThrow(/schemaVersion/)
  })
})

describe('onboarding realtime contract (P9-019)', () => {
  it('scopes channels per audience', () => {
    expect(onboardingGmChannel).toBe('onboarding')
    expect(onboardingProfileChannel(PROFILE_ID as never)).toBe(`onboarding:profile:${PROFILE_ID}`)
    expect(ONBOARDING_REALTIME_EVENT_TYPES).toHaveLength(5)
    expect(ONBOARDING_EVENT_AUDIENCES['onboarding.draft.changed']).toEqual(['owner'])
    expect(ONBOARDING_EVENT_AUDIENCES['onboarding.slot.changed']).toEqual(['gm'])
    expect(ONBOARDING_EVENT_AUDIENCES['onboarding.completed']).toEqual(['gm', 'owner'])
  })

  it('parses payloads strictly and rejects drift', () => {
    const slotPayload = parseOnboardingSlotChangedPayload({
      schemaVersion: 1,
      slotId: 'onbslot_eeeeffff',
      profileId: PROFILE_ID,
      state: 'submitted',
      policyVersion: 2,
      updatedAt: 1_700_000_000_000,
    })
    expect(slotPayload.state).toBe('submitted')

    const draftPayload = parseOnboardingDraftChangedPayload({
      schemaVersion: 1,
      draftId: 'onbdraft_aaaabbbb',
      slotId: 'onbslot_eeeeffff',
      revision: 3,
      state: 'draft',
      updatedAt: 1_700_000_000_000,
      clientId: null,
    })
    expect(draftPayload.revision).toBe(3)

    const reviewPayload = parseOnboardingReviewChangedPayload({
      schemaVersion: 1,
      draftId: 'onbdraft_aaaabbbb',
      slotId: 'onbslot_eeeeffff',
      state: 'changes-requested',
      submissionRevision: 1,
      updatedAt: 1_700_000_000_000,
    })
    expect(reviewPayload.state).toBe('changes-requested')

    const policyPayload = parseOnboardingPolicyPublishedPayload({
      schemaVersion: 1,
      policyId: 'onbpol_ccccdddd',
      version: 3,
      publishedAt: 1_700_000_000_000,
    })
    expect(policyPayload.version).toBe(3)

    const completedPayload = parseOnboardingCompletedPayload({
      schemaVersion: 1,
      slotId: 'onbslot_eeeeffff',
      profileId: PROFILE_ID,
      trainerSlug: 'rowan-vale',
      pokemonSlugs: ['sprig'],
      completionRecordId: 'onbcomplete-1',
      completedAt: 1_700_000_000_000,
    })
    expect(completedPayload.pokemonSlugs).toEqual(['sprig'])

    expect(() => parseOnboardingSlotChangedPayload({ schemaVersion: 2 })).toThrow(/schemaVersion/)
    expect(() => parseOnboardingDraftChangedPayload({
      schemaVersion: 1,
      draftId: 'nope',
      slotId: 'onbslot_eeeeffff',
      revision: 3,
      state: 'draft',
      updatedAt: 1,
      clientId: null,
    })).toThrow(/draftId/)
  })
})
