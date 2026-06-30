import {
  createLivePlayRejectedResult,
  type LivePlayCommandAccepted,
  type LivePlayCommandEnvelope,
  type LivePlayCommandRejected,
  type LivePlayCommandResult,
} from '#shared/livePlayCommands'
import {
  areTerminalCommandResultsSemanticallyEqual,
  assertTerminalOperationResultCompatible,
  cloneJson,
  createCanonicalCommandHash,
  isAcceptedTerminalResult,
  isRecord,
  isRejectedTerminalResult,
  stringifyCanonicalCommandForHash,
} from './commandIdempotency'

export { canonicalJsonStringify } from './commandIdempotency'

export type LivePlayCommandHash = string & { readonly __brand: 'LivePlayCommandHash' }

export type StorableLivePlayCommandResult = LivePlayCommandAccepted | LivePlayCommandRejected

export interface LivePlayOperationResultConflictInput {
  readonly mapSlug: string
  readonly opId: string
  readonly commandHash: LivePlayCommandHash
  readonly existingResult: StorableLivePlayCommandResult
  readonly attemptedResult: StorableLivePlayCommandResult
}

export class LivePlayOperationResultConflictError extends Error {
  readonly mapSlug: string
  readonly opId: string
  readonly commandHash: LivePlayCommandHash
  readonly existingResult: StorableLivePlayCommandResult
  readonly attemptedResult: StorableLivePlayCommandResult

  constructor(input: LivePlayOperationResultConflictInput) {
    super(`Operation ID ${input.mapSlug}:${input.opId} already has a different terminal result for the same command envelope`)
    this.name = 'LivePlayOperationResultConflictError'
    this.mapSlug = input.mapSlug
    this.opId = input.opId
    this.commandHash = input.commandHash
    this.existingResult = cloneJson(input.existingResult)
    this.attemptedResult = cloneJson(input.attemptedResult)
  }
}

export const isLivePlayOperationResultConflictError = (
  error: unknown,
): error is LivePlayOperationResultConflictError => error instanceof LivePlayOperationResultConflictError

export interface LivePlayCommandHashMaterial {
  readonly schemaVersion: LivePlayCommandEnvelope['schemaVersion']
  readonly opId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly type: string
  readonly scopes: LivePlayCommandEnvelope['scopes']
  readonly payload: unknown
}

export interface LivePlayRecordedResultReference {
  readonly mapSlug: string
  readonly opId: string
  readonly result: StorableLivePlayCommandResult
}

export const normalizeLivePlayCommandForHash = (
  command: LivePlayCommandEnvelope,
): LivePlayCommandHashMaterial => ({
  schemaVersion: command.schemaVersion,
  opId: command.opId,
  mapSlug: command.mapSlug,
  baseRevision: command.baseRevision,
  type: command.type,
  scopes: command.scopes,
  payload: command.payload,
})

export const stringifyLivePlayCommandForHash = (command: LivePlayCommandEnvelope): string =>
  stringifyCanonicalCommandForHash({
    command,
    normalize: normalizeLivePlayCommandForHash,
    path: 'command',
    errorPrefix: 'Live-play command envelope could not be hashed',
  })

export const createLivePlayCommandHash = (command: LivePlayCommandEnvelope): LivePlayCommandHash =>
  createCanonicalCommandHash({
    command,
    normalize: normalizeLivePlayCommandForHash,
    path: 'command',
    errorPrefix: 'Live-play command envelope could not be hashed',
  })

export const isStorableLivePlayCommandResult = (
  result: unknown,
): result is StorableLivePlayCommandResult => {
  if (!isRecord(result)) return false
  if (isRejectedTerminalResult(result)) return typeof result.mapSlug === 'string'
  return isAcceptedTerminalResult(result) && typeof result.mapSlug === 'string'
}

export const areLivePlayCommandResultsSemanticallyEqual = (
  left: StorableLivePlayCommandResult,
  right: StorableLivePlayCommandResult,
): boolean => areTerminalCommandResultsSemanticallyEqual(left, right, 'leftResult', 'rightResult')

export const assertLivePlayOperationResultCompatible = (
  input: LivePlayOperationResultConflictInput,
): void => assertTerminalOperationResultCompatible({
  existingResult: input.existingResult,
  attemptedResult: input.attemptedResult,
  existingPath: 'leftResult',
  attemptedPath: 'rightResult',
  conflictError: () => new LivePlayOperationResultConflictError(input),
})

export const assertLivePlayResultMatchesCommand = (
  command: LivePlayCommandEnvelope,
  result: StorableLivePlayCommandResult,
): void => {
  if (result.opId !== command.opId) {
    throw new Error('Live-play command result opId must match the command opId')
  }

  if (result.mapSlug !== command.mapSlug) {
    throw new Error('Live-play command result mapSlug must match the command mapSlug')
  }
}

const currentRevisionFromResult = (
  result: StorableLivePlayCommandResult,
): number | undefined => result.ok ? result.revision : result.currentRevision

export const livePlayIdempotencyViolationMessage = (mapSlug: string, opId: string): string =>
  `Operation ID ${mapSlug}:${opId} was already recorded for a different command envelope`

export const createLivePlayIdempotencyViolationResult = (
  command: LivePlayCommandEnvelope,
  existing: LivePlayRecordedResultReference,
): LivePlayCommandRejected => createLivePlayRejectedResult({
  opId: command.opId,
  mapSlug: command.mapSlug,
  reason: 'conflict',
  message: livePlayIdempotencyViolationMessage(existing.mapSlug, existing.opId),
  currentRevision: currentRevisionFromResult(existing.result),
})
