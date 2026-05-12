import { coerceMoveDamageBase } from '~/utils/moveAutomationCoercion'
import {
  splitMoveRangeKeywords,
  textIncludes as has,
} from '~/utils/moveAutomationText'
import type { MoveAutomationTargetMode } from '~/types/moveAutomation'

export interface MoveAutomationTargetingMove {
  name: string
  range?: string | null
  effect?: string | null
  damage_base?: unknown
}

export const determineMoveAutomationTargetMode = (move: MoveAutomationTargetingMove): MoveAutomationTargetMode => {
  const range = move.range ?? ''
  const effect = move.effect ?? ''
  const combined = `${range} ${effect}`
  const damaging = coerceMoveDamageBase(move.damage_base) != null

  if (has(range, /\bHazard\b/i) || /Spikes|Sticky Web|Stealth Rock/.test(move.name)) return 'hazard'
  if (has(range, /\bField\b/i) || has(range, /\bWeather\b/i)) return 'field'
  if (has(range, /\bSelf\b/i) && !has(range, /\bTarget\b/i) && !has(range, /Burst|Cone|Line|Blast/i)) return 'self'
  if (has(range, /Burst|Cone|Line|Blast|all adjacent|all legal targets|all targets|\b[235]\s+Targets\b/i)) return 'multi-target'
  if (has(range, /\b1\s*Target\b|\bSingle Target\b|\bTarget\b|\bMelee\b|^\s*\d+\b/i)) return 'one-target'
  if (damaging) return 'one-target'
  if (has(combined, /target/i)) return 'one-target'
  return 'none'
}

export const determineMoveAutomationTargetCount = (
  move: Pick<MoveAutomationTargetingMove, 'range'>,
  mode: MoveAutomationTargetMode,
): number | null => {
  if (mode === 'self' || mode === 'none' || mode === 'field' || mode === 'hazard') return mode === 'self' ? 1 : null

  const range = move.range ?? ''
  const countMatch = range.match(/\b([235])\s+Targets\b/i)
  if (countMatch) return Number(countMatch[1])
  if (/Double Strike/i.test(range)) return 1
  return mode === 'one-target' ? 1 : null
}

export const buildMoveAutomationRangeKeywords = (range: string): string[] =>
  splitMoveRangeKeywords(range).filter((keyword) => !/^\d+$/.test(keyword) && !/1 Target|Single Target/i.test(keyword))

export const parseMoveAutomationCriticalRange = (effect: string): number | null => {
  const match = effect.match(/Critical Hit on (?:a )?(\d{1,2})\+/i)
  if (!match) return null

  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}
