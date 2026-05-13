import { ref, watch, type Ref } from 'vue'
import { sheetEditorPath } from '~/utils/sheetRoutes'
import type { SheetKind } from '#shared/sheets'

export interface UseSheetRenameUrlSyncOptions {
  kind: SheetKind
  initialSlug: string
  renamedTo: Ref<string | null>
  replaceUrl?: (path: string) => void
}

const replaceCurrentHistoryUrl = (path: string): void => {
  if (typeof window === 'undefined') return
  window.history.replaceState(window.history.state, '', path)
}

export const useSheetRenameUrlSync = (options: UseSheetRenameUrlSyncOptions) => {
  const currentUrlSlug = ref(options.initialSlug)
  const replaceUrl = options.replaceUrl ?? replaceCurrentHistoryUrl

  watch(options.renamedTo, (newSlug) => {
    if (!newSlug || newSlug === currentUrlSlug.value) return
    currentUrlSlug.value = newSlug
    replaceUrl(sheetEditorPath(options.kind, newSlug))
  })

  return { currentUrlSlug }
}
