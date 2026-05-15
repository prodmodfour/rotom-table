import type { SheetKind } from '#shared/sheets'
import { folderPathFromQuery } from '~/utils/folderBrowser'

export const SHEET_LIBRARY_PATH = '/sheets'

export interface SheetLibraryFolderLocation {
  path: typeof SHEET_LIBRARY_PATH
  query?: { folder: string }
}

export const sheetLibraryPath = (): typeof SHEET_LIBRARY_PATH => SHEET_LIBRARY_PATH

export const sheetLibraryFolderLocation = (folder?: string | null): SheetLibraryFolderLocation => {
  const normalizedFolder = folderPathFromQuery(folder)
  return normalizedFolder
    ? { path: SHEET_LIBRARY_PATH, query: { folder: normalizedFolder } }
    : { path: SHEET_LIBRARY_PATH }
}

export const sheetEditorPath = (kind: SheetKind, slug: string): string => {
  const encodedSlug = encodeURIComponent(slug)
  return kind === 'trainer'
    ? `${SHEET_LIBRARY_PATH}/trainers/${encodedSlug}`
    : `${SHEET_LIBRARY_PATH}/${encodedSlug}`
}

export const sheetKindLabel = (kind: SheetKind): 'Pokémon' | 'Trainer' =>
  kind === 'pokemon' ? 'Pokémon' : 'Trainer'
