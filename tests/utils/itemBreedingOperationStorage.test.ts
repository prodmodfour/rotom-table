// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ITEM_BREEDING_PENDING_STORAGE_PREFIX,
  clearPendingItemBreedingOperation,
  createItemBreedingOperationId,
  loadPendingItemBreedingOperation,
  retainPendingItemBreedingOperation,
} from '../../src/utils/itemBreedingOperationStorage'

const command = {
  schemaVersion: 1 as const,
  kind: 'assign-egg-warmer' as const,
  operationId: `item-breeding:v1:${'a'.repeat(32)}`,
  trainerSheetSlug: 'trainer-mira',
  expectedTrainerRevision: 4,
  warmerUnitOptionId: `breeding-item-option:v1:${'b'.repeat(32)}`,
  eggOptionIds: [`breeding-item-option:v1:${'c'.repeat(32)}`],
}
afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks() })
describe('item breeding pending operation storage', () => {
  it('retains, reloads, and clears one exact principal-bound command', () => {
    retainPendingItemBreedingOperation({ schemaVersion:1,trainerSheetSlug:'trainer-mira',profileId:'profile_owner0001',command })
    expect(loadPendingItemBreedingOperation('trainer-mira')).toEqual({ schemaVersion:1,trainerSheetSlug:'trainer-mira',profileId:'profile_owner0001',command })
    clearPendingItemBreedingOperation('trainer-mira','another-operation')
    expect(loadPendingItemBreedingOperation('trainer-mira')).not.toBeNull()
    clearPendingItemBreedingOperation('trainer-mira',command.operationId)
    expect(loadPendingItemBreedingOperation('trainer-mira')).toBeNull()
  })
  it('fails closed and removes malformed or cross-Trainer storage', () => {
    window.sessionStorage.setItem(`${ITEM_BREEDING_PENDING_STORAGE_PREFIX}trainer-mira`,JSON.stringify({schemaVersion:1,trainerSheetSlug:'other',profileId:null,command}))
    expect(loadPendingItemBreedingOperation('trainer-mira')).toBeNull()
    expect(window.sessionStorage.length).toBe(0)
  })
  it('uses secure browser randomness for bounded operation identity', () => {
    vi.spyOn(globalThis.crypto,'randomUUID').mockReturnValue('12345678-1234-4abc-8def-1234567890ab')
    expect(createItemBreedingOperationId()).toBe('item-breeding:v1:1234567812344abc8def1234567890ab')
  })
})
