/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { InventorySourceSelectionOptionV1 } from '#shared/itemAutomation/inventorySourceSelection'
import {
  INVENTORY_SOURCE_PREFERENCE_STORAGE_KEY,
  loadInventorySourcePresentationPreference,
  orderInventorySourceOptions,
  parseInventorySourcePresentationPreference,
  rememberInventorySourcePresentationPreference,
} from '~/utils/inventorySourcePreference'

const option = (
  sourceSelectionId: string,
  containerKind: 'trainer',
  section: 'medicalKit' | 'pokemonItems',
  rowIndex: number,
  selected = false,
): InventorySourceSelectionOptionV1 => ({
  schemaVersion: 1,
  sourceSelectionId,
  offerId: `offer:${sourceSelectionId}`,
  containerKind,
  containerLabel: 'Trainer inventory',
  section,
  sectionLabel: section === 'medicalKit' ? 'Medical Kit' : 'Pokémon Items',
  rowIndex,
  rowLabel: `Row ${rowIndex + 1}`,
  itemLabel: 'Potion',
  quantity: 1,
  selected,
})

describe('inventory source presentation preference', () => {
  beforeEach(() => window.localStorage.clear())

  it('stores only safe container and section presentation fields', () => {
    const saved = rememberInventorySourcePresentationPreference({ containerKind: 'trainer', section: 'medicalKit' })
    expect(saved).toEqual({ schemaVersion: 1, preferredContainerKind: 'trainer', preferredSection: 'medicalKit' })
    const raw = window.localStorage.getItem(INVENTORY_SOURCE_PREFERENCE_STORAGE_KEY)
    expect(raw).toBe('{"schemaVersion":1,"preferredContainerKind":"trainer","preferredSection":"medicalKit"}')
    expect(raw).not.toMatch(/slug|row|offer|sourceSelection|operation|profile|instance/u)
    expect(loadInventorySourcePresentationPreference()).toEqual(saved)
  })

  it('removes malformed or identity-bearing values instead of trusting them', () => {
    expect(() => parseInventorySourcePresentationPreference({
      schemaVersion: 1, preferredContainerKind: 'trainer', preferredSection: 'medicalKit', rowId: 'private',
    })).toThrow('invalid shape')
    window.localStorage.setItem(INVENTORY_SOURCE_PREFERENCE_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1, preferredContainerKind: 'trainer', preferredSection: 'medicalKit', trainerSlug: 'mira',
    }))
    expect(loadInventorySourcePresentationPreference()).toBeNull()
    expect(window.localStorage.getItem(INVENTORY_SOURCE_PREFERENCE_STORAGE_KEY)).toBeNull()
  })

  it('orders presentation only and never changes the exact selected option', () => {
    const selected = option('selected', 'trainer', 'pokemonItems', 2, true)
    const preferred = option('preferred', 'trainer', 'medicalKit', 4)
    const other = option('other', 'trainer', 'pokemonItems', 1)
    expect(orderInventorySourceOptions([other, preferred, selected], {
      schemaVersion: 1, preferredContainerKind: 'trainer', preferredSection: 'medicalKit',
    }).map(row => row.sourceSelectionId)).toEqual(['preferred', 'other', 'selected'])
    expect(selected.selected).toBe(true)
    expect(preferred.selected).toBe(false)
  })
})
