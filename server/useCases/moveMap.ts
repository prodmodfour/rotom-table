import { UseCaseHttpError } from '../utils/useCaseErrors'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, sep } from 'node:path'
import { mapChannel, mapsChannel, type RealtimeEvent } from '#shared/realtime'
import type { TabletopMap } from '~/types/map'
import { campaignPathLabel } from '../utils/campaignPaths'
import { findMapFile, readMapFile, writeMapFile } from '../utils/mapStorage'
import { MAPS_ROOT, SLUG_RE, pruneEmptyMapParents, sanitizeMapFolderPath } from '../utils/mapPaths'
import { summarizeMap } from '../utils/mapSummaries'

export class MoveMapUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface MoveMapInput {
  slug?: unknown
  folder?: unknown
  clientId?: string
}

export interface MoveMapDependencies {
  mapsRoot?: string
  now?: () => number
  sanitizeFolder?: (folder: string, allowEmpty: boolean) => string
  findMapPath?: (slug: string) => string | null
  pathExists?: (filePath: string) => boolean
  ensureDirectory?: (dirPath: string) => void
  renameMapPath?: (oldPath: string, newPath: string) => void
  pruneEmptyParents?: (filePath: string) => void
  readMap?: (filePath: string) => TabletopMap
  writeMap?: (filePath: string, map: TabletopMap) => void
  relativePath?: (filePath: string) => string
}

export interface MoveMapResult {
  ok: true
  moved: boolean
  path: string
  map: TabletopMap
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

const SLUG_ERROR = 'slug must match /^[a-z0-9-]+$/'

export const normalizeMoveMapSlug = (value: unknown): string => {
  const slug = String(value ?? '')
  if (!SLUG_RE.test(slug)) throw new MoveMapUseCaseError(400, SLUG_ERROR)
  return slug
}

export const normalizeMoveMapFolder = (
  value: unknown,
  sanitizeFolder: (folder: string, allowEmpty: boolean) => string = sanitizeMapFolderPath,
): string => {
  try {
    return sanitizeFolder(String(value ?? ''), true)
  } catch (err) {
    throw new MoveMapUseCaseError(400, (err as Error).message)
  }
}

export const moveMapUseCase = (
  input: MoveMapInput,
  dependencies: MoveMapDependencies = {},
): MoveMapResult => {
  const mapsRoot = dependencies.mapsRoot ?? MAPS_ROOT
  const sanitizeFolder = dependencies.sanitizeFolder ?? sanitizeMapFolderPath
  const findMapPath = dependencies.findMapPath ?? findMapFile
  const pathExists = dependencies.pathExists ?? existsSync
  const ensureDirectory = dependencies.ensureDirectory ?? ((dirPath: string) => mkdirSync(dirPath, { recursive: true }))
  const renameMapPath = dependencies.renameMapPath ?? renameSync
  const pruneEmptyParents = dependencies.pruneEmptyParents ?? pruneEmptyMapParents
  const readMap = dependencies.readMap ?? readMapFile
  const writeMap = dependencies.writeMap ?? writeMapFile
  const relativePath = dependencies.relativePath ?? campaignPathLabel
  const now = dependencies.now ?? Date.now

  const slug = normalizeMoveMapSlug(input.slug)
  const folder = normalizeMoveMapFolder(input.folder, sanitizeFolder)
  const currentPath = findMapPath(slug)
  if (!currentPath) throw new MoveMapUseCaseError(404, `Map ${slug}.json not found`)

  const destDir = folder ? join(mapsRoot, folder) : mapsRoot
  if (destDir !== mapsRoot && !destDir.startsWith(mapsRoot + sep)) {
    throw new MoveMapUseCaseError(400, 'Invalid destination')
  }
  const destPath = join(destDir, `${slug}.json`)

  let moved = false
  if (currentPath !== destPath) {
    if (pathExists(destPath)) {
      throw new MoveMapUseCaseError(409, 'A map with that name already exists in the target folder')
    }
    ensureDirectory(destDir)
    renameMapPath(currentPath, destPath)
    pruneEmptyParents(currentPath)
    moved = true
  }

  const map = readMap(destPath)
  map.updatedAt = now()
  writeMap(destPath, map)

  return {
    ok: true,
    moved,
    path: relativePath(destPath),
    map,
    events: [
      {
        channel: mapChannel(slug),
        type: 'updated',
        clientId: input.clientId,
        data: map,
      },
      {
        channel: mapsChannel,
        type: 'moved',
        clientId: input.clientId,
        data: summarizeMap(map),
      },
    ],
  }
}
