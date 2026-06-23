import type { AuthRole } from '#shared/auth'
import { sqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'

export interface ListSheetFoldersInput {
  role: AuthRole
}

export interface ListSheetFoldersDependencies {
  sheetRepository?: Pick<SheetRepository, 'listFolders'>
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

  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository
  const listFolders = dependencies.listFolders ?? (() => [...sheetRepository.listFolders()])
  return { folders: listFolders() }
}
