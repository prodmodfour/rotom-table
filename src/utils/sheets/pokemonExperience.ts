import pokemonExperienceChartJson from '~~/data/reference/pokemonExperienceChart.json'

export interface PokemonExperienceChartEntry {
  level: number
  expNeeded: number
}

export interface PokemonExperienceProgress {
  level: number
  nextLevel: number | null
  totalExp: number
  hasTrackedTotalExp: boolean
  currentLevelExp: number
  nextLevelExp: number | null
  currentExp: number
  neededExp: number
  remainingExp: number
  percent: number
  isMaxLevel: boolean
}

// PTU Pokémon Experience Chart (Core book, p. 203). Keep the data in
// data/reference so the web UI and Python encounter generator share one
// source of truth.
export const POKEMON_EXPERIENCE_CHART = pokemonExperienceChartJson as readonly PokemonExperienceChartEntry[]

const POKEMON_EXPERIENCE_BY_LEVEL = new Map(
  POKEMON_EXPERIENCE_CHART.map((entry) => [entry.level, entry] as const),
)

const normalizeExperienceTotal = (totalExp: number | null | undefined): number | undefined => {
  if (typeof totalExp !== 'number' || !Number.isFinite(totalExp)) return undefined
  return Math.max(0, totalExp)
}

const normalizeExperienceLevel = (level: number | null | undefined): number | undefined => {
  if (typeof level !== 'number' || !Number.isFinite(level)) return undefined
  return Math.min(100, Math.max(1, Math.floor(level)))
}

export const pokemonExperienceNeededForLevel = (
  level: number | null | undefined,
): number | undefined => {
  const normalizedLevel = normalizeExperienceLevel(level)
  if (normalizedLevel == null) return undefined
  return POKEMON_EXPERIENCE_BY_LEVEL.get(normalizedLevel)?.expNeeded ?? 0
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

export const resolvePokemonExperienceProgress = (
  level: number | null | undefined,
  totalExp: number | null | undefined,
): PokemonExperienceProgress | undefined => {
  const normalizedTotalExp = normalizeExperienceTotal(totalExp)
  const fallbackLevel = normalizeExperienceLevel(level)
  const progressLevel = normalizedTotalExp == null
    ? fallbackLevel
    : calculatePokemonLevelFromExperience(normalizedTotalExp)
  if (progressLevel == null) return undefined

  const currentLevelExp = pokemonExperienceNeededForLevel(progressLevel) ?? 0
  const trackedTotalExp = normalizedTotalExp ?? currentLevelExp
  const nextLevel = POKEMON_EXPERIENCE_CHART.find((entry) => entry.level > progressLevel) ?? null

  if (!nextLevel) {
    return {
      level: progressLevel,
      nextLevel: null,
      totalExp: trackedTotalExp,
      hasTrackedTotalExp: normalizedTotalExp != null,
      currentLevelExp,
      nextLevelExp: null,
      currentExp: 0,
      neededExp: 0,
      remainingExp: 0,
      percent: 100,
      isMaxLevel: true,
    }
  }

  const neededExp = Math.max(0, nextLevel.expNeeded - currentLevelExp)
  const currentExp = Math.min(
    neededExp,
    Math.max(0, trackedTotalExp - currentLevelExp),
  )
  const remainingExp = Math.max(0, neededExp - currentExp)

  return {
    level: progressLevel,
    nextLevel: nextLevel.level,
    totalExp: trackedTotalExp,
    hasTrackedTotalExp: normalizedTotalExp != null,
    currentLevelExp,
    nextLevelExp: nextLevel.expNeeded,
    currentExp,
    neededExp,
    remainingExp,
    percent: neededExp > 0 ? (currentExp / neededExp) * 100 : 100,
    isMaxLevel: false,
  }
}
