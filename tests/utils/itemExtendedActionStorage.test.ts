import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ITEM_EXTENDED_ACTION_PENDING_STORAGE_PREFIX,
  clearPendingItemExtendedAction,
  createItemExtendedActionId,
  createItemExtendedActionOperationId,
  loadPendingItemExtendedAction,
  retainPendingItemExtendedAction,
} from '~/utils/itemExtendedActionStorage'
import type { ItemExtendedActionCommandV1 } from '#shared/itemAutomation/extendedActions'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const command = (): ItemExtendedActionCommandV1 => ({
  schemaVersion: 1,
  kind: 'complete',
  operationId: 'item-activity-operation:v1:11111111111111111111111111111111',
  activityId: 'item-activity:v1:22222222222222222222222222222222',
  expectedRevision: 0,
})

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: new MemoryStorage() })
})
afterEach(() => vi.unstubAllGlobals())

describe('item Extended Action exact-retry browser retention', () => {
  it('retains one strict lifecycle command per Trainer until its terminal response', () => {
    const pending = retainPendingItemExtendedAction({
      schemaVersion: 1, trainerSlug: 'medic', profileId: 'profile_medic01', command: command(),
    })
    expect(loadPendingItemExtendedAction('medic')).toEqual(pending)
    clearPendingItemExtendedAction('medic', 'item-activity-operation:v1:ffffffffffffffffffffffffffffffff')
    expect(loadPendingItemExtendedAction('medic')).toEqual(pending)
    clearPendingItemExtendedAction('medic', command().operationId)
    expect(loadPendingItemExtendedAction('medic')).toBeNull()
  })

  it('discards corrupt cross-surface evidence and creates secure bounded identities', () => {
    window.sessionStorage.setItem(`${ITEM_EXTENDED_ACTION_PENDING_STORAGE_PREFIX}medic`, JSON.stringify({
      schemaVersion: 1, trainerSlug: 'other', profileId: null, command: command(),
    }))
    expect(loadPendingItemExtendedAction('medic')).toBeNull()
    expect(window.sessionStorage.getItem(`${ITEM_EXTENDED_ACTION_PENDING_STORAGE_PREFIX}medic`)).toBeNull()
    expect(createItemExtendedActionId()).toMatch(/^item-activity:v1:[0-9a-f]{32}$/)
    expect(createItemExtendedActionOperationId()).toMatch(/^item-activity-operation:v1:[0-9a-f]{32}$/)
  })
})
