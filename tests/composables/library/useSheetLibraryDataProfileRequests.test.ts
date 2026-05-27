import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePlayerProfileId } from '#shared/playerProfiles'
import { useSheetLibraryData } from '~/composables/library/useSheetLibraryData'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { sheetApiProfileContext } from '~/utils/sheetApiRequests'

const apiMocks = vi.hoisted(() => ({
  getJson: vi.fn(),
}))

vi.mock('~/composables/useApiClient', () => ({
  useApiClient: () => ({
    getJson: apiMocks.getJson,
  }),
}))

describe('useSheetLibraryData profile-aware requests', () => {
  beforeEach(() => {
    apiMocks.getJson.mockReset()
    apiMocks.getJson.mockResolvedValue({ pokemonSheets: [], trainerSheets: [] })
  })

  it('passes the selected player profile id to the default sheet list API request', async () => {
    const profileId = parsePlayerProfileId('profile_ash00000')
    const data = useSheetLibraryData({
      isGm: ref(false),
      isPlayer: ref(true),
      canLoadFolders: ref(false),
      autoLoadFoldersOnMounted: false,
      sheetProfileContext: () => sheetApiProfileContext(true, profileId),
      speciesTypesFor: () => [],
      spriteUrlFor: () => null,
    })

    await data.loadFolders()

    expect(apiMocks.getJson).toHaveBeenCalledTimes(1)
    expect(apiMocks.getJson).toHaveBeenCalledWith(SHEET_API_PATHS.list, {
      params: { profileId },
    })
  })
})
