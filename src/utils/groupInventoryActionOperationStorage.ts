import { parseInventoryActionDeclaration, type InventoryActionDeclarationV1 } from '#shared/itemAutomation/inventoryActions'
import { SLUG_RE } from '#shared/paths'
import {
  clearDurablePendingRecord,
  loadDurablePendingRecord,
  matchesDurablePendingStorageEvent,
  retainDurablePendingRecord,
} from '~/utils/inventoryRecoveryStorage'

export const GROUP_INVENTORY_ACTION_PENDING_STORAGE_PREFIX = 'rotom-table:group-inventory-action:pending:v1:'

export interface PendingGroupInventoryActionOperationV1 {
  readonly schemaVersion: 1
  readonly groupSlug: string
  readonly profileId: string | null
  readonly declaration: InventoryActionDeclarationV1
}

const keyFor = (groupSlug: string): string => `${GROUP_INVENTORY_ACTION_PENDING_STORAGE_PREFIX}${groupSlug}`

const parsePending = (value: unknown, groupSlug: string): PendingGroupInventoryActionOperationV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pending group inventory action must be an object.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 4
    || !['schemaVersion', 'groupSlug', 'profileId', 'declaration'].every(field => Object.hasOwn(input, field))
    || input.schemaVersion !== 1 || input.groupSlug !== groupSlug || !SLUG_RE.test(groupSlug)
    || (input.profileId !== null && typeof input.profileId !== 'string')) {
    throw new Error('Pending group inventory action has invalid scope authority.')
  }
  const declaration = parseInventoryActionDeclaration(input.declaration)
  if (!['transfer', 'split', 'merge', 'discard'].includes(declaration.action)) {
    throw new Error('Pending group inventory action does not use a supported inventory handoff.')
  }
  return Object.freeze({
    schemaVersion: 1,
    groupSlug,
    profileId: input.profileId as string | null,
    declaration,
  })
}

const durableOptions = (groupSlug: string) => ({
  storageKey: keyFor(groupSlug),
  scope: { kind: 'group' as const, slug: groupSlug },
  flow: 'inventory-action' as const,
  parse: (value: unknown) => parsePending(value, groupSlug),
  operationId: (value: PendingGroupInventoryActionOperationV1) => value.declaration.operationId,
})

export const loadPendingGroupInventoryActionOperation = (
  groupSlug: string,
): PendingGroupInventoryActionOperationV1 | null => {
  if (typeof window === 'undefined' || !SLUG_RE.test(groupSlug)) return null
  return loadDurablePendingRecord(durableOptions(groupSlug))
}

export const retainPendingGroupInventoryActionOperation = (
  input: PendingGroupInventoryActionOperationV1,
): PendingGroupInventoryActionOperationV1 => {
  const parsed = parsePending(input, input.groupSlug)
  return retainDurablePendingRecord(parsed, durableOptions(parsed.groupSlug))
}

export const clearPendingGroupInventoryActionOperation = (groupSlug: string, operationId: string): void => {
  if (typeof window === 'undefined' || !SLUG_RE.test(groupSlug)) return
  clearDurablePendingRecord(operationId, durableOptions(groupSlug))
}

export const isPendingGroupInventoryActionStorageEvent = (event: StorageEvent, groupSlug: string): boolean => (
  SLUG_RE.test(groupSlug) && matchesDurablePendingStorageEvent(event, keyFor(groupSlug))
)
