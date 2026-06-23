import { ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { SheetKind } from '#shared/sheets'
import { getErrorMessage } from '~/utils/errorMessages'

export interface CreatedSheetResult {
  ok: true
  kind: SheetKind
  slug: string
}

export interface UseSheetLibraryCreationOptions {
  canCreate: MaybeRefOrGetter<boolean>
  currentPath: MaybeRefOrGetter<string>
  createSheet: (kind: SheetKind, folder: string) => Promise<CreatedSheetResult> | CreatedSheetResult
  navigateToSheet: (kind: SheetKind, slug: string) => void
}

/**
 * Sheet-library specific creation state.
 *
 * The sheet library navigates after creating the SQLite-backed sheet so the
 * editor loads the authoritative runtime document. This composable keeps that
 * busy/error/menu state out of the route shell while the page still injects
 * the concrete API request and navigation behavior.
 */
export const useSheetLibraryCreation = (options: UseSheetLibraryCreationOptions) => {
  const sheetMenuOpen = ref(false)
  const creatingSheet = ref(false)
  const sheetCreateError = ref<string | null>(null)

  const closeSheetMenu = () => {
    sheetMenuOpen.value = false
  }

  const toggleSheetMenu = (): boolean => {
    if (!toValue(options.canCreate)) return false
    sheetMenuOpen.value = !sheetMenuOpen.value
    return true
  }

  const createSheet = async (kind: SheetKind): Promise<CreatedSheetResult | null> => {
    if (!toValue(options.canCreate) || creatingSheet.value) return null

    closeSheetMenu()
    creatingSheet.value = true
    sheetCreateError.value = null

    try {
      const result = await options.createSheet(kind, toValue(options.currentPath))
      options.navigateToSheet(result.kind, result.slug)
      return result
    } catch (err: unknown) {
      sheetCreateError.value = getErrorMessage(err)
      creatingSheet.value = false
      return null
    }
  }

  return {
    sheetMenuOpen,
    creatingSheet,
    sheetCreateError,
    toggleSheetMenu,
    closeSheetMenu,
    createSheet,
  }
}
