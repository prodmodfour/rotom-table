import type { AuthRole } from '#shared/auth'
import {
  ENCOUNTER_WORKSPACE_SUMMARY_SCHEMA_VERSION,
  sortEncounterWorkspaceSummaries,
  summarizeEncounterDocument,
  summarizeMapBackedEncounter,
  type EncounterWorkspaceSummaryList,
} from '#shared/encounterWorkspace/library'
import type { TabletopMap } from '~/types/map'
import { sqliteMapRepository, type MapRepository, type StoredMapDocument } from '../storage/mapRepository'
import { normalizeMapDocument } from '../utils/mapNormalization'
import {
  createSqliteEncounterDocumentRepository,
  type EncounterDocumentRepository,
} from '../storage/encounterDocumentRepository'

export interface ListEncounterWorkspacesInput {
  readonly role: AuthRole
}

export interface ListEncounterWorkspacesDependencies {
  readonly mapRepository?: Pick<MapRepository, 'list'>
  readonly encounterRepository?: Pick<EncounterDocumentRepository, 'list'>
}

const storedMap = (stored: StoredMapDocument<unknown>): TabletopMap => ({
  ...normalizeMapDocument(stored.document, { sourceLabel: `SQLite map ${stored.slug}` }),
  slug: stored.slug,
  revision: stored.revision,
  updatedAt: stored.updatedAt,
})

export const listEncounterWorkspacesUseCase = (
  input: ListEncounterWorkspacesInput,
  dependencies: ListEncounterWorkspacesDependencies = {},
): EncounterWorkspaceSummaryList => {
  const repository = dependencies.mapRepository ?? sqliteMapRepository
  const maps = repository.list().map(row => storedMap(row as StoredMapDocument<unknown>))
  const mapBySlug = new Map(maps.map(map => [map.slug, map]))
  const encounters = dependencies.encounterRepository
    ? dependencies.encounterRepository.list()
    : dependencies.mapRepository
      ? []
      : createSqliteEncounterDocumentRepository().list()
  const encounterMapSlugs = new Set(encounters.map(encounter => encounter.linkedMapSlug))
  const authored = encounters.flatMap((encounter) => {
    const map = mapBySlug.get(encounter.linkedMapSlug)
    if (!map || (input.role !== 'gm' && map.playerVisible !== true)) return []
    return [summarizeEncounterDocument(encounter, map, { includeHidden: input.role === 'gm' })]
  })
  const legacy = maps
    .filter(map => !encounterMapSlugs.has(map.slug))
    .filter(map => input.role === 'gm' || map.playerVisible === true)
    .map(summarizeMapBackedEncounter)
  return {
    schemaVersion: ENCOUNTER_WORKSPACE_SUMMARY_SCHEMA_VERSION,
    summaries: sortEncounterWorkspaceSummaries([...authored, ...legacy]),
  }
}
