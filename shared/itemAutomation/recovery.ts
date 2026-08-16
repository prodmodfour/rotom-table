import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'
import { ITEM_OPERATION_LIMITS, ITEM_OPERATION_SCHEMA_VERSION } from './operations'

export const ITEM_OPERATION_RECOVERY_SCHEMA_VERSION = 1 as const

export type ItemOperationRecoveryCommandV1 =
  | {
      readonly schemaVersion: typeof ITEM_OPERATION_RECOVERY_SCHEMA_VERSION
      readonly operationId: string
      readonly action: 'abandon'
      readonly reason: string
    }
  | {
      readonly schemaVersion: typeof ITEM_OPERATION_RECOVERY_SCHEMA_VERSION
      readonly operationId: string
      readonly action: 'correct'
      readonly correctionOperationId: string
      readonly reason: string
    }

export interface ItemOperationRecoveryResultV1 {
  readonly schemaVersion: typeof ITEM_OPERATION_RECOVERY_SCHEMA_VERSION
  readonly operationId: string
  readonly action: 'abandon' | 'correct'
  readonly status: 'abandoned' | 'corrected' | 'already-terminal'
  readonly inventoryDisposition: 'reservation-released' | 'restored' | 'unchanged'
  readonly correctionOperationId: string | null
  readonly correctedReceiptId: string | null
  readonly exactReplay: boolean
  readonly message: string
}

export type ItemOperationRecoveryValidationCode =
  | 'invalid-command'
  | 'unsupported-schema-version'
  | 'not-json'
  | 'limit-exceeded'

export class ItemOperationRecoveryValidationError extends Error {
  readonly code: ItemOperationRecoveryValidationCode
  readonly path: string

  constructor(code: ItemOperationRecoveryValidationCode, path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'ItemOperationRecoveryValidationError'
    this.code = code
    this.path = path
  }
}

type UnknownRecord = Record<string, unknown>

const ABANDON_FIELDS = ['schemaVersion', 'operationId', 'action', 'reason'] as const
const CORRECT_FIELDS = ['schemaVersion', 'operationId', 'action', 'correctionOperationId', 'reason'] as const
const OPERATION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{7,199}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const fail = (
  code: ItemOperationRecoveryValidationCode,
  path: string,
  detail: string,
): never => {
  throw new ItemOperationRecoveryValidationError(code, path, detail)
}

const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-command', path, 'must be a plain object.')
  return value as UnknownRecord
}

const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  const missing = fields.filter(field => !Object.hasOwn(value, field))
  const unknown = Object.keys(value).filter(field => !expected.has(field))
  if (missing.length || unknown.length) {
    fail('invalid-command', path, `has an invalid shape (missing: ${missing.join(', ') || 'none'}; unknown: ${unknown.join(', ') || 'none'}).`)
  }
}

const boundedText = (value: unknown, path: string, maximum: number = ITEM_OPERATION_LIMITS.stringLength): string => {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || CONTROL_CHARACTER_PATTERN.test(value)) {
    fail('invalid-command', path, 'must be non-empty trimmed text without control characters.')
  }
  if ((value as string).length > maximum) fail('limit-exceeded', path, `must contain at most ${maximum} characters.`)
  return value as string
}

const operationId = (value: unknown, path: string): string => {
  const id = boundedText(value, path, ITEM_OPERATION_LIMITS.identifierLength)
  if (!OPERATION_ID_PATTERN.test(id)) fail('invalid-command', path, 'must be a bounded item operation identifier.')
  return id
}

/** Parse one bounded GM recovery intent. No mechanics, quantities, or restore values are client supplied. */
export const parseItemOperationRecoveryCommand = (
  value: unknown,
): ItemOperationRecoveryCommandV1 => {
  const detached = cloneStrictJson(value, 'itemRecoveryCommand', {
    limits: {
      depth: 4,
      nodes: 16,
      objectFields: 8,
      arrayEntries: 0,
      stringLength: ITEM_OPERATION_LIMITS.stringLength,
      objectKeyLength: ITEM_OPERATION_LIMITS.identifierLength,
    },
    rootLabel: 'item recovery command',
    valueLabel: 'item recovery commands',
    failNotJson: (path, detail) => fail('not-json', path, detail),
    failLimit: (path, detail) => fail('limit-exceeded', path, detail),
  })
  const input = record(detached, 'itemRecoveryCommand')
  if (input.action !== 'abandon' && input.action !== 'correct') {
    fail('invalid-command', 'itemRecoveryCommand.action', 'must be abandon or correct.')
  }
  exact(input, input.action === 'abandon' ? ABANDON_FIELDS : CORRECT_FIELDS, 'itemRecoveryCommand')
  if (input.schemaVersion !== ITEM_OPERATION_SCHEMA_VERSION) {
    fail('unsupported-schema-version', 'itemRecoveryCommand.schemaVersion', `must be ${ITEM_OPERATION_RECOVERY_SCHEMA_VERSION}.`)
  }
  const base = {
    schemaVersion: ITEM_OPERATION_RECOVERY_SCHEMA_VERSION,
    operationId: operationId(input.operationId, 'itemRecoveryCommand.operationId'),
    reason: boundedText(input.reason, 'itemRecoveryCommand.reason', 500),
  }
  if (input.action === 'abandon') return deepFreezeStrictJson({ ...base, action: 'abandon' as const })
  const correctionOperationId = operationId(
    input.correctionOperationId,
    'itemRecoveryCommand.correctionOperationId',
  )
  if (correctionOperationId === base.operationId) {
    fail('invalid-command', 'itemRecoveryCommand.correctionOperationId', 'must differ from the origin item operation ID.')
  }
  return deepFreezeStrictJson({
    ...base,
    action: 'correct' as const,
    correctionOperationId,
  })
}
