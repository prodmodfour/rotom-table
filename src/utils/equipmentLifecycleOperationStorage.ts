import { SLUG_RE } from '#shared/paths'
import {
  parseEquipmentOperationCommand,
  type EquipmentActivityOperationCommandV1,
  type EquipmentDurabilityOperationCommandV1,
} from '#shared/itemAutomation/equipmentOperations'
import type { EquipmentOwnerKind } from '#shared/itemAutomation/equipment'

export const EQUIPMENT_PENDING_LIFECYCLE_STORAGE_PREFIX = 'rotom-table:equipment:lifecycle:pending:v1:'
export type EquipmentLifecycleOperationCommand =
  | EquipmentActivityOperationCommandV1
  | EquipmentDurabilityOperationCommandV1

export interface PendingEquipmentLifecycleOperation {
  readonly schemaVersion: 1
  readonly ownerKind: EquipmentOwnerKind
  readonly ownerSlug: string
  readonly command: EquipmentLifecycleOperationCommand
}

const keyFor = (ownerKind: EquipmentOwnerKind, ownerSlug: string): string =>
  `${EQUIPMENT_PENDING_LIFECYCLE_STORAGE_PREFIX}${ownerKind}:${ownerSlug}`

const parsePending = (
  value: unknown,
  ownerKind: EquipmentOwnerKind,
  ownerSlug: string,
): PendingEquipmentLifecycleOperation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Pending lifecycle operation must be an object.')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 4
    || !['schemaVersion', 'ownerKind', 'ownerSlug', 'command'].every(field => Object.hasOwn(input, field))
    || input.schemaVersion !== 1 || input.ownerKind !== ownerKind || input.ownerSlug !== ownerSlug
    || !SLUG_RE.test(ownerSlug)) throw new Error('Pending lifecycle operation has invalid owner authority.')
  const command = parseEquipmentOperationCommand(input.command)
  if (!['suppress', 'deactivate', 'break', 'restore', 'repair', 'damage', 'restore-durability'].includes(command.commandKind)
    || command.source.kind !== 'equipment'
    || command.source.ownerKind !== ownerKind
    || command.source.ownerSlug !== ownerSlug
    || command.actorProfileId !== null) {
    throw new Error('Pending lifecycle operation does not match its equipment owner.')
  }
  return Object.freeze({
    schemaVersion: 1,
    ownerKind,
    ownerSlug,
    command: command as EquipmentLifecycleOperationCommand,
  })
}

export const loadPendingEquipmentLifecycleOperation = (
  ownerKind: EquipmentOwnerKind,
  ownerSlug: string,
): PendingEquipmentLifecycleOperation | null => {
  if (typeof window === 'undefined' || !SLUG_RE.test(ownerSlug)) return null
  const key = keyFor(ownerKind, ownerSlug)
  const raw = window.sessionStorage.getItem(key)
  if (raw === null) return null
  try { return parsePending(JSON.parse(raw), ownerKind, ownerSlug) }
  catch {
    window.sessionStorage.removeItem(key)
    return null
  }
}

export const retainPendingEquipmentLifecycleOperation = (
  input: PendingEquipmentLifecycleOperation,
): PendingEquipmentLifecycleOperation => {
  const parsed = parsePending(input, input.ownerKind, input.ownerSlug)
  if (typeof window !== 'undefined') {
    window.sessionStorage.setItem(keyFor(parsed.ownerKind, parsed.ownerSlug), JSON.stringify(parsed))
  }
  return parsed
}

export const clearPendingEquipmentLifecycleOperation = (
  ownerKind: EquipmentOwnerKind,
  ownerSlug: string,
  operationId: string,
): void => {
  if (typeof window === 'undefined') return
  const pending = loadPendingEquipmentLifecycleOperation(ownerKind, ownerSlug)
  if (pending?.command.operationId === operationId) {
    window.sessionStorage.removeItem(keyFor(ownerKind, ownerSlug))
  }
}
