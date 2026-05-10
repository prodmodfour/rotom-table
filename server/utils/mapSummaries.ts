import type { MapSummary, TabletopMap } from '~/types/map'

export const summarizeMap = (map: TabletopMap): MapSummary => ({
  slug: map.slug,
  name: map.name,
  folder: map.folder ?? '',
  dimensions: map.dimensions,
  placementCount: map.placements?.length ?? 0,
  playerVisible: map.playerVisible === true,
  schemaVersion: map.schemaVersion,
  updatedAt: map.updatedAt,
})

export const compareMapSummaries = (a: MapSummary, b: MapSummary): number => {
  const folderCmp = a.folder.localeCompare(b.folder)
  if (folderCmp !== 0) return folderCmp
  return a.name.localeCompare(b.name)
}

export const sortMapSummaries = (summaries: MapSummary[]): MapSummary[] =>
  [...summaries].sort(compareMapSummaries)
