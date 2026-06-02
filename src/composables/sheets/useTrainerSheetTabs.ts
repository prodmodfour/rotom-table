import { ref } from 'vue'

const TRAINER_SHEET_TAB_DEFS = [
  { key: 'stats', label: 'Stats' },
  { key: 'skills', label: 'Skills' },
  { key: 'combat', label: 'Combat' },
  { key: 'pokemon', label: 'Pokémon' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'features', label: 'Features' },
  { key: 'edges', label: 'Edges' },
] as const

export type TrainerSheetTabKey = (typeof TRAINER_SHEET_TAB_DEFS)[number]['key']

export interface TrainerSheetTabOption {
  key: TrainerSheetTabKey
  label: string
}

export const TRAINER_SHEET_TABS: TrainerSheetTabOption[] = TRAINER_SHEET_TAB_DEFS.map((tab) => ({ ...tab }))

export const isTrainerSheetTabKey = (value: unknown): value is TrainerSheetTabKey => (
  typeof value === 'string' && TRAINER_SHEET_TABS.some((tab) => tab.key === value)
)

export function useTrainerSheetTabs(initialTab: TrainerSheetTabKey = 'stats') {
  const activeTab = ref<TrainerSheetTabKey>(initialTab)

  const setActiveTab = (key: string) => {
    if (isTrainerSheetTabKey(key)) activeTab.value = key
  }

  return {
    tabs: TRAINER_SHEET_TABS,
    activeTab,
    setActiveTab,
  }
}
