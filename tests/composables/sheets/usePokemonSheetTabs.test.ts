import { computed, ref, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import {
  isPokemonSheetTabKey,
  POKEMON_SHEET_TABS,
  pokemonSheetTabsFor,
  usePokemonSheetTabs,
} from '~/composables/sheets/usePokemonSheetTabs'

describe('usePokemonSheetTabs', () => {
  it('defines the stable pokemon sheet tab order', () => {
    expect(POKEMON_SHEET_TABS.map((tab) => [tab.key, tab.label])).toEqual([
      ['sheet', 'Sheet'],
      ['knownMoves', 'Known Moves'],
      ['gm', 'GM'],
    ])
    expect(pokemonSheetTabsFor(false).map((tab) => tab.key)).toEqual(['sheet', 'knownMoves'])
    expect(pokemonSheetTabsFor(true).map((tab) => tab.key)).toEqual(['sheet', 'knownMoves', 'gm'])
  })

  it('validates tab keys', () => {
    expect(isPokemonSheetTabKey('sheet')).toBe(true)
    expect(isPokemonSheetTabKey('knownMoves')).toBe(true)
    expect(isPokemonSheetTabKey('gm')).toBe(true)
    expect(isPokemonSheetTabKey('eggMoves')).toBe(false)
    expect(isPokemonSheetTabKey('healing')).toBe(false)
    expect(isPokemonSheetTabKey('combat')).toBe(false)
    expect(isPokemonSheetTabKey(null)).toBe(false)
  })

  it('updates active tab only for visible keys', async () => {
    const includeGmTab = ref(false)
    const tabs = usePokemonSheetTabs({ includeGmTab: computed(() => includeGmTab.value) })

    expect(tabs.tabs.value.map((tab) => tab.key)).toEqual(['sheet', 'knownMoves'])
    expect(tabs.activeTab.value).toBe('sheet')
    tabs.setActiveTab('knownMoves')
    expect(tabs.activeTab.value).toBe('knownMoves')
    tabs.setActiveTab('gm')
    expect(tabs.activeTab.value).toBe('knownMoves')
    tabs.setActiveTab('healing')
    expect(tabs.activeTab.value).toBe('knownMoves')
    tabs.setActiveTab('unknown')
    expect(tabs.activeTab.value).toBe('knownMoves')

    includeGmTab.value = true
    await nextTick()
    expect(tabs.tabs.value.map((tab) => tab.key)).toEqual(['sheet', 'knownMoves', 'gm'])
    tabs.setActiveTab('gm')
    expect(tabs.activeTab.value).toBe('gm')

    includeGmTab.value = false
    await nextTick()
    expect(tabs.activeTab.value).toBe('sheet')
  })
})
