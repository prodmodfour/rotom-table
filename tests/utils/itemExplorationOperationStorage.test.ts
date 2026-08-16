import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ITEM_EXPLORATION_PENDING_STORAGE_PREFIX,
  clearPendingItemExplorationOperation,
  createItemExplorationOperationId,
  loadPendingItemExplorationOperation,
  retainPendingItemExplorationOperation,
} from '~/utils/itemExplorationOperationStorage'
import type { ItemExplorationOperationCommandV1 } from '#shared/itemAutomation/exploration'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const command = (): ItemExplorationOperationCommandV1 => ({
  schemaVersion: 1,
  operationId: 'item-exploration:v1:11111111111111111111111111111111',
  kind: 'resolve-route-lure-check',
  trainerSlug: 'explorer',
  trainerRevision: 3,
  campaignClockRevision: 2,
  activityId: 'item-route-lure:v1:22222222222222222222222222222222',
})

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: new MemoryStorage() })
})
afterEach(() => vi.unstubAllGlobals())

describe('item exploration exact-retry browser retention', () => {
  it('retains one strict profile-bound command per exact scope until its terminal response', () => {
    const pending = retainPendingItemExplorationOperation({
      schemaVersion: 1,
      scopeKey: 'trainer:explorer',
      profileId: 'profile_explorer01',
      command: command(),
    })
    expect(loadPendingItemExplorationOperation('trainer:explorer')).toEqual(pending)
    clearPendingItemExplorationOperation('trainer:explorer', 'item-exploration:v1:ffffffffffffffffffffffffffffffff')
    expect(loadPendingItemExplorationOperation('trainer:explorer')).toEqual(pending)
    clearPendingItemExplorationOperation('trainer:explorer', command().operationId)
    expect(loadPendingItemExplorationOperation('trainer:explorer')).toBeNull()
  })

  it('separates Trainer and map scopes and discards corrupt or cross-scope evidence', () => {
    const mapCommand: ItemExplorationOperationCommandV1 = {
      schemaVersion: 1,
      operationId: 'item-exploration:v1:33333333333333333333333333333333',
      kind: 'settle-direct-repel',
      mapSlug: 'route-map',
      mapRevision: 7,
      decisionId: 'item-repel-position:v1:44444444444444444444444444444444',
      destination: { x: 5, y: 0, z: 1 },
    }
    retainPendingItemExplorationOperation({
      schemaVersion: 1, scopeKey: 'map:route-map', profileId: null, command: mapCommand,
    })
    expect(loadPendingItemExplorationOperation('trainer:explorer')).toBeNull()
    expect(loadPendingItemExplorationOperation('map:route-map')?.command).toEqual(mapCommand)

    window.sessionStorage.setItem(`${ITEM_EXPLORATION_PENDING_STORAGE_PREFIX}trainer:explorer`, JSON.stringify({
      schemaVersion: 1, scopeKey: 'trainer:other', profileId: null, command: command(),
    }))
    expect(loadPendingItemExplorationOperation('trainer:explorer')).toBeNull()
    expect(window.sessionStorage.getItem(`${ITEM_EXPLORATION_PENDING_STORAGE_PREFIX}trainer:explorer`)).toBeNull()
  })

  it('creates secure bounded operation identities', () => {
    expect(createItemExplorationOperationId()).toMatch(/^item-exploration:v1:[0-9a-f]{32}$/)
  })
})
