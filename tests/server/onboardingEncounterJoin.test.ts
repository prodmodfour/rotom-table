import { describe, expect, it } from 'vitest'
import { openRotomDatabase } from '../../server/storage/database'
import { createSqliteOnboardingRepository } from '../../server/storage/onboardingRepository'
import { createSqliteMapRepository } from '../../server/storage/mapRepository'
import { createSqliteSheetRepository } from '../../server/storage/sheetRepository'
import {
  joinOnboardedPartyUseCase,
  listOnboardedPartyCandidates,
  onboardingEncounterEligibilityUseCase,
} from '../../server/useCases/onboardingEncounterJoin'
import { createMapUseCase } from '../../server/useCases/createMap'
import { publishOnboardingPolicyUseCase } from '../../server/useCases/onboardingWorkflows'
import { defaultCampaignOnboardingPolicyContent } from '../../shared/onboarding/policy'
import type { PlayerProfile } from '../../shared/playerProfiles'
import type { TabletopMap } from '../../src/types/map'

const PROFILE = {
  schemaVersion: 1,
  id: 'profile_joinuser0001',
  displayName: 'Join Tester',
  linkedCharacters: [
    { sheetKind: 'trainer', sheetSlug: 'rowan' },
    { sheetKind: 'pokemon', sheetSlug: 'sprig' },
  ],
} as unknown as PlayerProfile

const harness = () => {
  const database = openRotomDatabase({ path: ':memory:' })
  const repository = createSqliteOnboardingRepository(database)
  const sheetRepository = createSqliteSheetRepository<Record<string, unknown>>(database)
  const mapRepository = createSqliteMapRepository<TabletopMap>(database)

  const interactionModes = new Map<string, string>()
  const dependencies = {
    repository,
    sheetRepository,
    mapRepository,
    readProfile: () => PROFILE,
    listProfiles: () => [PROFILE],
    interactionMode: (slug: string) => interactionModes.get(slug) ?? 'setup-edit',
    publishSlotChanged: () => {},
    publishDraftChanged: () => {},
    publishPolicyPublished: () => {},
  }

  publishOnboardingPolicyUseCase({
    role: 'gm',
    content: defaultCampaignOnboardingPolicyContent(),
    display: { name: 'Join campaign' },
  }, dependencies)

  sheetRepository.saveSetupSheet('trainer', 'rowan', {
    slug: 'rowan', name: 'Rowan Vale', level: 1, currentTeam: ['sprig'], revision: 0, updatedAt: 1,
  })
  sheetRepository.saveSetupSheet('pokemon', 'sprig', {
    slug: 'sprig', nickname: 'Sprig', species: 'Bulbasaur', level: 5, revision: 0, updatedAt: 1,
  })

  const slot = repository.createIntakeSlot({ profileId: PROFILE.id })
  repository.recordCompletion({
    completionId: 'onbdone-join-test',
    slotId: slot.slotId,
    draftId: 'onbdraft_jointest0',
    submissionRevision: 1,
    refs: {
      kind: 'guided',
      trainerSlug: 'rowan',
      pokemonSlugs: ['sprig'],
      profileLinksApplied: true,
    },
  })

  const createdMap = createMapUseCase({
    name: 'Arena',
    dimensions: { x: 6, y: 2, z: 6 },
  }, { database, publishPersistedRealtimeEvent: () => {}, reportAfterCommitPublicationFailure: () => {} })
  const arena = mapRepository.getBySlug(createdMap.map.slug)! as unknown as Record<string, any>
  mapRepository.saveSetupMap({
    ...arena,
    placements: [
      { id: 'foe-1', sheetKind: 'pokemon', sheetSlug: 'sprig-foe', sideId: 'wild', position: { x: 0, y: 0, z: 0 } },
    ],
    encounterState: {
      ...(arena.encounterState ?? {}),
      sides: {
        heroes: { id: 'heroes', label: 'Heroes', status: 'active', color: '#34d399' },
        wild: { id: 'wild', label: 'Wild', status: 'active', color: '#ef4444' },
      },
    },
  } as unknown as TabletopMap)

  return { database, repository, mapRepository, dependencies, interactionModes, arenaSlug: createdMap.map.slug as string }
}

describe('onboarded party encounter handoff (P9-074/P9-075)', () => {
  it('lists only completed, linked packages as ready candidates', () => {
    const { database, dependencies } = harness()
    const candidates = listOnboardedPartyCandidates(dependencies)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      trainerSlug: 'rowan',
      trainerName: 'Rowan Vale',
      pokemonSlugs: ['sprig'],
      ready: true,
      kind: 'guided',
    })
    database.close()
  })

  it('re-authorizes eligibility: setup mode and configured sides required', () => {
    const harnessState = harness()
    const { database, dependencies, interactionModes } = harnessState
    const eligible = onboardingEncounterEligibilityUseCase({ role: 'gm', mapSlug: harnessState.arenaSlug }, dependencies)
    expect(eligible.eligible).toBe(true)
    expect(eligible.sides.map(side => side.id).sort()).toEqual(['heroes', 'wild'])

    interactionModes.set(harnessState.arenaSlug, 'live-play')
    const live = onboardingEncounterEligibilityUseCase({ role: 'gm', mapSlug: harnessState.arenaSlug }, dependencies)
    expect(live.eligible).toBe(false)
    expect(live.reason).toMatch(/live/)
    database.close()
  })

  it('places the whole party on the chosen side with revision-checked writes and exact retry', () => {
    const harnessState = harness()
    const { database, dependencies, mapRepository } = harnessState
    const joined = joinOnboardedPartyUseCase({
      role: 'gm', trainerSlug: 'rowan', mapSlug: harnessState.arenaSlug, sideId: 'heroes', operationId: 'onbop_join-1',
    }, dependencies)
    expect(joined.placementIds).toHaveLength(2)

    const map = mapRepository.getBySlug(harnessState.arenaSlug)! as unknown as Record<string, any>
    const placed = (map.placements as any[]).filter(placement => placement.sideId === 'heroes')
    expect(placed.map(placement => `${placement.sheetKind}:${placement.sheetSlug}`).sort())
      .toEqual(['pokemon:sprig', 'trainer:rowan'])
    // Free-cell allocation avoided the existing foe placement.
    expect(placed.every(placement => `${placement.position.x},${placement.position.z}` !== '0,0')).toBe(true)

    /* Exact retry replays without duplicating placements. */
    const replay = joinOnboardedPartyUseCase({
      role: 'gm', trainerSlug: 'rowan', mapSlug: harnessState.arenaSlug, sideId: 'heroes', operationId: 'onbop_join-1',
    }, dependencies)
    expect(replay).toEqual(joined)
    const after = mapRepository.getBySlug(harnessState.arenaSlug)! as unknown as Record<string, any>
    expect((after.placements as any[]).length).toBe(3)

    /* A second fresh join is rejected: everyone is already placed. */
    expect(() => joinOnboardedPartyUseCase({
      role: 'gm', trainerSlug: 'rowan', mapSlug: harnessState.arenaSlug, sideId: 'heroes', operationId: 'onbop_join-2',
    }, dependencies)).toThrow(/already placed/)
    database.close()
  })

  it('rejects unknown sides and non-candidates', () => {
    const harnessState = harness()
    const { database, dependencies } = harnessState
    expect(() => joinOnboardedPartyUseCase({
      role: 'gm', trainerSlug: 'rowan', mapSlug: harnessState.arenaSlug, sideId: 'ghost-side', operationId: 'onbop_join-side',
    }, dependencies)).toThrow(/does not exist/)
    expect(() => joinOnboardedPartyUseCase({
      role: 'gm', trainerSlug: 'nobody', mapSlug: harnessState.arenaSlug, sideId: 'heroes', operationId: 'onbop_join-none',
    }, dependencies)).toThrow(/No completed onboarding package/)
    database.close()
  })
})
