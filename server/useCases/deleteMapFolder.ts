import { existsSync, rmSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { mapsChannel, type RealtimeEvent } from '~/shared/realtime'
import { relativeToProjectRoot } from '../utils/fsPaths'
import { MAPS_ROOT, pruneEmptyMapParents, sanitizeMapFolderPath } from '../utils/mapStorage'

export class DeleteMapFolderUseCaseError extends Error {
  constructor(
    public readonly statusCode: 400 | 404,
    message: string,
  ) {
    super(message)
  }
}

export interface DeleteMapFolderInput {
  folder?: unknown
  clientId?: string
}

export interface DeleteMapFolderDependencies {
  mapsRoot?: string
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  pathExists?: (dirPath: string) => boolean
  isDirectory?: (dirPath: string) => boolean
  removeFolder?: (dirPath: string) => void
  pruneEmptyParents?: (dirPath: string) => void
  relativePath?: (dirPath: string) => string
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
  const mapsRoot = dependencies.mapsRoot ?? MAPS_ROOT
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const pathExists = dependencies.pathExists ?? existsSync
  const isDirectory = dependencies.isDirectory ?? ((dirPath: string) => statSync(dirPath).isDirectory())
  const removeFolder = dependencies.removeFolder ?? ((dirPath: string) => rmSync(dirPath, { recursive: true, force: true }))
  const pruneEmptyParents = dependencies.pruneEmptyParents ?? pruneEmptyMapParents
  const relativePath = dependencies.relativePath ?? relativeToProjectRoot

  const folder = normalizeDeleteMapFolderPath(input.folder, sanitizeFolder)
  const dir = join(mapsRoot, folder)
  if (dir === mapsRoot || !dir.startsWith(mapsRoot + sep)) {
    throw new DeleteMapFolderUseCaseError(400, 'Invalid folder path')
  }
  if (!pathExists(dir)) {
    throw new DeleteMapFolderUseCaseError(404, `Folder "${folder}" not found`)
  }
  if (!isDirectory(dir)) {
    throw new DeleteMapFolderUseCaseError(400, 'Not a directory')
  }

  removeFolder(dir)
  pruneEmptyParents(dir)

  return {
    ok: true,
    removed: relativePath(dir),
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
