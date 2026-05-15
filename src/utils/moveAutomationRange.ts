import { getClearanceValue } from '~/utils/gridGeometry'
import { splitMoveRangeKeywords } from '~/utils/moveAutomationText'
import type { SpawnedPokemon } from '~/types/pokemon'

export const MELEE_MOVE_RANGE_METERS = 1

const gridAxisDistance = (
  leftStart: number,
  leftSize: number,
  rightStart: number,
  rightSize: number,
): number => {
  if (leftStart <= rightStart) {
    const gap = rightStart - (leftStart + leftSize)
    return gap >= 0 ? gap + 1 : 0
  }

  const gap = leftStart - (rightStart + rightSize)
  return gap >= 0 ? gap + 1 : 0
}

export const tokenGridDistance = (
  left: Pick<SpawnedPokemon, 'base' | 'clearance' | 'position'>,
  right: Pick<SpawnedPokemon, 'base' | 'clearance' | 'position'>,
): number => Math.max(
  gridAxisDistance(left.position.x, left.base, right.position.x, right.base),
  gridAxisDistance(left.position.y, getClearanceValue(left), right.position.y, getClearanceValue(right)),
  gridAxisDistance(left.position.z, left.base, right.position.z, right.base),
)

export const parseSingleTargetMoveRangeMeters = (range: string | null | undefined): number | null => {
  const keywords = splitMoveRangeKeywords(range ?? '')
  const numericKeyword = keywords.find((keyword) => /^\d+$/.test(keyword))
  if (numericKeyword) return Number(numericKeyword)
  return keywords.some((keyword) => /^Melee$/i.test(keyword)) ? MELEE_MOVE_RANGE_METERS : null
}

export const moveAutomationTargetsInRange = (options: {
  user: SpawnedPokemon
  tokens: readonly SpawnedPokemon[]
  rangeMeters: number
}): SpawnedPokemon[] => options.tokens.filter((token) =>
  token.id !== options.user.id && tokenGridDistance(options.user, token) <= options.rangeMeters,
)
