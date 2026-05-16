import { effectThresholdNear } from '~/utils/moveAutomationText'
import { conditionsFromText, normalizeConditionName } from '~/utils/statusConditions'
import type { MoveAutomationConditionSuggestion } from '~/types/moveAutomation'

const STATUS_CLEAR_RE = /cures? (?:all of )?(?:its|the user.s|the target.s|their)?\s*(?:Persistent or Volatile )?Status|cured of (?:all |any |a )?Status|cured of all Permanent and Volatile Statuses|All targets are cured of any Persistent Status/i
const CLEAR_TARGET_RE = /target|All targets/i
const CLEAR_USER_AND_ALLIES_RE = /user and any allies/i
const CLEAR_OPTIONAL_RE = /choice|one status|may/i
const USER_CONTEXT_RE = /user|itself|the user/i
const TARGET_CONTEXT_RE = /target|foe/i
const USER_ACTION_RE = /falls|becomes|is|cured/i
const REMOVE_ACTION_RE = /cures?|cured|removes?/i
const CONTEXTUAL_MENTION_RE = /\bif\b|\bwhile\b|already|has been|have been|afflicted with|affected by|immune to|cannot Sleep|ignore the first turn/i
const OPTIONAL_CONDITION_RE = /may choose|may|can choose/i

const CONDITION_SEARCH_TERMS: Record<string, string[]> = {
  Burned: ['burned', 'burns', 'burn'],
  Frozen: ['frozen', 'freezes', 'freeze'],
  Paralysis: ['paralysis', 'paralyzes', 'paralyses', 'paralyzed', 'paralysed', 'paralyze', 'paralyse'],
  Poisoned: ['poisoned', 'poisons', 'poison'],
  Sleep: ['asleep', 'sleeping', 'sleep'],
  Slowed: ['slowed', 'slows', 'slow'],
  Tripped: ['tripped', 'trips', 'tripping', 'trip'],
}

const conditionSearchTerms = (condition: string): string[] =>
  CONDITION_SEARCH_TERMS[condition] ?? [condition.toLowerCase().split(' ')[0] ?? '']

const conditionMentionIndex = (effect: string, condition: string): number => {
  const lowerEffect = effect.toLowerCase()
  return conditionSearchTerms(condition)
    .map((term) => lowerEffect.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? -1
}

const conditionWindow = (effect: string, index: number): string => {
  if (index < 0) return effect
  return effect.slice(Math.max(0, index - 90), Math.min(effect.length, index + 120))
}

const inferConditionRecipient = (
  effect: string,
  canonicalCondition: string,
  before: string,
  after: string,
): MoveAutomationConditionSuggestion['recipient'] => {
  const userish = USER_CONTEXT_RE.test(before) && !TARGET_CONTEXT_RE.test(before.slice(-40))
  if (/Rest/i.test(effect) && canonicalCondition === 'Sleep') return 'user'
  return userish && USER_ACTION_RE.test(after) ? 'user' : 'target'
}

const buildClearSuggestion = (effect: string): MoveAutomationConditionSuggestion | null => {
  if (!STATUS_CLEAR_RE.test(effect)) return null
  const recipient = CLEAR_TARGET_RE.test(effect) && !CLEAR_USER_AND_ALLIES_RE.test(effect) ? 'target' : 'user'
  return {
    recipient,
    condition: '*',
    action: 'clear',
    label: recipient === 'user' ? 'Clear user conditions' : 'Clear target conditions',
    optional: CLEAR_OPTIONAL_RE.test(effect),
  }
}

export const parseMoveAutomationConditionSuggestions = (effect: string): MoveAutomationConditionSuggestion[] => {
  const suggestions: MoveAutomationConditionSuggestion[] = []
  const clearSuggestion = buildClearSuggestion(effect)
  if (clearSuggestion) suggestions.push(clearSuggestion)

  for (const condition of conditionsFromText(effect)) {
    const canonical = normalizeConditionName(condition) ?? condition
    const index = conditionMentionIndex(effect, canonical)
    const threshold = index >= 0 ? effectThresholdNear(effect, index) : undefined
    const before = index >= 0 ? effect.slice(Math.max(0, index - 80), index) : ''
    const after = index >= 0 ? effect.slice(index, Math.min(effect.length, index + 100)) : ''
    const window = conditionWindow(effect, index)
    const recipient = inferConditionRecipient(effect, canonical, before, after)
    const action = REMOVE_ACTION_RE.test(window) ? 'remove' : 'add'
    const contextualMention = CONTEXTUAL_MENTION_RE.test(window)

    suggestions.push({
      recipient,
      condition: canonical,
      action,
      label: threshold ? `${canonical} on ${threshold}` : canonical,
      threshold,
      optional: Boolean(threshold) || contextualMention || OPTIONAL_CONDITION_RE.test(window),
    })
  }

  return suggestions
}
