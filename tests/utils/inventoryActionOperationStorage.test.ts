/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPendingInventoryActionOperation,
  INVENTORY_ACTION_PENDING_STORAGE_PREFIX,
  loadPendingInventoryActionOperation,
  retainPendingInventoryActionOperation,
} from '~/utils/inventoryActionOperationStorage'

const declaration = {
  schemaVersion: 1 as const,
  operationId: `inventory-action:v1:${'1'.repeat(32)}`,
  offerId: `inventory-action-offer:v1:${'2'.repeat(32)}`,
  action: 'give' as const,
  sourceSelectionId: `inventory-source:v1:${'3'.repeat(32)}`,
  quantity: 1,
  destinationId: `inventory-destination:v1:${'4'.repeat(32)}`,
  confirmationOptionId: null,
  expectedRevisions: [
    { requirementId: `inventory-revision:v1:${'5'.repeat(32)}`, expectedRevision: 3 },
    { requirementId: `inventory-revision:v1:${'6'.repeat(32)}`, expectedRevision: 2 },
  ],
}

afterEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('inventory action exact-retry storage', () => {
  it('retains and clears only one exact Trainer/profile-bound declaration', () => {
    retainPendingInventoryActionOperation({ schemaVersion: 1, trainerSlug: 'ash', profileId: null, declaration })
    expect(loadPendingInventoryActionOperation('ash')).toEqual({
      schemaVersion: 1, trainerSlug: 'ash', profileId: null, declaration,
    })
    clearPendingInventoryActionOperation('ash', `inventory-action:v1:${'9'.repeat(32)}`)
    expect(loadPendingInventoryActionOperation('ash')).not.toBeNull()
    clearPendingInventoryActionOperation('ash', declaration.operationId)
    expect(loadPendingInventoryActionOperation('ash')).toBeNull()

    const discard = {
      ...declaration,
      operationId: `inventory-action:v1:${'7'.repeat(32)}`,
      action: 'discard' as const,
      destinationId: null,
      confirmationOptionId: `inventory-confirmation:v1:${'8'.repeat(32)}`,
      expectedRevisions: declaration.expectedRevisions.slice(0, 1),
    }
    retainPendingInventoryActionOperation({ schemaVersion: 1, trainerSlug: 'ash', profileId: null, declaration: discard })
    expect(loadPendingInventoryActionOperation('ash')?.declaration).toEqual(discard)
  })

  it('deletes malformed, expanded, or unsupported pending state', () => {
    const key = `${INVENTORY_ACTION_PENDING_STORAGE_PREFIX}ash`
    window.sessionStorage.setItem(key, JSON.stringify({
      schemaVersion: 1, trainerSlug: 'ash', profileId: null,
      declaration: { ...declaration, action: 'inspect' },
    }))
    expect(loadPendingInventoryActionOperation('ash')).toBeNull()
    expect(window.sessionStorage.getItem(key)).toBeNull()

    window.sessionStorage.setItem(key, JSON.stringify({
      schemaVersion: 1, trainerSlug: 'ash', profileId: null, declaration, rowId: 'private-row',
    }))
    expect(loadPendingInventoryActionOperation('ash')).toBeNull()
  })
})
