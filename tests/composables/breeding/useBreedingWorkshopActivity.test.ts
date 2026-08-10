import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createBreedingWorkshopActivityProjectionV1 } from '../../../server/domain/breeding/workshopActivity'
import { useBreedingWorkshopActivity } from '../../../src/composables/breeding/useBreedingWorkshopActivity'

const projection = (trainer = 'trainer-owner') => createBreedingWorkshopActivityProjectionV1({
  audience: 'owner',
  trainer: { trainerSheetSlug: trainer, trainerRevision: 1, displayName: 'Mira' },
  generatedAtCampaignMinute: 100,
  projectsTruncated: false,
  eggsTruncated: false,
  projects: [],
  eggs: [],
})
const install = (responses: readonly unknown[], player = true) => {
  const getJson = vi.fn()
  responses.forEach(response => getJson.mockResolvedValueOnce(response))
  vi.stubGlobal('useAuth', () => ({ isPlayer: ref(player) }))
  vi.stubGlobal('useApiClient', () => ({ getJson }))
  vi.stubGlobal('usePlayerProfiles', () => ({ selectedProfileId: ref('profile_owner000') }))
  return { getJson }
}
afterEach(() => vi.unstubAllGlobals())

describe('useBreedingWorkshopActivity', () => {
  it('loads a selected Trainer with current Profile authority and adopts only verified cards', async () => {
    const globals = install([projection()])
    const activity = useBreedingWorkshopActivity()
    await activity.load('trainer-owner')
    expect(globals.getJson).toHaveBeenCalledWith('/api/breeding/workshop/activity', {
      params: { profileId: 'profile_owner000', trainerSheetSlug: 'trainer-owner' },
    })
    expect(activity.projection.value?.trainer.displayName).toBe('Mira')
    expect(activity.error.value).toBeNull()
  })

  it('rejects response hash drift and clears stale cards on failure', async () => {
    const valid = projection()
    const globals = install([valid, { ...valid, generatedAtCampaignMinute: 101 }])
    const activity = useBreedingWorkshopActivity()
    await activity.load('trainer-owner')
    expect(activity.projection.value).not.toBeNull()
    await activity.reload()
    expect(globals.getJson).toHaveBeenCalledTimes(2)
    expect(activity.projection.value).toBeNull()
    expect(activity.error.value).toContain('does not match')
  })

  it('omits Profile claims for GM activity and clears authority when selection disappears', async () => {
    const globals = install([createBreedingWorkshopActivityProjectionV1({
      audience: 'gm',
      trainer: { trainerSheetSlug: 'trainer-owner', trainerRevision: 1, displayName: 'Mira' },
      generatedAtCampaignMinute: 100,
      projectsTruncated: false,
      eggsTruncated: false,
      projects: [], eggs: [],
    })], false)
    const activity = useBreedingWorkshopActivity()
    await activity.load('trainer-owner')
    expect(globals.getJson).toHaveBeenCalledWith('/api/breeding/workshop/activity', {
      params: { profileId: undefined, trainerSheetSlug: 'trainer-owner' },
    })
    await activity.load(null)
    expect(activity.projection.value).toBeNull()
    expect(activity.loading.value).toBe(false)
  })

  it('ignores a slower response after a newer Trainer selection', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    const first = new Promise<unknown>(resolve => { resolveFirst = resolve })
    const getJson = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(projection('trainer-second'))
    vi.stubGlobal('useAuth', () => ({ isPlayer: ref(true) }))
    vi.stubGlobal('useApiClient', () => ({ getJson }))
    vi.stubGlobal('usePlayerProfiles', () => ({ selectedProfileId: ref('profile_owner000') }))
    const activity = useBreedingWorkshopActivity()
    const oldLoad = activity.load('trainer-owner')
    await activity.load('trainer-second')
    resolveFirst?.(projection('trainer-owner'))
    await oldLoad
    expect(activity.projection.value?.trainer.trainerSheetSlug).toBe('trainer-second')
  })
})
