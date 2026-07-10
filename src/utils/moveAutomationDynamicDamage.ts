import type {
  MoveAutomationRandomRoller,
  MoveAutomationRollRequestMetadata,
} from '#shared/moveAutomation/random'
import { findMoveDamageBase, formatMoveDamageBaseFormula } from '~/utils/moveDamageBase'
import { moveAutomationSuggestionKey } from '~/utils/moveAutomationTargetResolution'
import type { CombatStageMap } from '~/types/combatStages'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export interface MoveAutomationRuntimeDamageFormulaResult {
  formula: string | null
  note: string | null
}

const singleDieDrawFormula = (formula: '1d6' | '1d8') => ({
  kind: 'dice' as const,
  count: 1,
  sides: formula === '1d8' ? 8 : 6,
  modifier: 0,
})

const rollSingleDieFormula = (
  formula: '1d6' | '1d8',
  random: () => number = Math.random,
): number => {
  const { sides } = singleDieDrawFormula(formula)
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
  randomRoller,
  rollMetadata,
}: {
  script: MoveAutomationScript
  user: SpawnedPokemon
  fallbackFormula: string | null | undefined
  random?: () => number
  randomRoller?: MoveAutomationRandomRoller
  rollMetadata?: MoveAutomationRollRequestMetadata
}): MoveAutomationRuntimeDamageFormulaResult => {
  const rule = script.dynamicDamageBase
  if (!rule) return { formula: fallbackFormula ?? null, note: null }

  const baseDb = script.damageBase ?? 0
  const stabDb = script.stabDamageBaseBonus ?? 0

  if (rule.kind === 'five-strike') {
    const tableEntries = [
      { minimum: 1, maximum: 1, value: 1 },
      { minimum: 2, maximum: 3, value: 2 },
      { minimum: 4, maximum: 6, value: 3 },
      { minimum: 7, maximum: 7, value: 4 },
      { minimum: 8, maximum: 8, value: 5 },
    ] as const
    const tableResult = randomRoller?.rollTable({
      ...(rollMetadata ?? {
        parentEffectId: 'legacy-v1.hit-count',
        reason: `${script.moveName} hit-count table`,
      }),
      formula: { kind: 'table', tableId: 'legacy-v1.five-strike-hit-count' },
      drawFormula: singleDieDrawFormula(rule.rollFormula),
      entries: tableEntries,
    })
    const roll = tableResult?.naturalResult ?? rollSingleDieFormula(rule.rollFormula, random)
    const hits = tableResult?.finalValue ?? fiveStrikeHitsForRoll(roll)
    const finalDb = baseDb * hits + stabDb
    const formula = damageFormulaForDb(finalDb)
    const note = `${rule.label} rolled ${roll}: ${hits} ${plural(hits, 'hit')}; DB ${baseDb} × ${hits}${stabDb ? ` + ${stabDb} STAB` : ''} = DB ${finalDb}.`
    return { formula, note }
  }

  if (rule.kind === 'double-strike') {
    return {
      formula: fallbackFormula ?? null,
      note: `${rule.label} requires two target-specific Accuracy Rolls and is resolved by seamless targeting.`,
    }
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
  randomRoller,
  rollMetadata,
}: {
  script: MoveAutomationScript
  enabledSuggestions: Record<string, boolean>
  random?: () => number
  randomRoller?: MoveAutomationRandomRoller
  rollMetadata?: MoveAutomationRollRequestMetadata
}): string | null => {
  const rule = script.randomStageSuggestion
  if (!rule) return null

  const tableResult = randomRoller?.rollTable({
    ...(rollMetadata ?? {
      parentEffectId: 'legacy-v1.random-stage',
      reason: `${script.moveName} random stage table`,
    }),
    formula: { kind: 'table', tableId: 'legacy-v1.random-stage-suggestion' },
    drawFormula: singleDieDrawFormula(rule.rollFormula),
    entries: rule.entries.map((entry) => ({
      minimum: entry.roll,
      maximum: entry.roll,
      value: entry.stageSuggestionIndex,
    })),
  })
  const roll = tableResult?.naturalResult ?? rollSingleDieFormula(rule.rollFormula, random)
  const entry = rule.entries.find((item) => item.roll === roll) ?? null
  if (!entry) return `${rule.label} rolled ${roll}: no matching stage boost.`

  enabledSuggestions[moveAutomationSuggestionKey(script, 'stage', entry.stageSuggestionIndex)] = true
  return `${rule.label} rolled ${roll}: ${entry.label}.`
}
