import { UseCaseHttpError } from '../utils/useCaseErrors'
import { mapChannel, mapsChannel, type RealtimeEvent } from '#shared/realtime'
import { validateSlug } from '#shared/paths'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'

export class DeleteMapUseCaseError extends UseCaseHttpError<400 | 404> {}

export interface DeleteMapInput {
  slug?: unknown
  clientId?: string
}

export interface DeleteMapDependencies {
  mapRepository?: Pick<MapRepository, 'deleteDocument'>
}

export interface DeleteMapResult {
  ok: true
  path: string
  events: Array<Omit<RealtimeEvent, 'timestamp'>>
}

export const normalizeDeleteMapSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'slug')
  } catch {
    throw new DeleteMapUseCaseError(400, 'slug must match /^[a-z0-9-]+$/')
  }
}

export const deleteMapUseCase = (
  input: DeleteMapInput,
  dependencies: DeleteMapDependencies = {},
): DeleteMapResult => {
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const slug = normalizeDeleteMapSlug(input.slug)
  const deleted = mapRepository.deleteDocument(slug)
  if (!deleted) throw new DeleteMapUseCaseError(404, `Map ${slug}.json not found`)

  const path = logicalMapResourcePath(deleted.map)
  return {
    ok: true,
    path,
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
