import { mapsChannel, type RealtimeEvent } from '#shared/realtime'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { logicalMapFolderPath } from '../utils/runtimeResourcePaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'

export class DeleteMapFolderUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface DeleteMapFolderInput {
  folder?: unknown
  clientId?: string
}

export interface DeleteMapFolderDependencies {
  mapRepository?: Pick<MapRepository, 'deleteFolder'>
  deleteFolder?: (folder: string) => { folder?: string; removed?: string } | null
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

export const deleteMapFolderUseCase = (
  input: DeleteMapFolderInput,
  dependencies: DeleteMapFolderDependencies = {},
): DeleteMapFolderResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const deleteFolder = dependencies.deleteFolder ?? ((folder: string) => mapRepository.deleteFolder(folder))

  const folder = normalizeDeleteMapFolderPath(input.folder, sanitizeFolder)
  let result
  try {
    result = deleteFolder(folder)
  } catch (err) {
    throw new DeleteMapFolderUseCaseError(400, (err as Error).message)
  }

  if (!result) throw new DeleteMapFolderUseCaseError(404, `Folder "${folder}" not found`)

  return {
    ok: true,
    removed: ('removed' in result && typeof result.removed === 'string')
      ? result.removed
      : logicalMapFolderPath(result.folder ?? folder),
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
