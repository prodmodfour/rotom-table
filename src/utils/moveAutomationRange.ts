import { splitMoveRangeKeywords } from '~/utils/moveAutomationText'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'
import type { SpawnedPokemon } from '~/types/pokemon'

export const MELEE_MOVE_RANGE_METERS = 1

export const tokenGridDistance = (
  left: Pick<SpawnedPokemon, 'base' | 'clearance' | 'position'>,
  right: Pick<SpawnedPokemon, 'base' | 'clearance' | 'position'>,
): number => ptuGridDistanceBetweenFootprints(left, right)

export interface SingleTargetMoveRangeOptions {
  focusSkillRankValue?: number | null
}

const finitePositiveRankValue = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null

export const parseSingleTargetMoveRangeMeters = (
  range: string | null | undefined,
  options: SingleTargetMoveRangeOptions = {},
): number | null => {
  const keywords = splitMoveRangeKeywords(range ?? '')
  const numericKeyword = keywords.find((keyword) => /^\d+$/.test(keyword))
  if (numericKeyword) return Number(numericKeyword)
  if (keywords.some((keyword) => /^Focus Rank$/i.test(keyword))) return finitePositiveRankValue(options.focusSkillRankValue)
  return keywords.some((keyword) => /^Melee$/i.test(keyword)) ? MELEE_MOVE_RANGE_METERS : null
}

export const moveAutomationTargetsInRange = (options: {
  user: SpawnedPokemon
  tokens: readonly SpawnedPokemon[]
  rangeMeters: number
}): SpawnedPokemon[] => options.tokens.filter((token) =>
  token.id !== options.user.id && tokenGridDistance(options.user, token) <= options.rangeMeters,
)
