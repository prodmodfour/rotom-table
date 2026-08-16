import {
  parseItemExplorationOperationCommand,
  type ItemExplorationOperationCommandV1,
} from '#shared/itemAutomation/exploration'
import {
  clearDurablePendingRecord,
  loadDurablePendingRecord,
  matchesDurablePendingStorageEvent,
  retainDurablePendingRecord,
} from '~/utils/inventoryRecoveryStorage'

export const ITEM_EXPLORATION_PENDING_STORAGE_PREFIX = 'rotom-table:item-exploration:pending:v1:'

export interface PendingItemExplorationOperation {
  readonly schemaVersion: 1
  readonly scopeKey: string
  readonly profileId: string | null
  readonly command: ItemExplorationOperationCommandV1
}

const safeScope = (value: string): boolean => /^[a-z]+:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
const key = (scopeKey: string): string => `${ITEM_EXPLORATION_PENDING_STORAGE_PREFIX}${scopeKey}`

const randomHex32 = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    const value = globalThis.crypto.randomUUID().replace(/-/g, '').toLowerCase()
    if (/^[0-9a-f]{32}$/.test(value)) return value
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure browser randomness is required for exploration operation identity.')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export const createItemExplorationOperationId = (): string => `item-exploration:v1:${randomHex32()}`

const parsePending = (value: unknown, expectedScopeKey: string): PendingItemExplorationOperation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pending exploration operation must be an object.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 4
    || !['schemaVersion', 'scopeKey', 'profileId', 'command'].every(field => Object.hasOwn(input, field))
    || input.schemaVersion !== 1 || input.scopeKey !== expectedScopeKey || !safeScope(expectedScopeKey)
    || (input.profileId !== null && typeof input.profileId !== 'string')) {
    throw new Error('Pending exploration operation has invalid authority.')
  }
  return Object.freeze({
    schemaVersion: 1,
    scopeKey: expectedScopeKey,
    profileId: input.profileId as string | null,
    command: parseItemExplorationOperationCommand(input.command),
  })
}

const trainerSlug = (scopeKey: string): string | null => {
  const match = /^trainer:([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(scopeKey)
  return match?.[1] ?? null
}
const durableOptions = (scopeKey: string) => {
  const slug = trainerSlug(scopeKey)
  if (!slug) throw new Error('Exploration recovery requires one Trainer inventory scope.')
  return {
    storageKey: key(scopeKey),
    scope: { kind: 'trainer' as const, slug },
    flow: 'exploration' as const,
    parse: (value: unknown) => parsePending(value, scopeKey),
    operationId: (value: PendingItemExplorationOperation) => value.command.operationId,
  }
}

export const loadPendingItemExplorationOperation = (scopeKey: string): PendingItemExplorationOperation | null => {
  if (typeof window === 'undefined' || !safeScope(scopeKey)) return null
  if (trainerSlug(scopeKey)) return loadDurablePendingRecord(durableOptions(scopeKey))
  const stored = window.sessionStorage.getItem(key(scopeKey))
  if (stored === null) return null
  try { return parsePending(JSON.parse(stored), scopeKey) }
  catch {
    window.sessionStorage.removeItem(key(scopeKey))
    return null
  }
}

export const retainPendingItemExplorationOperation = (
  input: PendingItemExplorationOperation,
): PendingItemExplorationOperation => {
  const parsed = parsePending(input, input.scopeKey)
  if (typeof window !== 'undefined' && !trainerSlug(parsed.scopeKey)) {
    window.sessionStorage.setItem(key(parsed.scopeKey), JSON.stringify(parsed))
    return parsed
  }
  return retainDurablePendingRecord(parsed, durableOptions(parsed.scopeKey))
}

export const clearPendingItemExplorationOperation = (scopeKey: string, operationId: string): void => {
  if (typeof window === 'undefined' || !safeScope(scopeKey)) return
  if (!trainerSlug(scopeKey)) {
    const pending = loadPendingItemExplorationOperation(scopeKey)
    if (pending?.command.operationId === operationId) window.sessionStorage.removeItem(key(scopeKey))
    return
  }
  clearDurablePendingRecord(operationId, durableOptions(scopeKey))
}

export const isPendingItemExplorationStorageEvent = (event: StorageEvent, scopeKey: string): boolean => (
  safeScope(scopeKey) && Boolean(trainerSlug(scopeKey))
  && matchesDurablePendingStorageEvent(event, key(scopeKey))
)
