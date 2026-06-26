import { computed, ref, type ComputedRef } from 'vue'
import type { CharacterSheet } from '~/types/characterSheet'
import { getErrorMessage } from '~/utils/errorMessages'
import { randomizePokemonAddedStats } from '~/utils/sheets/pokemonAddedStatRandomizer'
import { computePokemonLevelUpStatPointBudget } from '~/utils/statPointBudgets'

export interface UsePokemonAddedStatsAdminActionOptions {
  readonly sheet: ComputedRef<CharacterSheet | null>
  readonly canUse: ComputedRef<boolean>
}

export const usePokemonAddedStatsAdminAction = ({
  sheet,
  canUse,
}: UsePokemonAddedStatsAdminActionOptions) => {
  const statusMessage = ref<string | null>(null)
  const errorMessage = ref<string | null>(null)
  const statPointsBudget = computed(() => (
    sheet.value ? computePokemonLevelUpStatPointBudget(sheet.value.level) : null
  ))

  const clearMessages = () => {
    statusMessage.value = null
    errorMessage.value = null
  }

  const randomizeAddedStats = () => {
    if (!canUse.value || !sheet.value) return

    clearMessages()
    try {
      const result = randomizePokemonAddedStats(sheet.value)
      statusMessage.value = `Randomised ${result.budget} Added Stat Points. Sheet autosave will persist the change.`
    } catch (error) {
      errorMessage.value = getErrorMessage(error, { fallback: 'Unable to randomise Added Stat Points.' })
    }
  }

  return {
    statusMessage,
    errorMessage,
    statPointsBudget,
    clearMessages,
    randomizeAddedStats,
  }
}
