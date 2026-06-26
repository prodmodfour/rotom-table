import { describe, expect, it } from 'vitest'
import {
  isPokemonSheetTabKey,
  POKEMON_SHEET_TABS,
  usePokemonSheetTabs,
} from '~/composables/sheets/usePokemonSheetTabs'

describe('usePokemonSheetTabs', () => {
  it('defines the stable pokemon sheet tab order', () => {
    expect(POKEMON_SHEET_TABS.map((tab) => [tab.key, tab.label])).toEqual([
      ['sheet', 'Sheet'],
      ['knownMoves', 'Known Moves'],
    ])
  })

  it('validates tab keys', () => {
    expect(isPokemonSheetTabKey('sheet')).toBe(true)
    expect(isPokemonSheetTabKey('knownMoves')).toBe(true)
    expect(isPokemonSheetTabKey('eggMoves')).toBe(false)
    expect(isPokemonSheetTabKey('healing')).toBe(false)
    expect(isPokemonSheetTabKey('combat')).toBe(false)
    expect(isPokemonSheetTabKey(null)).toBe(false)
  })

  it('updates active tab only for known keys', () => {
    const tabs = usePokemonSheetTabs()

    expect(tabs.activeTab.value).toBe('sheet')
    tabs.setActiveTab('knownMoves')
    expect(tabs.activeTab.value).toBe('knownMoves')
    tabs.setActiveTab('healing')
    expect(tabs.activeTab.value).toBe('knownMoves')
    tabs.setActiveTab('unknown')
    expect(tabs.activeTab.value).toBe('knownMoves')
  })
})
