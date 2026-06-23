import type { AuthRole } from '#shared/auth'
import type { MapSummary, TabletopMap } from '~/types/map'
import { sqliteMapRepository, type MapRepository, type StoredMapDocument } from '../storage/mapRepository'
import { normalizeMapDocument } from '../utils/mapNormalization'
import { summarizeMap, sortMapSummaries } from '../utils/mapSummaries'

export interface ListMapSummariesInput {
  role: AuthRole
}

export interface ListMapSummariesDependencies {
  mapRepository?: Pick<MapRepository, 'list'>
  listMapSummaries?: () => MapSummary[]
}

export interface ListMapFoldersInput {
  role: AuthRole
}

export interface ListMapFoldersDependencies {
  mapRepository?: Pick<MapRepository, 'listFolders'>
  listFolders?: () => string[]
}

export interface ListMapSummariesResult {
  maps: MapSummary[]
}

export interface ListMapFoldersResult {
  folders: string[]
}

export const canListMapSummary = (role: AuthRole, map: MapSummary): boolean =>
  role === 'gm' || map.playerVisible === true

const storedMapToMap = (stored: StoredMapDocument<unknown>): TabletopMap => ({
  ...normalizeMapDocument(stored.document, { sourceLabel: `SQLite map ${stored.slug}` }),
  slug: stored.slug,
  revision: stored.revision,
  updatedAt: stored.updatedAt,
})

const listRepositoryMapSummaries = (repository: Pick<MapRepository, 'list'>): MapSummary[] => sortMapSummaries(
  repository.list().map((stored) => summarizeMap(storedMapToMap(stored as StoredMapDocument<unknown>))),
)

export const listMapSummariesUseCase = (
  input: ListMapSummariesInput,
  dependencies: ListMapSummariesDependencies = {},
): ListMapSummariesResult => {
  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const listSummaries = dependencies.listMapSummaries ?? (() => listRepositoryMapSummaries(mapRepository))
  const maps = listSummaries()
  if (input.role === 'gm') return { maps }
  return { maps: maps.filter((map) => canListMapSummary(input.role, map)) }
}

export const listMapFoldersUseCase = (
  input: ListMapFoldersInput,
  dependencies: ListMapFoldersDependencies = {},
): ListMapFoldersResult => {
  if (input.role === 'player') return { folders: [] }

  const mapRepository = dependencies.mapRepository ?? sqliteMapRepository
  const listFolders = dependencies.listFolders ?? (() => [...mapRepository.listFolders()])
  return { folders: listFolders() }
}
