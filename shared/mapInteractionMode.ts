export const MAP_INTERACTION_MODES = {
  SETUP_EDIT: 'setup-edit',
  LIVE_PLAY: 'live-play',
} as const

export type MapInteractionMode = (typeof MAP_INTERACTION_MODES)[keyof typeof MAP_INTERACTION_MODES]

export const isMapInteractionMode = (value: unknown): value is MapInteractionMode => (
  value === MAP_INTERACTION_MODES.SETUP_EDIT || value === MAP_INTERACTION_MODES.LIVE_PLAY
)

export const parseMapInteractionMode = (value: unknown): MapInteractionMode | null => (
  isMapInteractionMode(value) ? value : null
)
