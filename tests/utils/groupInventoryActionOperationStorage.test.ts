/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPendingGroupInventoryActionOperation,
  GROUP_INVENTORY_ACTION_PENDING_STORAGE_PREFIX,
  loadPendingGroupInventoryActionOperation,
  retainPendingGroupInventoryActionOperation,
} from '~/utils/groupInventoryActionOperationStorage'

const declaration = {
  schemaVersion: 1 as const,
  operationId: `inventory-action:v1:${'1'.repeat(32)}`,
  offerId: `inventory-action-offer:v1:${'2'.repeat(32)}`,
  action: 'transfer' as const,
  sourceSelectionId: `inventory-source:v1:${'3'.repeat(32)}`,
  quantity: 1,
  destinationId: `inventory-destination:v1:${'4'.repeat(32)}`,
  confirmationOptionId: null,
  expectedRevisions: [
    { requirementId: `inventory-revision:v1:${'5'.repeat(32)}`, expectedRevision: 3 },
  ],
}

afterEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('group inventory action exact-retry storage', () => {
  it('retains only one strict group/profile-bound transfer or stack declaration', () => {
    retainPendingGroupInventoryActionOperation({ schemaVersion: 1, groupSlug: 'main', profileId: null, declaration })
    expect(loadPendingGroupInventoryActionOperation('main')).toEqual({
      schemaVersion: 1, groupSlug: 'main', profileId: null, declaration,
    })
    clearPendingGroupInventoryActionOperation('main', declaration.operationId)
    expect(loadPendingGroupInventoryActionOperation('main')).toBeNull()

    const discard = {
      ...declaration,
      operationId: `inventory-action:v1:${'7'.repeat(32)}`,
      action: 'discard' as const,
      destinationId: null,
      confirmationOptionId: `inventory-confirmation:v1:${'8'.repeat(32)}`,
    }
    retainPendingGroupInventoryActionOperation({ schemaVersion: 1, groupSlug: 'main', profileId: null, declaration: discard })
    expect(loadPendingGroupInventoryActionOperation('main')?.declaration).toEqual(discard)
  })

  it('removes changed shapes and unsupported action kinds', () => {
    const key = `${GROUP_INVENTORY_ACTION_PENDING_STORAGE_PREFIX}main`
    window.sessionStorage.setItem(key, JSON.stringify({
      schemaVersion: 1, groupSlug: 'main', profileId: null,
      declaration: { ...declaration, action: 'give' },
    }))
    expect(loadPendingGroupInventoryActionOperation('main')).toBeNull()

    window.sessionStorage.setItem(key, JSON.stringify({
      schemaVersion: 1, groupSlug: 'main', profileId: null, declaration, rowId: 'private-row',
    }))
    expect(loadPendingGroupInventoryActionOperation('main')).toBeNull()
  })
})
