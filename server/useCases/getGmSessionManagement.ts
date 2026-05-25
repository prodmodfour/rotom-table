import {
  parseGmKey,
  parseSessionId,
  type GmKey,
  type JoinCode,
  type SessionId,
} from '#shared/sessionIdentity'
import type {
  PlayerAssignmentRecord,
  SessionActor,
  SessionControllableResourceRef,
  SessionVisibleResourceRef,
} from '#shared/sessionPermissions'
import type { SessionRevision } from '#shared/sessionRevisions'
import type {
  AuthoritativeSessionState,
  SelectedSessionMapSlug,
  SessionConnectedClientRecord,
  SessionPlayerRecord,
} from '#shared/sessionState'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
  type SessionStoreStatus,
} from '../utils/sessionStore'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class GetGmSessionManagementUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export interface GetGmSessionManagementInput {
  readonly sessionId?: unknown
  readonly gmKey?: unknown
}

export interface GetGmSessionManagementDependencies<TMapDocument = unknown> {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>
}

export interface ManagedGmSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly selectedMapSlug: SelectedSessionMapSlug
  readonly createdAt: string
  readonly updatedAt: string
  readonly endedAt?: string
  readonly playerCount: number
  readonly connectedClientCount: number
  readonly assignmentCount: number
  readonly mapCount: number
}

export interface ManagedGmSessionJoinDetails {
  readonly joinCode: JoinCode
}

export type ManagedSessionPlayerSummary = SessionPlayerRecord
export type ManagedSessionConnectedClientSummary = SessionConnectedClientRecord
export type ManagedSessionAssignmentSummary = PlayerAssignmentRecord

export interface GetGmSessionManagementUseCaseResult<TMapDocument = unknown> {
  readonly session: ManagedGmSessionDetails
  readonly join: ManagedGmSessionJoinDetails
  readonly players: readonly ManagedSessionPlayerSummary[]
  readonly connectedClients: readonly ManagedSessionConnectedClientSummary[]
  readonly assignments: readonly ManagedSessionAssignmentSummary[]
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TMapDocument>>
  readonly state: AuthoritativeSessionState<TMapDocument>
}

type ManagedSessionRecord<TMapDocument> = SessionStoreRecord<
  AuthoritativeSessionState<TMapDocument>
> & {
  readonly state: AuthoritativeSessionState<TMapDocument>
}

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const normalizeSessionIdForManagement = (value: unknown): SessionId => {
  try {
    return parseSessionId(value)
  } catch (error) {
    throw new GetGmSessionManagementUseCaseError(400, messageFromError(error))
  }
}

const normalizeGmKeyForManagement = (value: unknown): GmKey => {
  try {
    return parseGmKey(value)
  } catch (error) {
    throw new GetGmSessionManagementUseCaseError(400, messageFromError(error))
  }
}

const getManagedSessionRecord = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
  sessionId: SessionId,
  gmKey: GmKey,
): ManagedSessionRecord<TMapDocument> => {
  const record = store.get(sessionId)
  if (record === undefined) {
    throw new GetGmSessionManagementUseCaseError(
      404,
      'No Track 2 table session was found for the supplied session ID',
    )
  }

  if (record.gmKey !== gmKey) {
    throw new GetGmSessionManagementUseCaseError(
      403,
      'The supplied GM key is not authorized to manage this Track 2 table session',
    )
  }

  if (record.state === undefined) {
    throw new GetGmSessionManagementUseCaseError(
      500,
      'The Track 2 table session has no authoritative state available for GM management',
    )
  }

  return record as ManagedSessionRecord<TMapDocument>
}

const cloneSessionActor = (actor: SessionActor): SessionActor => ({ ...actor })

const cloneControllableResources = (
  resources: readonly SessionControllableResourceRef[],
): readonly SessionControllableResourceRef[] => resources.map((resource) => ({ ...resource }))

const cloneVisibleResources = (
  resources: readonly SessionVisibleResourceRef[],
): readonly SessionVisibleResourceRef[] => resources.map((resource) => ({ ...resource }))

const clonePlayers = (
  players: readonly SessionPlayerRecord[],
): readonly ManagedSessionPlayerSummary[] => players.map((player) => ({ ...player }))

const cloneConnectedClients = (
  connectedClients: readonly SessionConnectedClientRecord[],
): readonly ManagedSessionConnectedClientSummary[] =>
  connectedClients.map((client) => ({
    ...client,
    actor: cloneSessionActor(client.actor),
  }))

const cloneAssignments = (
  assignments: readonly PlayerAssignmentRecord[],
): readonly ManagedSessionAssignmentSummary[] =>
  assignments.map((assignment) => ({
    ...assignment,
    controllableResources: cloneControllableResources(assignment.controllableResources),
    visibleResources: cloneVisibleResources(assignment.visibleResources),
  }))

export const getGmSessionManagementUseCase = <TMapDocument = unknown>(
  input: GetGmSessionManagementInput = {},
  dependencies: GetGmSessionManagementDependencies<TMapDocument> = {},
): GetGmSessionManagementUseCaseResult<TMapDocument> => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TMapDocument>
  >)
  const sessionId = normalizeSessionIdForManagement(input.sessionId)
  const gmKey = normalizeGmKeyForManagement(input.gmKey)
  const record = getManagedSessionRecord(activeStore, sessionId, gmKey)
  const state = record.state

  return {
    session: {
      sessionId: record.sessionId,
      status: record.status,
      revision: record.revision,
      selectedMapSlug: state.selectedMapSlug,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(record.endedAt === undefined ? {} : { endedAt: record.endedAt }),
      playerCount: state.players.length,
      connectedClientCount: state.connectedClients.length,
      assignmentCount: state.assignments.length,
      mapCount: state.maps.length,
    },
    join: {
      joinCode: record.joinCode,
    },
    players: clonePlayers(state.players),
    connectedClients: cloneConnectedClients(state.connectedClients),
    assignments: cloneAssignments(state.assignments),
    record,
    state,
  }
}
