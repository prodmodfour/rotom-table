import { mapsChannel, type RealtimeEvent } from '#shared/realtime'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { logicalMapFolderPath } from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'

export class CreateMapFolderUseCaseError extends UseCaseHttpError<400> {}

export interface CreateMapFolderInput {
  folder?: unknown
  clientId?: string
}

export interface CreateMapFolderDependencies {
  mapRepository?: Pick<MapRepository, 'createFolder'>
  createFolder?: (folder: string) => { created: boolean; folder: string }
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  now?: () => number
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

export const createMapFolderUseCase = (
  input: CreateMapFolderInput,
  dependencies: CreateMapFolderDependencies = {},
): CreateMapFolderResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const createFolder = dependencies.createFolder ?? ((folder: string) => mapRepository.createFolder(folder, dependencies.now?.()))

  const folder = normalizeCreateMapFolder(input.folder, sanitizeFolder)
  let result
  try {
    result = createFolder(folder)
  } catch (err) {
    throw new CreateMapFolderUseCaseError(400, (err as Error).message)
  }

  return {
    ok: true,
    created: result.created,
    path: logicalMapFolderPath(result.folder),
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
