import { mapsChannel, type RealtimeEvent } from '~/shared/realtime'
import type { MapSummary, TabletopMap } from '~/types/map'
import {
  isInsideFolder,
  isSameOrDescendantFolder,
  normalizeSearchText,
  renameFolderPrefix,
} from '~/utils/folderBrowser'

export interface MapLibraryCollections {
  maps: Map<string, MapSummary>
  extraFolders: Set<string>
}

export const tabletopMapToSummary = (map: TabletopMap): MapSummary => ({
  slug: map.slug,
  name: map.name,
  folder: map.folder ?? '',
  dimensions: map.dimensions,
  placementCount: map.placements.length,
  playerVisible: map.playerVisible === true,
  schemaVersion: map.schemaVersion,
  updatedAt: map.updatedAt,
})

export const mapSummaryMatchesQuery = (
  item: MapSummary,
  normalizedQuery: string,
): boolean => [item.name, item.folder]
  .some((value) => normalizeSearchText(value).includes(normalizedQuery))

export const buildMapFolderSet = (
  items: readonly MapSummary[],
  extraFolders: Iterable<string>,
): Set<string> => {
  const folders = new Set<string>()
  for (const item of items) if (item.folder) folders.add(item.folder)
  for (const folder of extraFolders) folders.add(folder)
  return folders
}

export const filterVisibleMaps = ({
  items,
  currentPath,
  searchTerm,
}: {
  items: readonly MapSummary[]
  currentPath: string
  searchTerm: string
}): MapSummary[] => {
  const query = normalizeSearchText(searchTerm)
  const pool = items.filter((item) => isInsideFolder(item.folder, currentPath))
  const matched = query ? pool.filter((item) => mapSummaryMatchesQuery(item, query)) : pool
  const scoped = query ? matched : matched.filter((item) => item.folder === currentPath)
  return [...scoped].sort((a, b) => a.name.localeCompare(b.name))
}

const eventSummary = (data: unknown): MapSummary | null => {
  const summary = data as Partial<MapSummary> | null | undefined
  return typeof summary?.slug === 'string' ? summary as MapSummary : null
}

const eventSlug = (data: unknown): string | null => {
  const payload = data as { slug?: unknown } | null | undefined
  return typeof payload?.slug === 'string' ? payload.slug : null
}

const eventFolder = (data: unknown): string | null => {
  const payload = data as { folder?: unknown } | null | undefined
  return typeof payload?.folder === 'string' ? payload.folder : null
}

const eventRename = (data: unknown): { oldSlug: string; summary: MapSummary } | null => {
  const payload = data as { oldSlug?: unknown; summary?: unknown } | null | undefined
  const summary = eventSummary(payload?.summary)
  return typeof payload?.oldSlug === 'string' && summary
    ? { oldSlug: payload.oldSlug, summary }
    : null
}

const eventFolderMove = (data: unknown): { from: string; to: string } | null => {
  const payload = data as { from?: unknown; to?: unknown } | null | undefined
  return typeof payload?.from === 'string' && typeof payload?.to === 'string'
    ? { from: payload.from, to: payload.to }
    : null
}

export const deleteMapFolderFromLibrary = (
  collections: MapLibraryCollections,
  folder: string,
): void => {
  collections.extraFolders.delete(folder)
  for (const path of [...collections.extraFolders]) {
    if (isSameOrDescendantFolder(path, folder)) collections.extraFolders.delete(path)
  }
  for (const [slug, map] of [...collections.maps]) {
    if (isSameOrDescendantFolder(map.folder, folder)) collections.maps.delete(slug)
  }
}

export const moveMapFolderInLibrary = (
  collections: MapLibraryCollections,
  from: string,
  to: string,
): void => {
  const nextFolders = new Set<string>()
  for (const folder of collections.extraFolders) {
    nextFolders.add(renameFolderPrefix(folder, from, to))
  }
  collections.extraFolders.clear()
  for (const folder of nextFolders) collections.extraFolders.add(folder)

  for (const [slug, map] of collections.maps) {
    collections.maps.set(slug, { ...map, folder: renameFolderPrefix(map.folder, from, to) })
  }
}

export const applyMapLibraryRealtimeEvent = (
  collections: MapLibraryCollections,
  event: RealtimeEvent,
  clientId: string,
): boolean => {
  if (event.clientId === clientId) return false
  if (event.channel && event.channel !== mapsChannel) return false

  if (event.type === 'created' || event.type === 'updated' || event.type === 'moved') {
    const summary = eventSummary(event.data)
    if (!summary) return false
    collections.maps.set(summary.slug, summary)
    return true
  }

  if (event.type === 'renamed') {
    const payload = eventRename(event.data)
    if (!payload) return false
    collections.maps.delete(payload.oldSlug)
    collections.maps.set(payload.summary.slug, payload.summary)
    return true
  }

  if (event.type === 'deleted') {
    const slug = eventSlug(event.data)
    if (!slug) return false
    collections.maps.delete(slug)
    return true
  }

  if (event.type === 'folder-created') {
    const folder = eventFolder(event.data)
    if (!folder) return false
    collections.extraFolders.add(folder)
    return true
  }

  if (event.type === 'folder-deleted') {
    const folder = eventFolder(event.data)
    if (!folder) return false
    deleteMapFolderFromLibrary(collections, folder)
    return true
  }

  if (event.type === 'folder-moved') {
    const payload = eventFolderMove(event.data)
    if (!payload) return false
    moveMapFolderInLibrary(collections, payload.from, payload.to)
    return true
  }

  return false
}
