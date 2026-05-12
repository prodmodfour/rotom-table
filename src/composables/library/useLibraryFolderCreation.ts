import { ref, toValue, type MaybeRefOrGetter } from 'vue'
import { getErrorMessage } from '~/utils/errorMessages'
import { joinFolderPath, nextAvailableFolderLeaf } from '~/utils/folderBrowser'

export interface UseLibraryFolderCreationOptions {
  canCreate: MaybeRefOrGetter<boolean>
  currentPath: MaybeRefOrGetter<string>
  folderPaths: MaybeRefOrGetter<ReadonlySet<string> | Iterable<string>>
  createFolder: (folderPath: string) => Promise<void> | void
  onCreated?: (folderPath: string) => void
}

/**
 * Shared folder-creation state for library browsers.
 *
 * The composable owns the generic `new_folder`, `new_folder_1`, ... allocation,
 * busy/error state, and create gating. Each page injects the persistence request
 * and local post-create collection update so map/sheet storage semantics stay at
 * the route boundary.
 */
export const useLibraryFolderCreation = (options: UseLibraryFolderCreationOptions) => {
  const creating = ref(false)
  const createError = ref<string | null>(null)

  const nextFolderName = (): string => nextAvailableFolderLeaf(
    toValue(options.folderPaths),
    toValue(options.currentPath),
  )

  const createNewFolder = async (): Promise<string | null> => {
    if (!toValue(options.canCreate) || creating.value) return null

    const folderPath = joinFolderPath(toValue(options.currentPath), nextFolderName())
    creating.value = true
    createError.value = null

    try {
      await options.createFolder(folderPath)
      options.onCreated?.(folderPath)
      return folderPath
    } catch (err: unknown) {
      createError.value = getErrorMessage(err)
      return null
    } finally {
      creating.value = false
    }
  }

  return {
    creating,
    createError,
    nextFolderName,
    createNewFolder,
  }
}
