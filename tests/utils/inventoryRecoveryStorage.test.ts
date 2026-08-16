/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearDurablePendingRecord,
  InventoryRecoveryConflictError,
  loadDurablePendingRecord,
  matchesDurablePendingStorageEvent,
  retainDurablePendingRecord,
} from '~/utils/inventoryRecoveryStorage'

type FixturePending = {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly value: string
}

const parse = (value: unknown): FixturePending => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 3 || input.schemaVersion !== 1
    || typeof input.operationId !== 'string' || typeof input.value !== 'string') throw new Error('invalid')
  return Object.freeze({ schemaVersion: 1, operationId: input.operationId, value: input.value })
}
const options = (storageKey: string, flow: 'inventory-action' | 'equipment') => ({
  storageKey,
  scope: { kind: 'trainer' as const, slug: 'ash' },
  flow,
  parse,
  operationId: (value: FixturePending) => value.operationId,
})
const first: FixturePending = { schemaVersion: 1, operationId: 'operation:first', value: 'retained' }
const second: FixturePending = { schemaVersion: 1, operationId: 'operation:second', value: 'other-flow' }

afterEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('durable inventory recovery storage', () => {
  it('restores one exact command after a session reload and remirrors it into the active tab', () => {
    const firstOptions = options('rotom-table:test:pending:v1:ash', 'inventory-action')
    retainDurablePendingRecord(first, firstOptions)
    expect(JSON.parse(window.localStorage.getItem(firstOptions.storageKey)!)).toEqual(first)

    window.sessionStorage.clear()
    expect(loadDurablePendingRecord(firstOptions)).toEqual(first)
    expect(JSON.parse(window.sessionStorage.getItem(firstOptions.storageKey)!)).toEqual(first)
  })

  it('blocks a competing flow for the same inventory until the exact retained command clears', () => {
    const firstOptions = options('rotom-table:test-a:pending:v1:ash', 'inventory-action')
    const secondOptions = options('rotom-table:test-b:pending:v1:ash', 'equipment')
    retainDurablePendingRecord(first, firstOptions)

    expect(() => retainDurablePendingRecord(second, secondOptions)).toThrow(InventoryRecoveryConflictError)
    expect(window.localStorage.getItem(secondOptions.storageKey)).toBeNull()

    clearDurablePendingRecord(first.operationId, firstOptions)
    expect(() => retainDurablePendingRecord(second, secondOptions)).not.toThrow()
    expect(loadDurablePendingRecord(secondOptions)).toEqual(second)
  })

  it('clears malformed durable payloads and recognizes only the exact cross-tab payload key', () => {
    const firstOptions = options('rotom-table:test:pending:v1:ash', 'inventory-action')
    window.localStorage.setItem(firstOptions.storageKey, JSON.stringify({ ...first, privateExpansion: true }))
    expect(loadDurablePendingRecord(firstOptions)).toBeNull()
    expect(window.localStorage.getItem(firstOptions.storageKey)).toBeNull()

    window.sessionStorage.setItem(firstOptions.storageKey, JSON.stringify(first))
    const matching = new StorageEvent('storage', {
      key: firstOptions.storageKey,
      oldValue: JSON.stringify(first),
      newValue: null,
      storageArea: window.localStorage,
    })
    const other = new StorageEvent('storage', { key: 'rotom-table:other', storageArea: window.localStorage })
    expect(matchesDurablePendingStorageEvent(matching, firstOptions.storageKey)).toBe(true)
    expect(window.sessionStorage.getItem(firstOptions.storageKey)).toBeNull()
    expect(matchesDurablePendingStorageEvent(other, firstOptions.storageKey)).toBe(false)
  })
})
