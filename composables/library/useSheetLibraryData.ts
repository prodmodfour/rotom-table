import { computed, onMounted, reactive, ref } from 'vue'
import { characterSheets, getPokedexEntry, getSpriteUrl } from '~/data/characterSheets'
import { trainerSheets } from '~/data/trainerSheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { useApiClient } from '~/composables/useApiClient'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  applySheetLibraryOverrides,
  buildSheetFolderSet,
  buildSheetLibraryItems,
} from '~/utils/sheetLibrary'

export interface SheetLibraryFolderFetchResult {
  folders: string[]
}

interface BooleanSource {
  readonly value: boolean
}

export interface UseSheetLibraryDataOptions {
  isGm: BooleanSource
  isPlayer: BooleanSource
  canLoadFolders?: BooleanSource
  autoLoadFoldersOnMounted?: boolean
  fetchFolders?: () => Promise<SheetLibraryFolderFetchResult>
  pokemonSheets?: ReadonlyArray<CharacterSheet>
  trainerSheets?: ReadonlyArray<TrainerSheet>
  speciesTypesFor?: (species: string) => string[] | undefined
  spriteUrlFor?: (species: string) => string | null
}

const defaultFetchFolders = (): Promise<SheetLibraryFolderFetchResult> =>
  useApiClient().getJson<SheetLibraryFolderFetchResult>(SHEET_API_PATHS.folders)

export const useSheetLibraryData = (options: UseSheetLibraryDataOptions) => {
  const sheetOverrides = reactive<Record<string, string>>({})
  const folderRenames = ref<Array<{ from: string; to: string }>>([])
  const nameOverrides = reactive<Record<string, string>>({})
  const deletedSheets = reactive(new Set<string>())
  const deletedFolders = reactive(new Set<string>())
  const extraFolders = reactive(new Set<string>())
  const loadingFolders = ref(false)
  const folderLoadError = ref<string | null>(null)

  const fetchFolders = options.fetchFolders ?? defaultFetchFolders
  const speciesTypesFor = options.speciesTypesFor ?? ((species: string) => getPokedexEntry(species)?.types)
  const spriteUrlFor = options.spriteUrlFor ?? getSpriteUrl

  const baseItems = computed(() => buildSheetLibraryItems({
    pokemonSheets: options.pokemonSheets ?? characterSheets,
    trainerSheets: options.trainerSheets ?? trainerSheets,
    speciesTypesFor,
    spriteUrlFor,
  }))

  const items = computed(() => applySheetLibraryOverrides(baseItems.value, {
    playerOnly: options.isPlayer.value,
    sheetOverrides,
    folderRenames: folderRenames.value,
    nameOverrides,
    deletedSheets,
    deletedFolders,
  }))

  const allFolders = computed(() => buildSheetFolderSet({
    items: items.value,
    extraFolders,
    includeExtraFolders: options.isGm.value,
    folderRenames: folderRenames.value,
    deletedFolders,
  }))

  const canLoadFolders = (): boolean => (options.canLoadFolders ?? options.isGm).value

  const loadFolders = async (): Promise<void> => {
    if (!canLoadFolders()) return

    loadingFolders.value = true
    folderLoadError.value = null
    try {
      const data = await fetchFolders()
      for (const folder of data.folders) extraFolders.add(folder)
    } catch (err: unknown) {
      folderLoadError.value = getErrorMessage(err)
      console.warn('[sheets] failed to load existing folders', err)
    } finally {
      loadingFolders.value = false
    }
  }

  if (options.autoLoadFoldersOnMounted !== false) {
    onMounted(() => {
      void loadFolders()
    })
  }

  return {
    baseItems,
    items,
    allFolders,
    extraFolders,
    sheetOverrides,
    folderRenames,
    nameOverrides,
    deletedSheets,
    deletedFolders,
    loadingFolders,
    folderLoadError,
    loadFolders,
  }
}
