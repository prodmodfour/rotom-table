import { UseCaseHttpError } from '../utils/useCaseErrors'
import { dirname, join } from 'node:path'
import { existsSync, renameSync } from 'node:fs'
import { mapChannel, mapsChannel, type RealtimeEvent } from '#shared/realtime'
import type { TabletopMap } from '~/types/map'
import { campaignPathLabel } from '../utils/campaignPaths'
import { allocateSlug, findMapFile, readMapFile, writeMapFile } from '../utils/mapStorage'
import { SLUG_RE, slugify } from '../utils/mapPaths'
import { summarizeMap } from '../utils/mapSummaries'

export class RenameMapUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface RenameMapInput {
  slug?: unknown
  name?: unknown
  clientId?: string
}

export interface RenameMapDependencies {
  now?: () => number
  findMapPath?: (slug: string) => string | null
  readMap?: (filePath: string) => TabletopMap
  writeMap?: (filePath: string, map: TabletopMap) => void
  pathExists?: (filePath: string) => boolean
  renameMapPath?: (oldPath: string, newPath: string) => void
  slugifyName?: (name: string) => string
  allocateMapSlug?: (name: string) => string
  relativePath?: (filePath: string) => string
}

export interface RenameMapResult {
  ok: true
  slug: string
  name: string
  path: string
  map: TabletopMap
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

const MAX_MAP_NAME_LENGTH = 80
const SLUG_ERROR = 'slug must match /^[a-z0-9-]+$/'

export const normalizeRenameMapSlug = (value: unknown): string => {
  const slug = String(value ?? '')
  if (!SLUG_RE.test(slug)) throw new RenameMapUseCaseError(400, SLUG_ERROR)
  return slug
}

export const normalizeRenameMapName = (value: unknown): string => {
  const name = String(value ?? '').trim()
  if (!name) throw new RenameMapUseCaseError(400, 'name is required')
  if (name.length > MAX_MAP_NAME_LENGTH) {
    throw new RenameMapUseCaseError(400, 'name too long (max 80 chars)')
  }
  return name
}

export const renameMapUseCase = (
  input: RenameMapInput,
  dependencies: RenameMapDependencies = {},
): RenameMapResult => {
  const findMapPath = dependencies.findMapPath ?? findMapFile
  const readMap = dependencies.readMap ?? readMapFile
  const writeMap = dependencies.writeMap ?? writeMapFile
  const pathExists = dependencies.pathExists ?? existsSync
  const renameMapPath = dependencies.renameMapPath ?? renameSync
  const slugifyName = dependencies.slugifyName ?? slugify
  const allocateMapSlug = dependencies.allocateMapSlug ?? allocateSlug
  const relativePath = dependencies.relativePath ?? campaignPathLabel
  const now = dependencies.now ?? Date.now

  const slug = normalizeRenameMapSlug(input.slug)
  const name = normalizeRenameMapName(input.name)

  const currentPath = findMapPath(slug)
  if (!currentPath) throw new RenameMapUseCaseError(404, `Map ${slug}.json not found`)

  const map = readMap(currentPath)
  const desiredSlug = slugifyName(name)
  let newSlug = slug
  let newPath = currentPath

  if (desiredSlug && desiredSlug !== slug) {
    newSlug = findMapPath(desiredSlug) ? allocateMapSlug(name) : desiredSlug
    newPath = join(dirname(currentPath), `${newSlug}.json`)
    if (pathExists(newPath)) {
      throw new RenameMapUseCaseError(409, `Map ${newSlug}.json already exists`)
    }
    renameMapPath(currentPath, newPath)
    map.slug = newSlug
  }

  map.name = name
  map.updatedAt = now()
  writeMap(newPath, map)

  const summary = summarizeMap(map)
  const events: Array<Omit<RealtimeEvent, 'timestamp'>> = newSlug !== slug
    ? [
        {
          channel: mapChannel(slug),
          type: 'renamed',
          clientId: input.clientId,
          data: { oldSlug: slug, newSlug, map },
        },
        {
          channel: mapChannel(newSlug),
          type: 'updated',
          clientId: input.clientId,
          data: map,
        },
        {
          channel: mapsChannel,
          type: 'renamed',
          clientId: input.clientId,
          data: { oldSlug: slug, summary },
        },
      ]
    : [
        {
          channel: mapChannel(slug),
          type: 'updated',
          clientId: input.clientId,
          data: map,
        },
        {
          channel: mapsChannel,
          type: 'updated',
          clientId: input.clientId,
          data: summary,
        },
      ]

  return {
    ok: true,
    slug: newSlug,
    name,
    path: relativePath(newPath),
    map,
    events,
  }
}
