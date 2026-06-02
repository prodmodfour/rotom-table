import { ref } from 'vue'

const POKEMON_SHEET_TAB_DEFS = [
  { key: 'sheet', label: 'Sheet' },
] as const

export type PokemonSheetTabKey = (typeof POKEMON_SHEET_TAB_DEFS)[number]['key']

export interface PokemonSheetTabOption {
  key: PokemonSheetTabKey
  label: string
}

export const POKEMON_SHEET_TABS: PokemonSheetTabOption[] = POKEMON_SHEET_TAB_DEFS.map((tab) => ({ ...tab }))

export const isPokemonSheetTabKey = (value: unknown): value is PokemonSheetTabKey => (
  typeof value === 'string' && POKEMON_SHEET_TABS.some((tab) => tab.key === value)
)

export function usePokemonSheetTabs(initialTab: PokemonSheetTabKey = 'sheet') {
  const activeTab = ref<PokemonSheetTabKey>(initialTab)

  const setActiveTab = (key: string) => {
    if (isPokemonSheetTabKey(key)) activeTab.value = key
  }

  return {
    tabs: POKEMON_SHEET_TABS,
    activeTab,
    setActiveTab,
  }
}
