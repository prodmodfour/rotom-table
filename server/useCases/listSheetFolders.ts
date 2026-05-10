import type { AuthRole } from '~/shared/auth'
import { listSheetFolders } from '../utils/sheetFolderStorage'

export interface ListSheetFoldersInput {
  role: AuthRole
}

export interface ListSheetFoldersDependencies {
  listFolders?: () => string[]
}

export interface ListSheetFoldersResult {
  folders: string[]
}

export const listSheetFoldersUseCase = (
  input: ListSheetFoldersInput,
  dependencies: ListSheetFoldersDependencies = {},
): ListSheetFoldersResult => {
  if (input.role === 'player') return { folders: [] }

  const listFolders = dependencies.listFolders ?? (() => listSheetFolders())
  return { folders: listFolders() }
}
