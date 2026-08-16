import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SHEET_ITEM_PENDING_OPERATION_STORAGE_PREFIX,
  clearPendingSheetItemOperation,
  createSheetItemOperationId,
  loadPendingSheetItemOperation,
  retainPendingSheetItemOperation,
} from '~/utils/sheetItemOperationStorage'
import type { UseItemCommandV1 } from '#shared/itemAutomation/operations'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const command = (): UseItemCommandV1 => ({
  schemaVersion: 1,
  operationId: 'sheet-item:v1:11111111111111111111111111111111',
  context: 'sheet', offerId: 'offer:sheet-item:potion',
  sourceInstanceId: 'item-instance:trainer:ash:medicalKit:potion-row', actorParticipantId: null,
  actorSheet: { kind: 'trainer', slug: 'ash', expectedRevision: 3 },
  source: { kind: 'trainer', slug: 'ash', section: 'medicalKit', rowId: 'potion-row', expectedRevision: 3 },
  targetIds: ['sheet-target:v1:pokemon:pikachu'],
  choices: [{ choiceId: 'target', optionIds: ['sheet-target:v1:pokemon:pikachu'] }],
  readSet: [
    { kind: 'sheet', sheetKind: 'pokemon', id: 'pikachu', revision: 2 },
    { kind: 'sheet', sheetKind: 'trainer', id: 'ash', revision: 3 },
  ],
})

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: new MemoryStorage() })
})
afterEach(() => vi.unstubAllGlobals())

describe('sheet item exact-retry browser retention', () => {
  it('retains the exact private command per Trainer until its terminal result', () => {
    const pending = retainPendingSheetItemOperation({
      schemaVersion: 1, trainerSlug: 'ash', profileId: 'profile_fixture01', command: command(),
    })
    expect(loadPendingSheetItemOperation('ash')).toEqual(pending)
    clearPendingSheetItemOperation('ash', 'sheet-item:v1:ffffffffffffffffffffffffffffffff')
    expect(loadPendingSheetItemOperation('ash')).toEqual(pending)
    clearPendingSheetItemOperation('ash', command().operationId)
    expect(loadPendingSheetItemOperation('ash')).toBeNull()
  })

  it('discards corrupt or cross-surface commands and creates secure bounded operation IDs', () => {
    window.sessionStorage.setItem(`${SHEET_ITEM_PENDING_OPERATION_STORAGE_PREFIX}ash`, JSON.stringify({
      schemaVersion: 1, trainerSlug: 'misty', profileId: null, command: command(),
    }))
    expect(loadPendingSheetItemOperation('ash')).toBeNull()
    expect(window.sessionStorage.getItem(`${SHEET_ITEM_PENDING_OPERATION_STORAGE_PREFIX}ash`)).toBeNull()
    expect(createSheetItemOperationId()).toMatch(/^sheet-item:v1:[0-9a-f]{32}$/)
  })
})
