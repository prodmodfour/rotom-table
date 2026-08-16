import {
  parseEncounterSettlementCommitCommand,
  type EncounterSettlementCommitCommand,
} from '#shared/encounterSettlement/atomicCommit'

export const ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION = 1 as const
export const ENCOUNTER_SETTLEMENT_PENDING_KEY_PREFIX = 'rotom-table:encounter-settlement:pending:v1:' as const
export const ENCOUNTER_SETTLEMENT_PENDING_LOCK_KEY_PREFIX = 'rotom-table:encounter-settlement:lock:v1:' as const

export interface PendingEncounterSettlementOperation {
  readonly schemaVersion: typeof ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION
  readonly encounterId: string
  readonly command: EncounterSettlementCommitCommand
  readonly createdAt: number
}

interface PendingEncounterSettlementLock {
  readonly schemaVersion: 1
  readonly encounterId: string
  readonly operationId: string
  readonly storageKey: string
}

export class EncounterSettlementRecoveryConflictError extends Error {
  constructor() {
    super('Another tab already retained a different Finish Encounter command. Resolve it before sending another settlement.')
    this.name = 'EncounterSettlementRecoveryConflictError'
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/
const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort()
  const fields = [...expected].sort()
  return keys.length === fields.length && keys.every((key, index) => key === fields[index])
}
const record = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
)

type SettlementStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const pendingEncounterSettlementStorageKey = (encounterId: string): string => {
  if (!ID.test(encounterId)) throw new Error('Pending encounter settlement encounter identity is invalid.')
  return `${ENCOUNTER_SETTLEMENT_PENDING_KEY_PREFIX}${encodeURIComponent(encounterId)}`
}

export const pendingEncounterSettlementLockStorageKey = (encounterId: string): string => {
  if (!ID.test(encounterId)) throw new Error('Pending encounter settlement encounter identity is invalid.')
  return `${ENCOUNTER_SETTLEMENT_PENDING_LOCK_KEY_PREFIX}${encodeURIComponent(encounterId)}`
}

export const parsePendingEncounterSettlementOperation = (value: unknown): PendingEncounterSettlementOperation => {
  const input = record(value)
  if (!input || !exactKeys(input, ['schemaVersion', 'encounterId', 'command', 'createdAt'])
    || input.schemaVersion !== ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION
    || typeof input.encounterId !== 'string' || !ID.test(input.encounterId)
    || !Number.isSafeInteger(input.createdAt) || Number(input.createdAt) < 0) {
    throw new Error('Pending encounter settlement operation is invalid.')
  }
  return Object.freeze({
    schemaVersion: ENCOUNTER_SETTLEMENT_PENDING_SCHEMA_VERSION,
    encounterId: input.encounterId,
    command: parseEncounterSettlementCommitCommand(input.command),
    createdAt: Number(input.createdAt),
  })
}

const parseLock = (value: unknown, encounterId: string): PendingEncounterSettlementLock => {
  const input = record(value)
  const storageKey = pendingEncounterSettlementStorageKey(encounterId)
  if (!input || !exactKeys(input, ['schemaVersion', 'encounterId', 'operationId', 'storageKey'])
    || input.schemaVersion !== 1 || input.encounterId !== encounterId
    || typeof input.operationId !== 'string' || !ID.test(input.operationId)
    || input.storageKey !== storageKey) {
    throw new Error('Pending encounter settlement lock is invalid.')
  }
  return Object.freeze({
    schemaVersion: 1,
    encounterId,
    operationId: input.operationId,
    storageKey,
  })
}

const readLock = (storage: SettlementStorage, encounterId: string): PendingEncounterSettlementLock | null => {
  const key = pendingEncounterSettlementLockStorageKey(encounterId)
  const serialized = storage.getItem(key)
  if (!serialized) return null
  try { return parseLock(JSON.parse(serialized) as unknown, encounterId) }
  catch {
    storage.removeItem(key)
    return null
  }
}

const writeLock = (
  storage: SettlementStorage,
  pending: PendingEncounterSettlementOperation,
): void => {
  const storageKey = pendingEncounterSettlementStorageKey(pending.encounterId)
  const lockKey = pendingEncounterSettlementLockStorageKey(pending.encounterId)
  const current = readLock(storage, pending.encounterId)
  if (current && current.operationId !== pending.command.operationId) {
    if (storage.getItem(current.storageKey) === null) storage.removeItem(lockKey)
    else throw new EncounterSettlementRecoveryConflictError()
  }
  const lock = Object.freeze({
    schemaVersion: 1 as const,
    encounterId: pending.encounterId,
    operationId: pending.command.operationId,
    storageKey,
  })
  storage.setItem(lockKey, JSON.stringify(lock))
  const confirmed = readLock(storage, pending.encounterId)
  if (!confirmed || confirmed.operationId !== pending.command.operationId) {
    throw new EncounterSettlementRecoveryConflictError()
  }
}

const samePendingCommand = (
  left: PendingEncounterSettlementOperation,
  right: PendingEncounterSettlementOperation,
): boolean => left.encounterId === right.encounterId
  && JSON.stringify(left.command) === JSON.stringify(right.command)

export const readPendingEncounterSettlementOperation = (
  storage: SettlementStorage,
  encounterId: string,
): PendingEncounterSettlementOperation | null => {
  const key = pendingEncounterSettlementStorageKey(encounterId)
  const serialized = storage.getItem(key)
  if (!serialized) {
    const lock = readLock(storage, encounterId)
    if (lock?.storageKey === key) storage.removeItem(pendingEncounterSettlementLockStorageKey(encounterId))
    return null
  }
  let pending: PendingEncounterSettlementOperation
  try { pending = parsePendingEncounterSettlementOperation(JSON.parse(serialized) as unknown) }
  catch {
    storage.removeItem(key)
    storage.removeItem(pendingEncounterSettlementLockStorageKey(encounterId))
    return null
  }
  if (pending.encounterId !== encounterId) {
    storage.removeItem(key)
    storage.removeItem(pendingEncounterSettlementLockStorageKey(encounterId))
    return null
  }
  const lock = readLock(storage, encounterId)
  if (!lock || lock.operationId === pending.command.operationId) writeLock(storage, pending)
  return pending
}

export const writePendingEncounterSettlementOperation = (
  storage: SettlementStorage,
  input: PendingEncounterSettlementOperation,
): PendingEncounterSettlementOperation => {
  const parsed = parsePendingEncounterSettlementOperation(input)
  const existing = readPendingEncounterSettlementOperation(storage, parsed.encounterId)
  if (existing && !samePendingCommand(existing, parsed)) throw new EncounterSettlementRecoveryConflictError()
  writeLock(storage, parsed)
  storage.setItem(pendingEncounterSettlementStorageKey(parsed.encounterId), JSON.stringify(parsed))
  const confirmed = readPendingEncounterSettlementOperation(storage, parsed.encounterId)
  if (!confirmed || !samePendingCommand(confirmed, parsed)) throw new EncounterSettlementRecoveryConflictError()
  return parsed
}

export const clearPendingEncounterSettlementOperation = (
  storage: SettlementStorage,
  pending: PendingEncounterSettlementOperation,
): boolean => {
  const current = readPendingEncounterSettlementOperation(storage, pending.encounterId)
  if (!current || !samePendingCommand(current, pending)) return false
  storage.removeItem(pendingEncounterSettlementStorageKey(pending.encounterId))
  const lock = readLock(storage, pending.encounterId)
  if (lock?.operationId === pending.command.operationId) {
    storage.removeItem(pendingEncounterSettlementLockStorageKey(pending.encounterId))
  }
  return true
}

export const removePendingEncounterSettlementOperation = (
  storage: Pick<Storage, 'removeItem'>,
  encounterId: string,
): void => {
  storage.removeItem(pendingEncounterSettlementStorageKey(encounterId))
  storage.removeItem(pendingEncounterSettlementLockStorageKey(encounterId))
}
