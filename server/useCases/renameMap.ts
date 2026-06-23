import { UseCaseHttpError } from '../utils/useCaseErrors'
import { mapChannel, mapsChannel, type RealtimeEvent } from '#shared/realtime'
import type { TabletopMap } from '~/types/map'
import { validateSlug } from '#shared/paths'
import { summarizeMap } from '../utils/mapSummaries'
import {
  mapRevisionForRealtime,
  mapSummaryUpdatedRealtimeEvent,
  mapUpdatedRealtimeEvent,
} from '../utils/mapRealtimeEvents'
import { logicalMapResourcePath } from '../utils/runtimeResourcePaths'
import { sqliteMapRepository, type MapRepository } from '../storage/mapRepository'

export class RenameMapUseCaseError extends UseCaseHttpError<400 | 404 | 409> {}

export interface RenameMapInput {
  slug?: unknown
  name?: unknown
  clientId?: string
}

export interface RenameMapDependencies {
  now?: () => number
  mapRepository?: Pick<MapRepository, 'rename'>
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

export const normalizeRenameMapSlug = (value: unknown): string => {
  try {
    return validateSlug(value, 'slug')
  } catch {
    throw new RenameMapUseCaseError(400, 'slug must match /^[a-z0-9-]+$/')
  }
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
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const now = dependencies.now ?? Date.now

  const slug = normalizeRenameMapSlug(input.slug)
  const name = normalizeRenameMapName(input.name)

  let renamed
  try {
    renamed = mapRepository.rename({ slug, name, now: now() })
  } catch (err) {
    const message = (err as Error).message
    if (message.includes('already exists') || message.includes('UNIQUE')) throw new RenameMapUseCaseError(409, message)
    throw new RenameMapUseCaseError(400, message)
  }
  if (!renamed) throw new RenameMapUseCaseError(404, `Map ${slug}.json not found`)

  const map = renamed.map
  const summary = summarizeMap(map)
  const revision = mapRevisionForRealtime(map)
  const events: Array<Omit<RealtimeEvent, 'timestamp'>> = !renamed.changed
    ? []
    : renamed.renamed
      ? [
          {
            channel: mapChannel(slug),
            type: 'renamed',
            revision,
            clientId: input.clientId,
            data: { oldSlug: slug, newSlug: renamed.newSlug, map },
          },
          mapUpdatedRealtimeEvent(map, input.clientId),
          {
            channel: mapsChannel,
            type: 'renamed',
            revision,
            clientId: input.clientId,
            data: { oldSlug: slug, summary },
          },
        ]
      : [
          mapUpdatedRealtimeEvent(map, input.clientId),
          mapSummaryUpdatedRealtimeEvent(map, input.clientId),
        ]

  return {
    ok: true,
    slug: renamed.newSlug,
    name,
    path: logicalMapResourcePath(map),
    map,
    events,
  }
}
