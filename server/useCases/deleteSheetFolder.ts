import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sanitizeFolderPath } from '#shared/paths'
import { deleteSheetFolder, type DeleteFolderResult } from '../utils/sheetFolderStorage'

export class DeleteSheetFolderUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface DeleteSheetFolderInput {
  folder?: unknown
}

export interface DeleteSheetFolderDependencies {
  deleteFolder?: (folder: string) => DeleteFolderResult | null
}

export interface DeleteSheetFolderResult {
  ok: true
  count: number
  removed: string[]
}

export const normalizeDeleteSheetFolderPath = (value: unknown): string => {
  try {
    return sanitizeFolderPath(String(value ?? ''))
  } catch (err) {
    throw new DeleteSheetFolderUseCaseError(400, (err as Error).message)
  }
}

export const deleteSheetFolderUseCase = (
  input: DeleteSheetFolderInput,
  dependencies: DeleteSheetFolderDependencies = {},
): DeleteSheetFolderResult => {
  const deleteFolder = dependencies.deleteFolder ?? deleteSheetFolder
  const folder = normalizeDeleteSheetFolderPath(input.folder)
  const result = deleteFolder(folder)
  if (!result) throw new DeleteSheetFolderUseCaseError(404, `Folder "${folder}" not found`)

  return { ok: true, count: result.count, removed: result.removed }
}
