import { mapsChannel, type RealtimeEvent } from '~/shared/realtime'
import { deleteMapFolder, type DeleteMapFolderResult as StoredDeleteMapFolderResult } from '../utils/mapFolderStorage'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class DeleteMapFolderUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface DeleteMapFolderInput {
  folder?: unknown
  clientId?: string
}

export interface DeleteMapFolderDependencies {
  deleteFolder?: (folder: string) => StoredDeleteMapFolderResult | null
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
}

export interface DeleteMapFolderResult {
  ok: true
  removed: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const normalizeDeleteMapFolderPath = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeMapFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), false)
  } catch (err) {
    throw new DeleteMapFolderUseCaseError(400, (err as Error).message)
  }
}

const normalizeDeleteFolderStorageError = (err: unknown): DeleteMapFolderUseCaseError => {
  const message = (err as Error).message
  if (message === 'Invalid path: outside root') {
    return new DeleteMapFolderUseCaseError(400, 'Invalid folder path')
  }
  return new DeleteMapFolderUseCaseError(400, message)
}

export const deleteMapFolderUseCase = (
  input: DeleteMapFolderInput,
  dependencies: DeleteMapFolderDependencies = {},
): DeleteMapFolderResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const deleteFolder = dependencies.deleteFolder ?? deleteMapFolder

  const folder = normalizeDeleteMapFolderPath(input.folder, sanitizeFolder)
  let result: StoredDeleteMapFolderResult | null
  try {
    result = deleteFolder(folder)
  } catch (err) {
    throw normalizeDeleteFolderStorageError(err)
  }

  if (!result) throw new DeleteMapFolderUseCaseError(404, `Folder "${folder}" not found`)

  return {
    ok: true,
    removed: result.removed,
    events: [
      {
        channel: mapsChannel,
        type: 'folder-deleted',
        clientId: input.clientId,
        data: { folder },
      },
    ],
  }
}
