export interface PokemonExperienceChartEntry {
  level: number
  expNeeded: number
}

// PTU Pokémon Experience Chart (Core book, p. 203), encoded directly so
// runtime calculations do not depend on the markdown book extraction.
export const POKEMON_EXPERIENCE_CHART = [
  { level: 1, expNeeded: 0 },
  { level: 2, expNeeded: 10 },
  { level: 3, expNeeded: 20 },
  { level: 4, expNeeded: 30 },
  { level: 5, expNeeded: 40 },
  { level: 6, expNeeded: 50 },
  { level: 7, expNeeded: 60 },
  { level: 8, expNeeded: 70 },
  { level: 9, expNeeded: 80 },
  { level: 10, expNeeded: 90 },
  { level: 11, expNeeded: 110 },
  { level: 12, expNeeded: 135 },
  { level: 13, expNeeded: 160 },
  { level: 14, expNeeded: 190 },
  { level: 15, expNeeded: 220 },
  { level: 16, expNeeded: 250 },
  { level: 17, expNeeded: 285 },
  { level: 18, expNeeded: 320 },
  { level: 19, expNeeded: 360 },
  { level: 20, expNeeded: 400 },
  { level: 21, expNeeded: 460 },
  { level: 22, expNeeded: 530 },
  { level: 23, expNeeded: 600 },
  { level: 24, expNeeded: 670 },
  { level: 25, expNeeded: 745 },
  { level: 26, expNeeded: 820 },
  { level: 27, expNeeded: 900 },
  { level: 28, expNeeded: 990 },
  { level: 29, expNeeded: 1075 },
  { level: 30, expNeeded: 1165 },
  { level: 31, expNeeded: 1260 },
  { level: 32, expNeeded: 1355 },
  { level: 33, expNeeded: 1455 },
  { level: 34, expNeeded: 1555 },
  { level: 35, expNeeded: 1660 },
  { level: 36, expNeeded: 1770 },
  { level: 37, expNeeded: 1880 },
  { level: 38, expNeeded: 1995 },
  { level: 39, expNeeded: 2110 },
  { level: 40, expNeeded: 2230 },
  { level: 41, expNeeded: 2355 },
  { level: 42, expNeeded: 2480 },
  { level: 43, expNeeded: 2610 },
  { level: 44, expNeeded: 2740 },
  { level: 45, expNeeded: 2875 },
  { level: 46, expNeeded: 3015 },
  { level: 47, expNeeded: 3155 },
  { level: 48, expNeeded: 3300 },
  { level: 49, expNeeded: 3445 },
  { level: 50, expNeeded: 3645 },
  { level: 51, expNeeded: 3850 },
  { level: 52, expNeeded: 4060 },
  { level: 53, expNeeded: 4270 },
  { level: 54, expNeeded: 4485 },
  { level: 55, expNeeded: 4705 },
  { level: 56, expNeeded: 4930 },
  { level: 57, expNeeded: 5160 },
  { level: 58, expNeeded: 5390 },
  { level: 59, expNeeded: 5625 },
  { level: 60, expNeeded: 5865 },
  { level: 61, expNeeded: 6110 },
  { level: 62, expNeeded: 6360 },
  { level: 63, expNeeded: 6610 },
  { level: 64, expNeeded: 6865 },
  { level: 65, expNeeded: 7125 },
  { level: 66, expNeeded: 7390 },
  { level: 67, expNeeded: 7660 },
  { level: 68, expNeeded: 7925 },
  { level: 69, expNeeded: 8205 },
  { level: 70, expNeeded: 8485 },
  { level: 71, expNeeded: 8770 },
  { level: 72, expNeeded: 9060 },
  { level: 73, expNeeded: 9350 },
  { level: 74, expNeeded: 9645 },
  { level: 75, expNeeded: 9945 },
  { level: 76, expNeeded: 10250 },
  { level: 77, expNeeded: 10560 },
  { level: 78, expNeeded: 10870 },
  { level: 79, expNeeded: 11185 },
  { level: 80, expNeeded: 11505 },
  { level: 81, expNeeded: 11910 },
  { level: 82, expNeeded: 12320 },
  { level: 83, expNeeded: 12735 },
  { level: 84, expNeeded: 13155 },
  { level: 85, expNeeded: 13580 },
  { level: 86, expNeeded: 14010 },
  { level: 87, expNeeded: 14445 },
  { level: 88, expNeeded: 14885 },
  { level: 89, expNeeded: 15330 },
  { level: 90, expNeeded: 15780 },
  { level: 91, expNeeded: 16235 },
  { level: 92, expNeeded: 16695 },
  { level: 93, expNeeded: 17160 },
  { level: 94, expNeeded: 17630 },
  { level: 95, expNeeded: 18105 },
  { level: 96, expNeeded: 18585 },
  { level: 97, expNeeded: 19070 },
  { level: 98, expNeeded: 19560 },
  { level: 99, expNeeded: 20055 },
  { level: 100, expNeeded: 20555 },
] as const satisfies readonly PokemonExperienceChartEntry[]

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
