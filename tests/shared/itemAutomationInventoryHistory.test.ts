import { describe, expect, it } from 'vitest'
import {
  INVENTORY_HISTORY_LIMITS,
  InventoryHistoryValidationError,
  parseInventoryHistoryProjection,
} from '#shared/itemAutomation/inventoryHistory'

const projection = () => ({
  schemaVersion: 1,
  generatedAt: 2_000,
  scope: { kind: 'trainer', label: 'Ash inventory' },
  facts: [{
    kind: 'purchase',
    occurredAt: 1_900,
    headline: 'Potion ×2',
    item: { label: 'Potion', quantity: 2 },
    custody: { sourceLabel: 'Shop', destinationLabel: 'Trainer inventory' },
    details: ['Purchase accepted for $600.'],
  }, {
    kind: 'item-use',
    occurredAt: 1_800,
    headline: 'Potion was used.',
    item: { label: 'Potion', quantity: 1 },
    custody: null,
    details: ['20 HP restored.', '1 item consumed.'],
  }],
  truncated: false,
})

describe('inventory history public contract', () => {
  it('strictly parses and deeply freezes bounded, newest-first player-readable receipts', () => {
    const parsed = parseInventoryHistoryProjection(projection())
    expect(parsed.scope).toEqual({ kind: 'trainer', label: 'Ash inventory' })
    expect(parsed.facts.map(fact => fact.kind)).toEqual(['purchase', 'item-use'])
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.facts[0]?.details)).toBe(true)
  })

  it.each([
    ['unknown fields', { ...projection(), operationId: 'private-operation' }],
    ['unsupported categories', { ...projection(), facts: [{ ...projection().facts[0], kind: 'private-audit' }] }],
    ['unbounded quantities', { ...projection(), facts: [{ ...projection().facts[0], item: { label: 'Potion', quantity: 0 } }] }],
    ['same custody endpoints', { ...projection(), facts: [{ ...projection().facts[0], custody: { sourceLabel: 'Shop', destinationLabel: 'Shop' } }] }],
    ['duplicate details', { ...projection(), facts: [{ ...projection().facts[0], details: ['Same', 'Same'] }] }],
    ['out-of-order facts', { ...projection(), facts: [...projection().facts].reverse() }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseInventoryHistoryProjection(value)).toThrow(InventoryHistoryValidationError)
  })

  it('rejects receipt expansion beyond the public bound', () => {
    expect(() => parseInventoryHistoryProjection({
      ...projection(),
      facts: Array.from({ length: INVENTORY_HISTORY_LIMITS.facts + 1 }, (_, index) => ({
        ...projection().facts[0],
        occurredAt: 2_000 - index,
      })),
    })).toThrow(InventoryHistoryValidationError)
  })
})
