import type { MapRevision } from '#shared/sessionRevisions'
import type { SessionMapSlug } from '#shared/sessionState'
import { mapEditorSessionPath } from '~/utils/mapRoutes'

export type PlayerSessionMapNavigationStatus =
  | 'ready'
  | 'loading'
  | 'needs-session-map'
  | 'needs-player-visibility'

export interface PlayerSessionMapNavigationMapSummary {
  readonly mapSlug: SessionMapSlug | string
  readonly revision?: MapRevision | number | null
  readonly selected?: boolean
  readonly attached?: boolean
  readonly availableForSessionMode?: boolean
}

export interface PlayerSessionMapNavigationVisibilityState {
  readonly selectedMapAttached: boolean
  readonly currentMapVisible: boolean
  readonly currentMapAvailable: boolean
  readonly currentMap: PlayerSessionMapNavigationMapSummary | null
  readonly visibleMapSlugs: readonly (SessionMapSlug | string)[]
  readonly visibleMaps: readonly PlayerSessionMapNavigationMapSummary[]
}

export interface PlayerSessionMapNavigationLink {
  readonly key: string
  readonly mapSlug: string
  readonly label: string
  readonly to: string
  readonly description: string
  readonly selected: boolean
  readonly revisionLabel: string | null
}

export interface PlayerSessionMapNavigationModel {
  readonly heading: string
  readonly summary: string
  readonly emptyMessage: string | null
  readonly status: PlayerSessionMapNavigationStatus
  readonly links: readonly PlayerSessionMapNavigationLink[]
}

const normalizeMapSlug = (mapSlug: SessionMapSlug | string | null | undefined): string | null => {
  if (typeof mapSlug !== 'string') return null
  const trimmed = mapSlug.trim()
  return trimmed.length > 0 ? trimmed : null
}

const revisionLabel = (revision: MapRevision | number | null | undefined): string | null => {
  if (typeof revision !== 'number' || !Number.isFinite(revision)) return null
  return `map revision ${revision}`
}

const labelForMap = (map: PlayerSessionMapNavigationMapSummary): string => (
  map.selected === true ? 'Open selected session map' : 'Open session map'
)

const descriptionForMap = (map: PlayerSessionMapNavigationMapSummary): string => {
  const slug = normalizeMapSlug(map.mapSlug) ?? 'this map'
  const revision = revisionLabel(map.revision)
  const readiness = revision === null ? 'attached' : `${revision} attached`
  if (map.selected === true) {
    return `${slug} is the selected live session map with ${readiness}. Open it in session mode so table actions use session commands.`
  }
  return `${slug} is visible in this live session with ${readiness}. Open it in session mode to view the table.`
}

const visibleMapsFromState = (
  visibility: PlayerSessionMapNavigationVisibilityState,
): PlayerSessionMapNavigationMapSummary[] => {
  const bySlug = new Map<string, PlayerSessionMapNavigationMapSummary>()

  for (const sessionMap of visibility.visibleMaps) {
    if (sessionMap.availableForSessionMode === false) continue
    const mapSlug = normalizeMapSlug(sessionMap.mapSlug)
    if (mapSlug === null) continue
    bySlug.set(mapSlug, { ...sessionMap, mapSlug })
  }

  for (const mapSlugValue of visibility.visibleMapSlugs) {
    const mapSlug = normalizeMapSlug(mapSlugValue)
    if (mapSlug === null || bySlug.has(mapSlug)) continue
    bySlug.set(mapSlug, {
      mapSlug,
      selected: visibility.currentMapVisible
        && normalizeMapSlug(visibility.currentMap?.mapSlug) === mapSlug,
      availableForSessionMode: true,
    })
  }

  return [...bySlug.values()].sort((left, right) => {
    const selectedDelta = Number(right.selected === true) - Number(left.selected === true)
    if (selectedDelta !== 0) return selectedDelta
    return normalizeMapSlug(left.mapSlug)?.localeCompare(normalizeMapSlug(right.mapSlug) ?? '') ?? 0
  })
}

export const buildPlayerSessionMapNavigationModel = (
  visibility: PlayerSessionMapNavigationVisibilityState | null | undefined,
): PlayerSessionMapNavigationModel => {
  const heading = 'Visible session maps'

  if (visibility == null) {
    return {
      heading,
      summary: 'Join a live session or refresh the remembered live session to see session maps visible to you.',
      emptyMessage: 'After you join, Rotom Table lists attached session maps the GM has made visible to your player.',
      status: 'loading',
      links: [],
    }
  }

  const maps = visibleMapsFromState(visibility)
  const links = maps.map((sessionMap): PlayerSessionMapNavigationLink => {
    const mapSlug = normalizeMapSlug(sessionMap.mapSlug) ?? ''
    return {
      key: `visible-session-map:${mapSlug}`,
      mapSlug,
      label: labelForMap(sessionMap),
      to: mapEditorSessionPath(mapSlug),
      description: descriptionForMap(sessionMap),
      selected: sessionMap.selected === true,
      revisionLabel: revisionLabel(sessionMap.revision),
    }
  })

  if (links.length > 0) {
    return {
      heading,
      summary: 'Open a visible map in session mode so table actions use session commands and the session socket.',
      emptyMessage: null,
      status: 'ready',
      links,
    }
  }

  if (!visibility.selectedMapAttached) {
    return {
      heading,
      summary: 'No session map is attached to this live session yet.',
      emptyMessage: 'The GM needs to attach a saved map to the live session, then players can refresh the lobby and open the session map.',
      status: 'needs-session-map',
      links: [],
    }
  }

  const currentMapReady = visibility.currentMapAvailable && visibility.currentMapVisible
  return {
    heading,
    summary: currentMapReady
      ? 'The selected session map is not listed yet.'
      : 'A session map is attached, but it is not visible to your player yet.',
    emptyMessage: currentMapReady
      ? 'Refresh the lobby to reload your visible session maps.'
      : 'Ask the GM to make the attached session map visible to players or grant your player access, then refresh the lobby.',
    status: 'needs-player-visibility',
    links: [],
  }
}
