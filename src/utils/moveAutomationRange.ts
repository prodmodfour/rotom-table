import {
  hasMoveAutomationExplicitMultiTargetCount,
  splitMoveRangeKeywords,
} from '~/utils/moveAutomationText'
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

const numericRangeKeyword = (keywords: readonly string[]): number | null => {
  const numericKeyword = keywords.find((keyword) => /^(?:Range\s+)?\d+$/i.test(keyword))
  const match = numericKeyword?.match(/\d+/)
  return match ? Number(match[0]) : null
}

const positiveNumericRangeKeyword = (keywords: readonly string[]): number | null => {
  const value = numericRangeKeyword(keywords)
  return value != null && Number.isInteger(value) && value > 0 ? value : null
}

const keywordsIncludeMeleeRange = (keywords: readonly string[]): boolean =>
  // Canonical PTU source also writes target count compactly as `Melee 1`.
  keywords.some((keyword) => /^Melee(?:\s+\d+)?$/i.test(keyword))

export const parseSingleTargetMoveRangeMeters = (
  range: string | null | undefined,
  options: SingleTargetMoveRangeOptions = {},
): number | null => {
  const keywords = splitMoveRangeKeywords(range ?? '')
  const numericRange = numericRangeKeyword(keywords)
  if (numericRange != null) return numericRange
  if (keywords.some((keyword) => /^Focus Rank$/i.test(keyword))) return finitePositiveRankValue(options.focusSkillRankValue)
  return keywordsIncludeMeleeRange(keywords) ? MELEE_MOVE_RANGE_METERS : null
}

const rangeMetersForKeywords = (keywords: readonly string[]): number | null => {
  const numericRange = positiveNumericRangeKeyword(keywords)
  if (numericRange != null) return numericRange
  return keywordsIncludeMeleeRange(keywords) ? MELEE_MOVE_RANGE_METERS : null
}

const explicitMultiTargetRangeClauses = (range: string): string[] => range
  .split(/\s*;\s*(?:or\s+)?|\s+\bor\b\s+/i)
  .map((clause) => clause.trim())
  .filter(Boolean)

export const parseExplicitMultiTargetMoveRangeMeters = (range: string | null | undefined): number | null => {
  const value = range ?? ''
  if (!hasMoveAutomationExplicitMultiTargetCount(value)) return null

  const matchingClause = explicitMultiTargetRangeClauses(value).find(hasMoveAutomationExplicitMultiTargetCount)
  return rangeMetersForKeywords(splitMoveRangeKeywords(matchingClause ?? ''))
    ?? rangeMetersForKeywords(splitMoveRangeKeywords(value))
}

/** Reviewed weapon profiles may add a lower bound beside the ordinary maximum. */
export const parseMoveMinimumRangeMeters = (range: string | null | undefined): number => {
  const match = /(?:^|[,;])\s*Minimum Range\s+(\d+)\b/iu.exec(range ?? '')
  if (!match) return 0
  const value = Number(match[1])
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

export const moveAutomationTargetsInRange = (options: {
  user: SpawnedPokemon
  tokens: readonly SpawnedPokemon[]
  rangeMeters: number
}): SpawnedPokemon[] => options.tokens.filter((token) =>
  token.id !== options.user.id && tokenGridDistance(options.user, token) <= options.rangeMeters,
)
