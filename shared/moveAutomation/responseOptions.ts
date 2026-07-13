import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'

export interface MoveResponseGridAnchor {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Shared wire/storage bounds for one server-issued durable response option. */
export const MOVE_RESPONSE_OPTION_LIMITS = Object.freeze({
  identifierChars: 160,
  placementIdChars: 200,
  optionsPerWindow: 512,
})

export const PENDING_MOVE_MOVEMENT_SELECTION_KINDS = [
  'movement-destination',
  'movement-direction',
] as const

export type PendingMoveMovementSelectionKind =
  (typeof PENDING_MOVE_MOVEMENT_SELECTION_KINDS)[number]

/**
 * Server-issued movement intent attached to an authorized option. The client
 * returns only the option ID; this selection is re-derived and revalidated by
 * the movement oracle when the durable resolution resumes.
 */
export interface PendingMoveDestinationSelection {
  readonly kind: 'movement-destination'
  readonly setId: string
  readonly destination: MoveResponseGridAnchor
}

export interface PendingMoveDirectionSelection {
  readonly kind: 'movement-direction'
  readonly setId: string
  readonly direction: MoveAutomationAreaDirection
  /** Authoritative endpoint selected for this direction when the window opened. */
  readonly destination: MoveResponseGridAnchor
}

export type PendingMoveMovementSelection =
  | PendingMoveDestinationSelection
  | PendingMoveDirectionSelection

/** Presentation lookup plus optional server-issued typed movement intent. */
export interface PendingMoveResponseOption {
  readonly id: string
  readonly labelKey: string
  readonly selection?: PendingMoveMovementSelection
}
