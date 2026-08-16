import { parseInventoryActionDeclaration, type InventoryActionDeclarationV1 } from '#shared/itemAutomation/inventoryActions'
import { SLUG_RE } from '#shared/paths'
import {
  clearDurablePendingRecord,
  loadDurablePendingRecord,
  matchesDurablePendingStorageEvent,
  retainDurablePendingRecord,
} from '~/utils/inventoryRecoveryStorage'

export const INVENTORY_ACTION_PENDING_STORAGE_PREFIX = 'rotom-table:inventory-action:pending:v1:'

export interface PendingInventoryActionOperationV1 {
  readonly schemaVersion: 1
  readonly trainerSlug: string
  readonly profileId: string | null
  readonly declaration: InventoryActionDeclarationV1
}

const keyFor = (trainerSlug: string): string => `${INVENTORY_ACTION_PENDING_STORAGE_PREFIX}${trainerSlug}`

const parsePending = (value: unknown, trainerSlug: string): PendingInventoryActionOperationV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pending inventory action must be an object.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 4
    || !['schemaVersion', 'trainerSlug', 'profileId', 'declaration'].every(field => Object.hasOwn(input, field))
    || input.schemaVersion !== 1 || input.trainerSlug !== trainerSlug || !SLUG_RE.test(trainerSlug)
    || (input.profileId !== null && typeof input.profileId !== 'string')) {
    throw new Error('Pending inventory action has invalid Trainer authority.')
  }
  const declaration = parseInventoryActionDeclaration(input.declaration)
  if (!['equip', 'give', 'transfer', 'split', 'merge', 'discard'].includes(declaration.action)) {
    throw new Error('Pending inventory action does not use a supported owning handoff.')
  }
  return Object.freeze({
    schemaVersion: 1,
    trainerSlug,
    profileId: input.profileId as string | null,
    declaration,
  })
}

const durableOptions = (trainerSlug: string) => ({
  storageKey: keyFor(trainerSlug),
  scope: { kind: 'trainer' as const, slug: trainerSlug },
  flow: 'inventory-action' as const,
  parse: (value: unknown) => parsePending(value, trainerSlug),
  operationId: (value: PendingInventoryActionOperationV1) => value.declaration.operationId,
})

export const loadPendingInventoryActionOperation = (trainerSlug: string): PendingInventoryActionOperationV1 | null => {
  if (typeof window === 'undefined' || !SLUG_RE.test(trainerSlug)) return null
  return loadDurablePendingRecord(durableOptions(trainerSlug))
}

export const retainPendingInventoryActionOperation = (
  input: PendingInventoryActionOperationV1,
): PendingInventoryActionOperationV1 => {
  const parsed = parsePending(input, input.trainerSlug)
  return retainDurablePendingRecord(parsed, durableOptions(parsed.trainerSlug))
}

export const clearPendingInventoryActionOperation = (trainerSlug: string, operationId: string): void => {
  if (typeof window === 'undefined' || !SLUG_RE.test(trainerSlug)) return
  clearDurablePendingRecord(operationId, durableOptions(trainerSlug))
}

export const isPendingInventoryActionStorageEvent = (event: StorageEvent, trainerSlug: string): boolean => (
  SLUG_RE.test(trainerSlug) && matchesDurablePendingStorageEvent(event, keyFor(trainerSlug))
)
