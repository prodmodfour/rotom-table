import { formatMoveDamageBase } from '~/utils/moveDamageBase'
import { parseMoveAutomationAreaTemplates } from '~/utils/moveAutomationAreaTemplates'
import { parseMoveAutomationConditionSuggestions } from '~/utils/moveAutomationConditionSuggestions'
import { coerceMoveAccuracy, coerceMoveDamageBase } from '~/utils/moveAutomationCoercion'
import {
  parseMoveAutomationFieldSuggestions,
  parseMoveAutomationHazardSuggestions,
} from '~/utils/moveAutomationFieldHazardSuggestions'
import { parseMoveAutomationHpSuggestions } from '~/utils/moveAutomationHpSuggestions'
import { parseMoveAutomationStageSuggestions } from '~/utils/moveAutomationStages'
import {
  buildMoveAutomationRangeKeywords,
  determineMoveAutomationTargetCount,
  determineMoveAutomationTargetMode,
  parseMoveAutomationCriticalRange,
} from '~/utils/moveAutomationTargeting'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { MoveAutomationMoveLike } from '~/utils/move-automation/moveData'

export const createMoveAutomationScriptFromMoveData = (move: MoveAutomationMoveLike): MoveAutomationScript => {
  const effect = move.effect ?? ''
  const special = move.special ?? ''
  const range = move.range ?? ''
  const damageBase = coerceMoveDamageBase(move.damage_base)
  const damageClass = move.damage_class ?? null
  const targetMode = determineMoveAutomationTargetMode(move)
  const keywords = buildMoveAutomationRangeKeywords(range)
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
    automationNotes.push('This move has conditional or unique text; verify the automated result before applying.')
  }
  if (/Set-Up|Set Up|Execute|Priority|Interrupt|Reaction|Trigger|Shield|Full Action|Swift Action|Free Action|Exhaust/i.test(range)) {
    automationNotes.push('Timing/action keyword present; confirm this move is being resolved at the correct timing window.')
  }
  if (/Five Strike|Double Strike/i.test(range)) automationNotes.push('Multi-strike keyword present; enter the final damage after resolving strike count if needed.')
  if (/Blessing|Coat|Vortex|Leech Seed|Aqua Ring|Ingrain/i.test(effect)) automationNotes.push('Persistent non-sheet effect may need manual tracking after this transaction.')

  return {
    kind: 'explicit',
    moveName: move.name,
    version: 1,
    targetMode,
    targetCount: determineMoveAutomationTargetCount(move, targetMode),
    damaging,
    requiresAccuracy,
    damageBase,
    damageClass,
    type: move.type ?? 'Normal',
    ac: coerceMoveAccuracy(move.ac),
    range,
    effect,
    special,
    keywords,
    criticalRange: parseMoveAutomationCriticalRange(effect),
    areaTemplates: parseMoveAutomationAreaTemplates(range),
    conditionSuggestions,
    stageSuggestions,
    hpSuggestions,
    fieldSuggestions,
    hazardSuggestions,
    automationNotes,
  }
}

export const damageFormulaForMoveData = (move: MoveAutomationMoveLike): string | null => {
  const roll = typeof move.damage_roll === 'string' ? move.damage_roll.trim() : ''
  if (roll) return roll.split('/')[0]?.trim() || null
  const db = coerceMoveDamageBase(move.damage_base)
  if (db == null) return null
  return formatMoveDamageBase(db)
}
