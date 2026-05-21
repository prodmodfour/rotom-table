import type { GridAnchor } from '~/types/pokemon'

export interface PreviewState {
  position: GridAnchor | null
  reachable: boolean
  /** PTU movement distance in meters/squares for token movement previews. */
  pathLength: number
  movementDistance?: number
  movementLimit?: number | null
  movementCapabilities?: string[]
  movementCapabilityLabel?: string
  movementFailureReason?: string | null
}
