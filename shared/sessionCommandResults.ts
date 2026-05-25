import type { OpId, SessionCommandScope, SessionCommandType } from './sessionCommands'
import type { SessionId } from './sessionIdentity'
import type { PermissionDenied, SessionActor, SessionResourceRef } from './sessionPermissions'
import type { Revision } from './sessionRevisions'

export const SESSION_COMMAND_RESULT_SCHEMA_VERSION = 1 as const

export const SESSION_COMMAND_RESULT_STATUSES = ['accepted', 'rejected', 'duplicate'] as const
export type SessionCommandResultStatus = (typeof SESSION_COMMAND_RESULT_STATUSES)[number]

export const SESSION_COMMAND_REJECTION_REASONS = [
  'invalid',
  'unauthorized',
  'stale',
  'conflict',
] as const
export type SessionCommandRejectionReason = (typeof SESSION_COMMAND_REJECTION_REASONS)[number]

export const SESSION_COMMAND_DUPLICATE_ORIGINAL_STATUSES = ['accepted', 'rejected'] as const
export type SessionCommandDuplicateOriginalStatus =
  (typeof SESSION_COMMAND_DUPLICATE_ORIGINAL_STATUSES)[number]

const SESSION_COMMAND_RESULT_STATUS_SET = new Set<unknown>(SESSION_COMMAND_RESULT_STATUSES)
const SESSION_COMMAND_REJECTION_REASON_SET = new Set<unknown>(SESSION_COMMAND_REJECTION_REASONS)
const SESSION_COMMAND_DUPLICATE_ORIGINAL_STATUS_SET = new Set<unknown>(
  SESSION_COMMAND_DUPLICATE_ORIGINAL_STATUSES,
)

export const isSessionCommandResultStatus = (
  value: unknown,
): value is SessionCommandResultStatus => SESSION_COMMAND_RESULT_STATUS_SET.has(value)

export const isSessionCommandRejectionReason = (
  value: unknown,
): value is SessionCommandRejectionReason => SESSION_COMMAND_REJECTION_REASON_SET.has(value)

export const isSessionCommandDuplicateOriginalStatus = (
  value: unknown,
): value is SessionCommandDuplicateOriginalStatus =>
  SESSION_COMMAND_DUPLICATE_ORIGINAL_STATUS_SET.has(value)

export type SessionCommandResultMetadataValue = string | number | boolean | null
export type SessionCommandResultMetadataAttributes = Readonly<
  Record<string, SessionCommandResultMetadataValue>
>

export interface SessionCommandResultMetadata {
  readonly serverProcessedAt?: string
  readonly traceId?: string
  readonly attributes?: SessionCommandResultMetadataAttributes
}

export interface SessionCommandResultBase<
  TStatus extends SessionCommandResultStatus = SessionCommandResultStatus,
  TType extends SessionCommandType = SessionCommandType,
  TRevision extends Revision = Revision,
> {
  readonly schemaVersion: typeof SESSION_COMMAND_RESULT_SCHEMA_VERSION
  readonly status: TStatus
  readonly sessionId: SessionId
  readonly opId: OpId
  readonly commandType: TType
  readonly actor: SessionActor
  /**
   * The server-owned authoritative revision after this result is produced.
   * Accepted commands use the resulting revision; rejections and duplicates use
   * the current revision observed when they were answered.
   */
  readonly currentRevision: TRevision
  readonly scopes: readonly SessionCommandScope[]
  readonly metadata?: SessionCommandResultMetadata
}

export interface SessionCommandAcceptedResult<
  TType extends SessionCommandType = SessionCommandType,
  TEvent = unknown,
  TRevision extends Revision = Revision,
> extends SessionCommandResultBase<'accepted', TType, TRevision> {
  readonly accepted: true
  readonly event?: TEvent
}

export interface SessionCommandValidationIssue {
  readonly path: string
  readonly code: string
  readonly message: string
  readonly expected?: string
  readonly received?: string
}

export interface SessionCommandRejectedResultBase<
  TReason extends SessionCommandRejectionReason = SessionCommandRejectionReason,
  TType extends SessionCommandType = SessionCommandType,
  TRevision extends Revision = Revision,
> extends SessionCommandResultBase<'rejected', TType, TRevision> {
  readonly accepted: false
  readonly reason: TReason
  readonly message: string
  /** Whether the same user intent may be retried after refreshing/reconciling state. */
  readonly retryable: boolean
}

export interface SessionCommandInvalidRejection<
  TType extends SessionCommandType = SessionCommandType,
  TRevision extends Revision = Revision,
> extends SessionCommandRejectedResultBase<'invalid', TType, TRevision> {
  readonly issues: readonly SessionCommandValidationIssue[]
}

export interface SessionCommandUnauthorizedRejection<
  TType extends SessionCommandType = SessionCommandType,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> extends SessionCommandRejectedResultBase<'unauthorized', TType, TRevision> {
  readonly permission?: PermissionDenied
  readonly resource?: SessionResourceRef
  readonly currentState?: TCurrentState
}

export interface SessionCommandStaleRejection<
  TType extends SessionCommandType = SessionCommandType,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> extends SessionCommandRejectedResultBase<'stale', TType, TRevision> {
  readonly baseRevision: TRevision
  readonly changedScopes: readonly SessionCommandScope[]
  readonly currentState: TCurrentState
}

export interface SessionCommandConflictRejection<
  TType extends SessionCommandType = SessionCommandType,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> extends SessionCommandRejectedResultBase<'conflict', TType, TRevision> {
  readonly conflictingScopes: readonly SessionCommandScope[]
  readonly conflictRevision?: TRevision
  readonly currentState?: TCurrentState
}

export type SessionCommandRejectedResult<
  TType extends SessionCommandType = SessionCommandType,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> =
  | SessionCommandInvalidRejection<TType, TRevision>
  | SessionCommandUnauthorizedRejection<TType, TCurrentState, TRevision>
  | SessionCommandStaleRejection<TType, TCurrentState, TRevision>
  | SessionCommandConflictRejection<TType, TCurrentState, TRevision>

export type SessionCommandInvalidResult<
  TType extends SessionCommandType = SessionCommandType,
  TRevision extends Revision = Revision,
> = SessionCommandInvalidRejection<TType, TRevision>

export type SessionCommandUnauthorizedResult<
  TType extends SessionCommandType = SessionCommandType,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> = SessionCommandUnauthorizedRejection<TType, TCurrentState, TRevision>

export type SessionCommandStaleResult<
  TType extends SessionCommandType = SessionCommandType,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> = SessionCommandStaleRejection<TType, TCurrentState, TRevision>

export type SessionCommandConflictResult<
  TType extends SessionCommandType = SessionCommandType,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> = SessionCommandConflictRejection<TType, TCurrentState, TRevision>

export type SessionCommandDuplicateOriginalSummary<TRevision extends Revision = Revision> =
  | {
      readonly status: 'accepted'
      readonly revision: TRevision
      readonly reason?: never
    }
  | {
      readonly status: 'rejected'
      readonly revision: TRevision
      readonly reason: SessionCommandRejectionReason
    }

export interface SessionCommandDuplicateResult<
  TType extends SessionCommandType = SessionCommandType,
  TRevision extends Revision = Revision,
> extends SessionCommandResultBase<'duplicate', TType, TRevision> {
  readonly duplicate: true
  readonly idempotent: true
  readonly original: SessionCommandDuplicateOriginalSummary<TRevision>
}

export type SessionCommandResult<
  TType extends SessionCommandType = SessionCommandType,
  TEvent = unknown,
  TCurrentState = unknown,
  TRevision extends Revision = Revision,
> =
  | SessionCommandAcceptedResult<TType, TEvent, TRevision>
  | SessionCommandRejectedResult<TType, TCurrentState, TRevision>
  | SessionCommandDuplicateResult<TType, TRevision>

export const isSessionCommandAcceptedResult = (
  result: SessionCommandResult,
): result is SessionCommandAcceptedResult => result.status === 'accepted'

export const isSessionCommandRejectedResult = (
  result: SessionCommandResult,
): result is SessionCommandRejectedResult => result.status === 'rejected'

export const isSessionCommandDuplicateResult = (
  result: SessionCommandResult,
): result is SessionCommandDuplicateResult => result.status === 'duplicate'
