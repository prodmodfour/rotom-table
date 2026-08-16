import { parseUseItemCommand, type UseItemCommandV1 } from '#shared/itemAutomation/operations'
import { SLUG_RE } from '#shared/paths'
import {
  clearDurablePendingRecord,
  loadDurablePendingRecord,
  matchesDurablePendingStorageEvent,
  retainDurablePendingRecord,
} from '~/utils/inventoryRecoveryStorage'

export const GROUP_ITEM_PENDING_OPERATION_STORAGE_PREFIX = 'rotom-table:group-item:pending:v1:'

export interface PendingGroupItemOperationV1 {
  readonly schemaVersion: 1
  readonly groupSlug: string
  readonly profileId: string | null
  readonly command: UseItemCommandV1
}

const storageKey = (groupSlug: string): string => `${GROUP_ITEM_PENDING_OPERATION_STORAGE_PREFIX}${groupSlug}`

const randomHex32 = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    const value = globalThis.crypto.randomUUID().replace(/-/gu, '').toLowerCase()
    if (/^[0-9a-f]{32}$/u.test(value)) return value
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure browser randomness is required for shared item operation identity.')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export const createGroupItemOperationId = (): string => `group-sheet-item:v1:${randomHex32()}`

const parsePending = (value: unknown, expectedGroupSlug: string): PendingGroupItemOperationV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pending shared item operation must be an object.')
  }
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 4
    || !['schemaVersion', 'groupSlug', 'profileId', 'command'].every(field => Object.hasOwn(input, field))) {
    throw new Error('Pending shared item operation has an invalid shape.')
  }
  if (input.schemaVersion !== 1 || input.groupSlug !== expectedGroupSlug || !SLUG_RE.test(expectedGroupSlug)) {
    throw new Error('Pending shared item operation has invalid group authority.')
  }
  if (input.profileId !== null && typeof input.profileId !== 'string') {
    throw new Error('Pending shared item profile identity is invalid.')
  }
  const command = parseUseItemCommand(input.command)
  if (command.context !== 'sheet' || command.actorParticipantId !== null
    || command.actorSheet.kind !== 'trainer' || command.source.kind !== 'group'
    || command.source.slug !== expectedGroupSlug
    || !command.readSet.some(ref => ref.kind === 'group-inventory'
      && ref.id === expectedGroupSlug && ref.revision === command.source.expectedRevision)) {
    throw new Error('Pending shared item command does not match its exact group surface.')
  }
  return Object.freeze({
    schemaVersion: 1,
    groupSlug: expectedGroupSlug,
    profileId: input.profileId as string | null,
    command,
  })
}

const durableOptions = (groupSlug: string) => ({
  storageKey: storageKey(groupSlug),
  scope: { kind: 'group' as const, slug: groupSlug },
  flow: 'item-use' as const,
  parse: (value: unknown) => parsePending(value, groupSlug),
  operationId: (value: PendingGroupItemOperationV1) => value.command.operationId,
})

export const loadPendingGroupItemOperation = (groupSlug: string): PendingGroupItemOperationV1 | null => {
  if (typeof window === 'undefined' || !SLUG_RE.test(groupSlug)) return null
  return loadDurablePendingRecord(durableOptions(groupSlug))
}

export const retainPendingGroupItemOperation = (
  input: PendingGroupItemOperationV1,
): PendingGroupItemOperationV1 => {
  const parsed = parsePending(input, input.groupSlug)
  return retainDurablePendingRecord(parsed, durableOptions(parsed.groupSlug))
}

export const clearPendingGroupItemOperation = (groupSlug: string, operationId: string): void => {
  if (typeof window === 'undefined' || !SLUG_RE.test(groupSlug)) return
  clearDurablePendingRecord(operationId, durableOptions(groupSlug))
}

export const isPendingGroupItemStorageEvent = (event: StorageEvent, groupSlug: string): boolean => (
  SLUG_RE.test(groupSlug) && matchesDurablePendingStorageEvent(event, storageKey(groupSlug))
)
