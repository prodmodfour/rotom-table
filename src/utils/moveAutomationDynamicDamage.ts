import { findMoveDamageBase, formatMoveDamageBaseFormula } from '~/utils/moveDamageBase'
import { moveAutomationSuggestionKey } from '~/utils/moveAutomationTargetResolution'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export interface MoveAutomationRuntimeDamageFormulaResult {
  formula: string | null
  note: string | null
}

const rollSingleDieFormula = (
  formula: '1d6' | '1d8',
  random: () => number = Math.random,
): number => {
  const sides = formula === '1d8' ? 8 : 6
  return 1 + Math.floor(random() * sides)
}

const damageFormulaForDb = (db: number): string | null => {
  const definition = findMoveDamageBase(db)
  return definition ? formatMoveDamageBaseFormula(definition) : null
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
  count === 1 ? singular : pluralForm

const fiveStrikeHitsForRoll = (roll: number): number => {
  if (roll <= 1) return 1
  if (roll <= 3) return 2
  if (roll <= 6) return 3
  if (roll === 7) return 4
  return 5
}

const positiveCombatStageTotal = (stages: CombatStageMap): number =>
  Object.values(stages).reduce((sum, value) => sum + Math.max(0, Math.floor(value)), 0)

export const moveAutomationCanResolveDamageAtRuntime = (
  script: MoveAutomationScript | null | undefined,
): boolean => Boolean(script?.dynamicDamageBase || script?.directHpLoss?.kind === 'fixed')

export const resolveMoveAutomationRuntimeDamageFormula = ({
  script,
  user,
  fallbackFormula,
  random,
}: {
  script: MoveAutomationScript
  user: SpawnedPokemon
  fallbackFormula: string | null | undefined
  random?: () => number
}): MoveAutomationRuntimeDamageFormulaResult => {
  const rule = script.dynamicDamageBase
  if (!rule) return { formula: fallbackFormula ?? null, note: null }

  const baseDb = script.damageBase ?? 0
  const stabDb = script.stabDamageBaseBonus ?? 0

  if (rule.kind === 'five-strike') {
    const roll = rollSingleDieFormula(rule.rollFormula, random)
    const hits = fiveStrikeHitsForRoll(roll)
    const finalDb = baseDb * hits + stabDb
    const formula = damageFormulaForDb(finalDb)
    const note = `${rule.label} rolled ${roll}: ${hits} ${plural(hits, 'hit')}; DB ${baseDb} × ${hits}${stabDb ? ` + ${stabDb} STAB` : ''} = DB ${finalDb}.`
    return { formula, note }
  }

  const positiveStages = positiveCombatStageTotal(user.combatStages)
  const scaledDb = Math.min(rule.maxDamageBase, baseDb + (positiveStages * rule.dbPerPositiveStage))
  const finalDb = scaledDb + stabDb
  const formula = damageFormulaForDb(finalDb)
  const note = `${rule.label}: ${positiveStages} positive Combat ${plural(positiveStages, 'Stage')} -> DB ${scaledDb}${stabDb ? ` + ${stabDb} STAB = DB ${finalDb}` : ''}.`
  return { formula, note }
}

export const resolveMoveAutomationRandomStageSuggestion = ({
  script,
  enabledSuggestions,
  random,
}: {
  script: MoveAutomationScript
  enabledSuggestions: Record<string, boolean>
  random?: () => number
}): string | null => {
  const rule = script.randomStageSuggestion
  if (!rule) return null

  const roll = rollSingleDieFormula(rule.rollFormula, random)
  const entry = rule.entries.find((item) => item.roll === roll) ?? null
  if (!entry) return `${rule.label} rolled ${roll}: no matching stage boost.`

  enabledSuggestions[moveAutomationSuggestionKey(script, 'stage', entry.stageSuggestionIndex)] = true
  return `${rule.label} rolled ${roll}: ${entry.label}.`
}
