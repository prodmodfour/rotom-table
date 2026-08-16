import { SLUG_RE } from '#shared/paths'
import { parseUseItemCommand, type UseItemCommandV1 } from '#shared/itemAutomation/operations'
import {
  clearDurablePendingRecord,
  loadDurablePendingRecord,
  matchesDurablePendingStorageEvent,
  retainDurablePendingRecord,
} from '~/utils/inventoryRecoveryStorage'

export const SHEET_ITEM_PENDING_OPERATION_STORAGE_PREFIX = 'rotom-table:sheet-item:pending:v1:'

export interface PendingSheetItemOperation {
  readonly schemaVersion: 1
  readonly trainerSlug: string
  readonly profileId: string | null
  readonly command: UseItemCommandV1
}

const storageKey = (trainerSlug: string): string => `${SHEET_ITEM_PENDING_OPERATION_STORAGE_PREFIX}${trainerSlug}`

const randomHex32 = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    const value = globalThis.crypto.randomUUID().replace(/-/g, '').toLowerCase()
    if (/^[0-9a-f]{32}$/.test(value)) return value
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('Secure browser randomness is required for item operation identity.')
  }
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
}

export const createSheetItemOperationId = (): string => `sheet-item:v1:${randomHex32()}`

const parsePending = (value: unknown, expectedTrainerSlug: string): PendingSheetItemOperation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pending sheet item operation must be an object.')
  const input = value as Record<string, unknown>
  const fields = Object.keys(input)
  if (fields.length !== 4 || !['schemaVersion', 'trainerSlug', 'profileId', 'command'].every(field => Object.hasOwn(input, field))) {
    throw new Error('Pending sheet item operation has an invalid shape.')
  }
  if (input.schemaVersion !== 1 || input.trainerSlug !== expectedTrainerSlug || !SLUG_RE.test(expectedTrainerSlug)) {
    throw new Error('Pending sheet item operation has invalid Trainer authority.')
  }
  if (input.profileId !== null && typeof input.profileId !== 'string') throw new Error('Pending sheet item profile identity is invalid.')
  const command = parseUseItemCommand(input.command)
  if (command.context !== 'sheet' || command.actorSheet.kind !== 'trainer'
    || command.actorSheet.slug !== expectedTrainerSlug || command.actorParticipantId !== null) {
    throw new Error('Pending sheet item command does not match its Trainer surface.')
  }
  return Object.freeze({
    schemaVersion: 1,
    trainerSlug: expectedTrainerSlug,
    profileId: input.profileId as string | null,
    command,
  })
}

const durableOptions = (trainerSlug: string) => ({
  storageKey: storageKey(trainerSlug),
  scope: { kind: 'trainer' as const, slug: trainerSlug },
  flow: 'item-use' as const,
  parse: (value: unknown) => parsePending(value, trainerSlug),
  operationId: (value: PendingSheetItemOperation) => value.command.operationId,
})

export const loadPendingSheetItemOperation = (trainerSlug: string): PendingSheetItemOperation | null => {
  if (typeof window === 'undefined' || !SLUG_RE.test(trainerSlug)) return null
  return loadDurablePendingRecord(durableOptions(trainerSlug))
}

export const retainPendingSheetItemOperation = (input: PendingSheetItemOperation): PendingSheetItemOperation => {
  const parsed = parsePending(input, input.trainerSlug)
  return retainDurablePendingRecord(parsed, durableOptions(parsed.trainerSlug))
}

export const clearPendingSheetItemOperation = (trainerSlug: string, operationId: string): void => {
  if (typeof window === 'undefined' || !SLUG_RE.test(trainerSlug)) return
  clearDurablePendingRecord(operationId, durableOptions(trainerSlug))
}

export const isPendingSheetItemStorageEvent = (event: StorageEvent, trainerSlug: string): boolean => (
  SLUG_RE.test(trainerSlug) && matchesDurablePendingStorageEvent(event, storageKey(trainerSlug))
)
