import type { AuthRole } from '#shared/auth'
import type { MapSummary } from '~/types/map'
import { listMapFolders } from '../utils/mapFolderStorage'
import { listMaps } from '../utils/mapStorage'

export interface ListMapSummariesInput {
  role: AuthRole
}

export interface ListMapSummariesDependencies {
  listMapSummaries?: () => MapSummary[]
}

export interface ListMapFoldersInput {
  role: AuthRole
}

export interface ListMapFoldersDependencies {
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

export const listMapSummariesUseCase = (
  input: ListMapSummariesInput,
  dependencies: ListMapSummariesDependencies = {},
): ListMapSummariesResult => {
  const listSummaries = dependencies.listMapSummaries ?? listMaps
  const maps = listSummaries()
  if (input.role === 'gm') return { maps }
  return { maps: maps.filter((map) => canListMapSummary(input.role, map)) }
}

export const listMapFoldersUseCase = (
  input: ListMapFoldersInput,
  dependencies: ListMapFoldersDependencies = {},
): ListMapFoldersResult => {
  if (input.role === 'player') return { folders: [] }

  const listFolders = dependencies.listFolders ?? listMapFolders
  return { folders: listFolders() }
}
