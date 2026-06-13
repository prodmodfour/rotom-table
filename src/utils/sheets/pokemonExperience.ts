import pokemonExperienceChartJson from '~~/data/reference/pokemonExperienceChart.json'

export interface PokemonExperienceChartEntry {
  level: number
  expNeeded: number
}

// PTU Pokémon Experience Chart (Core book, p. 203). Keep the data in
// data/reference so the web UI and Python encounter generator share one
// source of truth.
export const POKEMON_EXPERIENCE_CHART = pokemonExperienceChartJson as readonly PokemonExperienceChartEntry[]

const normalizeExperienceTotal = (totalExp: number | null | undefined): number | undefined => {
  if (typeof totalExp !== 'number' || !Number.isFinite(totalExp)) return undefined
  return Math.max(0, totalExp)
}

export const calculatePokemonLevelFromExperience = (
  totalExp: number | null | undefined,
): number | undefined => {
  const normalizedTotalExp = normalizeExperienceTotal(totalExp)
  if (normalizedTotalExp == null) return undefined

  let currentLevel: number = POKEMON_EXPERIENCE_CHART[0].level
  for (const { level, expNeeded } of POKEMON_EXPERIENCE_CHART) {
    if (expNeeded > normalizedTotalExp) break
    currentLevel = level
  }
  return currentLevel
}

export const calculatePokemonExperienceToNextLevel = (
  totalExp: number | null | undefined,
): number | undefined => {
  const normalizedTotalExp = normalizeExperienceTotal(totalExp)
  if (normalizedTotalExp == null) return undefined

  const nextLevel = POKEMON_EXPERIENCE_CHART.find(({ expNeeded }) => expNeeded > normalizedTotalExp)
  return nextLevel ? nextLevel.expNeeded - normalizedTotalExp : 0
}
