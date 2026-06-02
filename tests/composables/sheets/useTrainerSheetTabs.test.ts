import { describe, expect, it } from 'vitest'
import {
  isTrainerSheetTabKey,
  TRAINER_SHEET_TABS,
  useTrainerSheetTabs,
} from '~/composables/sheets/useTrainerSheetTabs'

describe('useTrainerSheetTabs', () => {
  it('defines the stable trainer sheet tab order', () => {
    expect(TRAINER_SHEET_TABS.map((tab) => [tab.key, tab.label])).toEqual([
      ['stats', 'Stats'],
      ['skills', 'Skills'],
      ['combat', 'Combat'],
      ['healing', 'Healing'],
      ['pokemon', 'Pokémon'],
      ['inventory', 'Inventory'],
      ['features', 'Features'],
      ['edges', 'Edges'],
    ])
  })

  it('validates tab keys', () => {
    expect(isTrainerSheetTabKey('stats')).toBe(true)
    expect(isTrainerSheetTabKey('skills')).toBe(true)
    expect(isTrainerSheetTabKey('combat')).toBe(true)
    expect(isTrainerSheetTabKey('healing')).toBe(true)
    expect(isTrainerSheetTabKey('pokemon')).toBe(true)
    expect(isTrainerSheetTabKey(null)).toBe(false)
  })

  it('updates active tab only for known keys', () => {
    const tabs = useTrainerSheetTabs()

    expect(tabs.activeTab.value).toBe('stats')
    tabs.setActiveTab('inventory')
    expect(tabs.activeTab.value).toBe('inventory')
    tabs.setActiveTab('unknown')
    expect(tabs.activeTab.value).toBe('inventory')
  })
})
