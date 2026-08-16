import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EquipmentOperationCommandV1 } from '#shared/itemAutomation/equipmentOperations'
import {
  EQUIPMENT_PENDING_OPERATION_STORAGE_PREFIX,
  clearPendingEquipmentOperation,
  loadPendingEquipmentOperation,
  retainPendingEquipmentOperation,
} from '~/utils/equipmentOperationStorage'
import { createEquipmentOperationId } from '~/utils/equipmentOperationClient'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const command = (): EquipmentOperationCommandV1 => ({
  schemaVersion: 1,
  operationId: `equipment-operation:v1:${'1'.repeat(32)}`,
  commandKind: 'equip',
  actorProfileId: 'profile_fixture',
  source: {
    kind: 'inventory', containerKind: 'trainer', containerSlug: 'ash', section: 'equipment',
    rowId: 'armor-row', sourceInstanceId: 'item-instance:trainer:ash:equipment:armor-row', expectedRevision: 4,
  },
  destination: {
    kind: 'equipment', ownerKind: 'trainer', ownerSlug: 'ash', slotIds: ['body'],
    expectedSheetRevision: 4, expectedEquipmentRevision: 0,
  },
  replacedInstanceId: null,
  swapReturnDestination: null,
  configuration: null,
})

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: new MemoryStorage() })
})
afterEach(() => vi.unstubAllGlobals())

describe('equipment exact-retry browser retention', () => {
  it('retains one exact command per Trainer until its terminal response', () => {
    const pending = retainPendingEquipmentOperation({
      schemaVersion: 1, trainerSlug: 'ash', profileId: 'profile_fixture', command: command(),
    })
    expect(loadPendingEquipmentOperation('ash')).toEqual(pending)
    clearPendingEquipmentOperation('ash', `equipment-operation:v1:${'f'.repeat(32)}`)
    expect(loadPendingEquipmentOperation('ash')).toEqual(pending)
    clearPendingEquipmentOperation('ash', command().operationId)
    expect(loadPendingEquipmentOperation('ash')).toBeNull()
  })

  it('discards corrupt cross-surface commands and creates secure bounded operation identities', () => {
    window.sessionStorage.setItem(`${EQUIPMENT_PENDING_OPERATION_STORAGE_PREFIX}ash`, JSON.stringify({
      schemaVersion: 1, trainerSlug: 'misty', profileId: 'profile_fixture', command: command(),
    }))
    expect(loadPendingEquipmentOperation('ash')).toBeNull()
    expect(window.sessionStorage.getItem(`${EQUIPMENT_PENDING_OPERATION_STORAGE_PREFIX}ash`)).toBeNull()
    expect(createEquipmentOperationId()).toMatch(/^equipment-operation:v1:[a-f0-9]{32}$/)
  })

  it('rejects a retained actor profile that drifts from the exact command', () => {
    expect(() => retainPendingEquipmentOperation({
      schemaVersion: 1, trainerSlug: 'ash', profileId: 'profile_other', command: command(),
    })).toThrow('does not match its Trainer surface')
  })
})
