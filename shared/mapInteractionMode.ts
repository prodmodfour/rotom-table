export const MAP_INTERACTION_MODES = {
  SETUP_EDIT: 'setup-edit',
  LIVE_PLAY: 'live-play',
} as const

export type MapInteractionMode = (typeof MAP_INTERACTION_MODES)[keyof typeof MAP_INTERACTION_MODES]

export const DEFAULT_MAP_INTERACTION_MODE: MapInteractionMode = MAP_INTERACTION_MODES.LIVE_PLAY

export const MAP_INTERACTION_MODE_LABELS: Record<MapInteractionMode, string> = {
  [MAP_INTERACTION_MODES.LIVE_PLAY]: 'Run Live Play',
  [MAP_INTERACTION_MODES.SETUP_EDIT]: 'Prepare Map',
}

export const MAP_INTERACTION_MODE_REALTIME_EVENT_TYPE = 'map-interaction-mode-updated' as const

export const SETUP_MODE_REQUIRED_FOR_MAP_SAVE_MESSAGE =
  'Map is in Run Live Play mode. Switch to Prepare Map before whole-map setup saves.'

export const LIVE_PLAY_MODE_REQUIRED_FOR_COMMAND_MESSAGE =
  'Map is in Prepare Map mode. Switch to Run Live Play before live-play commands.'

export interface MapInteractionModeRealtimePayload {
  readonly slug: string
  readonly interactionMode: MapInteractionMode
  readonly updatedAt: number
}

export const isMapInteractionMode = (value: unknown): value is MapInteractionMode => (
  value === MAP_INTERACTION_MODES.SETUP_EDIT || value === MAP_INTERACTION_MODES.LIVE_PLAY
)

export const parseMapInteractionMode = (value: unknown): MapInteractionMode | null => (
  isMapInteractionMode(value) ? value : null
)
