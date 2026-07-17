import type { MoveAutomationAreaDirection } from '~/types/moveAutomation'
import type {
  MoveItemChoicePresentation,
  MoveItemResponseSelection,
} from './itemChoices'

export interface MoveResponseGridAnchor {
  readonly x: number
  readonly y: number
  readonly z: number
}

/** Shared wire/storage bounds for one server-issued durable response option. */
export const MOVE_RESPONSE_OPTION_LIMITS = Object.freeze({
  identifierChars: 160,
  placementIdChars: 200,
  coordinateMagnitude: 1_000_000,
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

/**
 * Private durable option. Item owner identity and revisions stay in
 * `itemSelection`; authorized client views receive only `itemChoice`.
 */
export interface PendingMoveResponseOption {
  readonly id: string
  readonly labelKey: string
  readonly selection?: PendingMoveMovementSelection
  readonly itemChoice?: MoveItemChoicePresentation
  readonly itemSelection?: MoveItemResponseSelection
}

/** Presentation-safe option shape returned after response-window authorization. */
export interface PendingMoveResponsePublicOption {
  readonly id: string
  readonly labelKey: string
  readonly selection?: PendingMoveMovementSelection
  readonly itemChoice?: MoveItemChoicePresentation
}

const stableNamespaceHash = (value: string): string => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Canonical durable identity for one server-owned movement selection. */
export const pendingMoveMovementOptionId = (
  selection: PendingMoveMovementSelection,
): string => {
  const prefix = selection.kind === 'movement-direction'
    ? `movement.direction.${stableNamespaceHash(selection.setId)}.${selection.direction}`
    : `movement.destination.${stableNamespaceHash(selection.setId)}`
  const { x, y, z } = selection.destination
  return `${prefix}.${x}.${y}.${z}`
}

/** Locale lookup associated with one typed movement selection. */
export const pendingMoveMovementOptionLabelKey = (
  selection: PendingMoveMovementSelection,
): string => selection.kind === 'movement-direction'
  ? `move.movement.direction.${selection.direction}`
  : 'move.movement.destination'

/** Stable duplicate key for strict window parsers and server resolvers. */
export const pendingMoveMovementSelectionKey = (
  selection: PendingMoveMovementSelection,
): string => (
  `${selection.kind}:${selection.setId}:`
  + `${selection.kind === 'movement-direction' ? `${selection.direction}:` : ''}`
  + `${selection.destination.x},${selection.destination.y},${selection.destination.z}`
)

/** Cross-check durable option identity and presentation against its private value. */
export const isCanonicalPendingMoveMovementOption = (
  option: PendingMoveResponseOption,
): option is PendingMoveResponseOption & { readonly selection: PendingMoveMovementSelection } => (
  option.selection !== undefined
  && option.id === pendingMoveMovementOptionId(option.selection)
  && option.labelKey === pendingMoveMovementOptionLabelKey(option.selection)
)
