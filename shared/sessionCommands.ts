import type { ClientId, PlayerId, SessionId } from './sessionIdentity'
import type { SessionActor, SessionResourceRef } from './sessionPermissions'
import type { Revision } from './sessionRevisions'

type Brand<TName extends string> = string & { readonly __brand: TName }

export type OpId = Brand<'OpId'>
export type OperationId = OpId
export type OperationIdScopeKey = Brand<'OperationIdScopeKey'>
export type SessionCommandType = string
export type SessionCommandBaseRevision<TRevision extends Revision = Revision> = TRevision

export const OP_ID_PREFIX = 'op_'
export const OP_ID_PATTERN_DESCRIPTION = '/^op_[A-Za-z0-9_-]{8,96}$/'
export const OP_ID_RE = /^op_[A-Za-z0-9_-]{8,96}$/

export const SESSION_COMMAND_TYPE_PATTERN_DESCRIPTION =
  '/^[a-z][A-Za-z0-9]*(?:[.:_-][A-Za-z0-9]+)*$/'
export const SESSION_COMMAND_TYPE_RE = /^[a-z][A-Za-z0-9]*(?:[.:_-][A-Za-z0-9]+)*$/

export const SESSION_COMMAND_ENVELOPE_VERSION = 1 as const

export const SESSION_COMMAND_SCOPE_LANES = [
  'session',
  'map',
  'token',
  'sheet',
  'initiative',
  'hazard',
  'field-effect',
  'terrain',
  'assignment',
] as const

export type SessionCommandScopeLane = (typeof SESSION_COMMAND_SCOPE_LANES)[number]

const SESSION_COMMAND_SCOPE_LANE_SET = new Set<unknown>(SESSION_COMMAND_SCOPE_LANES)
const OP_ID_RANDOM_PART_UNSAFE_RE = /[^A-Za-z0-9_-]/g

export const isOpId = (value: unknown): value is OpId =>
  typeof value === 'string' && OP_ID_RE.test(value)

export const parseOpId = (value: unknown, label = 'opId'): OpId => {
  if (!isOpId(value)) {
    throw new Error(`${label} must match ${OP_ID_PATTERN_DESCRIPTION}`)
  }
  return value
}

export type RandomUuidProvider = () => string

const getDefaultRandomUuid = (): string => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID is required to create opId values')
  }

  return globalThis.crypto.randomUUID()
}

export const createOpId = (randomUuid: RandomUuidProvider = getDefaultRandomUuid): OpId => {
  const randomPart = randomUuid().normalize('NFKC').replace(OP_ID_RANDOM_PART_UNSAFE_RE, '')
  return parseOpId(`${OP_ID_PREFIX}${randomPart}`)
}

export const isSessionCommandType = (value: unknown): value is SessionCommandType =>
  typeof value === 'string' && SESSION_COMMAND_TYPE_RE.test(value)

export const parseSessionCommandType = (
  value: unknown,
  label = 'commandType',
): SessionCommandType => {
  if (!isSessionCommandType(value)) {
    throw new Error(`${label} must match ${SESSION_COMMAND_TYPE_PATTERN_DESCRIPTION}`)
  }
  return value
}

export const isSessionCommandScopeLane = (value: unknown): value is SessionCommandScopeLane =>
  SESSION_COMMAND_SCOPE_LANE_SET.has(value)

export type SessionCommandMetadataValue = string | number | boolean | null
export type SessionCommandMetadataAttributes = Readonly<Record<string, SessionCommandMetadataValue>>

export interface SessionCommandMetadata {
  readonly clientIssuedAt?: string
  readonly clientSequence?: number
  readonly traceId?: string
  readonly attributes?: SessionCommandMetadataAttributes
}

export interface SessionCommandScope {
  readonly lane: SessionCommandScopeLane
  readonly resource?: SessionResourceRef
  readonly field?: string
  readonly mapSlug?: string
  readonly playerId?: PlayerId
}

export interface SessionCommandCommonFields<
  TActor extends SessionActor = SessionActor,
  TRevision extends Revision = Revision,
> {
  readonly sessionId: SessionId
  readonly actor: TActor
  readonly opId: OpId
  readonly baseRevision: SessionCommandBaseRevision<TRevision>
  readonly scopes: readonly SessionCommandScope[]
  readonly metadata?: SessionCommandMetadata
}

export interface SessionCommandEnvelope<
  TType extends SessionCommandType = SessionCommandType,
  TPayload = unknown,
  TActor extends SessionActor = SessionActor,
  TRevision extends Revision = Revision,
> extends SessionCommandCommonFields<TActor, TRevision> {
  readonly schemaVersion: typeof SESSION_COMMAND_ENVELOPE_VERSION
  readonly type: TType
  readonly payload: TPayload
}

export interface OperationIdScope {
  readonly sessionId: SessionId
  readonly clientId: ClientId
  readonly opId: OpId
}

export const getCommandOperationIdScope = (
  command: Pick<SessionCommandEnvelope, 'sessionId' | 'actor' | 'opId'>,
): OperationIdScope => ({
  sessionId: command.sessionId,
  clientId: command.actor.clientId,
  opId: command.opId,
})

export const formatOperationIdScopeKey = (scope: OperationIdScope): OperationIdScopeKey =>
  `${scope.sessionId}:${scope.clientId}:${scope.opId}` as OperationIdScopeKey
