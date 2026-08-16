import { SLUG_RE } from '#shared/paths'
import { parseEquipmentOperationCommand, type EquipmentOperationCommandV1 } from '#shared/itemAutomation/equipmentOperations'
import {
  clearDurablePendingRecord,
  loadDurablePendingRecord,
  matchesDurablePendingStorageEvent,
  retainDurablePendingRecord,
} from '~/utils/inventoryRecoveryStorage'

export const EQUIPMENT_PENDING_OPERATION_STORAGE_PREFIX = 'rotom-table:equipment:pending:v1:'

export interface PendingEquipmentOperation {
  readonly schemaVersion: 1
  readonly trainerSlug: string
  readonly profileId: string | null
  readonly command: EquipmentOperationCommandV1
}

const keyFor = (trainerSlug: string): string => `${EQUIPMENT_PENDING_OPERATION_STORAGE_PREFIX}${trainerSlug}`

const parsePending = (value: unknown, trainerSlug: string): PendingEquipmentOperation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pending equipment operation must be an object.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 4
    || !['schemaVersion', 'trainerSlug', 'profileId', 'command'].every(field => Object.hasOwn(input, field))
    || input.schemaVersion !== 1 || input.trainerSlug !== trainerSlug || !SLUG_RE.test(trainerSlug)
    || (input.profileId !== null && typeof input.profileId !== 'string')) {
    throw new Error('Pending equipment operation has invalid Trainer authority.')
  }
  const command = parseEquipmentOperationCommand(input.command)
  const refs = 'destination' in command
    ? [command.source, command.destination, command.swapReturnDestination]
    : [command.source]
  const touchesTrainer = refs.some(ref => ref && (
      ('containerKind' in ref && ref.containerKind === 'trainer' && ref.containerSlug === trainerSlug)
      || ('ownerKind' in ref && ref.ownerKind === 'trainer' && ref.ownerSlug === trainerSlug)
    ))
  if (!touchesTrainer || command.actorProfileId !== input.profileId) {
    throw new Error('Pending equipment operation does not match its Trainer surface.')
  }
  return Object.freeze({
    schemaVersion: 1,
    trainerSlug,
    profileId: input.profileId as string | null,
    command,
  })
}

const durableOptions = (trainerSlug: string) => ({
  storageKey: keyFor(trainerSlug),
  scope: { kind: 'trainer' as const, slug: trainerSlug },
  flow: 'equipment' as const,
  parse: (value: unknown) => parsePending(value, trainerSlug),
  operationId: (value: PendingEquipmentOperation) => value.command.operationId,
})

export const loadPendingEquipmentOperation = (trainerSlug: string): PendingEquipmentOperation | null => {
  if (typeof window === 'undefined' || !SLUG_RE.test(trainerSlug)) return null
  return loadDurablePendingRecord(durableOptions(trainerSlug))
}

export const retainPendingEquipmentOperation = (input: PendingEquipmentOperation): PendingEquipmentOperation => {
  const parsed = parsePending(input, input.trainerSlug)
  return retainDurablePendingRecord(parsed, durableOptions(parsed.trainerSlug))
}

export const clearPendingEquipmentOperation = (trainerSlug: string, operationId: string): void => {
  if (typeof window === 'undefined' || !SLUG_RE.test(trainerSlug)) return
  clearDurablePendingRecord(operationId, durableOptions(trainerSlug))
}

export const isPendingEquipmentStorageEvent = (event: StorageEvent, trainerSlug: string): boolean => (
  SLUG_RE.test(trainerSlug) && matchesDurablePendingStorageEvent(event, keyFor(trainerSlug))
)
