import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { BreedingWorkshopOwnershipContextV1 } from '../../../shared/breeding/workshop'
import { createBreedingWorkshopProjectionV1 } from '../../../server/domain/breeding/workshop'
import { useBreedingWorkshop } from '../../../src/composables/breeding/useBreedingWorkshop'

const context = (index: number): BreedingWorkshopOwnershipContextV1 => ({
  trainerSheetSlug: `trainer-${String(index).padStart(3, '0')}`,
  trainerRevision: 1,
  displayName: `Trainer ${index}`,
  availability: 'available',
  unavailableReasonId: null,
  hasProjects: false,
  hasEggs: false,
})
const profileRequired = () => createBreedingWorkshopProjectionV1({
  audience: 'owner',
  generatedAtCampaignMinute: 10,
  profileSelectionRequired: true,
  ownershipCursor: null,
  nextOwnershipCursor: null,
  ownershipContexts: [],
  selectedOwnershipContext: null,
  emptyState: 'profile-required',
})

const installGlobals = (options: {
  readonly player?: boolean
  readonly responses: readonly unknown[]
  readonly query?: Record<string, string>
}) => {
  const route = { fullPath: '/breeding', query: { ...(options.query ?? {}) } }
  const replace = vi.fn(async (location: { query?: Record<string, string> }) => {
    if (location.query) route.query = { ...location.query }
  })
  const getJson = vi.fn()
  for (const response of options.responses) getJson.mockResolvedValueOnce(response)
  const profiles = {
    selectedProfileId: ref('profile_owner000'),
    loadRememberedProfile: vi.fn(),
    reloadProfiles: vi.fn(async () => undefined),
  }
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ replace }))
  vi.stubGlobal('useAuth', () => ({ isPlayer: ref(options.player === true) }))
  vi.stubGlobal('useApiClient', () => ({ getJson }))
  vi.stubGlobal('usePlayerProfiles', () => profiles)
  return { route, replace, getJson, profiles }
}

afterEach(() => vi.unstubAllGlobals())

describe('useBreedingWorkshop', () => {
  it('loads current Profile authority and adopts only a verified projection', async () => {
    const globals = installGlobals({ player: true, responses: [profileRequired()] })
    const workshop = useBreedingWorkshop()
    await workshop.initialize()

    expect(globals.profiles.loadRememberedProfile).toHaveBeenCalledOnce()
    expect(globals.profiles.reloadProfiles).toHaveBeenCalledWith({
      silent: true,
      clearMissingSelection: true,
    })
    expect(globals.getJson).toHaveBeenCalledWith('/api/breeding/workshop', {
      params: {
        profileId: 'profile_owner000',
        trainerSheetSlug: undefined,
        ownershipCursor: undefined,
      },
    })
    expect(workshop.projection.value?.emptyState).toBe('profile-required')
    expect(workshop.error.value).toBeNull()
  })

  it('rejects hash drift without adopting response facts', async () => {
    const valid = profileRequired()
    const globals = installGlobals({
      player: true,
      responses: [{ ...valid, generatedAtCampaignMinute: 11 }],
    })
    const workshop = useBreedingWorkshop()
    await workshop.initialize()

    expect(globals.getJson).toHaveBeenCalledOnce()
    expect(workshop.projection.value).toBeNull()
    expect(workshop.ownershipContexts.value).toEqual([])
    expect(workshop.error.value).toContain('hash does not match')
  })

  it('appends only verified canonical pages and preserves selected ownership', async () => {
    const firstContexts = Array.from({ length: 100 }, (_entry, index) => context(index))
    const first = createBreedingWorkshopProjectionV1({
      audience: 'gm',
      generatedAtCampaignMinute: 10,
      profileSelectionRequired: false,
      ownershipCursor: null,
      nextOwnershipCursor: 'trainer-099',
      ownershipContexts: firstContexts,
      selectedOwnershipContext: firstContexts[0]!,
      emptyState: 'selected-context-empty',
    })
    const last = context(100)
    const second = createBreedingWorkshopProjectionV1({
      audience: 'gm',
      generatedAtCampaignMinute: 10,
      profileSelectionRequired: false,
      ownershipCursor: 'trainer-099',
      nextOwnershipCursor: null,
      ownershipContexts: [last],
      selectedOwnershipContext: firstContexts[0]!,
      emptyState: 'selected-context-empty',
    })
    const globals = installGlobals({ responses: [first, second] })
    const workshop = useBreedingWorkshop()
    await workshop.initialize()
    await workshop.loadMoreOwnershipContexts()

    expect(workshop.ownershipContexts.value).toHaveLength(101)
    expect(workshop.ownershipContexts.value.at(-1)?.trainerSheetSlug).toBe('trainer-100')
    expect(workshop.selectedOwnershipContext.value?.trainerSheetSlug).toBe('trainer-000')
    expect(globals.getJson).toHaveBeenLastCalledWith('/api/breeding/workshop', {
      params: {
        profileId: undefined,
        trainerSheetSlug: 'trainer-000',
        ownershipCursor: 'trainer-099',
      },
    })
  })

  it('reloads selected Trainer authority before updating the route', async () => {
    const first = createBreedingWorkshopProjectionV1({
      audience: 'gm',
      generatedAtCampaignMinute: 10,
      profileSelectionRequired: false,
      ownershipCursor: null,
      nextOwnershipCursor: null,
      ownershipContexts: [context(0), context(1)],
      selectedOwnershipContext: context(0),
      emptyState: 'selected-context-empty',
    })
    const second = createBreedingWorkshopProjectionV1({
      audience: 'gm',
      generatedAtCampaignMinute: 10,
      profileSelectionRequired: false,
      ownershipCursor: null,
      nextOwnershipCursor: null,
      ownershipContexts: [context(0), context(1)],
      selectedOwnershipContext: context(1),
      emptyState: 'selected-context-empty',
    })
    const globals = installGlobals({ responses: [first, second] })
    const workshop = useBreedingWorkshop()
    await workshop.initialize()
    await workshop.selectOwnershipContext('trainer-001')

    expect(workshop.selectedOwnershipContext.value?.trainerSheetSlug).toBe('trainer-001')
    expect(globals.replace).toHaveBeenCalledWith({ query: { trainer: 'trainer-001' } })
  })
})
