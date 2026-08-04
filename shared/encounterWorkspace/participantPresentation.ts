import type { AcceptedEncounterPresentation } from '../encounterPresentation/contracts'
import type { EncounterVisualState } from './designTokens'
import type { EncounterWorkspaceParticipant } from './model'
import type { EncounterParticipantSummary } from './primitives'

const UNALIGNED_SIDE = Object.freeze({ id: 'unaligned', label: 'Unaligned', symbol: '◇', color: undefined })

export const workspaceParticipantSummary = (
  participant: EncounterWorkspaceParticipant,
): EncounterParticipantSummary => ({
  id: participant.participantId,
  name: participant.displayName,
  role: participant.roleLabel,
  portraitUrl: participant.portraitUrl,
  side: participant.side
    ? { id: participant.side.id, label: participant.side.label, symbol: participant.side.symbol, color: participant.side.color }
    : UNALIGNED_SIDE,
  hp: participant.hp ? { ...participant.hp } : null,
  injuries: participant.injuries,
  conditions: [...participant.conditions],
  resources: participant.resources.map(resource => ({ ...resource })),
  currentTurn: participant.currentTurn,
  controlled: participant.controlled,
  hidden: participant.hidden,
  fainted: participant.fainted,
})

export interface EncounterParticipantDisplayGroup {
  readonly groupId: string
  readonly kind: 'individual' | 'wild-group'
  readonly label: string
  readonly participantIds: readonly string[]
  readonly participants: readonly EncounterWorkspaceParticipant[]
}

const wildGroupKey = (
  participant: EncounterWorkspaceParticipant,
  trainerSideIds: ReadonlySet<string>,
): string | null => {
  if (participant.kind !== 'pokemon' || participant.currentTurn) return null
  if (participant.controlled && participant.side && trainerSideIds.has(participant.side.id)) return null
  return `${participant.side?.id ?? 'unaligned'}\u0000${participant.roleLabel.toLocaleLowerCase('en-US')}`
}

/** Presentation grouping only: participant identities and mechanics remain individual. */
export const groupEncounterWorkspaceParticipants = (
  participants: readonly EncounterWorkspaceParticipant[],
  minimumGroupSize = 3,
): EncounterParticipantDisplayGroup[] => {
  const candidates = new Map<string, EncounterWorkspaceParticipant[]>()
  const trainerSideIds = new Set(participants.flatMap(participant => (
    participant.kind === 'trainer' && participant.side ? [participant.side.id] : []
  )))
  for (const participant of participants) {
    const key = wildGroupKey(participant, trainerSideIds)
    if (!key) continue
    const group = candidates.get(key) ?? []
    group.push(participant)
    candidates.set(key, group)
  }
  const groupedIds = new Set<string>()
  const groups: EncounterParticipantDisplayGroup[] = []
  for (const [key, members] of [...candidates.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (members.length < minimumGroupSize) continue
    const ordered = [...members].sort((left, right) => left.displayName.localeCompare(right.displayName)
      || left.participantId.localeCompare(right.participantId))
    for (const participant of ordered) groupedIds.add(participant.participantId)
    groups.push({
      groupId: `wild-group:${key.replace('\u0000', ':')}`,
      kind: 'wild-group',
      label: `${ordered[0]?.roleLabel ?? 'Wild Pokémon'} ×${ordered.length}`,
      participantIds: ordered.map(participant => participant.participantId),
      participants: ordered,
    })
  }
  for (const participant of participants) {
    if (groupedIds.has(participant.participantId)) continue
    groups.push({
      groupId: `participant:${participant.participantId}`,
      kind: 'individual',
      label: participant.displayName,
      participantIds: [participant.participantId],
      participants: [participant],
    })
  }
  return groups.sort((left, right) => {
    const leftCurrent = left.participants.some(participant => participant.currentTurn) ? 0 : 1
    const rightCurrent = right.participants.some(participant => participant.currentTurn) ? 0 : 1
    return leftCurrent - rightCurrent || left.label.localeCompare(right.label) || left.groupId.localeCompare(right.groupId)
  })
}

export interface EncounterParticipantAcceptedState {
  readonly state: Extract<EncounterVisualState, 'accepted' | 'corrected'>
  readonly presentationId: string
  readonly labels: readonly string[]
}

export const acceptedParticipantPresentationStates = (
  presentations: readonly AcceptedEncounterPresentation[],
): ReadonlyMap<string, EncounterParticipantAcceptedState> => {
  const states = new Map<string, EncounterParticipantAcceptedState>()
  const latestRevision = presentations.reduce((maximum, presentation) => Math.max(maximum, presentation.revision), -1)
  for (const presentation of presentations) {
    if (presentation.revision !== latestRevision) continue
    const participantIds = new Set([
      ...presentation.affectedParticipants.map(participant => participant.participantId),
      ...presentation.outcomes.flatMap(outcome => outcome.participantId ? [outcome.participantId] : []),
      ...presentation.changes.flatMap(change => change.participantId ? [change.participantId] : []),
    ])
    const labels = [...new Set([
      ...presentation.outcomes.map(outcome => outcome.label),
      ...presentation.changes.map(change => change.label),
    ])]
    for (const participantId of participantIds) states.set(participantId, {
      state: presentation.correction ? 'corrected' : 'accepted',
      presentationId: presentation.presentationId,
      labels,
    })
  }
  return states
}
