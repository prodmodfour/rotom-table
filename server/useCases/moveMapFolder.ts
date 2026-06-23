import { mapsChannel, type RealtimeEvent } from '#shared/realtime'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'

export class MoveMapFolderUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveMapFolderInput {
  from?: unknown
  to?: unknown
  clientId?: string
}

export interface MoveMapFolderDependencies {
  mapRepository?: Pick<MapRepository, 'moveFolder'>
  moveFolder?: (from: string, to: string) => { moved: boolean } | null
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  now?: () => number
}

export interface MoveMapFolderResult {
  ok: true
  moved: boolean
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const normalizeMoveMapFolderPath = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeMapFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), false)
  } catch (err) {
    throw new MoveMapFolderUseCaseError(400, (err as Error).message)
  }
}

export const moveMapFolderUseCase = (
  input: MoveMapFolderInput,
  dependencies: MoveMapFolderDependencies = {},
): MoveMapFolderResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const moveFolder = dependencies.moveFolder ?? ((from: string, to: string) => mapRepository.moveFolder(from, to, dependencies.now?.()))

  const from = normalizeMoveMapFolderPath(input.from, sanitizeFolder)
  const to = normalizeMoveMapFolderPath(input.to, sanitizeFolder)

  if (from === to) {
    return {
      ok: true,
      moved: false,
      events: [],
    }
  }
  if (to.startsWith(`${from}/`)) {
    throw new MoveMapFolderUseCaseError(400, 'Cannot move a folder into itself or one of its descendants')
  }

  let result
  try {
    result = moveFolder(from, to)
  } catch (err) {
    const message = (err as Error).message
    if (message === 'Destination folder already exists') throw new MoveMapFolderUseCaseError(409, message)
    throw new MoveMapFolderUseCaseError(400, message)
  }

  if (!result) throw new MoveMapFolderUseCaseError(404, `Folder "${from}" not found`)

  return {
    ok: true,
    moved: result.moved,
    events: result.moved
      ? [
          {
            channel: mapsChannel,
            type: 'folder-moved',
            clientId: input.clientId,
            data: { from, to },
          },
        ]
      : [],
  }
}
