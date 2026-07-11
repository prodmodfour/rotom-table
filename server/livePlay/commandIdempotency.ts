import { createHash } from 'node:crypto'
import { parseLivePlayOpId, type LivePlayOpId } from '#shared/livePlayCommands'

export type CommandHash<TBrand extends string> = string & { readonly __brand: TBrand }

export interface CanonicalCommandHashInput<TCommand, TNormalized = unknown> {
  readonly command: TCommand
  readonly normalize: (command: TCommand) => TNormalized
  readonly path: string
  readonly errorPrefix: string
}

export interface SemanticCommandComparisonInput<TCommand, TNormalized = unknown> {
  readonly left: TCommand
  readonly right: TCommand
  readonly normalize: (command: TCommand) => TNormalized
  readonly path: string
  readonly errorPrefix: string
}

export interface TerminalOperationResultCompatibilityInput<TResult> {
  readonly existingResult: TResult
  readonly attemptedResult: TResult
  readonly existingPath?: string
  readonly attemptedPath?: string
  readonly conflictError: () => Error
}

export type JsonRecord = Record<string, unknown>

export const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const isRecord = (value: unknown): value is JsonRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

export const hasOwn = <TKey extends string>(value: object, key: TKey): value is Record<TKey, unknown> =>
  Object.prototype.hasOwnProperty.call(value, key)

export const messageFromError = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
)

export const validateLivePlayOperationId = (
  value: unknown,
  label = 'opId',
): LivePlayOpId => parseLivePlayOpId(value, label)

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

export const stringifyCanonicalCommandForHash = <TCommand, TNormalized = unknown>(
  input: CanonicalCommandHashInput<TCommand, TNormalized>,
): string => {
  try {
    return canonicalJsonStringify(input.normalize(input.command), input.path)
  } catch (error) {
    throw new Error(`${input.errorPrefix}: ${messageFromError(error)}`)
  }
}

export const createCanonicalCommandHash = <
  THash extends string,
  TCommand,
  TNormalized = unknown,
>(
  input: CanonicalCommandHashInput<TCommand, TNormalized>,
): THash => createHash('sha256')
  .update(stringifyCanonicalCommandForHash(input))
  .digest('hex') as THash

export const areCanonicalCommandsSemanticallyEqual = <TCommand, TNormalized = unknown>(
  input: SemanticCommandComparisonInput<TCommand, TNormalized>,
): boolean => stringifyCanonicalCommandForHash({
  command: input.left,
  normalize: input.normalize,
  path: input.path,
  errorPrefix: input.errorPrefix,
}) === stringifyCanonicalCommandForHash({
  command: input.right,
  normalize: input.normalize,
  path: input.path,
  errorPrefix: input.errorPrefix,
})

export const isAcceptedTerminalResult = (
  result: unknown,
): result is JsonRecord & { readonly ok: true; readonly opId: string } => (
  isRecord(result)
  && result.ok === true
  && typeof result.opId === 'string'
  && (!hasOwn(result, 'duplicate') || result.duplicate !== true)
  && (!hasOwn(result, 'pending') || result.pending !== true)
)

export const isRejectedTerminalResult = (
  result: unknown,
): result is JsonRecord & { readonly ok: false; readonly opId: string } => (
  isRecord(result)
  && result.ok === false
  && typeof result.opId === 'string'
)

export const isAcceptedOrRejectedTerminalResult = (
  result: unknown,
): result is JsonRecord & { readonly ok: boolean; readonly opId: string } => (
  isAcceptedTerminalResult(result) || isRejectedTerminalResult(result)
)

export const areTerminalCommandResultsSemanticallyEqual = <TResult>(
  left: TResult,
  right: TResult,
  leftPath = 'leftResult',
  rightPath = 'rightResult',
): boolean => canonicalJsonStringify(left, leftPath) === canonicalJsonStringify(right, rightPath)

export const assertTerminalOperationResultCompatible = <TResult>(
  input: TerminalOperationResultCompatibilityInput<TResult>,
): void => {
  if (areTerminalCommandResultsSemanticallyEqual(
    input.existingResult,
    input.attemptedResult,
    input.existingPath,
    input.attemptedPath,
  )) return
  throw input.conflictError()
}
