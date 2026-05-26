import {
  sessionLobbyJoinPath,
  sessionLobbyStartManagePath,
} from '~/utils/appRoutes'
import { mapEditorPath, mapEditorSessionPath } from '~/utils/mapRoutes'

export type MapSessionNavigationLinkKey =
  | 'start-manage-session'
  | 'join-session'
  | 'open-session-map'
  | 'open-local-map'

export interface MapSessionNavigationLink {
  readonly key: MapSessionNavigationLinkKey
  readonly label: string
  readonly to: string
  readonly description: string
  readonly kind: 'lobby' | 'map'
  readonly current?: boolean
}

export interface MapSessionNavigationModel {
  readonly heading: string
  readonly summary: string
  readonly statusLabel: string
  readonly links: readonly MapSessionNavigationLink[]
}

export interface BuildMapSessionNavigationModelOptions {
  readonly mapSlug?: string | null
  readonly sessionModeEnabled?: boolean
}

const normalizeMapSlug = (mapSlug: string | null | undefined): string | null => {
  if (typeof mapSlug !== 'string') return null
  const trimmed = mapSlug.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const buildMapSessionNavigationModel = (
  options: BuildMapSessionNavigationModelOptions = {},
): MapSessionNavigationModel => {
  const mapSlug = normalizeMapSlug(options.mapSlug)
  const sessionModeEnabled = options.sessionModeEnabled === true
  const links: MapSessionNavigationLink[] = [
    {
      key: 'start-manage-session',
      label: 'Start/manage session',
      to: sessionLobbyStartManagePath(),
      description: 'Open the GM lobby panel for the join code, players, and assignment summary.',
      kind: 'lobby',
    },
    {
      key: 'join-session',
      label: 'Join session',
      to: sessionLobbyJoinPath(),
      description: 'Open the player join panel for a join code and display name.',
      kind: 'lobby',
    },
  ]

  if (mapSlug !== null) {
    links.push(sessionModeEnabled
      ? {
          key: 'open-local-map',
          label: 'Return to local map',
          to: mapEditorPath(mapSlug),
          description: 'Leave the explicit session query and use the existing local-first map route.',
          kind: 'map',
        }
      : {
          key: 'open-session-map',
          label: 'Open session map',
          to: mapEditorSessionPath(mapSlug),
          description: 'Reopen this map with session=1 so table actions use server-authoritative commands.',
          kind: 'map',
        })
  }

  return {
    heading: 'Table session',
    summary: 'Start or join a GM-hosted Live session, then opt this map into session mode when you are ready to play.',
    statusLabel: sessionModeEnabled
      ? 'Session mode active for this map view. Commands use the WebSocket session channel.'
      : 'Local map mode is unchanged. Session commands start only after opening this map with session=1.',
    links,
  }
}
