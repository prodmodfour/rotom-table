/**
 * OnboardingDraft lifecycle, revision, and idempotency semantics (P9-013).
 *
 * States and legal transitions are a closed graph. Every mutation is
 * revision-checked; the final commit and other terminal operations run under
 * stable operation IDs whose exact retry returns the original result.
 */

export const ONBOARDING_DRAFT_STATES = Object.freeze([
  'draft',
  'submitted',
  'changes-requested',
  'approved',
  'committing',
  'completed',
  'cancelled',
  'superseded',
] as const)
export type OnboardingDraftState = typeof ONBOARDING_DRAFT_STATES[number]

const STATE_SET = new Set<unknown>(ONBOARDING_DRAFT_STATES)
export const isOnboardingDraftState = (value: unknown): value is OnboardingDraftState =>
  STATE_SET.has(value)

export type OnboardingActor = 'gm' | 'owner-player' | 'system'

export interface OnboardingTransition {
  readonly from: OnboardingDraftState
  readonly to: OnboardingDraftState
  readonly action: string
  readonly actors: readonly OnboardingActor[]
  readonly description: string
}

/**
 * The complete legal transition graph. Anything not listed here is illegal
 * and must be rejected by storage and use cases alike.
 */
export const ONBOARDING_TRANSITIONS: readonly OnboardingTransition[] = Object.freeze([
  { from: 'draft', to: 'submitted', action: 'submit', actors: ['owner-player', 'gm'], description: 'Owner submits a fully valid package; creates an immutable submission snapshot revision.' },
  { from: 'draft', to: 'cancelled', action: 'cancel', actors: ['owner-player', 'gm'], description: 'Abandon an unfinished draft; releases reservations, never deletes committed sheets.' },
  { from: 'draft', to: 'superseded', action: 'supersede', actors: ['gm'], description: 'GM restarts the slot under the same or newer policy; old draft is archived read-only.' },
  { from: 'submitted', to: 'changes-requested', action: 'request-changes', actors: ['gm'], description: 'GM requests changes bound to the exact submitted revision.' },
  { from: 'submitted', to: 'approved', action: 'approve', actors: ['gm'], description: 'GM approves the exact submitted revision after full re-authorization.' },
  { from: 'submitted', to: 'cancelled', action: 'cancel', actors: ['owner-player', 'gm'], description: 'Withdraw a pending submission.' },
  { from: 'submitted', to: 'superseded', action: 'supersede', actors: ['gm'], description: 'GM supersedes a pending submission.' },
  { from: 'changes-requested', to: 'submitted', action: 'resubmit', actors: ['owner-player'], description: 'Owner resolves requested changes and submits a new revision.' },
  { from: 'changes-requested', to: 'cancelled', action: 'cancel', actors: ['owner-player', 'gm'], description: 'Abandon after changes were requested.' },
  { from: 'changes-requested', to: 'superseded', action: 'supersede', actors: ['gm'], description: 'GM supersedes after changes were requested.' },
  { from: 'approved', to: 'committing', action: 'begin-commit', actors: ['system'], description: 'The journaled atomic commit begins under its stable operation ID.' },
  { from: 'approved', to: 'changes-requested', action: 'reopen-before-commit', actors: ['gm'], description: 'GM reopens an approved-but-uncommitted package.' },
  { from: 'committing', to: 'completed', action: 'commit-succeeded', actors: ['system'], description: 'The whole character package committed atomically.' },
  { from: 'committing', to: 'approved', action: 'commit-failed', actors: ['system'], description: 'The transaction rolled back completely; approval remains and may be re-planned.' },
] as const)

const transitionKey = (from: OnboardingDraftState, to: OnboardingDraftState): string => `${from}->${to}`
const TRANSITION_MAP: ReadonlyMap<string, OnboardingTransition> = new Map(
  ONBOARDING_TRANSITIONS.map(transition => [transitionKey(transition.from, transition.to), transition]),
)

export const findOnboardingTransition = (
  from: OnboardingDraftState,
  to: OnboardingDraftState,
): OnboardingTransition | null => TRANSITION_MAP.get(transitionKey(from, to)) ?? null

export class OnboardingLifecycleError extends Error {
  readonly code: 'illegal-transition' | 'actor-not-permitted' | 'terminal-state'
  readonly from: OnboardingDraftState
  readonly to: OnboardingDraftState
  constructor(
    code: OnboardingLifecycleError['code'],
    from: OnboardingDraftState,
    to: OnboardingDraftState,
    message: string,
  ) {
    super(message)
    this.name = 'OnboardingLifecycleError'
    this.code = code
    this.from = from
    this.to = to
  }
}

export const ONBOARDING_TERMINAL_STATES: ReadonlySet<OnboardingDraftState> = new Set([
  'completed',
  'cancelled',
  'superseded',
])

export const isOnboardingTerminalState = (state: OnboardingDraftState): boolean =>
  ONBOARDING_TERMINAL_STATES.has(state)

export const assertOnboardingTransition = (
  from: OnboardingDraftState,
  to: OnboardingDraftState,
  actor: OnboardingActor,
): OnboardingTransition => {
  if (isOnboardingTerminalState(from)) {
    throw new OnboardingLifecycleError('terminal-state', from, to, `state ${from} is terminal; no transitions are legal`)
  }
  const transition = findOnboardingTransition(from, to)
  if (!transition) {
    throw new OnboardingLifecycleError('illegal-transition', from, to, `transition ${from} -> ${to} is not legal`)
  }
  if (!transition.actors.includes(actor)) {
    throw new OnboardingLifecycleError('actor-not-permitted', from, to, `actor ${actor} may not perform ${transition.action}`)
  }
  return transition
}

/** States whose draft content the owner may still mutate. */
export const ONBOARDING_OWNER_EDITABLE_STATES: ReadonlySet<OnboardingDraftState> = new Set([
  'draft',
  'changes-requested',
])

export const canOwnerEditDraftContent = (state: OnboardingDraftState): boolean =>
  ONBOARDING_OWNER_EDITABLE_STATES.has(state)

/* ------------------------------------------------------------------ */
/* Idempotency semantics                                              */
/* ------------------------------------------------------------------ */

/**
 * Terminal operations (submit, approve, commit, cancel, supersede, correct)
 * journal their operation ID with a payload hash and result.
 *
 * - Same operation ID + same payload hash  -> return the stored result.
 * - Same operation ID + different payload  -> conflict; nothing mutates.
 * - Unknown operation ID                   -> execute fresh.
 */
export type OnboardingIdempotencyOutcome =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'replay' }
  | { readonly kind: 'conflict' }

export const classifyOnboardingIdempotentRetry = (
  stored: { readonly payloadHash: string } | null,
  payloadHash: string,
): OnboardingIdempotencyOutcome => {
  if (!stored) return { kind: 'fresh' }
  if (stored.payloadHash === payloadHash) return { kind: 'replay' }
  return { kind: 'conflict' }
}

/** Draft revision checks: every mutation names the revision it read. */
export const isStaleOnboardingRevision = (
  currentRevision: number,
  expectedRevision: number,
): boolean => currentRevision !== expectedRevision
