import type {
  SessionCommandAcceptedResult,
  SessionCommandDuplicateResult,
  SessionCommandRejectedResult,
} from './sessionCommandResults'
import type {
  OpId,
  SessionCommandEnvelope,
  SessionCommandScope,
  SessionCommandType,
} from './sessionCommands'
import type {
  ClientId,
  GmKey,
  PlayerId,
  SessionDisplayName,
  SessionId,
} from './sessionIdentity'
import type { SessionActor } from './sessionPermissions'
import type { Revision } from './sessionRevisions'

export const SESSION_MESSAGE_SCHEMA_VERSION = 1 as const

export const SESSION_MESSAGE_DIRECTIONS = ['client', 'server'] as const
export type SessionMessageDirection = (typeof SESSION_MESSAGE_DIRECTIONS)[number]

export const SESSION_CLIENT_MESSAGE_TYPES = ['hello', 'heartbeat', 'command'] as const
export type SessionClientMessageType = (typeof SESSION_CLIENT_MESSAGE_TYPES)[number]

export const SESSION_SERVER_MESSAGE_TYPES = [
  'hello',
  'heartbeat',
  'commandAck',
  'commandReject',
  'snapshot',
  'patch',
  'presence',
  'error',
] as const
export type SessionServerMessageType = (typeof SESSION_SERVER_MESSAGE_TYPES)[number]

export const SESSION_MESSAGE_TYPES = [
  'hello',
  'heartbeat',
  'command',
  'commandAck',
  'commandReject',
  'snapshot',
  'patch',
  'presence',
  'error',
] as const
export type SessionMessageType = (typeof SESSION_MESSAGE_TYPES)[number]

export const SESSION_HEARTBEAT_KINDS = ['ping', 'pong'] as const
export type SessionHeartbeatKind = (typeof SESSION_HEARTBEAT_KINDS)[number]

export const SESSION_SNAPSHOT_REASONS = [
  'initial',
  'reconnect',
  'recovery',
  'permission-change',
  'manual-sync',
] as const
export type SessionSnapshotReason = (typeof SESSION_SNAPSHOT_REASONS)[number]

export const SESSION_PRESENCE_STATUSES = ['connected', 'disconnected', 'reconnecting'] as const
export type SessionPresenceStatus = (typeof SESSION_PRESENCE_STATUSES)[number]

export const SESSION_PRESENCE_CHANGES = ['snapshot', 'joined', 'left', 'updated'] as const
export type SessionPresenceChange = (typeof SESSION_PRESENCE_CHANGES)[number]

export const SESSION_ERROR_CODES = [
  'malformed-message',
  'unsupported-message',
  'unauthorized',
  'session-not-found',
  'session-host-disabled',
  'session-ended',
  'rate-limited',
  'internal-error',
] as const
export type SessionErrorCode = (typeof SESSION_ERROR_CODES)[number]

const SESSION_MESSAGE_DIRECTION_SET = new Set<unknown>(SESSION_MESSAGE_DIRECTIONS)
const SESSION_CLIENT_MESSAGE_TYPE_SET = new Set<unknown>(SESSION_CLIENT_MESSAGE_TYPES)
const SESSION_SERVER_MESSAGE_TYPE_SET = new Set<unknown>(SESSION_SERVER_MESSAGE_TYPES)
const SESSION_MESSAGE_TYPE_SET = new Set<unknown>(SESSION_MESSAGE_TYPES)
const SESSION_HEARTBEAT_KIND_SET = new Set<unknown>(SESSION_HEARTBEAT_KINDS)
const SESSION_SNAPSHOT_REASON_SET = new Set<unknown>(SESSION_SNAPSHOT_REASONS)
const SESSION_PRESENCE_STATUS_SET = new Set<unknown>(SESSION_PRESENCE_STATUSES)
const SESSION_PRESENCE_CHANGE_SET = new Set<unknown>(SESSION_PRESENCE_CHANGES)
const SESSION_ERROR_CODE_SET = new Set<unknown>(SESSION_ERROR_CODES)

export const isSessionMessageDirection = (value: unknown): value is SessionMessageDirection =>
  SESSION_MESSAGE_DIRECTION_SET.has(value)

export const isSessionClientMessageType = (value: unknown): value is SessionClientMessageType =>
  SESSION_CLIENT_MESSAGE_TYPE_SET.has(value)

export const isSessionServerMessageType = (value: unknown): value is SessionServerMessageType =>
  SESSION_SERVER_MESSAGE_TYPE_SET.has(value)

export const isSessionMessageType = (value: unknown): value is SessionMessageType =>
  SESSION_MESSAGE_TYPE_SET.has(value)

export const isSessionHeartbeatKind = (value: unknown): value is SessionHeartbeatKind =>
  SESSION_HEARTBEAT_KIND_SET.has(value)

export const isSessionSnapshotReason = (value: unknown): value is SessionSnapshotReason =>
  SESSION_SNAPSHOT_REASON_SET.has(value)

export const isSessionPresenceStatus = (value: unknown): value is SessionPresenceStatus =>
  SESSION_PRESENCE_STATUS_SET.has(value)

export const isSessionPresenceChange = (value: unknown): value is SessionPresenceChange =>
  SESSION_PRESENCE_CHANGE_SET.has(value)

export const isSessionErrorCode = (value: unknown): value is SessionErrorCode =>
  SESSION_ERROR_CODE_SET.has(value)

export interface SessionMessageMetadata {
  readonly messageId?: string
  readonly sentAt?: string
  readonly traceId?: string
}

export interface SessionMessageBase<
  TType extends SessionMessageType = SessionMessageType,
  TDirection extends SessionMessageDirection = SessionMessageDirection,
> extends SessionMessageMetadata {
  readonly schemaVersion: typeof SESSION_MESSAGE_SCHEMA_VERSION
  readonly type: TType
  /**
   * Carried in the wire shape so shared tests and validators can distinguish
   * same-name messages such as client/server hello and heartbeat frames.
   */
  readonly direction: TDirection
}

export interface SessionScopedMessageBase<
  TType extends SessionMessageType = SessionMessageType,
  TDirection extends SessionMessageDirection = SessionMessageDirection,
> extends SessionMessageBase<TType, TDirection> {
  readonly sessionId: SessionId
}

export interface SessionClientHelloGmIdentity {
  readonly role: 'gm'
  readonly clientId: ClientId
  readonly gmKey: GmKey
}

export interface SessionClientHelloPlayerIdentity {
  readonly role: 'player'
  readonly clientId: ClientId
  readonly playerId: PlayerId
  readonly displayName?: SessionDisplayName
}

export type SessionClientHelloIdentity =
  | SessionClientHelloGmIdentity
  | SessionClientHelloPlayerIdentity

export interface SessionClientHelloMessage<TRevision extends Revision = Revision>
  extends SessionScopedMessageBase<'hello', 'client'> {
  readonly identity: SessionClientHelloIdentity
  readonly reconnect: boolean
  readonly lastSeenRevision?: TRevision
}

export interface SessionHeartbeatConfig {
  readonly intervalMs: number
  readonly timeoutMs: number
}

export interface SessionServerHelloMessage<TRevision extends Revision = Revision>
  extends SessionScopedMessageBase<'hello', 'server'> {
  readonly actor: SessionActor
  readonly currentRevision: TRevision
  readonly resumed: boolean
  readonly heartbeat: SessionHeartbeatConfig
  /**
   * When true, the server will follow the hello response with a snapshot because
   * replay is unavailable, unsafe, or unnecessary for this connection.
   */
  readonly snapshotRequired?: boolean
  readonly replayFromRevision?: TRevision
}

export type SessionHelloMessage<TRevision extends Revision = Revision> =
  | SessionClientHelloMessage<TRevision>
  | SessionServerHelloMessage<TRevision>

export interface SessionHeartbeatMessage<
  TDirection extends SessionMessageDirection = SessionMessageDirection,
  TRevision extends Revision = Revision,
> extends SessionScopedMessageBase<'heartbeat', TDirection> {
  readonly heartbeat: SessionHeartbeatKind
  readonly nonce?: string
  readonly lastSeenRevision?: TRevision
}

export interface SessionCommandMessage<TCommand extends SessionCommandEnvelope = SessionCommandEnvelope>
  extends SessionScopedMessageBase<'command', 'client'> {
  readonly command: TCommand
}

export type SessionCommandAckResult<
  TType extends SessionCommandType = SessionCommandType,
  TEvent = unknown,
  TRevision extends Revision = Revision,
> =
  | SessionCommandAcceptedResult<TType, TEvent, TRevision>
  | SessionCommandDuplicateResult<TType, TRevision>

export interface SessionCommandAckMessage<
  TType extends SessionCommandType = SessionCommandType,
  TEvent = unknown,
  TRevision extends Revision = Revision,
> extends SessionScopedMessageBase<'commandAck', 'server'> {
  readonly result: SessionCommandAckResult<TType, TEvent, TRevision>
}

export interface SessionCommandRejectMessage<
  TType extends SessionCommandType = SessionCommandType,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> extends SessionScopedMessageBase<'commandReject', 'server'> {
  readonly result: SessionCommandRejectedResult<TType, TCurrentState, TRevision>
}

export type SessionCommandResultMessage<
  TType extends SessionCommandType = SessionCommandType,
  TEvent = unknown,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> =
  | SessionCommandAckMessage<TType, TEvent, TRevision>
  | SessionCommandRejectMessage<TType, TCurrentState, TRevision>

export interface SessionSnapshotMessage<
  TSnapshot = unknown,
  TRevision extends Revision = Revision,
> extends SessionScopedMessageBase<'snapshot', 'server'> {
  readonly reason: SessionSnapshotReason
  readonly currentRevision: TRevision
  readonly snapshot: TSnapshot
  readonly replayAvailable?: boolean
}

export interface SessionPatchEvent<
  TEventType extends string = string,
  TPayload = unknown,
  TRevision extends Revision = Revision,
> {
  readonly eventId?: string
  readonly eventType: TEventType
  readonly revision: TRevision
  readonly commandType?: SessionCommandType
  readonly opId?: OpId
  readonly actor?: SessionActor
  readonly scopes: readonly SessionCommandScope[]
  readonly payload: TPayload
}

export interface SessionPatchMessage<
  TEventType extends string = string,
  TPayload = unknown,
  TRevision extends Revision = Revision,
> extends SessionScopedMessageBase<'patch', 'server'> {
  readonly event: SessionPatchEvent<TEventType, TPayload, TRevision>
}

export interface SessionPresenceEntry<TRevision extends Revision = Revision> {
  readonly actor: SessionActor
  readonly clientId: ClientId
  readonly status: SessionPresenceStatus
  readonly connectedAt?: string
  readonly lastSeenAt?: string
  readonly lastSeenRevision?: TRevision
}

export interface SessionPresenceMessage<TRevision extends Revision = Revision>
  extends SessionScopedMessageBase<'presence', 'server'> {
  readonly change: SessionPresenceChange
  readonly currentRevision: TRevision
  readonly clients: readonly SessionPresenceEntry<TRevision>[]
}

export type SessionErrorDetailsValue = string | number | boolean | null
export type SessionErrorDetails = Readonly<Record<string, SessionErrorDetailsValue>>

export interface SessionErrorMessage<TRevision extends Revision = Revision>
  extends SessionMessageBase<'error', 'server'> {
  readonly sessionId?: SessionId
  readonly code: SessionErrorCode
  readonly message: string
  readonly retryable: boolean
  readonly currentRevision?: TRevision
  readonly details?: SessionErrorDetails
}

export type SessionClientMessage<TCommand extends SessionCommandEnvelope = SessionCommandEnvelope> =
  | SessionClientHelloMessage
  | SessionHeartbeatMessage<'client'>
  | SessionCommandMessage<TCommand>

export type SessionServerMessage<
  TSnapshot = unknown,
  TPatchEventType extends string = string,
  TPatchPayload = unknown,
  TCommandType extends SessionCommandType = SessionCommandType,
  TCommandEvent = unknown,
  TCommandCurrentState = unknown,
  TRevision extends Revision = Revision,
> =
  | SessionServerHelloMessage<TRevision>
  | SessionHeartbeatMessage<'server', TRevision>
  | SessionCommandAckMessage<TCommandType, TCommandEvent, TRevision>
  | SessionCommandRejectMessage<TCommandType, TCommandCurrentState, TRevision>
  | SessionSnapshotMessage<TSnapshot, TRevision>
  | SessionPatchMessage<TPatchEventType, TPatchPayload, TRevision>
  | SessionPresenceMessage<TRevision>
  | SessionErrorMessage<TRevision>

export type SessionWebSocketMessage<
  TCommand extends SessionCommandEnvelope = SessionCommandEnvelope,
  TSnapshot = unknown,
  TPatchEventType extends string = string,
  TPatchPayload = unknown,
  TCommandType extends SessionCommandType = SessionCommandType,
  TCommandEvent = unknown,
  TCommandCurrentState = unknown,
  TRevision extends Revision = Revision,
> =
  | SessionClientMessage<TCommand>
  | SessionServerMessage<
      TSnapshot,
      TPatchEventType,
      TPatchPayload,
      TCommandType,
      TCommandEvent,
      TCommandCurrentState,
      TRevision
    >

export const isSessionClientMessage = (
  message: SessionWebSocketMessage,
): message is SessionClientMessage => message.direction === 'client'

export const isSessionServerMessage = (
  message: SessionWebSocketMessage,
): message is SessionServerMessage => message.direction === 'server'

export const isSessionCommandAckMessage = (
  message: SessionServerMessage,
): message is SessionCommandAckMessage => message.type === 'commandAck'

export const isSessionCommandRejectMessage = (
  message: SessionServerMessage,
): message is SessionCommandRejectMessage => message.type === 'commandReject'
