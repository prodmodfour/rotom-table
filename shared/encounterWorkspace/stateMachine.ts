export const ENCOUNTER_WORKSPACE_PHASES = [
  'observe',
  'choose',
  'target',
  'wait',
  'resolve',
  'recover',
] as const
export type EncounterWorkspacePhase = typeof ENCOUNTER_WORKSPACE_PHASES[number]

export interface EncounterWorkspaceMachineState {
  readonly phase: EncounterWorkspacePhase
  readonly sequence: number
  readonly mapRevision: number
  readonly actorParticipantId: string | null
  readonly actionOfferId: string | null
  readonly interactionId: string | null
  readonly acceptedPresentationId: string | null
  readonly targetMode: 'participant' | 'relationship' | 'tactical' | null
  readonly recoveryReason: 'reconnecting' | 'reconciling' | 'stale' | 'uncertain' | 'error' | null
  readonly focusOriginId: string | null
}

export type EncounterWorkspaceMachineEvent =
  | {
      readonly type: 'workspace-adopted'
      readonly mapRevision: number
      readonly currentActorId: string | null
      readonly commandsBlocked: boolean
      readonly replayGap: boolean
      readonly primaryInteractionId: string | null
    }
  | { readonly type: 'actor-selected', readonly participantId: string, readonly focusOriginId?: string | null }
  | {
      readonly type: 'action-chosen'
      readonly offerId: string
      readonly actorParticipantId: string
      readonly targetMode: 'participant' | 'relationship' | 'tactical' | null
      readonly focusOriginId?: string | null
    }
  | { readonly type: 'target-cancelled' }
  | { readonly type: 'intent-submitted' }
  | { readonly type: 'pending-received', readonly interactionId: string }
  | { readonly type: 'accepted-received', readonly presentationId: string }
  | { readonly type: 'presentation-settled', readonly nextInteractionId?: string | null }
  | {
      readonly type: 'system-blocked'
      readonly reason: NonNullable<EncounterWorkspaceMachineState['recoveryReason']>
    }
  | { readonly type: 'system-recovered', readonly mapRevision: number, readonly currentActorId: string | null }
  | { readonly type: 'reset' }

export class EncounterWorkspaceTransitionError extends Error {
  readonly phase: EncounterWorkspacePhase
  readonly event: EncounterWorkspaceMachineEvent['type']

  constructor(phase: EncounterWorkspacePhase, event: EncounterWorkspaceMachineEvent['type'], detail: string) {
    super(`Cannot apply ${event} while encounter workspace is ${phase}: ${detail}`)
    this.name = 'EncounterWorkspaceTransitionError'
    this.phase = phase
    this.event = event
  }
}

export const createEncounterWorkspaceMachine = (
  mapRevision = 0,
): EncounterWorkspaceMachineState => ({
  phase: 'observe',
  sequence: 0,
  mapRevision,
  actorParticipantId: null,
  actionOfferId: null,
  interactionId: null,
  acceptedPresentationId: null,
  targetMode: null,
  recoveryReason: null,
  focusOriginId: null,
})

const requireId = (value: string, label: string, state: EncounterWorkspaceMachineState, event: EncounterWorkspaceMachineEvent): void => {
  if (!value.trim() || value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new EncounterWorkspaceTransitionError(state.phase, event.type, `${label} is invalid.`)
  }
}

const advance = (
  state: EncounterWorkspaceMachineState,
  patch: Omit<Partial<EncounterWorkspaceMachineState>, 'sequence'>,
): EncounterWorkspaceMachineState => ({ ...state, ...patch, sequence: state.sequence + 1 })

/** Pure deterministic reducer for observe → choose → target/wait → resolve/recover. */
export const transitionEncounterWorkspace = (
  state: EncounterWorkspaceMachineState,
  event: EncounterWorkspaceMachineEvent,
): EncounterWorkspaceMachineState => {
  const eventType: EncounterWorkspaceMachineEvent['type'] = event.type
  if (event.type === 'reset') return { ...createEncounterWorkspaceMachine(state.mapRevision), sequence: state.sequence + 1 }
  if (event.type === 'workspace-adopted') {
    if (!Number.isSafeInteger(event.mapRevision) || event.mapRevision < state.mapRevision) {
      throw new EncounterWorkspaceTransitionError(state.phase, event.type, 'snapshot revision is stale or invalid.')
    }
    if (event.commandsBlocked || event.replayGap) {
      return advance(state, {
        phase: 'recover',
        mapRevision: event.mapRevision,
        actorParticipantId: event.currentActorId,
        actionOfferId: null,
        interactionId: null,
        acceptedPresentationId: null,
        targetMode: null,
        recoveryReason: event.replayGap ? 'reconciling' : 'stale',
      })
    }
    if (event.primaryInteractionId) {
      requireId(event.primaryInteractionId, 'interaction ID', state, event)
      return advance(state, {
        phase: 'wait',
        mapRevision: event.mapRevision,
        actorParticipantId: event.currentActorId,
        actionOfferId: null,
        interactionId: event.primaryInteractionId,
        acceptedPresentationId: null,
        targetMode: null,
        recoveryReason: null,
      })
    }
    return advance(state, {
      phase: 'observe',
      mapRevision: event.mapRevision,
      actorParticipantId: event.currentActorId,
      actionOfferId: null,
      interactionId: null,
      acceptedPresentationId: null,
      targetMode: null,
      recoveryReason: null,
    })
  }
  if (event.type === 'system-blocked') {
    return advance(state, {
      phase: 'recover',
      recoveryReason: event.reason,
      actionOfferId: null,
      interactionId: null,
      targetMode: null,
    })
  }
  if (event.type === 'system-recovered') {
    if (state.phase !== 'recover') {
      throw new EncounterWorkspaceTransitionError(state.phase, event.type, 'no recovery workflow is active.')
    }
    if (!Number.isSafeInteger(event.mapRevision) || event.mapRevision < state.mapRevision) {
      throw new EncounterWorkspaceTransitionError(state.phase, event.type, 'recovered revision is stale or invalid.')
    }
    return advance(state, {
      phase: 'observe',
      mapRevision: event.mapRevision,
      actorParticipantId: event.currentActorId,
      actionOfferId: null,
      interactionId: null,
      acceptedPresentationId: null,
      targetMode: null,
      recoveryReason: null,
    })
  }
  if (event.type === 'pending-received') {
    requireId(event.interactionId, 'interaction ID', state, event)
    return advance(state, {
      phase: 'wait',
      interactionId: event.interactionId,
      acceptedPresentationId: null,
      targetMode: null,
      recoveryReason: null,
    })
  }
  if (event.type === 'accepted-received') {
    requireId(event.presentationId, 'presentation ID', state, event)
    return advance(state, {
      phase: 'resolve',
      acceptedPresentationId: event.presentationId,
      interactionId: null,
      targetMode: null,
      recoveryReason: null,
    })
  }
  if (state.phase === 'recover') {
    throw new EncounterWorkspaceTransitionError(state.phase, event.type, 'recovery must settle before ordinary play resumes.')
  }
  if (event.type === 'actor-selected') {
    requireId(event.participantId, 'participant ID', state, event)
    if (state.phase !== 'observe' && state.phase !== 'choose') {
      throw new EncounterWorkspaceTransitionError(state.phase, event.type, 'actor selection is available only while observing or choosing.')
    }
    return advance(state, {
      phase: 'choose',
      actorParticipantId: event.participantId,
      actionOfferId: null,
      interactionId: null,
      acceptedPresentationId: null,
      targetMode: null,
      focusOriginId: event.focusOriginId ?? state.focusOriginId,
    })
  }
  if (event.type === 'action-chosen') {
    requireId(event.offerId, 'offer ID', state, event)
    requireId(event.actorParticipantId, 'participant ID', state, event)
    if (state.phase !== 'choose' && state.phase !== 'observe') {
      throw new EncounterWorkspaceTransitionError(state.phase, event.type, 'an action cannot replace an active target, response, or result.')
    }
    return advance(state, {
      phase: event.targetMode === null ? 'choose' : 'target',
      actorParticipantId: event.actorParticipantId,
      actionOfferId: event.offerId,
      interactionId: null,
      acceptedPresentationId: null,
      targetMode: event.targetMode,
      focusOriginId: event.focusOriginId ?? state.focusOriginId,
    })
  }
  if (event.type === 'target-cancelled') {
    if (state.phase !== 'target') {
      throw new EncounterWorkspaceTransitionError(state.phase, event.type, 'no target workflow is active.')
    }
    return advance(state, { phase: 'choose', actionOfferId: null, targetMode: null })
  }
  if (event.type === 'intent-submitted') {
    if ((state.phase !== 'choose' && state.phase !== 'target') || state.actionOfferId === null) {
      throw new EncounterWorkspaceTransitionError(state.phase, event.type, 'an action must be selected before submission.')
    }
    return advance(state, { phase: 'resolve', acceptedPresentationId: null, targetMode: null })
  }
  if (event.type === 'presentation-settled') {
    if (state.phase !== 'resolve') {
      throw new EncounterWorkspaceTransitionError(state.phase, event.type, 'no accepted or pending command is settling.')
    }
    if (event.nextInteractionId) requireId(event.nextInteractionId, 'interaction ID', state, event)
    return advance(state, {
      phase: event.nextInteractionId ? 'wait' : 'observe',
      actionOfferId: null,
      interactionId: event.nextInteractionId ?? null,
      acceptedPresentationId: null,
      targetMode: null,
    })
  }
  throw new EncounterWorkspaceTransitionError(state.phase, eventType, 'event is not valid in this state.')
}
