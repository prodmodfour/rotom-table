import type { MoveSpecPhase } from './spec'

/** Canonical server-owned checkpoints at which a move resolution may suspend. */
export const MOVE_REACTION_TIMINGS = [
  'declare',
  'pre-cost',
  'target',
  'pre-hit',
  'post-hit',
  'pre-damage',
  'post-damage',
  'ko',
  'movement-step',
  'switch',
  'cleanup',
] as const

/** Bounded information classes that an eligible responder may know at a checkpoint. */
export const MOVE_REACTION_INFORMATION_KINDS = [
  'actor',
  'move',
  'declared-costs',
  'targets',
  'hit-outcomes',
  'damage-context',
  'damage-outcomes',
  'knockouts',
  'movement-step',
  'switch',
  'completion',
] as const

export const MOVE_REACTION_LIMITS = Object.freeze({
  priorityMagnitude: 1_000,
  /** Root windows have depth zero; a child reaction may nest through this depth. */
  nestedWindowDepth: 8,
})

export type MoveReactionTiming = (typeof MOVE_REACTION_TIMINGS)[number]
export type MoveReactionInformationKind =
  (typeof MOVE_REACTION_INFORMATION_KINDS)[number]
export type MoveReactionOperationPosition =
  | 'before-phase-operations'
  | 'after-phase-operations'

export interface MoveReactionTimingDefinition {
  readonly timing: MoveReactionTiming
  readonly phase: MoveSpecPhase
  /** Position relative to ordinary operations in the owning MoveSpec phase. */
  readonly operationPosition: MoveReactionOperationPosition
  /** Maximum classes available after authorization; this is not a visibility grant. */
  readonly revealedInformation: readonly MoveReactionInformationKind[]
}

const frozenInformation = (
  ...kinds: readonly MoveReactionInformationKind[]
): readonly MoveReactionInformationKind[] => Object.freeze(kinds)

/**
 * One reviewed timing table owns phase placement and disclosure progression.
 * Information is cumulative only where the fact is already authoritative. Raw
 * sheet values, hidden targets, options, and rolls still require independent
 * authorization/redaction.
 */
export const MOVE_REACTION_TIMING_DEFINITIONS: Readonly<
  Record<MoveReactionTiming, MoveReactionTimingDefinition>
> = Object.freeze({
  declare: Object.freeze({
    timing: 'declare',
    phase: 'declare',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation('actor', 'move'),
  }),
  'pre-cost': Object.freeze({
    timing: 'pre-cost',
    phase: 'pay',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation('actor', 'move', 'declared-costs'),
  }),
  target: Object.freeze({
    timing: 'target',
    phase: 'target',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation('actor', 'move', 'declared-costs', 'targets'),
  }),
  'pre-hit': Object.freeze({
    timing: 'pre-hit',
    phase: 'pre-hit',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation('actor', 'move', 'declared-costs', 'targets'),
  }),
  'post-hit': Object.freeze({
    timing: 'post-hit',
    phase: 'hit',
    operationPosition: 'after-phase-operations',
    revealedInformation: frozenInformation(
      'actor',
      'move',
      'declared-costs',
      'targets',
      'hit-outcomes',
    ),
  }),
  'pre-damage': Object.freeze({
    timing: 'pre-damage',
    phase: 'damage',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation(
      'actor',
      'move',
      'declared-costs',
      'targets',
      'hit-outcomes',
      'damage-context',
    ),
  }),
  'post-damage': Object.freeze({
    timing: 'post-damage',
    phase: 'after-damage',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation(
      'actor',
      'move',
      'declared-costs',
      'targets',
      'hit-outcomes',
      'damage-context',
      'damage-outcomes',
    ),
  }),
  ko: Object.freeze({
    timing: 'ko',
    phase: 'ko',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation(
      'actor',
      'move',
      'declared-costs',
      'targets',
      'hit-outcomes',
      'damage-context',
      'damage-outcomes',
      'knockouts',
    ),
  }),
  'movement-step': Object.freeze({
    timing: 'movement-step',
    phase: 'movement',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation(
      'actor',
      'move',
      'declared-costs',
      'targets',
      'hit-outcomes',
      'damage-context',
      'damage-outcomes',
      'knockouts',
      'movement-step',
    ),
  }),
  switch: Object.freeze({
    timing: 'switch',
    phase: 'movement',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation(
      'actor',
      'move',
      'declared-costs',
      'targets',
      'hit-outcomes',
      'damage-context',
      'damage-outcomes',
      'knockouts',
      'movement-step',
      'switch',
    ),
  }),
  cleanup: Object.freeze({
    timing: 'cleanup',
    phase: 'cleanup',
    operationPosition: 'before-phase-operations',
    revealedInformation: frozenInformation(
      'actor',
      'move',
      'declared-costs',
      'targets',
      'hit-outcomes',
      'damage-context',
      'damage-outcomes',
      'knockouts',
      'movement-step',
      'switch',
      'completion',
    ),
  }),
})

const TIMING_INDEX = new Map<MoveReactionTiming, number>(
  MOVE_REACTION_TIMINGS.map((timing, index) => [timing, index]),
)

export const isMoveReactionTiming = (value: unknown): value is MoveReactionTiming => (
  typeof value === 'string' && TIMING_INDEX.has(value as MoveReactionTiming)
)

export const moveReactionTimingDefinition = (
  timing: MoveReactionTiming,
): MoveReactionTimingDefinition => MOVE_REACTION_TIMING_DEFINITIONS[timing]

/**
 * Pass is an explicit decline of only the current window. It spends no reaction
 * resource, closes that window, and resumes at the next deterministic priority.
 * A window at the same checkpoint can reopen only from a new causal child fact.
 */
export const MOVE_REACTION_PASS_SEMANTICS = Object.freeze({
  outcome: 'decline-current-window' as const,
  closesCurrentWindow: true as const,
  consumesReactionResource: false as const,
  resumesAtNextPriority: true as const,
  sameCheckpointReopen: 'new-causal-fact-only' as const,
})

export interface MoveReactionOrderEntry {
  readonly operationId: string
  readonly timing: MoveReactionTiming
  readonly priority: number
}

/** Higher priority wins; canonical timing then stable operation ID break ties. */
export const compareMoveReactionOrder = (
  left: MoveReactionOrderEntry,
  right: MoveReactionOrderEntry,
): number => {
  const timingOrder = (TIMING_INDEX.get(left.timing) ?? 0)
    - (TIMING_INDEX.get(right.timing) ?? 0)
  if (timingOrder !== 0) return timingOrder
  const priorityOrder = right.priority - left.priority
  if (priorityOrder !== 0) return priorityOrder
  return left.operationId.localeCompare(right.operationId)
}
