import { existsSync, mkdirSync } from 'node:fs'
import { join, sep } from 'node:path'
import { mapsChannel, type RealtimeEvent } from '~/shared/realtime'
import { relativeToProjectRoot } from '../utils/fsPaths'
import { MAPS_ROOT, sanitizeMapFolderPath } from '../utils/mapStorage'

export class CreateMapFolderUseCaseError extends Error {
  constructor(
    public readonly statusCode: 400,
    message: string,
  ) {
    super(message)
  }
}

export interface CreateMapFolderInput {
  folder?: unknown
  clientId?: string
}

export interface CreateMapFolderDependencies {
  mapsRoot?: string
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  pathExists?: (dirPath: string) => boolean
  ensureDirectory?: (dirPath: string) => void
  relativePath?: (dirPath: string) => string
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
  const mapsRoot = dependencies.mapsRoot ?? MAPS_ROOT
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const pathExists = dependencies.pathExists ?? existsSync
  const ensureDirectory = dependencies.ensureDirectory ?? ((dirPath: string) => mkdirSync(dirPath, { recursive: true }))
  const relativePath = dependencies.relativePath ?? relativeToProjectRoot

  const folder = normalizeCreateMapFolder(input.folder, sanitizeFolder)
  const destination = join(mapsRoot, folder)
  if (!destination.startsWith(mapsRoot + sep)) {
    throw new CreateMapFolderUseCaseError(400, 'Invalid destination')
  }

  const existed = pathExists(destination)
  ensureDirectory(destination)

  return {
    ok: true,
    created: !existed,
    path: relativePath(destination),
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
