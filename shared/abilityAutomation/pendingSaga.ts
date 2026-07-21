import {
  parsePendingAbilityResolution,
  type PendingAbilityResolution,
} from './pendingResolution'
import { cloneStrictJson, deepFreezeStrictJson, isPlainJsonObject } from '../automation/strictJson'

export const PENDING_ABILITY_SAGA_SCHEMA_VERSION = 1 as const
export const PENDING_ABILITY_SAGA_STATUSES = [
  'pending', 'resuming', 'committed', 'passed', 'force-passed',
  'cancelled', 'expired', 'conflicted', 'recovered',
] as const
export const PENDING_ABILITY_SAGA_TERMINAL_STATUSES = [
  'committed', 'passed', 'force-passed', 'cancelled', 'expired', 'conflicted', 'recovered',
] as const
export const PENDING_ABILITY_SAGA_ACTIONS = [
  'select', 'pass', 'force-pass', 'cancel', 'expire', 'commit', 'conflict', 'gm-recover',
] as const
export const PENDING_ABILITY_SAGA_ACTOR_KINDS = [
  'principal', 'placement', 'profile', 'side', 'gm', 'system',
] as const
export const PENDING_ABILITY_SAGA_LIMITS = Object.freeze({ receipts: 256, identifierLength: 200 })

export type PendingAbilitySagaStatus = (typeof PENDING_ABILITY_SAGA_STATUSES)[number]
export type PendingAbilitySagaTerminalStatus = (typeof PENDING_ABILITY_SAGA_TERMINAL_STATUSES)[number]
export type PendingAbilitySagaAction = (typeof PENDING_ABILITY_SAGA_ACTIONS)[number]
export type PendingAbilitySagaActorKind = (typeof PENDING_ABILITY_SAGA_ACTOR_KINDS)[number]

export interface PendingAbilitySagaCommand {
  readonly schemaVersion: typeof PENDING_ABILITY_SAGA_SCHEMA_VERSION
  readonly commandId: string
  readonly resolutionId: string
  readonly windowId: string
  readonly expectedSagaVersion: number
  readonly action: PendingAbilitySagaAction
  readonly optionId: string | null
  readonly requestSha256: string
  readonly occurredAt: number
  readonly reasonCode: string
}

export interface PendingAbilitySagaReceipt {
  readonly sagaVersion: number
  readonly commandId: string
  readonly requestSha256: string
  readonly action: PendingAbilitySagaAction
  readonly resultingStatus: PendingAbilitySagaStatus
  readonly optionId: string | null
  readonly actorKind: PendingAbilitySagaActorKind
  readonly actorId: string | null
  readonly occurredAt: number
  readonly reasonCode: string
  readonly chainId: string
  readonly triggerId: string
  readonly eventId: string
}

export interface PendingAbilitySagaTerminal {
  readonly status: PendingAbilitySagaTerminalStatus
  readonly commandId: string
  readonly occurredAt: number
  readonly reasonCode: string
}

export interface PendingAbilitySaga {
  readonly schemaVersion: typeof PENDING_ABILITY_SAGA_SCHEMA_VERSION
  readonly resolution: PendingAbilityResolution
  readonly sagaVersion: number
  readonly status: PendingAbilitySagaStatus
  readonly updatedAt: number
  readonly selectedOptionId: string | null
  readonly receipts: readonly PendingAbilitySagaReceipt[]
  readonly terminal: PendingAbilitySagaTerminal | null
}

export class PendingAbilitySagaValidationError extends Error {
  constructor(readonly code: 'invalid-saga' | 'invalid-command' | 'limit-exceeded' | 'duplicate-id' | 'not-json', readonly path: string, detail: string) {
    super(`${path}: ${detail}`)
    this.name = 'PendingAbilitySagaValidationError'
  }
}

type UnknownRecord = Record<string, unknown>
const SAGA_FIELDS = ['schemaVersion', 'resolution', 'sagaVersion', 'status', 'updatedAt', 'selectedOptionId', 'receipts', 'terminal'] as const
const COMMAND_FIELDS = ['schemaVersion', 'commandId', 'resolutionId', 'windowId', 'expectedSagaVersion', 'action', 'optionId', 'requestSha256', 'occurredAt', 'reasonCode'] as const
const RECEIPT_FIELDS = ['sagaVersion', 'commandId', 'requestSha256', 'action', 'resultingStatus', 'optionId', 'actorKind', 'actorId', 'occurredAt', 'reasonCode', 'chainId', 'triggerId', 'eventId'] as const
const TERMINAL_FIELDS = ['status', 'commandId', 'occurredAt', 'reasonCode'] as const
const STATUS_SET = new Set<string>(PENDING_ABILITY_SAGA_STATUSES)
const TERMINAL_SET = new Set<string>(PENDING_ABILITY_SAGA_TERMINAL_STATUSES)
const ACTION_SET = new Set<string>(PENDING_ABILITY_SAGA_ACTIONS)
const ACTOR_SET = new Set<string>(PENDING_ABILITY_SAGA_ACTOR_KINDS)
const STABLE_ID_PATTERN = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const fail = (code: PendingAbilitySagaValidationError['code'], path: string, detail: string): never => {
  throw new PendingAbilitySagaValidationError(code, path, detail)
}
const clone = (value: unknown, path: string): unknown => cloneStrictJson(value, path, {
  limits: { depth: 40, nodes: 200_000, objectFields: 128, arrayEntries: 8_192, stringLength: 2_000, objectKeyLength: 200 },
  rootLabel: 'pending ability saga', valueLabel: 'pending ability saga values',
  failNotJson: (failurePath, detail) => fail('not-json', failurePath, detail),
  failLimit: (failurePath, detail) => fail('limit-exceeded', failurePath, detail),
})
const record = (value: unknown, path: string): UnknownRecord => {
  if (!isPlainJsonObject(value)) fail('invalid-saga', path, 'must be an object.')
  return value as UnknownRecord
}
const exact = (value: UnknownRecord, fields: readonly string[], path: string): void => {
  const expected = new Set(fields)
  if (fields.some(field => !Object.prototype.hasOwnProperty.call(value, field))
    || Object.keys(value).some(field => !expected.has(field))) fail('invalid-saga', path, 'has invalid shape.')
}
const stableId = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0
    || value.length > PENDING_ABILITY_SAGA_LIMITS.identifierLength
    || !STABLE_ID_PATTERN.test(value)) fail('invalid-saga', path, 'must be a stable ID.')
  return value as string
}
const sha = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail('invalid-saga', path, 'must be SHA-256.')
  return value as string
}
const integer = (value: unknown, path: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail('invalid-saga', path, 'must be non-negative.')
  return Number(value)
}
const optionalId = (value: unknown, path: string): string | null => value === null ? null : stableId(value, path)
const ALLOWED_PREVIOUS_STATUS = {
  select: ['pending'],
  pass: ['pending'],
  'force-pass': ['pending'],
  cancel: ['pending', 'resuming'],
  expire: ['pending', 'resuming'],
  commit: ['resuming'],
  conflict: ['pending', 'resuming'],
  'gm-recover': ['pending', 'resuming'],
} as const satisfies Readonly<Record<PendingAbilitySagaAction, readonly PendingAbilitySagaStatus[]>>
const statusForAction = (action: PendingAbilitySagaAction): PendingAbilitySagaStatus => {
  if (action === 'select') return 'resuming'
  if (action === 'pass') return 'passed'
  if (action === 'force-pass') return 'force-passed'
  if (action === 'cancel') return 'cancelled'
  if (action === 'expire') return 'expired'
  if (action === 'commit') return 'committed'
  if (action === 'conflict') return 'conflicted'
  return 'recovered'
}

export const parsePendingAbilitySagaCommand = (value: unknown): PendingAbilitySagaCommand => {
  const path = 'pendingAbilitySagaCommand'
  const input = record(clone(value, path), path)
  exact(input, COMMAND_FIELDS, path)
  if (input.schemaVersion !== PENDING_ABILITY_SAGA_SCHEMA_VERSION) fail('invalid-command', `${path}.schemaVersion`, 'is unsupported.')
  if (typeof input.action !== 'string' || !ACTION_SET.has(input.action)) fail('invalid-command', `${path}.action`, 'is unsupported.')
  const action = input.action as PendingAbilitySagaAction
  const optionId = optionalId(input.optionId, `${path}.optionId`)
  if ((action === 'select') !== (optionId !== null)) fail('invalid-command', `${path}.optionId`, 'is required only for selection.')
  return deepFreezeStrictJson({
    schemaVersion: PENDING_ABILITY_SAGA_SCHEMA_VERSION,
    commandId: stableId(input.commandId, `${path}.commandId`),
    resolutionId: stableId(input.resolutionId, `${path}.resolutionId`),
    windowId: stableId(input.windowId, `${path}.windowId`),
    expectedSagaVersion: integer(input.expectedSagaVersion, `${path}.expectedSagaVersion`),
    action,
    optionId,
    requestSha256: sha(input.requestSha256, `${path}.requestSha256`),
    occurredAt: integer(input.occurredAt, `${path}.occurredAt`),
    reasonCode: stableId(input.reasonCode, `${path}.reasonCode`),
  })
}

export const createPendingAbilitySaga = (resolutionValue: unknown): PendingAbilitySaga => {
  const resolution = parsePendingAbilityResolution(resolutionValue)
  return deepFreezeStrictJson({
    schemaVersion: PENDING_ABILITY_SAGA_SCHEMA_VERSION,
    resolution,
    sagaVersion: 0,
    status: 'pending',
    updatedAt: resolution.updatedAt,
    selectedOptionId: null,
    receipts: [],
    terminal: null,
  })
}

export const parsePendingAbilitySaga = (value: unknown): PendingAbilitySaga => {
  const path = 'pendingAbilitySaga'
  const input = record(clone(value, path), path)
  exact(input, SAGA_FIELDS, path)
  if (input.schemaVersion !== PENDING_ABILITY_SAGA_SCHEMA_VERSION) fail('invalid-saga', `${path}.schemaVersion`, 'is unsupported.')
  const resolution = parsePendingAbilityResolution(input.resolution)
  const sagaVersion = integer(input.sagaVersion, `${path}.sagaVersion`)
  if (typeof input.status !== 'string' || !STATUS_SET.has(input.status)) fail('invalid-saga', `${path}.status`, 'is unsupported.')
  const status = input.status as PendingAbilitySagaStatus
  const updatedAt = integer(input.updatedAt, `${path}.updatedAt`)
  const selectedOptionId = optionalId(input.selectedOptionId, `${path}.selectedOptionId`)
  if (!Array.isArray(input.receipts) || input.receipts.length > PENDING_ABILITY_SAGA_LIMITS.receipts) {
    fail('limit-exceeded', `${path}.receipts`, 'must be bounded.')
  }
  const receipts = (input.receipts as readonly unknown[]).map((entry, index): PendingAbilitySagaReceipt => {
    const receiptPath = `${path}.receipts[${index}]`
    const receipt = record(entry, receiptPath)
    exact(receipt, RECEIPT_FIELDS, receiptPath)
    if (typeof receipt.action !== 'string' || !ACTION_SET.has(receipt.action)
      || typeof receipt.resultingStatus !== 'string' || !STATUS_SET.has(receipt.resultingStatus)
      || typeof receipt.actorKind !== 'string' || !ACTOR_SET.has(receipt.actorKind)) {
      fail('invalid-saga', receiptPath, 'contains unsupported values.')
    }
    const actorKind = receipt.actorKind as PendingAbilitySagaActorKind
    const actorId = optionalId(receipt.actorId, `${receiptPath}.actorId`)
    if ((actorKind === 'system') !== (actorId === null)) {
      fail('invalid-saga', `${receiptPath}.actorId`, 'is null only for system actions.')
    }
    return Object.freeze({
      sagaVersion: integer(receipt.sagaVersion, `${receiptPath}.sagaVersion`),
      commandId: stableId(receipt.commandId, `${receiptPath}.commandId`),
      requestSha256: sha(receipt.requestSha256, `${receiptPath}.requestSha256`),
      action: receipt.action as PendingAbilitySagaAction,
      resultingStatus: receipt.resultingStatus as PendingAbilitySagaStatus,
      optionId: optionalId(receipt.optionId, `${receiptPath}.optionId`),
      actorKind,
      actorId,
      occurredAt: integer(receipt.occurredAt, `${receiptPath}.occurredAt`),
      reasonCode: stableId(receipt.reasonCode, `${receiptPath}.reasonCode`),
      chainId: stableId(receipt.chainId, `${receiptPath}.chainId`),
      triggerId: stableId(receipt.triggerId, `${receiptPath}.triggerId`),
      eventId: stableId(receipt.eventId, `${receiptPath}.eventId`),
    })
  })
  let replayStatus: PendingAbilitySagaStatus = 'pending'
  let invalidReplay = false
  for (const receipt of receipts) {
    const allowed = ALLOWED_PREVIOUS_STATUS[receipt.action] as readonly PendingAbilitySagaStatus[]
    if (!allowed.includes(replayStatus)) invalidReplay = true
    replayStatus = receipt.resultingStatus
  }
  if (receipts.length !== sagaVersion
    || invalidReplay
    || receipts.some((receipt, index) => receipt.sagaVersion !== index + 1)
    || new Set(receipts.map(receipt => receipt.commandId)).size !== receipts.length
    || receipts.some((receipt, index) => index > 0 && receipt.occurredAt < receipts[index - 1]!.occurredAt)
    || receipts.some(receipt => (
      receipt.resultingStatus !== statusForAction(receipt.action)
      || ((receipt.action === 'select') !== (receipt.optionId !== null))
      || receipt.chainId !== resolution.trigger.chainId
      || receipt.triggerId !== resolution.trigger.triggerId
      || receipt.eventId !== resolution.trigger.eventId
    ))) {
    fail('invalid-saga', `${path}.receipts`, 'must be unique, monotonic, and version-complete.')
  }
  let terminal: PendingAbilitySagaTerminal | null = null
  if (input.terminal !== null) {
    const terminalInput = record(input.terminal, `${path}.terminal`)
    exact(terminalInput, TERMINAL_FIELDS, `${path}.terminal`)
    if (typeof terminalInput.status !== 'string' || !TERMINAL_SET.has(terminalInput.status)) {
      fail('invalid-saga', `${path}.terminal.status`, 'is not terminal.')
    }
    terminal = Object.freeze({
      status: terminalInput.status as PendingAbilitySagaTerminalStatus,
      commandId: stableId(terminalInput.commandId, `${path}.terminal.commandId`),
      occurredAt: integer(terminalInput.occurredAt, `${path}.terminal.occurredAt`),
      reasonCode: stableId(terminalInput.reasonCode, `${path}.terminal.reasonCode`),
    })
  }
  const last = receipts[receipts.length - 1] ?? null
  if (updatedAt < resolution.updatedAt
    || status !== replayStatus
    || (last !== null && (updatedAt !== last.occurredAt || status !== last.resultingStatus))
    || (TERMINAL_SET.has(status)) !== (terminal !== null)
    || (terminal !== null && (terminal.status !== status || terminal.commandId !== last?.commandId))
    || (status === 'resuming' && selectedOptionId === null)
    || (selectedOptionId !== null && !resolution.window.options.some(option => option.id === selectedOptionId))) {
    fail('invalid-saga', path, 'status, terminal, selection, receipt, or timestamp facts disagree.')
  }
  return deepFreezeStrictJson({
    schemaVersion: PENDING_ABILITY_SAGA_SCHEMA_VERSION,
    resolution,
    sagaVersion,
    status,
    updatedAt,
    selectedOptionId,
    receipts: Object.freeze(receipts),
    terminal,
  })
}
