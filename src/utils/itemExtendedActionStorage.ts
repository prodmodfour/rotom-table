import {
  parseItemExtendedActionCommand,
  type ItemExtendedActionCommandV1,
} from '#shared/itemAutomation/extendedActions'
import { SLUG_RE } from '#shared/paths'
import {
  clearDurablePendingRecord,
  loadDurablePendingRecord,
  matchesDurablePendingStorageEvent,
  retainDurablePendingRecord,
} from '~/utils/inventoryRecoveryStorage'

export const ITEM_EXTENDED_ACTION_PENDING_STORAGE_PREFIX = 'rotom-table:item-extended-action:pending:v1:'

export interface PendingItemExtendedAction {
  readonly schemaVersion: 1
  readonly trainerSlug: string
  readonly profileId: string | null
  readonly command: ItemExtendedActionCommandV1
}

const key = (trainerSlug: string): string => `${ITEM_EXTENDED_ACTION_PENDING_STORAGE_PREFIX}${trainerSlug}`

const randomHex32 = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    const value = globalThis.crypto.randomUUID().replace(/-/g, '').toLowerCase()
    if (/^[0-9a-f]{32}$/.test(value)) return value
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure browser randomness is required for Extended Action identity.')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export const createItemExtendedActionId = (): string => `item-activity:v1:${randomHex32()}`
export const createItemExtendedActionOperationId = (): string => `item-activity-operation:v1:${randomHex32()}`

const parsePending = (value: unknown, expectedTrainerSlug: string): PendingItemExtendedAction => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pending Extended Action must be an object.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 4
    || !['schemaVersion', 'trainerSlug', 'profileId', 'command'].every(field => Object.hasOwn(input, field))
    || input.schemaVersion !== 1 || input.trainerSlug !== expectedTrainerSlug || !SLUG_RE.test(expectedTrainerSlug)
    || (input.profileId !== null && typeof input.profileId !== 'string')) {
    throw new Error('Pending Extended Action has invalid authority.')
  }
  return Object.freeze({
    schemaVersion: 1,
    trainerSlug: expectedTrainerSlug,
    profileId: input.profileId as string | null,
    command: parseItemExtendedActionCommand(input.command),
  })
}

const durableOptions = (trainerSlug: string) => ({
  storageKey: key(trainerSlug),
  scope: { kind: 'trainer' as const, slug: trainerSlug },
  flow: 'extended-action' as const,
  parse: (value: unknown) => parsePending(value, trainerSlug),
  operationId: (value: PendingItemExtendedAction) => value.command.operationId,
})

export const loadPendingItemExtendedAction = (trainerSlug: string): PendingItemExtendedAction | null => {
  if (typeof window === 'undefined' || !SLUG_RE.test(trainerSlug)) return null
  return loadDurablePendingRecord(durableOptions(trainerSlug))
}

export const retainPendingItemExtendedAction = (input: PendingItemExtendedAction): PendingItemExtendedAction => {
  const parsed = parsePending(input, input.trainerSlug)
  return retainDurablePendingRecord(parsed, durableOptions(parsed.trainerSlug))
}

export const clearPendingItemExtendedAction = (trainerSlug: string, operationId: string): void => {
  if (typeof window === 'undefined' || !SLUG_RE.test(trainerSlug)) return
  clearDurablePendingRecord(operationId, durableOptions(trainerSlug))
}

export const isPendingItemExtendedActionStorageEvent = (event: StorageEvent, trainerSlug: string): boolean => (
  SLUG_RE.test(trainerSlug) && matchesDurablePendingStorageEvent(event, key(trainerSlug))
)
