import type { ClientId, PlayerId, SessionDisplayName, SessionId } from './sessionIdentity'
import type {
  SessionPresenceEntry,
  SessionPresenceStatus,
} from './sessionMessages'
import type { PlayerAssignmentRecord, SessionActor } from './sessionPermissions'
import {
  INITIAL_MAP_REVISION,
  INITIAL_SESSION_REVISION,
  type MapRevision,
  type SessionRevision,
} from './sessionRevisions'

export const SESSION_STATE_SCHEMA_VERSION = 1 as const

export type SessionMapSlug = string
export type SelectedSessionMapSlug = SessionMapSlug | null

export interface AuthoritativeSessionMapState<TMapDocument = unknown> {
  readonly mapSlug: SessionMapSlug
  readonly revision: MapRevision
  /**
   * When true, newly joined players receive a visible map grant for this
   * session map unless the GM later replaces the map with a stricter rule.
   */
  readonly playerVisibleByDefault?: boolean
  /**
   * Server-owned map document/slice for this map. Session commands mutate this
   * copy and then broadcast small accepted patches instead of accepting live
   * whole-map autosaves from clients.
   */
  readonly document: TMapDocument
}

export interface SessionPlayerRecord {
  readonly playerId: PlayerId
  readonly displayName: SessionDisplayName
  readonly joinedAt: string
  readonly updatedAt: string
}

export interface SessionConnectedClientRecord {
  readonly clientId: ClientId
  readonly actor: SessionActor
  readonly status: SessionPresenceStatus
  readonly connectedAt: string
  readonly lastSeenAt?: string
  readonly lastSeenRevision?: SessionRevision
  readonly disconnectedAt?: string
}

export interface AuthoritativeSessionState<TMapDocument = unknown> {
  readonly schemaVersion: typeof SESSION_STATE_SCHEMA_VERSION
  readonly sessionId: SessionId
  readonly revision: SessionRevision
  readonly selectedMapSlug: SelectedSessionMapSlug
  readonly maps: readonly AuthoritativeSessionMapState<TMapDocument>[]
  readonly connectedClients: readonly SessionConnectedClientRecord[]
  readonly players: readonly SessionPlayerRecord[]
  readonly assignments: readonly PlayerAssignmentRecord[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateAuthoritativeSessionStateInput<TMapDocument = unknown> {
  readonly sessionId: SessionId
  readonly createdAt: string
  readonly updatedAt?: string
  readonly revision?: SessionRevision
  readonly selectedMapSlug?: SelectedSessionMapSlug
  readonly maps?: readonly AuthoritativeSessionMapState<TMapDocument>[]
  readonly connectedClients?: readonly SessionConnectedClientRecord[]
  readonly players?: readonly SessionPlayerRecord[]
  readonly assignments?: readonly PlayerAssignmentRecord[]
}

export interface CreateAuthoritativeSessionMapStateInput<TMapDocument = unknown> {
  readonly mapSlug: SessionMapSlug
  readonly document: TMapDocument
  readonly revision?: MapRevision
  readonly playerVisibleByDefault?: boolean
}

export interface SessionStateUpdateOptions {
  readonly revision?: SessionRevision
  readonly updatedAt?: string
}

const mapSlugLabel = 'map slug'

const compareStrings = (left: string, right: string): number => left.localeCompare(right)

const normalizeSessionMapSlug = (value: SessionMapSlug, label = mapSlugLabel): SessionMapSlug => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }

  return value
}

const assertUniqueKeys = <TItem>(
  values: readonly TItem[],
  keyOf: (item: TItem) => string,
  label: string,
): void => {
  const seen = new Set<string>()

  for (const value of values) {
    const key = keyOf(value)
    if (seen.has(key)) {
      throw new Error(`Duplicate ${label} "${key}" in authoritative session state`)
    }
    seen.add(key)
  }
}

const sortByKey = <TItem>(
  values: readonly TItem[],
  keyOf: (item: TItem) => string,
): TItem[] => [...values].sort((left, right) => compareStrings(keyOf(left), keyOf(right)))

const normalizeMaps = <TMapDocument>(
  maps: readonly AuthoritativeSessionMapState<TMapDocument>[],
): readonly AuthoritativeSessionMapState<TMapDocument>[] => {
  const normalized = maps.map((map) => ({
    ...map,
    mapSlug: normalizeSessionMapSlug(map.mapSlug),
    revision: map.revision ?? INITIAL_MAP_REVISION,
  }))

  assertUniqueKeys(normalized, (map) => map.mapSlug, 'map slug')
  return sortByKey(normalized, (map) => map.mapSlug)
}

const normalizeConnectedClients = (
  connectedClients: readonly SessionConnectedClientRecord[],
): readonly SessionConnectedClientRecord[] => {
  assertUniqueKeys(connectedClients, (client) => client.clientId, 'client id')
  return sortByKey(connectedClients, (client) => client.clientId)
}

const normalizePlayers = (
  players: readonly SessionPlayerRecord[],
): readonly SessionPlayerRecord[] => {
  assertUniqueKeys(players, (player) => player.playerId, 'player id')
  return sortByKey(players, (player) => player.playerId)
}

const normalizeAssignments = (
  assignments: readonly PlayerAssignmentRecord[],
): readonly PlayerAssignmentRecord[] => {
  assertUniqueKeys(assignments, (assignment) => assignment.playerId, 'player assignment')
  return sortByKey(assignments, (assignment) => assignment.playerId)
}

const selectedMapSlugFromInput = <TMapDocument>(
  input: CreateAuthoritativeSessionStateInput<TMapDocument>,
): SelectedSessionMapSlug => {
  if (input.selectedMapSlug !== undefined) {
    return input.selectedMapSlug === null
      ? null
      : normalizeSessionMapSlug(input.selectedMapSlug, 'selected map slug')
  }

  const firstMap = input.maps?.[0]
  return firstMap === undefined ? null : normalizeSessionMapSlug(firstMap.mapSlug)
}

const assertSelectedMapExists = <TMapDocument>(
  selectedMapSlug: SelectedSessionMapSlug,
  maps: readonly AuthoritativeSessionMapState<TMapDocument>[],
): void => {
  if (selectedMapSlug === null) return

  if (!maps.some((map) => map.mapSlug === selectedMapSlug)) {
    throw new Error(
      `Selected map "${selectedMapSlug}" is not present in authoritative session map state`,
    )
  }
}

const withSessionUpdateOptions = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  overrides: Omit<CreateAuthoritativeSessionStateInput<TMapDocument>, 'sessionId' | 'createdAt'>,
  options: SessionStateUpdateOptions = {},
): AuthoritativeSessionState<TMapDocument> => {
  const hasSelectedMapOverride = Object.prototype.hasOwnProperty.call(overrides, 'selectedMapSlug')

  return createAuthoritativeSessionState({
    sessionId: state.sessionId,
    createdAt: state.createdAt,
    updatedAt: options.updatedAt ?? overrides.updatedAt ?? state.updatedAt,
    revision: options.revision ?? overrides.revision ?? state.revision,
    selectedMapSlug: hasSelectedMapOverride ? overrides.selectedMapSlug : state.selectedMapSlug,
    maps: overrides.maps ?? state.maps,
    connectedClients: overrides.connectedClients ?? state.connectedClients,
    players: overrides.players ?? state.players,
    assignments: overrides.assignments ?? state.assignments,
  })
}

const upsertByKey = <TItem>(
  values: readonly TItem[],
  next: TItem,
  keyOf: (item: TItem) => string,
): readonly TItem[] => {
  const nextKey = keyOf(next)
  let replaced = false
  const updated = values.map((value) => {
    if (keyOf(value) !== nextKey) return value
    replaced = true
    return next
  })

  return replaced ? updated : [...updated, next]
}

export const createAuthoritativeSessionMapState = <TMapDocument = unknown>(
  input: CreateAuthoritativeSessionMapStateInput<TMapDocument>,
): AuthoritativeSessionMapState<TMapDocument> => ({
  mapSlug: normalizeSessionMapSlug(input.mapSlug),
  revision: input.revision ?? INITIAL_MAP_REVISION,
  ...(input.playerVisibleByDefault === true ? { playerVisibleByDefault: true } : {}),
  document: input.document,
})

export const createAuthoritativeSessionState = <TMapDocument = unknown>(
  input: CreateAuthoritativeSessionStateInput<TMapDocument>,
): AuthoritativeSessionState<TMapDocument> => {
  const maps = normalizeMaps(input.maps ?? [])
  const selectedMapSlug = selectedMapSlugFromInput(input)
  assertSelectedMapExists(selectedMapSlug, maps)

  return {
    schemaVersion: SESSION_STATE_SCHEMA_VERSION,
    sessionId: input.sessionId,
    revision: input.revision ?? INITIAL_SESSION_REVISION,
    selectedMapSlug,
    maps,
    connectedClients: normalizeConnectedClients(input.connectedClients ?? []),
    players: normalizePlayers(input.players ?? []),
    assignments: normalizeAssignments(input.assignments ?? []),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt ?? input.createdAt,
  }
}

export const getSessionMapState = <TMapDocument>(
  state: Pick<AuthoritativeSessionState<TMapDocument>, 'maps'>,
  mapSlug: SelectedSessionMapSlug,
): AuthoritativeSessionMapState<TMapDocument> | undefined =>
  mapSlug === null ? undefined : state.maps.find((map) => map.mapSlug === mapSlug)

export const getSelectedSessionMapState = <TMapDocument>(
  state: Pick<AuthoritativeSessionState<TMapDocument>, 'maps' | 'selectedMapSlug'>,
): AuthoritativeSessionMapState<TMapDocument> | undefined =>
  getSessionMapState(state, state.selectedMapSlug)

export const isSessionMapVisibleByDefaultToPlayers = <TMapDocument>(
  map: Pick<AuthoritativeSessionMapState<TMapDocument>, 'playerVisibleByDefault'>,
): boolean => map.playerVisibleByDefault === true

export const setSelectedSessionMapSlug = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  selectedMapSlug: SelectedSessionMapSlug,
  options: SessionStateUpdateOptions = {},
): AuthoritativeSessionState<TMapDocument> => {
  const normalizedSelectedMapSlug = selectedMapSlug === null
    ? null
    : normalizeSessionMapSlug(selectedMapSlug, 'selected map slug')
  assertSelectedMapExists(normalizedSelectedMapSlug, state.maps)

  return withSessionUpdateOptions(state, { selectedMapSlug: normalizedSelectedMapSlug }, options)
}

export const upsertSessionMapState = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  map: AuthoritativeSessionMapState<TMapDocument>,
  options: SessionStateUpdateOptions = {},
): AuthoritativeSessionState<TMapDocument> => {
  const normalizedMap = createAuthoritativeSessionMapState(map)
  const maps = upsertByKey(state.maps, normalizedMap, (candidate) => candidate.mapSlug)
  const selectedMapSlug = state.selectedMapSlug ?? normalizedMap.mapSlug

  return withSessionUpdateOptions(state, { maps, selectedMapSlug }, options)
}

export const upsertSessionPlayerRecord = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  player: SessionPlayerRecord,
  options: SessionStateUpdateOptions = {},
): AuthoritativeSessionState<TMapDocument> =>
  withSessionUpdateOptions(
    state,
    {
      players: upsertByKey(state.players, player, (candidate) => candidate.playerId),
    },
    options,
  )

export const upsertSessionConnectedClient = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  connectedClient: SessionConnectedClientRecord,
  options: SessionStateUpdateOptions = {},
): AuthoritativeSessionState<TMapDocument> =>
  withSessionUpdateOptions(
    state,
    {
      connectedClients: upsertByKey(
        state.connectedClients,
        connectedClient,
        (candidate) => candidate.clientId,
      ),
    },
    options,
  )

export const upsertSessionPlayerAssignment = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  assignment: PlayerAssignmentRecord,
  options: SessionStateUpdateOptions = {},
): AuthoritativeSessionState<TMapDocument> =>
  withSessionUpdateOptions(
    state,
    {
      assignments: upsertByKey(state.assignments, assignment, (candidate) => candidate.playerId),
    },
    options,
  )

export const findSessionPlayerRecord = (
  players: readonly SessionPlayerRecord[],
  playerId: PlayerId,
): SessionPlayerRecord | undefined => players.find((player) => player.playerId === playerId)

export const findSessionConnectedClient = (
  connectedClients: readonly SessionConnectedClientRecord[],
  clientId: ClientId,
): SessionConnectedClientRecord | undefined =>
  connectedClients.find((client) => client.clientId === clientId)

export const toSessionPresenceEntries = (
  state: Pick<AuthoritativeSessionState, 'connectedClients'>,
): readonly SessionPresenceEntry<SessionRevision>[] =>
  state.connectedClients.map((client) => ({
    actor: client.actor,
    clientId: client.clientId,
    status: client.status,
    connectedAt: client.connectedAt,
    ...(client.lastSeenAt === undefined ? {} : { lastSeenAt: client.lastSeenAt }),
    ...(client.lastSeenRevision === undefined ? {} : { lastSeenRevision: client.lastSeenRevision }),
  }))
