export const normalizeMoveAutomationWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

export const textIncludes = (haystack: string, needle: string | RegExp): boolean =>
  typeof needle === 'string' ? haystack.toLowerCase().includes(needle.toLowerCase()) : needle.test(haystack)

export const splitMoveRangeKeywords = (range: string): string[] =>
  range
    .split(/[,;]/g)
    .map((part) => normalizeMoveAutomationWhitespace(part).replace(/^or\s+/i, ''))
    .filter(Boolean)

export const parseMoveAutomationExplicitTargetCount = (text: string): number | null => {
  const counts = Array.from(text.matchAll(/\b([1-9]\d*)[\s-]+Targets?\b/gi))
    .map((match) => Number(match[1]))
    .filter((count) => Number.isInteger(count) && count > 0)
  return counts.length ? Math.max(...counts) : null
}

export const hasMoveAutomationExplicitMultiTargetCount = (text: string): boolean => {
  const count = parseMoveAutomationExplicitTargetCount(text)
  return count != null && count > 1
}

export const effectThresholdNear = (text: string, index: number): string | undefined => {
  const nearby = text.slice(Math.max(0, index - 40), Math.min(text.length, index + 80))
  const numbered = nearby.match(/(?:on|On|roll of|rolled|Accuracy Check)\s+(?:a\s+)?(\d{1,2}\+|\d{1,2}-\d{1,2})/)
  if (numbered) return numbered[1]
  if (/Even-?Numbered/i.test(nearby)) return 'even roll'
  return undefined
}
