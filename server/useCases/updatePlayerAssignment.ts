import {
  parseClientId,
  parseGmKey,
  parsePlayerId,
  parseSessionId,
  type ClientId,
  type GmKey,
  type PlayerId,
  type SessionId,
} from '#shared/sessionIdentity'
import {
  sessionResourceRefsMatch,
  type PlayerAssignmentRecord,
  type SessionControllableResourceRef,
  type SessionResourceRef,
  type SessionVisibleResourceRef,
} from '#shared/sessionPermissions'
import { incrementSessionRevision, type SessionRevision } from '#shared/sessionRevisions'
import {
  findSessionPlayerRecord,
  upsertSessionPlayerAssignment,
  type AuthoritativeSessionState,
  type SessionPlayerRecord,
} from '#shared/sessionState'
import { isSheetKind } from '#shared/sheets'
import { assertSessionHostEnabled, type SessionHostRuntimeEnv } from '../utils/sessionHosting'
import {
  writeSessionSnapshot,
  type WriteSessionSnapshotOptions,
  type WriteSessionSnapshotResult,
} from '../utils/sessionSnapshots'
import {
  sessionStore,
  type InMemorySessionStore,
  type SessionStoreRecord,
  type SessionStoreStatus,
} from '../utils/sessionStore'
import { UseCaseHttpError } from '../utils/useCaseErrors'

export class UpdatePlayerAssignmentUseCaseError<
  TStatusCode extends number = number,
> extends UseCaseHttpError<TStatusCode> {}

export const PLAYER_ASSIGNMENT_ACTIONS = ['assign', 'unassign'] as const
export type PlayerAssignmentAction = (typeof PLAYER_ASSIGNMENT_ACTIONS)[number]

export interface UpdatePlayerAssignmentInput {
  readonly sessionId?: unknown
  readonly gmKey?: unknown
  readonly gmClientId?: unknown
  readonly playerId?: unknown
  readonly action?: unknown
  readonly resources?: unknown
}

export type UpdatePlayerAssignmentClock = () => string
export type UpdatePlayerAssignmentSnapshotWriter<TMapDocument = unknown> = (
  state: AuthoritativeSessionState<TMapDocument>,
  options?: WriteSessionSnapshotOptions<TMapDocument>,
) => WriteSessionSnapshotResult<TMapDocument>

export interface UpdatePlayerAssignmentDependencies<TMapDocument = unknown> {
  readonly env?: SessionHostRuntimeEnv
  readonly store?: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>
  readonly clock?: UpdatePlayerAssignmentClock
  readonly writeSnapshot?: UpdatePlayerAssignmentSnapshotWriter<TMapDocument>
}

export interface UpdatedPlayerAssignmentSessionDetails {
  readonly sessionId: SessionId
  readonly status: SessionStoreStatus
  readonly revision: SessionRevision
  readonly createdAt: string
  readonly updatedAt: string
}

export type UpdatedPlayerAssignmentPlayerDetails = SessionPlayerRecord
export type UpdatedPlayerAssignmentDetails = PlayerAssignmentRecord

export interface UpdatedPlayerAssignmentSnapshotDetails {
  readonly writtenAt: string
  readonly revision: SessionRevision
}

export interface UpdatedPlayerAssignmentChangeDetails {
  readonly action: PlayerAssignmentAction
  readonly resources: readonly SessionControllableResourceRef[]
}

export interface UpdatePlayerAssignmentUseCaseResult<TMapDocument = unknown> {
  readonly session: UpdatedPlayerAssignmentSessionDetails
  readonly player: UpdatedPlayerAssignmentPlayerDetails
  readonly assignment: UpdatedPlayerAssignmentDetails
  readonly change: UpdatedPlayerAssignmentChangeDetails
  readonly snapshot: UpdatedPlayerAssignmentSnapshotDetails
  readonly record: SessionStoreRecord<AuthoritativeSessionState<TMapDocument>>
  readonly state: AuthoritativeSessionState<TMapDocument>
}

type AssignableSessionRecord<TMapDocument> = SessionStoreRecord<
  AuthoritativeSessionState<TMapDocument>
> & {
  readonly state: AuthoritativeSessionState<TMapDocument>
}

type UnknownRecord = Record<string, unknown>

const PLAYER_ASSIGNMENT_ACTION_SET = new Set<unknown>(PLAYER_ASSIGNMENT_ACTIONS)
const defaultClock: UpdatePlayerAssignmentClock = () => new Date().toISOString()

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = (record: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key)

const parseNonEmptyString = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UpdatePlayerAssignmentUseCaseError(400, `${path} must be a non-empty string`)
  }

  return value.trim()
}

const normalizeSessionIdForAssignment = (value: unknown): SessionId => {
  try {
    return parseSessionId(value)
  } catch (error) {
    throw new UpdatePlayerAssignmentUseCaseError(400, messageFromError(error))
  }
}

const normalizeGmKeyForAssignment = (value: unknown): GmKey => {
  try {
    return parseGmKey(value)
  } catch (error) {
    throw new UpdatePlayerAssignmentUseCaseError(400, messageFromError(error))
  }
}

const normalizeOptionalGmClientIdForAssignment = (value: unknown): ClientId | undefined => {
  if (value === undefined || value === null || value === '') return undefined

  try {
    return parseClientId(value)
  } catch (error) {
    throw new UpdatePlayerAssignmentUseCaseError(400, messageFromError(error))
  }
}

const normalizePlayerIdForAssignment = (value: unknown): PlayerId => {
  try {
    return parsePlayerId(value)
  } catch (error) {
    throw new UpdatePlayerAssignmentUseCaseError(400, messageFromError(error))
  }
}

const normalizeAssignmentAction = (value: unknown): PlayerAssignmentAction => {
  if (!PLAYER_ASSIGNMENT_ACTION_SET.has(value)) {
    throw new UpdatePlayerAssignmentUseCaseError(400, 'action must be assign or unassign')
  }

  return value as PlayerAssignmentAction
}

const normalizeControllableResource = (
  value: unknown,
  path: string,
): SessionControllableResourceRef => {
  if (!isRecord(value)) {
    throw new UpdatePlayerAssignmentUseCaseError(400, `${path} must be an object`)
  }

  if (value.kind === 'sheet') {
    if (!isSheetKind(value.sheetKind)) {
      throw new UpdatePlayerAssignmentUseCaseError(
        400,
        `${path}.sheetKind must be pokemon or trainer`,
      )
    }

    return {
      kind: 'sheet',
      sheetKind: value.sheetKind,
      sheetSlug: parseNonEmptyString(value.sheetSlug, `${path}.sheetSlug`),
    }
  }

  if (value.kind === 'token') {
    const token: SessionControllableResourceRef = {
      kind: 'token',
      tokenId: parseNonEmptyString(value.tokenId, `${path}.tokenId`),
    }

    if (hasOwn(value, 'mapSlug')) {
      token.mapSlug = parseNonEmptyString(value.mapSlug, `${path}.mapSlug`)
    }

    if (hasOwn(value, 'sheetKind')) {
      if (!isSheetKind(value.sheetKind)) {
        throw new UpdatePlayerAssignmentUseCaseError(
          400,
          `${path}.sheetKind must be pokemon or trainer when provided`,
        )
      }
      token.sheetKind = value.sheetKind
    }

    if (hasOwn(value, 'sheetSlug')) {
      token.sheetSlug = parseNonEmptyString(value.sheetSlug, `${path}.sheetSlug`)
    }

    return token
  }

  throw new UpdatePlayerAssignmentUseCaseError(400, `${path}.kind must be sheet or token`)
}

const normalizeControllableResources = (value: unknown): readonly SessionControllableResourceRef[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new UpdatePlayerAssignmentUseCaseError(
      400,
      'resources must be a non-empty array of player-controllable sheet/token resources',
    )
  }

  return value.map((resource, index) => normalizeControllableResource(resource, `resources[${index}]`))
}

const getAssignableSessionRecord = <TMapDocument>(
  store: InMemorySessionStore<AuthoritativeSessionState<TMapDocument>>,
  sessionId: SessionId,
  gmKey: GmKey,
): AssignableSessionRecord<TMapDocument> => {
  const record = store.get(sessionId)
  if (record === undefined) {
    throw new UpdatePlayerAssignmentUseCaseError(
      404,
      'No Track 2 table session was found for the supplied session ID',
    )
  }

  if (record.gmKey !== gmKey) {
    throw new UpdatePlayerAssignmentUseCaseError(
      403,
      'The supplied GM key is not authorized to update player assignments for this Track 2 table session',
    )
  }

  if (record.status !== 'active') {
    throw new UpdatePlayerAssignmentUseCaseError(
      409,
      'The Track 2 table session must be active before player assignments can be changed',
    )
  }

  if (record.state === undefined) {
    throw new UpdatePlayerAssignmentUseCaseError(
      500,
      'The Track 2 table session has no authoritative state available for player assignment updates',
    )
  }

  return record as AssignableSessionRecord<TMapDocument>
}

const getAssignablePlayerRecord = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  playerId: PlayerId,
): SessionPlayerRecord => {
  const player = findSessionPlayerRecord(state.players, playerId)
  if (player === undefined) {
    throw new UpdatePlayerAssignmentUseCaseError(
      404,
      'No joined player was found for the supplied player ID',
    )
  }

  return player
}

const cloneControllableResource = (
  resource: SessionControllableResourceRef,
): SessionControllableResourceRef => ({ ...resource })

const cloneVisibleResource = (
  resource: SessionVisibleResourceRef,
): SessionVisibleResourceRef => ({ ...resource })

const cloneControllableResources = (
  resources: readonly SessionControllableResourceRef[],
): readonly SessionControllableResourceRef[] => resources.map(cloneControllableResource)

const cloneVisibleResources = (
  resources: readonly SessionVisibleResourceRef[],
): readonly SessionVisibleResourceRef[] => resources.map(cloneVisibleResource)

const resourceMatches = (
  existing: SessionResourceRef,
  requested: SessionResourceRef,
): boolean => sessionResourceRefsMatch(existing, requested)

const appendControllableIfMissing = (
  resources: readonly SessionControllableResourceRef[],
  resource: SessionControllableResourceRef,
): readonly SessionControllableResourceRef[] => {
  if (resources.some((candidate) => resourceMatches(candidate, resource))) {
    return resources
  }

  return [...resources, cloneControllableResource(resource)]
}

const appendVisibleIfMissing = (
  resources: readonly SessionVisibleResourceRef[],
  resource: SessionControllableResourceRef,
): readonly SessionVisibleResourceRef[] => {
  if (resources.some((candidate) => resourceMatches(candidate, resource))) {
    return resources
  }

  return [...resources, cloneControllableResource(resource)]
}

const removeMatchingControllable = (
  resources: readonly SessionControllableResourceRef[],
  resource: SessionControllableResourceRef,
): readonly SessionControllableResourceRef[] =>
  resources.filter((candidate) => !resourceMatches(candidate, resource))

const removeMatchingVisible = (
  resources: readonly SessionVisibleResourceRef[],
  resource: SessionControllableResourceRef,
): readonly SessionVisibleResourceRef[] =>
  resources.filter((candidate) => candidate.kind === 'map' || !resourceMatches(candidate, resource))

const createFallbackAssignment = (
  player: SessionPlayerRecord,
): PlayerAssignmentRecord => ({
  playerId: player.playerId,
  displayName: player.displayName,
  controllableResources: [],
  visibleResources: [],
  updatedAt: player.updatedAt,
})

const updateAssignmentResources = (
  assignment: PlayerAssignmentRecord,
  player: SessionPlayerRecord,
  action: PlayerAssignmentAction,
  resources: readonly SessionControllableResourceRef[],
  updatedAt: string,
  updatedByClientId: ClientId | undefined,
): PlayerAssignmentRecord => {
  let controllableResources = cloneControllableResources(assignment.controllableResources)
  let visibleResources = cloneVisibleResources(assignment.visibleResources)

  for (const resource of resources) {
    if (action === 'assign') {
      controllableResources = appendControllableIfMissing(controllableResources, resource)
      visibleResources = appendVisibleIfMissing(visibleResources, resource)
    } else {
      controllableResources = removeMatchingControllable(controllableResources, resource)
      visibleResources = removeMatchingVisible(visibleResources, resource)
    }
  }

  return {
    playerId: player.playerId,
    displayName: player.displayName,
    controllableResources,
    visibleResources,
    updatedAt,
    ...(updatedByClientId === undefined ? {} : { updatedByClientId }),
  }
}

const cloneAssignment = (assignment: PlayerAssignmentRecord): PlayerAssignmentRecord => ({
  ...assignment,
  controllableResources: cloneControllableResources(assignment.controllableResources),
  visibleResources: cloneVisibleResources(assignment.visibleResources),
})

const clonePlayer = (player: SessionPlayerRecord): SessionPlayerRecord => ({ ...player })

export const updatePlayerAssignmentUseCase = <TMapDocument = unknown>(
  input: UpdatePlayerAssignmentInput = {},
  dependencies: UpdatePlayerAssignmentDependencies<TMapDocument> = {},
): UpdatePlayerAssignmentUseCaseResult<TMapDocument> => {
  assertSessionHostEnabled(dependencies.env)

  const activeStore = dependencies.store ?? (sessionStore as InMemorySessionStore<
    AuthoritativeSessionState<TMapDocument>
  >)
  const clock = dependencies.clock ?? defaultClock
  const snapshotWriter = dependencies.writeSnapshot ?? writeSessionSnapshot

  const sessionId = normalizeSessionIdForAssignment(input.sessionId)
  const gmKey = normalizeGmKeyForAssignment(input.gmKey)
  const gmClientId = normalizeOptionalGmClientIdForAssignment(input.gmClientId)
  const playerId = normalizePlayerIdForAssignment(input.playerId)
  const action = normalizeAssignmentAction(input.action)
  const resources = normalizeControllableResources(input.resources)
  const record = getAssignableSessionRecord(activeStore, sessionId, gmKey)
  const currentState = record.state
  const player = getAssignablePlayerRecord(currentState, playerId)
  const currentAssignment = currentState.assignments.find((assignment) => assignment.playerId === playerId)
    ?? createFallbackAssignment(player)
  const updatedAt = clock()
  const nextRevision = incrementSessionRevision(currentState.revision)
  const nextAssignment = updateAssignmentResources(
    currentAssignment,
    player,
    action,
    resources,
    updatedAt,
    gmClientId,
  )
  const nextState = upsertSessionPlayerAssignment(currentState, nextAssignment, {
    revision: nextRevision,
    updatedAt,
  })

  const updatedRecord = activeStore.setState(record.sessionId, nextState, {
    revision: nextRevision,
    updatedAt,
  })
  if (updatedRecord === undefined) {
    throw new UpdatePlayerAssignmentUseCaseError(
      409,
      'The Track 2 table session ended before player assignments could be changed',
    )
  }

  let snapshot: WriteSessionSnapshotResult<TMapDocument>
  try {
    snapshot = snapshotWriter(nextState, { clock: () => updatedAt })
  } catch (error) {
    activeStore.setState(record.sessionId, currentState, {
      revision: record.revision,
      updatedAt: record.updatedAt,
    })
    throw new UpdatePlayerAssignmentUseCaseError(
      500,
      `Failed to write player-assignment session snapshot: ${messageFromError(error)}`,
    )
  }

  return {
    session: {
      sessionId: updatedRecord.sessionId,
      status: updatedRecord.status,
      revision: updatedRecord.revision,
      createdAt: updatedRecord.createdAt,
      updatedAt: updatedRecord.updatedAt,
    },
    player: clonePlayer(player),
    assignment: cloneAssignment(nextAssignment),
    change: {
      action,
      resources: cloneControllableResources(resources),
    },
    snapshot: {
      writtenAt: snapshot.snapshot.writtenAt,
      revision: snapshot.snapshot.revision,
    },
    record: updatedRecord,
    state: nextState,
  }
}
