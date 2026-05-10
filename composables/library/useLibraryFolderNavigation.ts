import { computed, type ComputedRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  buildFolderBreadcrumbs,
  folderPathFromQuery,
  type FolderBreadcrumb,
} from '~/utils/folderBrowser'

export interface UseLibraryFolderNavigationOptions {
  routePath: string
  formatSegment?: (segment: string) => string
}

export interface LibraryFolderNavigation {
  currentPath: ComputedRef<string>
  breadcrumbs: ComputedRef<FolderBreadcrumb[]>
  goToFolder: (path: string) => void
}

export const useLibraryFolderNavigation = (
  options: UseLibraryFolderNavigationOptions,
): LibraryFolderNavigation => {
  const route = useRoute()
  const router = useRouter()

  const currentPath = computed(() => folderPathFromQuery(route.query.folder))
  const breadcrumbs = computed(() => buildFolderBreadcrumbs(
    currentPath.value,
    options.formatSegment ? { formatSegment: options.formatSegment } : undefined,
  ))

  const goToFolder = (path: string) => {
    router.push({ path: options.routePath, query: path ? { folder: path } : {} })
  }

  return { currentPath, breadcrumbs, goToFolder }
}
