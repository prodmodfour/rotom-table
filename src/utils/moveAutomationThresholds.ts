const naturalRollMeetsSingleMoveThreshold = (
  threshold: string,
  naturalRoll: number,
): boolean => {
  const plus = threshold.match(/^(\d{1,2})\+$/)
  if (plus) return naturalRoll >= Number(plus[1])

  const range = threshold.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])
    return naturalRoll >= Math.min(start, end) && naturalRoll <= Math.max(start, end)
  }

  if (/^even roll$/i.test(threshold)) return naturalRoll % 2 === 0
  return false
}

export const naturalRollMeetsMoveThreshold = (
  threshold: string | null | undefined,
  naturalRoll: number,
): boolean => {
  const value = threshold?.trim()
  if (!value) return true

  return value
    .split(/\s+or\s+/i)
    .some((part) => naturalRollMeetsSingleMoveThreshold(part.trim(), naturalRoll))
}

export const parseMoveAutomationNaturalRoll = (accuracyRoll: string | null | undefined): number | null => {
  const match = accuracyRoll?.trim().match(/^(\d{1,2})(?=\D|$)/)
  if (!match) return null

  const roll = Number(match[1])
  return Number.isInteger(roll) && roll >= 1 && roll <= 20 ? roll : null
}

export const parseMoveAutomationNaturalRolls = (accuracyRoll: string | null | undefined): number[] => {
  const value = accuracyRoll?.trim()
  if (!value) return []

  return value
    .split(',')
    .map((part) => parseMoveAutomationNaturalRoll(part))
    .filter((roll): roll is number => roll != null)
}

export const accuracyRollMeetsMoveThreshold = (
  threshold: string | null | undefined,
  accuracyRoll: string | null | undefined,
): boolean => {
  if (!threshold?.trim()) return true
  return parseMoveAutomationNaturalRolls(accuracyRoll)
    .some((naturalRoll) => naturalRollMeetsMoveThreshold(threshold, naturalRoll))
}
