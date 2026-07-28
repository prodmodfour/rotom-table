import { sheetHasCanonicalAbility } from '~/utils/sheetAbilities'
import { conditionBaseName } from '~/utils/statusConditions'
import type { MoveAutomationConditionSuggestion, MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export const POISON_TOUCH_ABILITY_NAME = 'Poison Touch'
export const POISON_TOUCH_DEFAULT_THRESHOLD = '19+'

const POISON_TOUCH_LABEL_MARKER = /\bPoison Touch\b/i
const POISONED_CONDITION_NAME = 'Poisoned'
const BADLY_POISONED_CONDITION_NAME = 'Badly Poisoned'
const POISON_AFFLICTION_NAMES = new Set([POISONED_CONDITION_NAME, BADLY_POISONED_CONDITION_NAME])

export const tokenHasPoisonTouch = (
  token: Pick<SpawnedPokemon, 'abilityNames'>,
): boolean => sheetHasCanonicalAbility(token.abilityNames, POISON_TOUCH_ABILITY_NAME)

const targetPoisonAfflictionAddition = (suggestion: MoveAutomationConditionSuggestion): boolean => {
  if (suggestion.recipient !== 'target') return false
  if (suggestion.action === 'remove' || suggestion.action === 'clear') return false
  const condition = conditionBaseName(suggestion.condition) ?? suggestion.condition
  return POISON_AFFLICTION_NAMES.has(condition)
}

const trimmedThreshold = (threshold: string | null | undefined): string => threshold?.trim() ?? ''

export const poisonTouchAdjustedThreshold = (threshold: string | null | undefined): string | null => {
  const value = trimmedThreshold(threshold)
  if (!value) return null

  const plus = value.match(/^(\d{1,2})\+$/)
  if (plus) return `${Math.max(1, Number(plus[1]) - 2)}+`

  const range = value.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/)
  if (range) {
    const start = Number(range[1])
    const end = Number(range[2])
    const min = Math.min(start, end)
    const max = Math.max(start, end)
    return `${Math.max(1, min - 2)}-${max}`
  }

  if (/^even roll$/i.test(value)) return 'even roll or 17+'
  return null
}

const poisonTouchAdjustedLabel = (label: string, oldThreshold: string, newThreshold: string): string => {
  if (POISON_TOUCH_LABEL_MARKER.test(label)) return label
  const threshold = oldThreshold.trim()
  const withAdjustedThreshold = threshold && label.includes(threshold)
    ? label.replace(threshold, newThreshold)
    : `${label} (${newThreshold})`
  return `${withAdjustedThreshold} (Poison Touch)`
}

const poisonTouchSuggestion = (): MoveAutomationConditionSuggestion => ({
  recipient: 'target',
  condition: POISONED_CONDITION_NAME,
  action: 'add',
  label: `Poison Touch: ${POISONED_CONDITION_NAME} on ${POISON_TOUCH_DEFAULT_THRESHOLD}`,
  threshold: POISON_TOUCH_DEFAULT_THRESHOLD,
})

export const moveAutomationScriptWithPoisonTouch = (
  script: MoveAutomationScript,
  user: Pick<SpawnedPokemon, 'abilityNames'>,
): MoveAutomationScript => {
  if (!script.damaging || !script.requiresAccuracy || !tokenHasPoisonTouch(user)) return script

  let changed = false
  let hasPoisonAfflictionSuggestion = false
  const conditionSuggestions = script.conditionSuggestions.map((suggestion) => {
    if (!targetPoisonAfflictionAddition(suggestion)) return suggestion
    hasPoisonAfflictionSuggestion = true

    const threshold = trimmedThreshold(suggestion.threshold)
    if (!threshold || POISON_TOUCH_LABEL_MARKER.test(suggestion.label)) return suggestion

    const adjustedThreshold = poisonTouchAdjustedThreshold(threshold)
    if (!adjustedThreshold || adjustedThreshold === threshold) return suggestion

    changed = true
    return {
      ...suggestion,
      threshold: adjustedThreshold,
      label: poisonTouchAdjustedLabel(suggestion.label, threshold, adjustedThreshold),
    }
  })

  if (!hasPoisonAfflictionSuggestion) {
    changed = true
    conditionSuggestions.push(poisonTouchSuggestion())
  }

  return changed
    ? {
        ...script,
        conditionSuggestions,
      }
    : script
}
