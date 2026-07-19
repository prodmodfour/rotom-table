import type { MoveAutomationScript } from '~/types/moveAutomation'

export const SPIRIT_SURGE_KEYWORD = 'Spirit Surge' as const

/** Spirit Surge lets canonical Effect-line target effects pass the accuracy gate. */
export const moveAutomationHasSpiritSurgeKeyword = (
  script: Pick<MoveAutomationScript, 'keywords'> | null | undefined,
): boolean => script?.keywords.some(keyword => (
  keyword.trim().toLowerCase() === SPIRIT_SURGE_KEYWORD.toLowerCase()
)) ?? false
