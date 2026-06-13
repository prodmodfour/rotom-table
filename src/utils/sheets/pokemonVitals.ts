import type { CharacterSheet } from '~/types/characterSheet'
import { clampHpValue } from '~/utils/ptuHp'
import { computeFullMaxHp, computeMaxHp, resolveStats } from '~/utils/sheets/pokemonDerived'
import { resolvePokemonExperienceProgress, type PokemonExperienceProgress } from '~/utils/sheets/pokemonExperience'
import { resolvedStatTotal } from '~/utils/sheets/resolvedStatRows'

export interface PokemonHpProgress {
  currentHp: number
  maxHp: number
  fullMaxHp: number
  percent: number
}

export interface PokemonVitalsProgress {
  hp: PokemonHpProgress
  experience: PokemonExperienceProgress
}

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export const resolvePokemonHpProgress = (
  sheet: CharacterSheet | null | undefined,
): PokemonHpProgress | null => {
  if (!sheet) return null

  const stats = resolveStats(sheet)
  const hpTotal = resolvedStatTotal(stats, 'hp')
  const fullMaxHp = computeFullMaxHp(sheet, hpTotal)
  const maxHp = computeMaxHp(sheet, hpTotal)
  const currentHp = clampHpValue(sheet.combat?.currentHp ?? maxHp, maxHp)
  const percent = maxHp > 0 ? clampPercent((currentHp / maxHp) * 100) : 0

  return { currentHp, maxHp, fullMaxHp, percent }
}

export const resolvePokemonVitalsProgress = (
  sheet: CharacterSheet | null | undefined,
): PokemonVitalsProgress | null => {
  if (!sheet) return null

  const hp = resolvePokemonHpProgress(sheet)
  const experience = resolvePokemonExperienceProgress(sheet.level, sheet.totalExp)
  if (!hp || !experience) return null

  return { hp, experience }
}
