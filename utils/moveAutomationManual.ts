import { formatMoveDamageBase } from '~/utils/moveDamageBase'
import { parseMoveAutomationConditionSuggestions } from '~/utils/moveAutomationConditionSuggestions'
import { coerceMoveAccuracy, coerceMoveDamageBase } from '~/utils/moveAutomationCoercion'
import {
  parseMoveAutomationFieldSuggestions,
  parseMoveAutomationHazardSuggestions,
} from '~/utils/moveAutomationFieldHazardSuggestions'
import { parseMoveAutomationHpSuggestions } from '~/utils/moveAutomationHpSuggestions'
import { parseMoveAutomationStageSuggestions } from '~/utils/moveAutomationStages'
import {
  splitMoveRangeKeywords as splitRangeKeywords,
  textIncludes as has,
} from '~/utils/moveAutomationText'
import type {
  MoveAutomationScript,
  MoveAutomationTargetMode,
} from '~/types/moveAutomation'
import type { MoveAutomationMoveLike } from '~/utils/moveAutomation'

const determineTargetMode = (move: MoveAutomationMoveLike): MoveAutomationTargetMode => {
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

const determineTargetCount = (move: MoveAutomationMoveLike, mode: MoveAutomationTargetMode): number | null => {
  if (mode === 'self' || mode === 'none' || mode === 'field' || mode === 'hazard') return mode === 'self' ? 1 : null
  const range = move.range ?? ''
  const countMatch = range.match(/\b([235])\s+Targets\b/i)
  if (countMatch) return Number(countMatch[1])
  if (/Double Strike/i.test(range)) return 1
  return mode === 'one-target' ? 1 : null
}

const parseCriticalRange = (effect: string): number | null => {
  const match = effect.match(/Critical Hit on (?:a )?(\d{1,2})\+/i)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

export const createManualMoveAutomationScript = (move: MoveAutomationMoveLike): MoveAutomationScript => {
  const effect = move.effect ?? ''
  const range = move.range ?? ''
  const damageBase = coerceMoveDamageBase(move.damage_base)
  const damageClass = move.damage_class ?? null
  const targetMode = determineTargetMode(move)
  const keywords = splitRangeKeywords(range).filter((keyword) => !/^\d+$/.test(keyword) && !/1 Target|Single Target/i.test(keyword))
  const damaging = damageBase != null && damageClass !== 'Status' && damageClass !== 'Static'
  const requiresAccuracy = coerceMoveAccuracy(move.ac) != null && (damaging || targetMode === 'one-target' || targetMode === 'multi-target')
  const conditionSuggestions = parseMoveAutomationConditionSuggestions(effect)
  const stageSuggestions = parseMoveAutomationStageSuggestions(effect)
  const hpSuggestions = parseMoveAutomationHpSuggestions(move)
  const fieldSuggestions = parseMoveAutomationFieldSuggestions(move)
  const hazardSuggestions = parseMoveAutomationHazardSuggestions(move)
  const automationNotes: string[] = []

  if (!effect || /^None\.?$/i.test(effect.trim())) automationNotes.push('No secondary effect text in moves.json; resolve range keywords normally.')
  if (/may|choose|instead|Once (?:a|per) Scene|if |If |roll 1d|random|last Move|Move List|copy|Transform|switch|recalled|Grapple|Weight Class|Loyalty|Injury|Stockpiled|Trump|Perish|Substitute|Illusory|Barrier|Smokescreen|Court Change|Defog|Gravity|Tailwind|Haze|Wondered|Warped/i.test(effect)) {
    automationNotes.push('This move has conditional or unique text. The wizard exposes manual toggles; verify before applying.')
  }
  if (/Set-Up|Set Up|Execute|Priority|Interrupt|Reaction|Trigger|Shield|Full Action|Swift Action|Free Action|Exhaust/i.test(range)) {
    automationNotes.push('Timing/action keyword present; confirm this move is being resolved at the correct timing window.')
  }
  if (/Five Strike|Double Strike/i.test(range)) automationNotes.push('Multi-strike keyword present; enter the final damage after resolving strike count if needed.')
  if (/Blessing|Coat|Vortex|Leech Seed|Aqua Ring|Ingrain/i.test(effect)) automationNotes.push('Persistent non-sheet effect may need manual tracking after this transaction.')

  return {
    kind: 'manual-fallback',
    moveName: move.name,
    version: 1,
    targetMode,
    targetCount: determineTargetCount(move, targetMode),
    damaging,
    requiresAccuracy,
    damageBase,
    damageClass,
    type: move.type ?? 'Normal',
    ac: coerceMoveAccuracy(move.ac),
    range,
    effect,
    keywords,
    criticalRange: parseCriticalRange(effect),
    conditionSuggestions,
    stageSuggestions,
    hpSuggestions,
    fieldSuggestions,
    hazardSuggestions,
    automationNotes,
  }
}

export const damageFormulaForManualMove = (move: MoveAutomationMoveLike): string | null => {
  const roll = typeof move.damage_roll === 'string' ? move.damage_roll.trim() : ''
  if (roll) return roll.split('/')[0]?.trim() || null
  const db = coerceMoveDamageBase(move.damage_base)
  if (db == null) return null
  return formatMoveDamageBase(db)
}
