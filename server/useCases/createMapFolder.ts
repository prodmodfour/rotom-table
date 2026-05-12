import { mapsChannel, type RealtimeEvent } from '#shared/realtime'
import { createMapFolder, type CreateMapFolderResult as StoredCreateMapFolderResult } from '../utils/mapFolderStorage'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class CreateMapFolderUseCaseError extends UseCaseHttpError<400> {}

export interface CreateMapFolderInput {
  folder?: unknown
  clientId?: string
}

export interface CreateMapFolderDependencies {
  createFolder?: (folder: string) => StoredCreateMapFolderResult
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
}

export interface CreateMapFolderResult {
  ok: true
  created: boolean
  path: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const normalizeCreateMapFolder = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeMapFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), false)
  } catch (err) {
    throw new CreateMapFolderUseCaseError(400, (err as Error).message)
  }
}

const normalizeCreateFolderStorageError = (err: unknown): CreateMapFolderUseCaseError => {
  const message = (err as Error).message
  if (message === 'Invalid path: outside root') {
    return new CreateMapFolderUseCaseError(400, 'Invalid destination')
  }
  return new CreateMapFolderUseCaseError(400, message)
}

export const createMapFolderUseCase = (
  input: CreateMapFolderInput,
  dependencies: CreateMapFolderDependencies = {},
): CreateMapFolderResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const createFolder = dependencies.createFolder ?? createMapFolder

  const folder = normalizeCreateMapFolder(input.folder, sanitizeFolder)
  let result: StoredCreateMapFolderResult
  try {
    result = createFolder(folder)
  } catch (err) {
    throw normalizeCreateFolderStorageError(err)
  }

  return {
    ok: true,
    created: result.created,
    path: result.path,
    events: [
      {
        channel: mapsChannel,
        type: 'folder-created',
        clientId: input.clientId,
        data: { folder },
      },
    ],
  }
}
