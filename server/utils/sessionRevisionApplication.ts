import {
  SESSION_COMMAND_RESULT_SCHEMA_VERSION,
  type SessionCommandAcceptedResult,
  type SessionCommandResultMetadata,
} from '#shared/sessionCommandResults'
import {
  type OpId,
  type SessionCommandEnvelope,
  type SessionCommandScope,
  type SessionCommandType,
} from '#shared/sessionCommands'
import type { SessionId } from '#shared/sessionIdentity'
import type { SessionPatchEvent } from '#shared/sessionMessages'
import type { SessionActor } from '#shared/sessionPermissions'
import {
  incrementMapRevision,
  incrementSessionRevision,
  type MapRevision,
  type SessionRevision,
} from '#shared/sessionRevisions'
import {
  createAuthoritativeSessionMapState,
  createAuthoritativeSessionState,
  type AuthoritativeSessionMapState,
  type AuthoritativeSessionState,
  type SessionMapSlug,
} from '#shared/sessionState'
import {
  createSessionCommandEventLogEntry,
  type SessionCommandEventLogEntry,
  type SessionEventLogMetadata,
} from './sessionEventLog'

export type SessionRevisionApplicationClock = () => string

export interface SessionAcceptedCommandEventIdContext<
  TType extends SessionCommandType = SessionCommandType,
> {
  readonly sessionId: SessionId
  readonly revision: SessionRevision
  readonly opId: OpId
  readonly commandType: TType
  readonly actor: SessionActor
  readonly scopes: readonly SessionCommandScope[]
}

export type SessionAcceptedCommandEventIdFactory<
  TType extends SessionCommandType = SessionCommandType,
> = (context: SessionAcceptedCommandEventIdContext<TType>) => string

export interface SessionMapDocumentEffect<TMapDocument = unknown> {
  readonly mapSlug: SessionMapSlug
  readonly document: TMapDocument
}

export interface AppliedSessionMapRevisionEffect<TMapDocument = unknown> {
  readonly mapSlug: SessionMapSlug
  readonly previousRevision: MapRevision
  readonly currentRevision: MapRevision
  readonly document: TMapDocument
}

export interface ApplyAcceptedSessionCommandStateEffectContext<
  TMapDocument = unknown,
> {
  readonly previousRevision: SessionRevision
  readonly currentRevision: SessionRevision
  readonly processedAt: string
  readonly mapRevisionChanges: readonly AppliedSessionMapRevisionEffect<TMapDocument>[]
}

export type ApplyAcceptedSessionCommandStateEffect<TMapDocument = unknown> = (
  state: AuthoritativeSessionState<TMapDocument>,
  context: ApplyAcceptedSessionCommandStateEffectContext<TMapDocument>,
) => AuthoritativeSessionState<TMapDocument>

export type AcceptedSessionCommandPatchEvent<
  TEventType extends string = string,
  TPatchPayload = unknown,
> = SessionPatchEvent<TEventType, TPatchPayload, SessionRevision>

export interface ApplyAcceptedSessionCommandEffectInput<
  TType extends SessionCommandType = SessionCommandType,
  TPayload = unknown,
  TMapDocument = unknown,
  TEventType extends string = string,
  TPatchPayload = unknown,
> {
  readonly state: AuthoritativeSessionState<TMapDocument>
  readonly command: SessionCommandEnvelope<TType, TPayload, SessionActor, SessionRevision>
  readonly eventType: TEventType
  readonly eventPayload: TPatchPayload
  readonly mapEffects?: readonly SessionMapDocumentEffect<TMapDocument>[]
  readonly stateEffect?: ApplyAcceptedSessionCommandStateEffect<TMapDocument>
}

export interface ApplyAcceptedSessionCommandEffectOptions<
  TType extends SessionCommandType = SessionCommandType,
> {
  readonly processedAt?: string
  readonly recordedAt?: string
  readonly clock?: SessionRevisionApplicationClock
  readonly eventId?: string
  readonly eventIdFactory?: SessionAcceptedCommandEventIdFactory<TType>
  readonly resultMetadata?: SessionCommandResultMetadata
  readonly eventLogMetadata?: SessionEventLogMetadata
}

export interface ApplyAcceptedSessionCommandEffectResult<
  TType extends SessionCommandType = SessionCommandType,
  TPayload = unknown,
  TMapDocument = unknown,
  TEventType extends string = string,
  TPatchPayload = unknown,
> {
  readonly previousState: AuthoritativeSessionState<TMapDocument>
  readonly state: AuthoritativeSessionState<TMapDocument>
  readonly previousRevision: SessionRevision
  readonly currentRevision: SessionRevision
  readonly processedAt: string
  readonly patchEvent: AcceptedSessionCommandPatchEvent<TEventType, TPatchPayload>
  readonly result: SessionCommandAcceptedResult<
    TType,
    AcceptedSessionCommandPatchEvent<TEventType, TPatchPayload>,
    SessionRevision
  >
  readonly eventLogEntry: SessionCommandEventLogEntry<
    TType,
    TPayload,
    AcceptedSessionCommandPatchEvent<TEventType, TPatchPayload>,
    unknown
  >
  readonly mapRevisionChanges: readonly AppliedSessionMapRevisionEffect<TMapDocument>[]
}

const defaultSessionRevisionApplicationClock: SessionRevisionApplicationClock = () =>
  new Date().toISOString()

const defaultEventIdFor = (revision: SessionRevision): string => `event_rev_${revision}`

const assertNonEmptyString = (value: string, label: string): void => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

const assertCommandMatchesState = <TMapDocument>(
  command: Pick<SessionCommandEnvelope, 'sessionId'>,
  state: Pick<AuthoritativeSessionState<TMapDocument>, 'sessionId'>,
): void => {
  if (command.sessionId !== state.sessionId) {
    throw new Error('Accepted command sessionId must match authoritative session state')
  }
}

const createStateWithRevision = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  revision: SessionRevision,
  updatedAt: string,
): AuthoritativeSessionState<TMapDocument> =>
  createAuthoritativeSessionState<TMapDocument>({
    sessionId: state.sessionId,
    revision,
    selectedMapSlug: state.selectedMapSlug,
    maps: state.maps,
    connectedClients: state.connectedClients,
    players: state.players,
    assignments: state.assignments,
    createdAt: state.createdAt,
    updatedAt,
  })

const applyMapDocumentEffects = <TMapDocument>(
  state: AuthoritativeSessionState<TMapDocument>,
  mapEffects: readonly SessionMapDocumentEffect<TMapDocument>[],
): {
  readonly state: AuthoritativeSessionState<TMapDocument>
  readonly changes: readonly AppliedSessionMapRevisionEffect<TMapDocument>[]
} => {
  if (mapEffects.length === 0) return { state, changes: [] }

  const mapsBySlug = new Map<SessionMapSlug, AuthoritativeSessionMapState<TMapDocument>>()
  for (const map of state.maps) mapsBySlug.set(map.mapSlug, map)

  const seenMapSlugs = new Set<SessionMapSlug>()
  const changes: AppliedSessionMapRevisionEffect<TMapDocument>[] = []

  for (const effect of mapEffects) {
    assertNonEmptyString(effect.mapSlug, 'mapEffect.mapSlug')

    if (seenMapSlugs.has(effect.mapSlug)) {
      throw new Error(`Map effect for "${effect.mapSlug}" was provided more than once`)
    }
    seenMapSlugs.add(effect.mapSlug)

    const previousMap = mapsBySlug.get(effect.mapSlug)
    if (previousMap === undefined) {
      throw new Error(`Cannot apply map effect for unknown session map "${effect.mapSlug}"`)
    }

    const currentRevision = incrementMapRevision(
      previousMap.revision,
      `map ${effect.mapSlug} revision`,
    )
    const nextMap = createAuthoritativeSessionMapState<TMapDocument>({
      mapSlug: effect.mapSlug,
      revision: currentRevision,
      document: effect.document,
    })

    mapsBySlug.set(effect.mapSlug, nextMap)
    changes.push({
      mapSlug: effect.mapSlug,
      previousRevision: previousMap.revision,
      currentRevision,
      document: effect.document,
    })
  }

  return {
    state: createAuthoritativeSessionState<TMapDocument>({
      sessionId: state.sessionId,
      revision: state.revision,
      selectedMapSlug: state.selectedMapSlug,
      maps: [...mapsBySlug.values()],
      connectedClients: state.connectedClients,
      players: state.players,
      assignments: state.assignments,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    }),
    changes,
  }
}

const ensureStateEffectPreservedAuthority = <TMapDocument>(
  previousState: AuthoritativeSessionState<TMapDocument>,
  effectedState: AuthoritativeSessionState<TMapDocument>,
  currentRevision: SessionRevision,
): void => {
  if (effectedState.sessionId !== previousState.sessionId) {
    throw new Error('Accepted command stateEffect must not change the sessionId')
  }

  if (effectedState.createdAt !== previousState.createdAt) {
    throw new Error('Accepted command stateEffect must not change the session createdAt timestamp')
  }

  if (effectedState.revision !== currentRevision) {
    throw new Error('Accepted command stateEffect must preserve the helper-assigned session revision')
  }
}

const resultMetadataFor = (
  commandMetadata: SessionCommandEnvelope['metadata'],
  processedAt: string,
  override: SessionCommandResultMetadata | undefined,
): SessionCommandResultMetadata => ({
  serverProcessedAt: override?.serverProcessedAt ?? processedAt,
  ...(override?.traceId !== undefined
    ? { traceId: override.traceId }
    : commandMetadata?.traceId === undefined
      ? {}
      : { traceId: commandMetadata.traceId }),
  ...(override?.attributes === undefined ? {} : { attributes: override.attributes }),
})

export const applyAcceptedSessionCommandEffect = <
  TType extends SessionCommandType,
  TPayload,
  TMapDocument = unknown,
  TEventType extends string = string,
  TPatchPayload = unknown,
>(
  input: ApplyAcceptedSessionCommandEffectInput<
    TType,
    TPayload,
    TMapDocument,
    TEventType,
    TPatchPayload
  >,
  options: ApplyAcceptedSessionCommandEffectOptions<TType> = {},
): ApplyAcceptedSessionCommandEffectResult<
  TType,
  TPayload,
  TMapDocument,
  TEventType,
  TPatchPayload
> => {
  assertCommandMatchesState(input.command, input.state)
  assertNonEmptyString(input.eventType, 'eventType')

  if (input.eventPayload === undefined) {
    throw new Error('eventPayload must be provided; use null for events without payload data')
  }

  const processedAt = options.processedAt ?? options.clock?.() ?? defaultSessionRevisionApplicationClock()
  const currentRevision = incrementSessionRevision(input.state.revision)
  const baseNextState = createStateWithRevision(input.state, currentRevision, processedAt)
  const { state: stateWithMapEffects, changes: mapRevisionChanges } = applyMapDocumentEffects(
    baseNextState,
    input.mapEffects ?? [],
  )

  const context: ApplyAcceptedSessionCommandStateEffectContext<TMapDocument> = {
    previousRevision: input.state.revision,
    currentRevision,
    processedAt,
    mapRevisionChanges,
  }
  const effectedState = input.stateEffect?.(stateWithMapEffects, context) ?? stateWithMapEffects
  ensureStateEffectPreservedAuthority(input.state, effectedState, currentRevision)
  const state = createStateWithRevision(effectedState, currentRevision, processedAt)

  const eventIdContext: SessionAcceptedCommandEventIdContext<TType> = {
    sessionId: input.command.sessionId,
    revision: currentRevision,
    opId: input.command.opId,
    commandType: input.command.type,
    actor: input.command.actor,
    scopes: input.command.scopes,
  }
  const eventId = options.eventId ?? options.eventIdFactory?.(eventIdContext) ?? defaultEventIdFor(currentRevision)
  const patchEvent: AcceptedSessionCommandPatchEvent<TEventType, TPatchPayload> = {
    eventId,
    eventType: input.eventType,
    revision: currentRevision,
    commandType: input.command.type,
    opId: input.command.opId,
    actor: input.command.actor,
    scopes: input.command.scopes,
    payload: input.eventPayload,
  }
  const result: SessionCommandAcceptedResult<
    TType,
    AcceptedSessionCommandPatchEvent<TEventType, TPatchPayload>,
    SessionRevision
  > = {
    schemaVersion: SESSION_COMMAND_RESULT_SCHEMA_VERSION,
    status: 'accepted',
    accepted: true,
    sessionId: input.command.sessionId,
    opId: input.command.opId,
    commandType: input.command.type,
    actor: input.command.actor,
    currentRevision,
    scopes: input.command.scopes,
    event: patchEvent,
    metadata: resultMetadataFor(input.command.metadata, processedAt, options.resultMetadata),
  }
  const eventLogEntry = createSessionCommandEventLogEntry(input.command, result, {
    recordedAt: options.recordedAt ?? processedAt,
    metadata: options.eventLogMetadata,
  })

  return {
    previousState: input.state,
    state,
    previousRevision: input.state.revision,
    currentRevision,
    processedAt,
    patchEvent,
    result,
    eventLogEntry,
    mapRevisionChanges,
  }
}
