import { describe, expect, it } from 'vitest'
import { parseInventoryContinuationRouteIntent } from '../../src/utils/inventoryContinuationRoute'

describe('inventory continuation route intent', () => {
  it('parses only bounded opaque source and group actor handoffs', () => {
    expect(parseInventoryContinuationRouteIntent({
      inventoryAction: 'use',
      inventorySource: 'inventory-source:v1:11111111111111111111111111111111',
      itemActor: 'group-item-actor:v1:22222222222222222222222222222222',
    })).toEqual({
      action: 'use',
      sourceSelectionId: 'inventory-source:v1:11111111111111111111111111111111',
      itemActorSelectionId: 'group-item-actor:v1:22222222222222222222222222222222',
    })
  })

  it.each([
    { inventoryAction: 'discard', inventorySource: 'inventory-source:v1:11111111111111111111111111111111' },
    { inventoryAction: 'use', inventorySource: 'private-row-id' },
    { inventoryAction: ['use'], inventorySource: 'inventory-source:v1:11111111111111111111111111111111' },
    { inventoryAction: 'use', inventorySource: 'inventory-source:v1:11111111111111111111111111111111', itemActor: 'profile_private' },
  ])('fails closed for malformed or expanded query authority %#', (query) => {
    expect(parseInventoryContinuationRouteIntent(query)).toBeNull()
  })
})
