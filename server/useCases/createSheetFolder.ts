import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sanitizeFolderPath } from '#shared/paths'
import { SHEET_KINDS, type SheetKind } from '#shared/sheets'
import { sqliteSheetRepository, type SheetRepository } from '../storage/sheetRepository'
import { logicalSheetFolderPath } from '../utils/runtimeResourcePaths'

export class CreateSheetFolderUseCaseError extends UseCaseHttpError<400> {}

export interface CreateSheetFolderInput {
  folder?: unknown
}

export interface CreateSheetFolderDependencies {
  sheetRepository?: Pick<SheetRepository, 'createFolder'>
  createFolder?: (folder: string) => { created: boolean; path: string; folder: string }
  now?: () => number
}

export interface CreateSheetFolderResult {
  ok: true
  created: boolean
  path: string
}

export const normalizeCreateSheetFolderPath = (value: unknown): string => {
  try {
    return sanitizeFolderPath(String(value ?? ''))
  } catch (err) {
    throw new CreateSheetFolderUseCaseError(400, (err as Error).message)
  }
}

export const createSheetFolderUseCase = (
  input: CreateSheetFolderInput,
  dependencies: CreateSheetFolderDependencies = {},
): CreateSheetFolderResult => {
  const sheetRepository = dependencies.sheetRepository ?? sqliteSheetRepository
  const createFolder = dependencies.createFolder
  const folder = normalizeCreateSheetFolderPath(input.folder)

  if (createFolder) {
    const result = createFolder(folder)
    return { ok: true, created: result.created, path: result.path }
  }

  let created = false
  for (const kind of SHEET_KINDS) {
    const result = sheetRepository.createFolder(kind as SheetKind, folder, dependencies.now?.())
    created = created || result.created
  }
  return { ok: true, created, path: logicalSheetFolderPath('pokemon', folder) }
}
