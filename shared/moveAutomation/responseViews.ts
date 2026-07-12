import type {
  PendingMoveResolutionPublicSummary,
  PendingMoveResponseOption,
  PendingMoveResponseWindowKind,
} from './pendingResolution'
import type { MoveSpecPhase } from './spec'

/** Client-safe projection version for authorized durable move-response prompts. */
export const PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION = 1 as const

/**
 * Window detail available only after server authorization. Ownership principals,
 * operation IDs, target identities, reads, rolls, and audit traces stay private.
 */
export interface PendingMoveResponseWindowView {
  readonly schemaVersion: typeof PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION
  readonly resolution: PendingMoveResolutionPublicSummary
  readonly window: {
    readonly windowId: string
    readonly kind: PendingMoveResponseWindowKind
    readonly phase: MoveSpecPhase
    readonly reasonCode: string
    readonly promptKey: string
    readonly options: readonly PendingMoveResponseOption[]
    readonly allowPass: boolean
    readonly priority: number | null
  }
}

/** Authorized windows for one currently accessible map. */
export interface PendingMoveResponseWindowList {
  readonly schemaVersion: typeof PENDING_MOVE_RESPONSE_VIEW_SCHEMA_VERSION
  readonly mapSlug: string
  readonly windows: readonly PendingMoveResponseWindowView[]
}
