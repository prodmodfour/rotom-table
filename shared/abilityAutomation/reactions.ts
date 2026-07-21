import {
  ABILITY_EVENT_CHECKPOINTS,
  type AbilityEventCheckpoint,
} from './events'
import type { AbilitySpecPhase } from './spec'

export const ABILITY_REACTION_TIMINGS = ['interrupt', 'reaction'] as const
export type AbilityReactionTiming = (typeof ABILITY_REACTION_TIMINGS)[number]
export const ABILITY_REACTION_INFORMATION_KINDS = [
  'event-source', 'declared-identity', 'targets', 'effect-context', 'accepted-outcome', 'lifecycle',
] as const
export type AbilityReactionInformationKind = (typeof ABILITY_REACTION_INFORMATION_KINDS)[number]

export interface AbilityReactionCheckpointDefinition {
  readonly checkpoint: AbilityEventCheckpoint
  readonly phase: AbilitySpecPhase
  readonly interruptPosition: 'before-checkpoint'
  readonly reactionPosition: 'after-checkpoint'
  readonly revealedInformation: readonly AbilityReactionInformationKind[]
}

const information = (...values: AbilityReactionInformationKind[]): readonly AbilityReactionInformationKind[] => Object.freeze(values)

/** Information maxima only; authorization/redaction still applies independently. */
export const ABILITY_REACTION_CHECKPOINT_DEFINITIONS: Readonly<Record<AbilityEventCheckpoint, AbilityReactionCheckpointDefinition>> = Object.freeze({
  declaration: Object.freeze({
    checkpoint: 'declaration', phase: 'eligibility',
    interruptPosition: 'before-checkpoint', reactionPosition: 'after-checkpoint',
    revealedInformation: information('event-source', 'declared-identity'),
  }),
  'pre-effect': Object.freeze({
    checkpoint: 'pre-effect', phase: 'pre-effect',
    interruptPosition: 'before-checkpoint', reactionPosition: 'after-checkpoint',
    revealedInformation: information('event-source', 'declared-identity', 'targets', 'effect-context'),
  }),
  'post-effect': Object.freeze({
    checkpoint: 'post-effect', phase: 'after-effect',
    interruptPosition: 'before-checkpoint', reactionPosition: 'after-checkpoint',
    revealedInformation: information(
      'event-source', 'declared-identity', 'targets', 'effect-context', 'accepted-outcome',
    ),
  }),
  'after-commit': Object.freeze({
    checkpoint: 'after-commit', phase: 'cleanup',
    interruptPosition: 'before-checkpoint', reactionPosition: 'after-checkpoint',
    revealedInformation: information(
      'event-source', 'declared-identity', 'targets', 'effect-context', 'accepted-outcome',
    ),
  }),
  lifecycle: Object.freeze({
    checkpoint: 'lifecycle', phase: 'schedule',
    interruptPosition: 'before-checkpoint', reactionPosition: 'after-checkpoint',
    revealedInformation: information('event-source', 'accepted-outcome', 'lifecycle'),
  }),
})

export const abilityReactionCheckpointDefinition = (
  checkpoint: AbilityEventCheckpoint,
): AbilityReactionCheckpointDefinition => ABILITY_REACTION_CHECKPOINT_DEFINITIONS[checkpoint]

export const isAbilityReactionCheckpoint = (value: unknown): value is AbilityEventCheckpoint => (
  typeof value === 'string' && (ABILITY_EVENT_CHECKPOINTS as readonly string[]).includes(value)
)

export const ABILITY_REACTION_PASS_SEMANTICS = Object.freeze({
  outcome: 'decline-current-window' as const,
  closesCurrentWindow: true as const,
  consumesAvailability: false as const,
  resumesAtNextPriority: true as const,
  sameCheckpointReopen: 'new-causal-event-only' as const,
})
