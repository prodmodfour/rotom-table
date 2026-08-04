import type { EncounterWorkspaceViewModel } from './model'

export interface EncounterTacticalFocus {
  readonly originKind: 'action' | 'decision' | 'participant' | 'director'
  readonly originId: string
  readonly participantIds: readonly string[]
  readonly cells: readonly { x: number, y: number, z: number }[]
  readonly mode: 'embedded' | 'split' | 'picture-in-picture' | 'full-screen'
}

export interface EncounterWorkspaceFocusOrigin {
  readonly kind: 'participant' | 'action' | 'decision' | 'history' | 'utility'
  readonly id: string
}

export interface EncounterWorkspaceSelection {
  readonly mapRevision: number
  readonly currentActorId: string | null
  readonly selectedActorId: string | null
  readonly inspectedParticipantId: string | null
  readonly targetPreviewParticipantIds: readonly string[]
  readonly tacticalFocus: EncounterTacticalFocus | null
  readonly focusOrigin: EncounterWorkspaceFocusOrigin | null
}

export type EncounterWorkspaceSelectionEvent =
  | { readonly type: 'workspace-adopted', readonly workspace: EncounterWorkspaceViewModel }
  | { readonly type: 'actor-selected', readonly participantId: string | null }
  | { readonly type: 'participant-inspected', readonly participantId: string | null }
  | { readonly type: 'target-previewed', readonly participantIds: readonly string[] }
  | { readonly type: 'tactical-focus-opened', readonly focus: EncounterTacticalFocus }
  | { readonly type: 'tactical-focus-closed' }
  | { readonly type: 'focus-origin-set', readonly origin: EncounterWorkspaceFocusOrigin | null }
  | { readonly type: 'cleared' }

export const emptyEncounterWorkspaceSelection = (
  mapRevision = 0,
): EncounterWorkspaceSelection => ({
  mapRevision,
  currentActorId: null,
  selectedActorId: null,
  inspectedParticipantId: null,
  targetPreviewParticipantIds: [],
  tacticalFocus: null,
  focusOrigin: null,
})

const unique = (values: readonly string[]): string[] => [...new Set(values)]

export const reconcileEncounterWorkspaceSelection = (
  selection: EncounterWorkspaceSelection,
  workspace: EncounterWorkspaceViewModel,
): EncounterWorkspaceSelection => {
  const visible = new Set(workspace.participants.map(participant => participant.participantId))
  const currentActorId = workspace.turn.currentParticipantId
  const selectedActorId = selection.selectedActorId && visible.has(selection.selectedActorId)
    ? selection.selectedActorId
    : currentActorId
  const inspectedParticipantId = selection.inspectedParticipantId && visible.has(selection.inspectedParticipantId)
    ? selection.inspectedParticipantId
    : null
  const targetPreviewParticipantIds = unique(selection.targetPreviewParticipantIds)
    .filter(id => visible.has(id))
  const tacticalFocus = selection.tacticalFocus
    ? {
        ...selection.tacticalFocus,
        participantIds: unique(selection.tacticalFocus.participantIds).filter(id => visible.has(id)),
      }
    : null
  return {
    ...selection,
    mapRevision: workspace.source.mapRevision,
    currentActorId,
    selectedActorId,
    inspectedParticipantId,
    targetPreviewParticipantIds,
    tacticalFocus,
  }
}

const requireVisibleParticipant = (
  state: EncounterWorkspaceSelection,
  participantId: string,
  visibleParticipantIds: ReadonlySet<string>,
): void => {
  if (!visibleParticipantIds.has(participantId)) {
    throw new Error(`Encounter participant ${participantId} is not visible in the current workspace.`)
  }
  if (state.mapRevision < 0) throw new Error('Encounter selection revision is invalid.')
}

export const reduceEncounterWorkspaceSelection = (
  state: EncounterWorkspaceSelection,
  event: EncounterWorkspaceSelectionEvent,
  visibleParticipantIds: ReadonlySet<string> = new Set(),
): EncounterWorkspaceSelection => {
  if (event.type === 'workspace-adopted') return reconcileEncounterWorkspaceSelection(state, event.workspace)
  if (event.type === 'cleared') return emptyEncounterWorkspaceSelection(state.mapRevision)
  if (event.type === 'actor-selected') {
    if (event.participantId !== null) requireVisibleParticipant(state, event.participantId, visibleParticipantIds)
    return { ...state, selectedActorId: event.participantId, targetPreviewParticipantIds: [], tacticalFocus: null }
  }
  if (event.type === 'participant-inspected') {
    if (event.participantId !== null) requireVisibleParticipant(state, event.participantId, visibleParticipantIds)
    return { ...state, inspectedParticipantId: event.participantId }
  }
  if (event.type === 'target-previewed') {
    const participantIds = unique(event.participantIds)
    for (const id of participantIds) requireVisibleParticipant(state, id, visibleParticipantIds)
    return { ...state, targetPreviewParticipantIds: participantIds }
  }
  if (event.type === 'tactical-focus-opened') {
    for (const id of event.focus.participantIds) requireVisibleParticipant(state, id, visibleParticipantIds)
    return {
      ...state,
      tacticalFocus: {
        ...event.focus,
        participantIds: unique(event.focus.participantIds),
        cells: event.focus.cells.map(cell => ({ ...cell })),
      },
    }
  }
  if (event.type === 'tactical-focus-closed') return { ...state, tacticalFocus: null }
  return { ...state, focusOrigin: event.origin }
}
