export interface MoveAutomationRelationshipParticipant {
  /** Stable map-placement identity. */
  readonly id: string
  /** Explicit encounter side identity when the authoritative map provides one. */
  readonly sideId?: string | null
}

const explicitSideId = (participant: MoveAutomationRelationshipParticipant): string | null => {
  const sideId = participant.sideId
  return typeof sideId === 'string' && sideId.trim() ? sideId.trim() : null
}

/** Whether both references identify the same map placement. */
export const self = (
  participant: MoveAutomationRelationshipParticipant,
  other: MoveAutomationRelationshipParticipant,
): boolean => participant.id === other.id

/** Whether two placements have the same known, explicit encounter side. */
export const sameSide = (
  participant: MoveAutomationRelationshipParticipant,
  other: MoveAutomationRelationshipParticipant,
): boolean => {
  const participantSideId = explicitSideId(participant)
  const otherSideId = explicitSideId(other)
  return participantSideId !== null
    && otherSideId !== null
    && participantSideId === otherSideId
}

/** Whether distinct placements have the same known, explicit encounter side. */
export const ally = (
  participant: MoveAutomationRelationshipParticipant,
  other: MoveAutomationRelationshipParticipant,
): boolean => !self(participant, other) && sameSide(participant, other)

/** Whether distinct placements have different known, explicit encounter sides. */
export const enemy = (
  participant: MoveAutomationRelationshipParticipant,
  other: MoveAutomationRelationshipParticipant,
): boolean => {
  if (self(participant, other)) return false
  const participantSideId = explicitSideId(participant)
  const otherSideId = explicitSideId(other)
  return participantSideId !== null
    && otherSideId !== null
    && participantSideId !== otherSideId
}
