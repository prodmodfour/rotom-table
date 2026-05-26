import {
  SESSION_CLIENT_IDENTITY_SCHEMA_VERSION,
  type SessionClientIdentity,
} from '#shared/sessionClientIdentity'
import { isRecord } from '#shared/sessionCommandValidation'
import {
  isClientId,
  isPlayerId,
  isSessionDisplayName,
  isSessionId,
  type ClientId,
  type PlayerId,
  type SessionId,
} from '#shared/sessionIdentity'
import {
  isGmSessionActor,
  isPlayerSessionActor,
  type PlayerAssignmentRecord,
  type SessionActor,
} from '#shared/sessionPermissions'
import {
  isSessionPresenceStatus,
  type SessionPresenceEntry,
  type SessionPresenceMessage,
  type SessionPresenceStatus,
  type SessionSnapshotMessage,
} from '#shared/sessionMessages'
import {
  isSessionRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import type {
  SessionConnectedClientRecord,
  SessionPlayerRecord,
} from '#shared/sessionState'

export interface BuildSessionPresencePanelModelInput {
  readonly identity: SessionClientIdentity | null
  readonly presence: SessionPresenceMessage | null
  readonly snapshot: SessionSnapshotMessage<unknown> | null
}

export interface SessionPresenceControlSummary {
  readonly tokenCount: number
  readonly sheetCount: number
  readonly visibleMapCount: number
  readonly label: string
  readonly detail: string
}

export interface SessionPresenceParticipant {
  readonly id: string
  readonly role: 'gm' | 'player'
  readonly playerId?: PlayerId
  readonly displayName: string
  readonly status: SessionPresenceStatus
  readonly isSelf: boolean
  readonly connectedClientCount: number
  readonly totalClientCount: number
  readonly controls: SessionPresenceControlSummary
  readonly lastSeenAt?: string
}

export interface SessionPresencePanelModel {
  readonly sessionId: SessionId
  readonly currentRevision: SessionRevision | null
  readonly actorLabel: string
  readonly actorRoleLabel: 'GM' | 'Player'
  readonly connectedPlayerCount: number
  readonly connectedClientCount: number
  readonly participants: readonly SessionPresenceParticipant[]
  readonly selfParticipant: SessionPresenceParticipant | null
}

interface SnapshotPresenceState {
  readonly revision: SessionRevision | null
  readonly players: readonly SessionPlayerRecord[]
  readonly connectedClients: readonly SessionConnectedClientRecord[]
  readonly assignments: readonly PlayerAssignmentRecord[]
}

interface ParticipantAccumulator {
  readonly role: 'gm' | 'player'
  readonly playerId?: PlayerId
  displayName: string
  assignment?: PlayerAssignmentRecord
  readonly clients: SessionPresenceEntry[]
}

const STATUS_RANK: Record<SessionPresenceStatus, number> = {
  disconnected: 0,
  reconnecting: 1,
  connected: 2,
}

const isSessionPlayerRecord = (value: unknown): value is SessionPlayerRecord => (
  isRecord(value) &&
  isPlayerId(value.playerId) &&
  isSessionDisplayName(value.displayName) &&
  typeof value.joinedAt === 'string' &&
  typeof value.updatedAt === 'string'
)

const isSessionConnectedClientRecord = (value: unknown): value is SessionConnectedClientRecord => (
  isRecord(value) &&
  isClientId(value.clientId) &&
  (isGmSessionActor(value.actor) || isPlayerSessionActor(value.actor)) &&
  isSessionPresenceStatus(value.status) &&
  typeof value.connectedAt === 'string' &&
  (value.lastSeenAt === undefined || typeof value.lastSeenAt === 'string') &&
  (value.lastSeenRevision === undefined || isSessionRevision(value.lastSeenRevision))
)

const isPlayerAssignmentRecord = (value: unknown): value is PlayerAssignmentRecord => (
  isRecord(value) &&
  isPlayerId(value.playerId) &&
  isSessionDisplayName(value.displayName) &&
  Array.isArray(value.controllableResources) &&
  Array.isArray(value.visibleResources) &&
  typeof value.updatedAt === 'string'
)

const snapshotStateFromMessage = (
  message: SessionSnapshotMessage<unknown> | null,
  sessionId: SessionId,
): SnapshotPresenceState | null => {
  if (message === null || message.sessionId !== sessionId) return null
  const snapshot = message.snapshot
  if (!isRecord(snapshot) || !isSessionId(snapshot.sessionId) || snapshot.sessionId !== sessionId) return null

  return {
    revision: isSessionRevision(snapshot.revision) ? snapshot.revision : null,
    players: Array.isArray(snapshot.players) ? snapshot.players.filter(isSessionPlayerRecord) : [],
    connectedClients: Array.isArray(snapshot.connectedClients)
      ? snapshot.connectedClients.filter(isSessionConnectedClientRecord)
      : [],
    assignments: Array.isArray(snapshot.assignments) ? snapshot.assignments.filter(isPlayerAssignmentRecord) : [],
  }
}

const presenceClientsForSession = (
  presence: SessionPresenceMessage | null,
  sessionId: SessionId,
): readonly SessionPresenceEntry[] => (
  presence?.sessionId === sessionId ? presence.clients : []
)

const clientEntryFromRecord = (
  client: SessionConnectedClientRecord,
): SessionPresenceEntry => ({
  actor: client.actor,
  clientId: client.clientId,
  status: client.status,
  connectedAt: client.connectedAt,
  ...(client.lastSeenAt === undefined ? {} : { lastSeenAt: client.lastSeenAt }),
  ...(client.lastSeenRevision === undefined ? {} : { lastSeenRevision: client.lastSeenRevision }),
})

const mergeClientEntries = (
  snapshotState: SnapshotPresenceState | null,
  presenceClients: readonly SessionPresenceEntry[],
): readonly SessionPresenceEntry[] => {
  const clientsById = new Map<ClientId, SessionPresenceEntry>()

  for (const client of snapshotState?.connectedClients ?? []) {
    clientsById.set(client.clientId, clientEntryFromRecord(client))
  }

  for (const client of presenceClients) {
    clientsById.set(client.clientId, client)
  }

  return [...clientsById.values()]
}

const assignmentControlSummary = (
  role: 'gm' | 'player',
  assignment: PlayerAssignmentRecord | undefined,
  assignmentHidden: boolean,
): SessionPresenceControlSummary => {
  if (role === 'gm') {
    return {
      tokenCount: 0,
      sheetCount: 0,
      visibleMapCount: 0,
      label: 'GM authority',
      detail: 'Can control the table and manage player assignments.',
    }
  }

  if (assignment === undefined) {
    return {
      tokenCount: 0,
      sheetCount: 0,
      visibleMapCount: 0,
      label: assignmentHidden ? 'Assignment hidden' : 'No controls assigned',
      detail: assignmentHidden
        ? 'This player is visible through presence, but their controls are not in this client snapshot.'
        : 'The GM has not assigned controllable sheets or tokens yet.',
    }
  }

  const tokenCount = assignment.controllableResources.filter((resource) => resource.kind === 'token').length
  const sheetCount = assignment.controllableResources.filter((resource) => resource.kind === 'sheet').length
  const visibleMapCount = assignment.visibleResources.filter((resource) => resource.kind === 'map').length
  const parts = [
    tokenCount > 0 ? `${tokenCount} token${tokenCount === 1 ? '' : 's'}` : null,
    sheetCount > 0 ? `${sheetCount} sheet${sheetCount === 1 ? '' : 's'}` : null,
  ].filter((part): part is string => part !== null)

  return {
    tokenCount,
    sheetCount,
    visibleMapCount,
    label: parts.length > 0 ? parts.join(' · ') : 'No controls assigned',
    detail: visibleMapCount > 0
      ? `Visible on ${visibleMapCount} map${visibleMapCount === 1 ? '' : 's'}.`
      : 'No visible maps are assigned yet.',
  }
}

const participantKeyForActor = (actor: SessionActor): string => (
  actor.role === 'gm' ? 'gm' : `player:${actor.playerId}`
)

const participantKeyForIdentity = (identity: SessionClientIdentity): string => (
  identity.role === 'gm' ? 'gm' : `player:${identity.playerId}`
)

const participantStatus = (
  clients: readonly SessionPresenceEntry[],
): SessionPresenceStatus => {
  if (clients.length === 0) return 'disconnected'

  return clients.reduce<SessionPresenceStatus>((selected, client) => (
    STATUS_RANK[client.status] > STATUS_RANK[selected] ? client.status : selected
  ), 'disconnected')
}

const latestLastSeenAt = (
  clients: readonly SessionPresenceEntry[],
): string | undefined => {
  const timestamps = clients
    .map((client) => client.lastSeenAt ?? client.connectedAt)
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .sort()
  return timestamps.at(-1)
}

const actorLabelForIdentity = (identity: SessionClientIdentity): string => (
  identity.role === 'gm' ? 'GM' : identity.displayName
)

const addOrGetParticipant = (
  participantsByKey: Map<string, ParticipantAccumulator>,
  key: string,
  role: 'gm' | 'player',
  displayName: string,
  playerId?: PlayerId,
): ParticipantAccumulator => {
  const existing = participantsByKey.get(key)
  if (existing !== undefined) {
    if (existing.displayName === 'Player' && displayName !== 'Player') existing.displayName = displayName
    return existing
  }

  const participant: ParticipantAccumulator = {
    role,
    ...(playerId === undefined ? {} : { playerId }),
    displayName,
    clients: [],
  }
  participantsByKey.set(key, participant)
  return participant
}

const sortParticipants = (
  left: SessionPresenceParticipant,
  right: SessionPresenceParticipant,
): number => {
  if (left.role !== right.role) return left.role === 'gm' ? -1 : 1
  if (left.status !== right.status) return STATUS_RANK[right.status] - STATUS_RANK[left.status]
  if (left.isSelf !== right.isSelf) return left.isSelf ? -1 : 1
  return left.displayName.localeCompare(right.displayName)
}

export const buildSessionPresencePanelModel = (
  input: BuildSessionPresencePanelModelInput,
): SessionPresencePanelModel | null => {
  const { identity } = input
  if (identity === null || identity.schemaVersion !== SESSION_CLIENT_IDENTITY_SCHEMA_VERSION) return null

  const snapshotState = snapshotStateFromMessage(input.snapshot, identity.sessionId)
  const presenceClients = presenceClientsForSession(input.presence, identity.sessionId)
  const clients = mergeClientEntries(snapshotState, presenceClients)
  const assignmentsByPlayerId = new Map<PlayerId, PlayerAssignmentRecord>()
  for (const assignment of snapshotState?.assignments ?? []) assignmentsByPlayerId.set(assignment.playerId, assignment)

  const participantsByKey = new Map<string, ParticipantAccumulator>()
  if (identity.role === 'gm') {
    addOrGetParticipant(participantsByKey, 'gm', 'gm', 'GM')
  } else {
    addOrGetParticipant(participantsByKey, `player:${identity.playerId}`, 'player', identity.displayName, identity.playerId)
  }

  for (const player of snapshotState?.players ?? []) {
    addOrGetParticipant(
      participantsByKey,
      `player:${player.playerId}`,
      'player',
      player.displayName,
      player.playerId,
    )
  }

  for (const assignment of snapshotState?.assignments ?? []) {
    const participant = addOrGetParticipant(
      participantsByKey,
      `player:${assignment.playerId}`,
      'player',
      assignment.displayName,
      assignment.playerId,
    )
    participant.assignment = assignment
  }

  for (const client of clients) {
    const actor = client.actor
    const key = participantKeyForActor(actor)
    const participant = actor.role === 'gm'
      ? addOrGetParticipant(participantsByKey, key, 'gm', 'GM')
      : addOrGetParticipant(participantsByKey, key, 'player', actor.displayName, actor.playerId)
    participant.clients.push(client)
  }

  const selfKey = participantKeyForIdentity(identity)
  const participants = [...participantsByKey.entries()].map(([key, participant]) => {
    const isSelf = key === selfKey
    const assignment = participant.role === 'player'
      ? participant.assignment ?? (participant.playerId === undefined ? undefined : assignmentsByPlayerId.get(participant.playerId))
      : undefined
    const assignmentHidden = participant.role === 'player' && assignment === undefined && !isSelf && identity.role === 'player'
    const connectedClientCount = participant.clients.filter((client) => client.status === 'connected').length

    return {
      id: key,
      role: participant.role,
      ...(participant.playerId === undefined ? {} : { playerId: participant.playerId }),
      displayName: participant.displayName,
      status: participantStatus(participant.clients),
      isSelf,
      connectedClientCount,
      totalClientCount: participant.clients.length,
      controls: assignmentControlSummary(participant.role, assignment, assignmentHidden),
      ...(latestLastSeenAt(participant.clients) === undefined ? {} : { lastSeenAt: latestLastSeenAt(participant.clients) }),
    } satisfies SessionPresenceParticipant
  }).sort(sortParticipants)

  const presenceRevision = input.presence?.sessionId === identity.sessionId && isSessionRevision(input.presence.currentRevision)
    ? input.presence.currentRevision
    : null
  const snapshotRevision = input.snapshot?.sessionId === identity.sessionId && isSessionRevision(input.snapshot.currentRevision)
    ? input.snapshot.currentRevision
    : null
  const currentRevision = presenceRevision ?? snapshotRevision ?? snapshotState?.revision ?? identity.lastSeenRevision ?? null

  return {
    sessionId: identity.sessionId,
    currentRevision,
    actorLabel: actorLabelForIdentity(identity),
    actorRoleLabel: identity.role === 'gm' ? 'GM' : 'Player',
    connectedPlayerCount: participants.filter(
      (participant) => participant.role === 'player' && participant.status === 'connected',
    ).length,
    connectedClientCount: clients.filter((client) => client.status === 'connected').length,
    participants,
    selfParticipant: participants.find((participant) => participant.isSelf) ?? null,
  }
}
