import { mapsChannel, type RealtimeEvent } from '#shared/realtime'
import { moveMapFolder, type MoveMapFolderResult as StoredMoveMapFolderResult } from '../utils/mapFolderStorage'
import { sanitizeMapFolderPath } from '../utils/mapPaths'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class MoveMapFolderUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveMapFolderInput {
  from?: unknown
  to?: unknown
  clientId?: string
}

export interface MoveMapFolderDependencies {
  moveFolder?: (from: string, to: string) => StoredMoveMapFolderResult | null
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
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

const normalizeMoveFolderStorageError = (err: unknown): MoveMapFolderUseCaseError => {
  const message = (err as Error).message
  if (message === 'Destination folder already exists') {
    return new MoveMapFolderUseCaseError(409, message)
  }
  if (message === 'Invalid path: outside root') {
    return new MoveMapFolderUseCaseError(400, 'Invalid path')
  }
  return new MoveMapFolderUseCaseError(400, message)
}

export const moveMapFolderUseCase = (
  input: MoveMapFolderInput,
  dependencies: MoveMapFolderDependencies = {},
): MoveMapFolderResult => {
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const moveFolder = dependencies.moveFolder ?? moveMapFolder

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

  let result: StoredMoveMapFolderResult | null
  try {
    result = moveFolder(from, to)
  } catch (err) {
    throw normalizeMoveFolderStorageError(err)
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
