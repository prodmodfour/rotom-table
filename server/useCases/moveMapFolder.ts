import { UseCaseHttpError } from '../utils/useCaseErrors'
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { mapsChannel, type RealtimeEvent } from '~/shared/realtime'
import { MAPS_ROOT, pruneEmptyMapParents, sanitizeMapFolderPath } from '../utils/mapStorage'

export class MoveMapFolderUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveMapFolderInput {
  from?: unknown
  to?: unknown
  clientId?: string
}

export interface MoveMapFolderDependencies {
  mapsRoot?: string
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  pathExists?: (dirPath: string) => boolean
  isDirectory?: (dirPath: string) => boolean
  ensureDirectory?: (dirPath: string) => void
  renameFolder?: (fromPath: string, toPath: string) => void
  pruneEmptyParents?: (dirPath: string) => void
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
  const mapsRoot = dependencies.mapsRoot ?? MAPS_ROOT
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const pathExists = dependencies.pathExists ?? existsSync
  const isDirectory = dependencies.isDirectory ?? ((dirPath: string) => statSync(dirPath).isDirectory())
  const ensureDirectory = dependencies.ensureDirectory ?? ((dirPath: string) => mkdirSync(dirPath, { recursive: true }))
  const renameFolder = dependencies.renameFolder ?? renameSync
  const pruneEmptyParents = dependencies.pruneEmptyParents ?? pruneEmptyMapParents

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

  const source = join(mapsRoot, from)
  const destination = join(mapsRoot, to)
  if (!source.startsWith(mapsRoot + sep) || !destination.startsWith(mapsRoot + sep)) {
    throw new MoveMapFolderUseCaseError(400, 'Invalid path')
  }
  if (!pathExists(source) || !isDirectory(source)) {
    throw new MoveMapFolderUseCaseError(404, `Folder "${from}" not found`)
  }
  if (pathExists(destination)) {
    throw new MoveMapFolderUseCaseError(409, 'Destination folder already exists')
  }

  ensureDirectory(dirname(destination))
  renameFolder(source, destination)
  pruneEmptyParents(source)

  return {
    ok: true,
    moved: true,
    events: [
      {
        channel: mapsChannel,
        type: 'folder-moved',
        clientId: input.clientId,
        data: { from, to },
      },
    ],
  }
}
