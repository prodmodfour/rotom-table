import type { EncounterPendingInteractionView } from '../encounterPresentation/contracts'
import type { EncounterWorkspaceViewModel } from './model'
import type { EncounterWorkspaceMachineState } from './stateMachine'

export type EncounterWorkspacePriorityKind =
  | 'system-recovery'
  | 'authorized-decision'
  | 'public-waiting'
  | 'targeting'
  | 'accepted-result'
  | 'action-choice'
  | 'current-actor'
  | 'idle'

export interface EncounterWorkspacePriority {
  readonly kind: EncounterWorkspacePriorityKind
  readonly priority: number
  readonly stableKey: string
  readonly participantId: string | null
  readonly interactionId: string | null
  readonly offerId: string | null
  readonly presentationId: string | null
  readonly focusTarget: 'system-heading' | 'decision-heading' | 'target-heading' | 'result-heading' | 'action-dock' | 'current-actor' | 'workspace'
  readonly announcement: 'assertive' | 'polite' | 'none'
}

const pendingRank = (pending: EncounterPendingInteractionView): readonly [number, number, string] => [
  pending.status === 'pending' ? 0 : pending.status === 'resuming' ? 1 : 2,
  pending.expiresAt ?? Number.MAX_SAFE_INTEGER,
  pending.interactionId,
]

const comparePending = (left: EncounterPendingInteractionView, right: EncounterPendingInteractionView): number => {
  const a = pendingRank(left)
  const b = pendingRank(right)
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2])
}

const activePending = (
  workspace: EncounterWorkspaceViewModel,
): EncounterPendingInteractionView[] => workspace.pending
  .filter(pending => pending.status === 'pending' || pending.status === 'resuming')
  .sort(comparePending)

/**
 * Chooses one primary visual/focus owner. This never grants authorization; it
 * selects only among rows already present in the role-projected workspace.
 */
export const resolveEncounterWorkspacePriority = (
  workspace: EncounterWorkspaceViewModel,
  machine: EncounterWorkspaceMachineState,
): EncounterWorkspacePriority => {
  if (workspace.system.commandsBlocked || machine.phase === 'recover') return {
    kind: 'system-recovery',
    priority: 100,
    stableKey: `system:${workspace.system.connection}:${workspace.source.mapRevision}`,
    participantId: null,
    interactionId: null,
    offerId: null,
    presentationId: null,
    focusTarget: 'system-heading',
    announcement: 'assertive',
  }

  const pending = activePending(workspace)
  const authorized = pending.find(interaction => interaction.projection !== 'public')
  if (authorized) return {
    kind: 'authorized-decision',
    priority: 90,
    stableKey: `decision:${authorized.interactionId}`,
    participantId: authorized.actor?.participantId ?? null,
    interactionId: authorized.interactionId,
    offerId: null,
    presentationId: null,
    focusTarget: 'decision-heading',
    announcement: authorized.announcement.priority === 'assertive' ? 'assertive' : 'polite',
  }
  if (pending[0]) return {
    kind: 'public-waiting',
    priority: 80,
    stableKey: `waiting:${pending[0].interactionId}`,
    participantId: pending[0].actor?.participantId ?? null,
    interactionId: pending[0].interactionId,
    offerId: null,
    presentationId: null,
    focusTarget: 'decision-heading',
    announcement: 'polite',
  }

  if (machine.phase === 'target' && machine.actionOfferId) return {
    kind: 'targeting',
    priority: 70,
    stableKey: `target:${machine.actionOfferId}`,
    participantId: machine.actorParticipantId,
    interactionId: null,
    offerId: machine.actionOfferId,
    presentationId: null,
    focusTarget: 'target-heading',
    announcement: 'polite',
  }

  if (machine.phase === 'resolve') {
    const accepted = machine.acceptedPresentationId
      ? workspace.accepted.find(value => value.presentationId === machine.acceptedPresentationId)
      : workspace.accepted.at(-1)
    if (accepted) return {
      kind: 'accepted-result',
      priority: 60,
      stableKey: `result:${accepted.presentationId}`,
      participantId: accepted.actor?.participantId ?? null,
      interactionId: null,
      offerId: machine.actionOfferId,
      presentationId: accepted.presentationId,
      focusTarget: 'result-heading',
      announcement: accepted.announcements.some(value => value.priority === 'assertive') ? 'assertive' : 'polite',
    }
  }

  if (machine.phase === 'choose' || machine.actionOfferId) return {
    kind: 'action-choice',
    priority: 50,
    stableKey: `actions:${machine.actorParticipantId ?? workspace.turn.currentParticipantId ?? 'none'}`,
    participantId: machine.actorParticipantId ?? workspace.turn.currentParticipantId,
    interactionId: null,
    offerId: machine.actionOfferId,
    presentationId: null,
    focusTarget: 'action-dock',
    announcement: 'none',
  }

  if (workspace.turn.currentParticipantId) return {
    kind: 'current-actor',
    priority: 40,
    stableKey: `actor:${workspace.turn.currentParticipantId}:${workspace.turn.round}`,
    participantId: workspace.turn.currentParticipantId,
    interactionId: null,
    offerId: null,
    presentationId: null,
    focusTarget: 'current-actor',
    announcement: 'polite',
  }

  return {
    kind: 'idle',
    priority: 0,
    stableKey: `workspace:${workspace.source.workspaceId}`,
    participantId: null,
    interactionId: null,
    offerId: null,
    presentationId: null,
    focusTarget: 'workspace',
    announcement: 'none',
  }
}

export interface EncounterFocusArbitration {
  readonly moveFocus: boolean
  readonly target: EncounterWorkspacePriority['focusTarget']
  readonly restoreOriginId: string | null
  readonly reason: 'new-primary-decision' | 'system-blocked' | 'stable-primary' | 'primary-settled'
}

export const arbitrateEncounterWorkspaceFocus = (input: {
  readonly previous: EncounterWorkspacePriority | null
  readonly next: EncounterWorkspacePriority
  readonly focusOriginId: string | null
}): EncounterFocusArbitration => {
  if (input.previous?.stableKey === input.next.stableKey) return {
    moveFocus: false,
    target: input.next.focusTarget,
    restoreOriginId: null,
    reason: 'stable-primary',
  }
  if (input.next.kind === 'system-recovery') return {
    moveFocus: true,
    target: 'system-heading',
    restoreOriginId: null,
    reason: 'system-blocked',
  }
  if (input.next.kind === 'authorized-decision' || input.next.kind === 'public-waiting' || input.next.kind === 'targeting') return {
    moveFocus: true,
    target: input.next.focusTarget,
    restoreOriginId: null,
    reason: 'new-primary-decision',
  }
  return {
    moveFocus: input.focusOriginId !== null,
    target: input.next.focusTarget,
    restoreOriginId: input.focusOriginId,
    reason: 'primary-settled',
  }
}
