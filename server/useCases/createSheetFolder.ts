import { sanitizeFolderPath } from '~/shared/paths'
import { createSheetFolder } from '../utils/sheetStorage'

export class CreateSheetFolderUseCaseError extends Error {
  constructor(
    public readonly statusCode: 400,
    message: string,
  ) {
    super(message)
  }
}

export interface CreateSheetFolderInput {
  folder?: unknown
}

export interface CreateSheetFolderDependencies {
  createFolder?: (folder: string) => { created: boolean; path: string; folder: string }
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
  const createFolder = dependencies.createFolder ?? ((folder: string) => createSheetFolder(folder, 'pokemon'))

  const folder = normalizeCreateSheetFolderPath(input.folder)
  const result = createFolder(folder)
  return { ok: true, created: result.created, path: result.path }
}
