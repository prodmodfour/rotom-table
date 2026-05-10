import { UseCaseHttpError } from '../utils/useCaseErrors'
import { unlinkSync } from 'node:fs'
import { sep } from 'node:path'
import { mapChannel, mapsChannel, type RealtimeEvent } from '~/shared/realtime'
import { relativeToProjectRoot } from '../utils/fsPaths'
import { findMapFile } from '../utils/mapStorage'
import { MAPS_ROOT, SLUG_RE, pruneEmptyMapParents } from '../utils/mapPaths'

export class DeleteMapUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface DeleteMapInput {
  slug?: unknown
  clientId?: string
}

export interface DeleteMapDependencies {
  mapsRoot?: string
  findMapPath?: (slug: string) => string | null
  removeMapFile?: (filePath: string) => void
  pruneEmptyParents?: (filePath: string) => void
  relativePath?: (filePath: string) => string
}

export interface DeleteMapResult {
  ok: true
  path: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

const SLUG_ERROR = 'slug must match /^[a-z0-9-]+$/'

export const normalizeDeleteMapSlug = (value: unknown): string => {
  const slug = String(value ?? '')
  if (!SLUG_RE.test(slug)) throw new DeleteMapUseCaseError(400, SLUG_ERROR)
  return slug
}

export const deleteMapUseCase = (
  input: DeleteMapInput,
  dependencies: DeleteMapDependencies = {},
): DeleteMapResult => {
  const mapsRoot = dependencies.mapsRoot ?? MAPS_ROOT
  const findMapPath = dependencies.findMapPath ?? findMapFile
  const removeMapFile = dependencies.removeMapFile ?? unlinkSync
  const pruneEmptyParents = dependencies.pruneEmptyParents ?? pruneEmptyMapParents
  const relativePath = dependencies.relativePath ?? relativeToProjectRoot

  const slug = normalizeDeleteMapSlug(input.slug)
  const mapPath = findMapPath(slug)
  if (!mapPath) throw new DeleteMapUseCaseError(404, `Map ${slug}.json not found`)
  if (mapPath === mapsRoot || !mapPath.startsWith(mapsRoot + sep)) {
    throw new DeleteMapUseCaseError(400, 'Invalid map path')
  }

  removeMapFile(mapPath)
  pruneEmptyParents(mapPath)

  return {
    ok: true,
    path: relativePath(mapPath),
    events: [
      {
        channel: mapChannel(slug),
        type: 'deleted',
        clientId: input.clientId,
        data: { slug },
      },
      {
        channel: mapsChannel,
        type: 'deleted',
        clientId: input.clientId,
        data: { slug },
      },
    ],
  }
}
