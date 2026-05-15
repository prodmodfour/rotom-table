import type { SkillRank } from '~/types/trainerSheet'

export const SKILL_RANK_TO_VALUE: Record<SkillRank, number> = {
  Pathetic: 1,
  Untrained: 2,
  Novice: 3,
  Adept: 4,
  Expert: 5,
  Master: 6,
}

export const SKILL_RANK_TO_DICE: Record<SkillRank, string> = {
  Pathetic: '1d6',
  Untrained: '2d6',
  Novice: '3d6',
  Adept: '4d6',
  Expert: '5d6',
  Master: '6d6',
}

export const EXPERT_SKILL_RANK_VALUE = SKILL_RANK_TO_VALUE.Expert

export const parseSkillDiceRankValue = (value: string | null | undefined): number | null => {
  const match = value?.trim().match(/^(\d+)\s*d\s*6\b/i)
  if (!match) return null

  const dice = Number(match[1])
  return Number.isFinite(dice) && dice >= 1 ? Math.floor(dice) : null
}

export const skillRankValueAtLeast = (
  value: number | null | undefined,
  minimum: number,
): boolean => typeof value === 'number' && Number.isFinite(value) && value >= minimum
