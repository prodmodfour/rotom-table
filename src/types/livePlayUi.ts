import type { GridAnchor } from '~/types/map'

export type LivePlayMovementIntentStatus = 'submitting' | 'awaiting-reaction'

/** Presentation-only route intent; authoritative placement remains map-owned. */
export interface LivePlayMovementIntent {
  readonly placementId: string
  readonly destination: GridAnchor
  readonly path: readonly GridAnchor[]
  readonly status: LivePlayMovementIntentStatus
  readonly resolutionId?: string
}

export interface LivePlayTokenCorrectionNotice {
  readonly opId: string
  readonly placementId: string
  readonly message: string
}
