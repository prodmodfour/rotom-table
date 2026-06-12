import { createHash } from 'node:crypto'
import {
  createLivePlayRejectedResult,
  type LivePlayCommandAccepted,
  type LivePlayCommandEnvelope,
  type LivePlayCommandRejected,
  type LivePlayCommandResult,
} from '#shared/livePlayCommands'

export type LivePlayCommandHash = string & { readonly __brand: 'LivePlayCommandHash' }

export type StorableLivePlayCommandResult = LivePlayCommandAccepted | LivePlayCommandRejected

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

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasOwn = <TKey extends string>(value: object, key: TKey): value is Record<TKey, unknown> =>
  Object.prototype.hasOwnProperty.call(value, key)

const messageFromError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const canonicalJsonStringify = (
  value: unknown,
  path = 'value',
  seen: WeakSet<object> = new WeakSet(),
): string => {
  if (value === null) return 'null'

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must be JSON-serializable; non-finite numbers are not allowed`)
    }
    return JSON.stringify(value)
  }

  if (value === undefined) {
    throw new Error(`${path} must be JSON-serializable; undefined values are not allowed`)
  }

  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(`${path} must be JSON-serializable`)
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error(`${path} must be JSON-serializable; circular references are not allowed`)
    }
    seen.add(value)
    const serialized = `[${value
      .map((item, index) => canonicalJsonStringify(item, `${path}[${index}]`, seen))
      .join(',')}]`
    seen.delete(value)
    return serialized
  }

  if (!isRecord(value)) {
    throw new Error(`${path} must be JSON-serializable`)
  }

  if (seen.has(value)) {
    throw new Error(`${path} must be JSON-serializable; circular references are not allowed`)
  }

  seen.add(value)
  const serializedEntries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key], `${path}.${key}`, seen)}`)
  seen.delete(value)

  return `{${serializedEntries.join(',')}}`
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

export const stringifyLivePlayCommandForHash = (command: LivePlayCommandEnvelope): string => {
  try {
    return canonicalJsonStringify(normalizeLivePlayCommandForHash(command), 'command')
  } catch (error) {
    throw new Error(`Live-play command envelope could not be hashed: ${messageFromError(error)}`)
  }
}

export const createLivePlayCommandHash = (command: LivePlayCommandEnvelope): LivePlayCommandHash =>
  createHash('sha256')
    .update(stringifyLivePlayCommandForHash(command))
    .digest('hex') as LivePlayCommandHash

export const isStorableLivePlayCommandResult = (
  result: unknown,
): result is StorableLivePlayCommandResult => {
  if (!isRecord(result) || typeof result.opId !== 'string') return false
  if (result.ok === false) return typeof result.mapSlug === 'string'
  if (result.ok !== true || typeof result.mapSlug !== 'string') return false
  return !hasOwn(result, 'duplicate') || result.duplicate !== true
}

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
