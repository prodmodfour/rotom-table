import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

const POKEMON_SHEET_TAB_DEFS = [
  { key: 'sheet', label: 'Sheet' },
  { key: 'vitamins', label: 'Vitamins' },
  { key: 'knownMoves', label: 'Known Moves' },
  { key: 'gm', label: 'GM' },
] as const

export type PokemonSheetTabKey = (typeof POKEMON_SHEET_TAB_DEFS)[number]['key']

export interface PokemonSheetTabOption {
  key: PokemonSheetTabKey
  label: string
}

export interface UsePokemonSheetTabsOptions {
  initialTab?: PokemonSheetTabKey
  includeGmTab?: MaybeRefOrGetter<boolean | undefined>
}

export const POKEMON_SHEET_TABS: PokemonSheetTabOption[] = POKEMON_SHEET_TAB_DEFS.map((tab) => ({ ...tab }))

export const pokemonSheetTabsFor = (includeGmTab = false): PokemonSheetTabOption[] => (
  POKEMON_SHEET_TABS.filter((tab) => includeGmTab || tab.key !== 'gm').map((tab) => ({ ...tab }))
)

export const isPokemonSheetTabKey = (value: unknown): value is PokemonSheetTabKey => (
  typeof value === 'string' && POKEMON_SHEET_TABS.some((tab) => tab.key === value)
)

export function usePokemonSheetTabs(options: UsePokemonSheetTabsOptions = {}) {
  const activeTab = ref<PokemonSheetTabKey>(options.initialTab ?? 'sheet')
  const tabs = computed(() => pokemonSheetTabsFor(toValue(options.includeGmTab) === true))

  const isVisibleTabKey = (key: string): key is PokemonSheetTabKey => (
    isPokemonSheetTabKey(key) && tabs.value.some((tab) => tab.key === key)
  )

  const setActiveTab = (key: string) => {
    if (isVisibleTabKey(key)) activeTab.value = key
  }

  watch(tabs, (visibleTabs) => {
    if (!visibleTabs.some((tab) => tab.key === activeTab.value)) activeTab.value = 'sheet'
  }, { immediate: true })

  return {
    tabs,
    activeTab,
    setActiveTab,
  }
}
