import { describe, expect, it } from 'vitest'
import {
  isTrainerSheetTabKey,
  TRAINER_SHEET_TABS,
  useTrainerSheetTabs,
} from '~/composables/sheets/useTrainerSheetTabs'

describe('useTrainerSheetTabs', () => {
  it('defines the stable trainer sheet tab order', () => {
    expect(TRAINER_SHEET_TABS.map((tab) => tab.key)).toEqual([
      'trainer',
      'combat',
      'inventory',
      'features',
      'edges',
    ])
  })

  it('validates tab keys', () => {
    expect(isTrainerSheetTabKey('trainer')).toBe(true)
    expect(isTrainerSheetTabKey('combat')).toBe(true)
    expect(isTrainerSheetTabKey('pokemon')).toBe(false)
    expect(isTrainerSheetTabKey(null)).toBe(false)
  })

  it('updates active tab only for known keys', () => {
    const tabs = useTrainerSheetTabs()

    expect(tabs.activeTab.value).toBe('trainer')
    tabs.setActiveTab('inventory')
    expect(tabs.activeTab.value).toBe('inventory')
    tabs.setActiveTab('unknown')
    expect(tabs.activeTab.value).toBe('inventory')
  })
})
