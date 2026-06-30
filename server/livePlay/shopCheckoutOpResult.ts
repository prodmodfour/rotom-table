import { createHash } from 'node:crypto'
import {
  isLivePlayCommandRejectionReason,
  type ShopCheckoutCommandAccepted,
  type ShopCheckoutCommandRejected,
  type ShopCheckoutLivePlayCommand,
} from '#shared/livePlayCommands'
import { canonicalJsonStringify } from './opResult'

export type ShopCheckoutCommandHash = string & { readonly __brand: 'ShopCheckoutCommandHash' }

export type StorableShopCheckoutCommandResult =
  | ShopCheckoutCommandAccepted
  | ShopCheckoutCommandRejected

export interface ShopCheckoutOperationResultConflictInput {
  readonly shopSlug: string
  readonly opId: string
  readonly commandHash: ShopCheckoutCommandHash
  readonly existingResult: StorableShopCheckoutCommandResult
  readonly attemptedResult: StorableShopCheckoutCommandResult
}

export class ShopCheckoutOperationResultConflictError extends Error {
  readonly shopSlug: string
  readonly opId: string
  readonly commandHash: ShopCheckoutCommandHash
  readonly existingResult: StorableShopCheckoutCommandResult
  readonly attemptedResult: StorableShopCheckoutCommandResult

  constructor(input: ShopCheckoutOperationResultConflictInput) {
    super(`Shop checkout operation ID ${input.shopSlug}:${input.opId} already has a different terminal result for the same command envelope`)
    this.name = 'ShopCheckoutOperationResultConflictError'
    this.shopSlug = input.shopSlug
    this.opId = input.opId
    this.commandHash = input.commandHash
    this.existingResult = cloneJson(input.existingResult)
    this.attemptedResult = cloneJson(input.attemptedResult)
  }
}

export const isShopCheckoutOperationResultConflictError = (
  error: unknown,
): error is ShopCheckoutOperationResultConflictError => error instanceof ShopCheckoutOperationResultConflictError

export interface ShopCheckoutCommandHashMaterial {
  readonly schemaVersion: ShopCheckoutLivePlayCommand['schemaVersion']
  readonly opId: string
  readonly type: ShopCheckoutLivePlayCommand['type']
  readonly scopes: ShopCheckoutLivePlayCommand['scopes']
  readonly payload: ShopCheckoutLivePlayCommand['payload']
}

type JsonRecord = Record<string, unknown>

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const isRecord = (value: unknown): value is JsonRecord => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

const messageFromError = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
)

const isSafeNonNegativeInteger = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
)

const isResultLine = (value: unknown): value is ShopCheckoutCommandAccepted['lines'][number] => {
  if (!isRecord(value)) return false
  if (typeof value.entryId !== 'string' || typeof value.itemName !== 'string') return false
  if (typeof value.section !== 'string') return false
  if (!isSafeNonNegativeInteger(value.quantity) || value.quantity <= 0) return false
  if (!isSafeNonNegativeInteger(value.unitPrice)) return false
  if (!isSafeNonNegativeInteger(value.lineTotal)) return false
  return value.stock === null || isSafeNonNegativeInteger(value.stock)
}

const isShopCheckoutAcceptedResult = (result: unknown): result is ShopCheckoutCommandAccepted => {
  if (!isRecord(result)) return false
  if (result.ok !== true || typeof result.opId !== 'string' || typeof result.shopSlug !== 'string') return false
  if (hasOwn(result, 'duplicate') && result.duplicate === true) return false
  if (!isSafeNonNegativeInteger(result.previousShopRevision)) return false
  if (!isSafeNonNegativeInteger(result.shopRevision)) return false
  if (!isSafeNonNegativeInteger(result.totalPrice)) return false
  if (!Array.isArray(result.lines) || !result.lines.every(isResultLine)) return false
  return isRecord(result.documents) && isRecord(result.documents.shop)
}

const isShopCheckoutRejectedResult = (result: unknown): result is ShopCheckoutCommandRejected => {
  if (!isRecord(result)) return false
  if (result.ok !== false || typeof result.opId !== 'string') return false
  if (!isLivePlayCommandRejectionReason(result.reason)) return false
  if (typeof result.message !== 'string') return false
  if (hasOwn(result, 'shopSlug') && result.shopSlug !== undefined && typeof result.shopSlug !== 'string') return false
  if (hasOwn(result, 'currentShopRevision') && result.currentShopRevision !== undefined && !isSafeNonNegativeInteger(result.currentShopRevision)) return false
  return true
}

export const normalizeShopCheckoutCommandForHash = (
  command: ShopCheckoutLivePlayCommand,
): ShopCheckoutCommandHashMaterial => ({
  schemaVersion: command.schemaVersion,
  opId: command.opId,
  type: command.type,
  scopes: command.scopes,
  payload: command.payload,
})

export const stringifyShopCheckoutCommandForHash = (command: ShopCheckoutLivePlayCommand): string => {
  try {
    return canonicalJsonStringify(normalizeShopCheckoutCommandForHash(command), 'shopCheckoutCommand')
  } catch (error) {
    throw new Error(`Shop checkout command envelope could not be hashed: ${messageFromError(error)}`)
  }
}

export const createShopCheckoutCommandHash = (command: ShopCheckoutLivePlayCommand): ShopCheckoutCommandHash => (
  createHash('sha256')
    .update(stringifyShopCheckoutCommandForHash(command))
    .digest('hex') as ShopCheckoutCommandHash
)

export const areShopCheckoutCommandsSemanticallyEqual = (
  left: ShopCheckoutLivePlayCommand,
  right: ShopCheckoutLivePlayCommand,
): boolean => stringifyShopCheckoutCommandForHash(left) === stringifyShopCheckoutCommandForHash(right)

export const isStorableShopCheckoutCommandResult = (
  result: unknown,
): result is StorableShopCheckoutCommandResult => (
  isShopCheckoutAcceptedResult(result) || isShopCheckoutRejectedResult(result)
)

export const areShopCheckoutCommandResultsSemanticallyEqual = (
  left: StorableShopCheckoutCommandResult,
  right: StorableShopCheckoutCommandResult,
): boolean => canonicalJsonStringify(left, 'leftShopCheckoutResult') === canonicalJsonStringify(right, 'rightShopCheckoutResult')

export const assertShopCheckoutOperationResultCompatible = (
  input: ShopCheckoutOperationResultConflictInput,
): void => {
  if (areShopCheckoutCommandResultsSemanticallyEqual(input.existingResult, input.attemptedResult)) return
  throw new ShopCheckoutOperationResultConflictError(input)
}

export const assertShopCheckoutResultMatchesCommand = (
  command: ShopCheckoutLivePlayCommand,
  result: StorableShopCheckoutCommandResult,
): void => {
  if (result.opId !== command.opId) {
    throw new Error('Shop checkout command result opId must match the command opId')
  }

  if (result.ok && result.shopSlug !== command.payload.shopSlug) {
    throw new Error('Shop checkout accepted result shopSlug must match the command payload shopSlug')
  }

  if (!result.ok && result.shopSlug !== undefined && result.shopSlug !== command.payload.shopSlug) {
    throw new Error('Shop checkout rejected result shopSlug must match the command payload shopSlug when provided')
  }
}

export const shopCheckoutIdempotencyViolationMessage = (shopSlug: string, opId: string): string =>
  `Shop checkout operation ID ${shopSlug}:${opId} was already recorded for a different command envelope`
