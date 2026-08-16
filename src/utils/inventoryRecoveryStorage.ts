import { SLUG_RE } from '#shared/paths'

export const INVENTORY_RECOVERY_LOCK_STORAGE_PREFIX = 'rotom-table:inventory-recovery-lock:v1:'

export type InventoryRecoveryScopeKind = 'trainer' | 'group'
export type InventoryRecoveryFlow =
  | 'inventory-action'
  | 'item-use'
  | 'equipment'
  | 'extended-action'
  | 'exploration'
  | 'guided-adjudication'

export interface InventoryRecoveryScope {
  readonly kind: InventoryRecoveryScopeKind
  readonly slug: string
}

interface InventoryRecoveryLockV1 {
  readonly schemaVersion: 1
  readonly scopeKind: InventoryRecoveryScopeKind
  readonly scopeSlug: string
  readonly flow: InventoryRecoveryFlow
  readonly operationId: string
  readonly storageKey: string
}

export class InventoryRecoveryConflictError extends Error {
  constructor() {
    super('Another exact inventory command is already awaiting recovery for this inventory. Resolve it before starting a new action.')
    this.name = 'InventoryRecoveryConflictError'
  }
}

interface DurablePendingRecordOptions<T> {
  readonly storageKey: string
  readonly scope: InventoryRecoveryScope
  readonly flow: InventoryRecoveryFlow
  readonly parse: (value: unknown) => T
  readonly operationId: (value: T) => string
}

const validScope = (scope: InventoryRecoveryScope): boolean => (
  (scope.kind === 'trainer' || scope.kind === 'group') && SLUG_RE.test(scope.slug)
)
const lockKey = (scope: InventoryRecoveryScope): string => (
  `${INVENTORY_RECOVERY_LOCK_STORAGE_PREFIX}${scope.kind}:${scope.slug}`
)
const sameScope = (lock: InventoryRecoveryLockV1, scope: InventoryRecoveryScope): boolean => (
  lock.scopeKind === scope.kind && lock.scopeSlug === scope.slug
)
const durableStorage = (): Storage => window.localStorage ?? window.sessionStorage
const parseLock = (value: unknown, scope: InventoryRecoveryScope): InventoryRecoveryLockV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Inventory recovery lock must be an object.')
  const input = value as Record<string, unknown>
  const fields = ['schemaVersion', 'scopeKind', 'scopeSlug', 'flow', 'operationId', 'storageKey']
  const flows: readonly InventoryRecoveryFlow[] = [
    'inventory-action', 'item-use', 'equipment', 'extended-action', 'exploration', 'guided-adjudication',
  ]
  if (Object.keys(input).length !== fields.length || fields.some(field => !Object.hasOwn(input, field))
    || input.schemaVersion !== 1 || !validScope(scope)
    || input.scopeKind !== scope.kind || input.scopeSlug !== scope.slug
    || !flows.includes(input.flow as InventoryRecoveryFlow)
    || typeof input.operationId !== 'string' || input.operationId.length < 8 || input.operationId.length > 160
    || typeof input.storageKey !== 'string' || !input.storageKey.startsWith('rotom-table:')
    || input.storageKey.length > 256 || /\p{C}/u.test(input.storageKey)) {
    throw new Error('Inventory recovery lock has invalid scope authority.')
  }
  return Object.freeze({
    schemaVersion: 1,
    scopeKind: input.scopeKind as InventoryRecoveryScopeKind,
    scopeSlug: input.scopeSlug as string,
    flow: input.flow as InventoryRecoveryFlow,
    operationId: input.operationId,
    storageKey: input.storageKey,
  })
}
const parseStored = <T>(
  storage: Storage,
  key: string,
  parse: (value: unknown) => T,
): T | null => {
  const raw = storage.getItem(key)
  if (raw === null) return null
  try { return parse(JSON.parse(raw)) }
  catch {
    storage.removeItem(key)
    return null
  }
}
const readLock = (scope: InventoryRecoveryScope): InventoryRecoveryLockV1 | null => {
  if (typeof window === 'undefined' || !validScope(scope)) return null
  return parseStored(durableStorage(), lockKey(scope), value => parseLock(value, scope))
}
const writeLock = (
  scope: InventoryRecoveryScope,
  flow: InventoryRecoveryFlow,
  operationId: string,
  storageKey: string,
): void => {
  const current = readLock(scope)
  if (current && current.operationId !== operationId) {
    if (durableStorage().getItem(current.storageKey) === null) durableStorage().removeItem(lockKey(scope))
    else throw new InventoryRecoveryConflictError()
  }
  const lock: InventoryRecoveryLockV1 = Object.freeze({
    schemaVersion: 1,
    scopeKind: scope.kind,
    scopeSlug: scope.slug,
    flow,
    operationId,
    storageKey,
  })
  durableStorage().setItem(lockKey(scope), JSON.stringify(lock))
  const confirmed = readLock(scope)
  if (!confirmed || confirmed.operationId !== operationId || !sameScope(confirmed, scope)) {
    throw new InventoryRecoveryConflictError()
  }
}

export const loadDurablePendingRecord = <T>(options: DurablePendingRecordOptions<T>): T | null => {
  if (typeof window === 'undefined' || !validScope(options.scope)) return null
  const local = parseStored(durableStorage(), options.storageKey, options.parse)
  const session = parseStored(window.sessionStorage, options.storageKey, options.parse)
  const pending = local ?? session
  if (!pending) {
    const currentLock = readLock(options.scope)
    if (currentLock?.storageKey === options.storageKey) durableStorage().removeItem(lockKey(options.scope))
    return null
  }
  const serialized = JSON.stringify(pending)
  if (!local) durableStorage().setItem(options.storageKey, serialized)
  if (!session || JSON.stringify(session) !== serialized) window.sessionStorage.setItem(options.storageKey, serialized)
  const operationId = options.operationId(pending)
  const currentLock = readLock(options.scope)
  if (!currentLock || currentLock.operationId === operationId) {
    writeLock(options.scope, options.flow, operationId, options.storageKey)
  }
  return pending
}

export const retainDurablePendingRecord = <T>(
  input: T,
  options: DurablePendingRecordOptions<T>,
): T => {
  if (typeof window === 'undefined') return input
  if (!validScope(options.scope)) throw new Error('Inventory recovery scope is invalid.')
  const operationId = options.operationId(input)
  const existing = loadDurablePendingRecord(options)
  if (existing && options.operationId(existing) !== operationId) throw new InventoryRecoveryConflictError()
  writeLock(options.scope, options.flow, operationId, options.storageKey)
  const serialized = JSON.stringify(input)
  durableStorage().setItem(options.storageKey, serialized)
  window.sessionStorage.setItem(options.storageKey, serialized)
  const confirmed = parseStored(durableStorage(), options.storageKey, options.parse)
  if (!confirmed || options.operationId(confirmed) !== operationId) throw new InventoryRecoveryConflictError()
  return input
}

export const clearDurablePendingRecord = <T>(
  operationId: string,
  options: DurablePendingRecordOptions<T>,
): void => {
  if (typeof window === 'undefined' || !validScope(options.scope)) return
  const local = parseStored(durableStorage(), options.storageKey, options.parse)
  const session = parseStored(window.sessionStorage, options.storageKey, options.parse)
  if (local && options.operationId(local) === operationId) durableStorage().removeItem(options.storageKey)
  if (session && options.operationId(session) === operationId) window.sessionStorage.removeItem(options.storageKey)
  const currentLock = readLock(options.scope)
  if (currentLock?.operationId === operationId) durableStorage().removeItem(lockKey(options.scope))
}

export const matchesDurablePendingStorageEvent = (event: StorageEvent, storageKey: string): boolean => {
  const matches = event.key === storageKey
    && (event.storageArea === null || event.storageArea === window.localStorage)
  // sessionStorage is tab-local. When another tab definitively clears the
  // durable command, discard this tab's stale mirror before its coordinator
  // reloads; otherwise the mirror could resurrect an already accepted command.
  if (matches && event.newValue === null) window.sessionStorage.removeItem(storageKey)
  return matches
}

export const clearInventoryRecoveryStorageForTests = (): void => {
  if (typeof window === 'undefined') return
  const storage = durableStorage()
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index)
    if (key?.startsWith('rotom-table:') && (key.includes(':pending:v1:') || key.startsWith(INVENTORY_RECOVERY_LOCK_STORAGE_PREFIX))) {
      storage.removeItem(key)
    }
  }
}
