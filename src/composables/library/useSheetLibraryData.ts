import { computed, onMounted, reactive, ref } from 'vue'
import { getPokedexEntry, getSpriteUrl } from '~~/data/characterSheets'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { useApiClient } from '~/composables/useApiClient'
import { SHEET_API_PATHS } from '~/utils/apiRoutes'
import { getErrorMessage } from '~/utils/errorMessages'
import {
  buildSheetListFetchOptions,
  type SheetApiProfileContext,
} from '~/utils/sheetApiRequests'
import {
  applySheetLibraryOverrides,
  buildSheetFolderSet,
  buildSheetLibraryItems,
} from '~/utils/sheetLibrary'

export interface SheetLibraryFolderFetchResult {
  folders: string[]
}

export interface SheetLibraryListFetchResult {
  pokemonSheets: CharacterSheet[]
  trainerSheets: TrainerSheet[]
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
  fetchSheets?: () => Promise<SheetLibraryListFetchResult>
  sheetProfileContext?: () => SheetApiProfileContext
  pokemonSheets?: ReadonlyArray<CharacterSheet>
  trainerSheets?: ReadonlyArray<TrainerSheet>
  speciesTypesFor?: (species: string) => string[] | undefined
  spriteUrlFor?: (species: string) => string | null
}

const defaultFetchFolders = (): Promise<SheetLibraryFolderFetchResult> =>
  useApiClient().getJson<SheetLibraryFolderFetchResult>(SHEET_API_PATHS.folders)

const defaultFetchSheets = (
  profileContext?: SheetApiProfileContext,
): Promise<SheetLibraryListFetchResult> =>
  useApiClient().getJson<SheetLibraryListFetchResult>(
    SHEET_API_PATHS.list,
    buildSheetListFetchOptions(profileContext),
  )

export const useSheetLibraryData = (options: UseSheetLibraryDataOptions) => {
  const sheetOverrides = reactive<Record<string, string>>({})
  const folderRenames = ref<Array<{ from: string; to: string }>>([])
  const nameOverrides = reactive<Record<string, string>>({})
  const deletedSheets = reactive(new Set<string>())
  const deletedFolders = reactive(new Set<string>())
  const extraFolders = reactive(new Set<string>())
  const loadingFolders = ref(false)
  const folderLoadError = ref<string | null>(null)
  const runtimePokemonSheets = ref<ReadonlyArray<CharacterSheet> | null>(null)
  const runtimeTrainerSheets = ref<ReadonlyArray<TrainerSheet> | null>(null)

  const fetchFolders = options.fetchFolders ?? defaultFetchFolders
  const fetchSheets = options.fetchSheets ?? (() => defaultFetchSheets(options.sheetProfileContext?.()))
  const speciesTypesFor = options.speciesTypesFor ?? ((species: string) => getPokedexEntry(species)?.types)
  const spriteUrlFor = options.spriteUrlFor ?? getSpriteUrl
  const canUseDefaultSheetFetch = options.pokemonSheets === undefined && options.trainerSheets === undefined

  const baseItems = computed(() => buildSheetLibraryItems({
    pokemonSheets: runtimePokemonSheets.value ?? options.pokemonSheets ?? [],
    trainerSheets: runtimeTrainerSheets.value ?? options.trainerSheets ?? [],
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
  const canLoadSheets = (): boolean => options.fetchSheets !== undefined || canUseDefaultSheetFetch

  const loadFolders = async (): Promise<void> => {
    const shouldLoadFolders = canLoadFolders()
    const shouldLoadSheets = canLoadSheets()
    if (!shouldLoadFolders && !shouldLoadSheets) return

    loadingFolders.value = true
    folderLoadError.value = null
    try {
      const [folderData, sheetData] = await Promise.all([
        shouldLoadFolders ? fetchFolders() : Promise.resolve(null),
        shouldLoadSheets ? fetchSheets() : Promise.resolve(null),
      ])

      if (folderData) {
        extraFolders.clear()
        for (const folder of folderData.folders) extraFolders.add(folder)
      }

      if (sheetData) {
        runtimePokemonSheets.value = sheetData.pokemonSheets
        runtimeTrainerSheets.value = sheetData.trainerSheets
      }
    } catch (err: unknown) {
      folderLoadError.value = getErrorMessage(err)
      console.warn('[sheets] failed to load existing sheet data', err)
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
    runtimePokemonSheets,
    runtimeTrainerSheets,
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
