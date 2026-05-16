import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { conditionAdjustedCombatStage } from '~/utils/sheetConditionEffects'
import { fieldEffectDamageBonus, type DamageRollResult } from '~/utils/moveAutomation'
import { parsePositiveInt } from '~/utils/moveAutomationDialog'
import { applyInfatuationOffenseModifier, resolveInfatuationDamageEffect } from '~/utils/infatuationDamage'
import { resolveMoveAutomationDirectHpLoss } from '~/utils/moveAutomationDirectHpLoss'
import { formatMultiplier } from '~/utils/typeChart'
import { computeSheetAbilityAwareMultiplier } from '~/utils/sheetPassiveAbilityEffects'
import type { MapFieldEffects } from '~/types/map'
import type { MoveAutomationScript } from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export type MoveAutomationSuggestionKind = 'condition' | 'stage' | 'hp' | 'field' | 'hazard'

export interface MoveAutomationTargetResolutionState {
  accuracyRoll: string
  hit: boolean
  crit: boolean
  damageRoll: DamageRollResult | null
  manualHpLoss: string
  applyDamage: boolean
}

export const moveAutomationSuggestionKey = (
  script: MoveAutomationScript | null | undefined,
  kind: MoveAutomationSuggestionKind,
  index: number,
): string => `${script?.moveName ?? 'move'}:${kind}:${index}`

export const defaultTargetResolutionState = (
  script: MoveAutomationScript | null | undefined,
): MoveAutomationTargetResolutionState => ({
  accuracyRoll: '',
  hit: !script?.requiresAccuracy,
  crit: false,
  damageRoll: null,
  manualHpLoss: '',
  applyDamage: Boolean(script?.damaging),
})

export const suggestionIsEnabled = (
  script: MoveAutomationScript | null | undefined,
  enabledSuggestions: Readonly<Record<string, boolean | undefined>>,
  kind: MoveAutomationSuggestionKind,
  index: number,
): boolean => Boolean(enabledSuggestions[moveAutomationSuggestionKey(script, kind, index)])

export const moveAutomationTargetDamageMultiplier = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
): number => computeSheetAbilityAwareMultiplier(
  script?.type ?? 'Normal',
  target.defenderTypes,
  target.abilityNames,
  target.defenderCapabilities,
)

export const moveAutomationMultiplierLabel = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
): string => {
  const multiplier = moveAutomationTargetDamageMultiplier(script, target)
  if (script?.directHpLoss?.ignoreWeaknessResistance) {
    return multiplier === 0 ? '0 (immune)' : '1 (ignores weakness/resistance)'
  }
  return formatMultiplier(multiplier)
}

export const resolveMoveAutomationTargetDamageLoss = (
  script: MoveAutomationScript | null | undefined,
  user: SpawnedPokemon,
  target: SpawnedPokemon,
  resolution: MoveAutomationTargetResolutionState | undefined,
  fieldEffects?: MapFieldEffects,
  selectedTargets: readonly SpawnedPokemon[] = [target],
): number => {
  if (!script?.damaging) return 0
  const state = resolution ?? defaultTargetResolutionState(script)
  if (!state.applyDamage || !state.hit) return 0
  const manual = parsePositiveInt(state.manualHpLoss)
  if (manual != null) return manual
  const directHpLoss = resolveMoveAutomationDirectHpLoss({
    script,
    user,
    target,
    rollTotal: state.damageRoll?.total,
  })
  if (directHpLoss != null) return directHpLoss
  const baseRollTotal = state.damageRoll?.total ?? 0
  const criticalDiceBonus = state.crit
    ? state.damageRoll?.rolls.reduce((sum, roll) => sum + roll, 0) ?? 0
    : 0
  const unmodifiedRaw = baseRollTotal + criticalDiceBonus
  if (unmodifiedRaw <= 0) return 0
  const infatuation = resolveInfatuationDamageEffect(user.conditions, selectedTargets)
  const raw = unmodifiedRaw + infatuation.damageRollModifier
  const physical = script.damageClass === 'Physical'
  const stagedOffense = physical
    ? applyCombatStageToStat(user.atk, conditionAdjustedCombatStage(user.combatStages.atk, user.conditions, 'atk'))
    : applyCombatStageToStat(user.satk, conditionAdjustedCombatStage(user.combatStages.satk, user.conditions, 'satk'))
  const offense = applyInfatuationOffenseModifier(stagedOffense, infatuation)
  const defense = physical
    ? applyCombatStageToStat(target.def, conditionAdjustedCombatStage(target.combatStages.def, target.conditions, 'def'))
    : applyCombatStageToStat(target.sdef, conditionAdjustedCombatStage(target.combatStages.sdef, target.conditions, 'sdef'))
  const fieldBonus = fieldEffectDamageBonus(script.type, fieldEffects)
  const multiplier = moveAutomationTargetDamageMultiplier(script, target)
  if (multiplier === 0) return 0
  const afterDefense = raw + offense + fieldBonus - defense
  return Math.max(1, Math.floor(afterDefense * multiplier))
}

export const resolveHpSuggestionAmount = (
  script: MoveAutomationScript | null | undefined,
  hpSuggestionAmounts: Readonly<Record<string, string | undefined>>,
  index: number,
  token: SpawnedPokemon,
): number => {
  const item = script?.hpSuggestions[index]
  if (!item) return 0
  const override = parsePositiveInt(hpSuggestionAmounts[moveAutomationSuggestionKey(script, 'hp', index)] ?? '')
  if (override != null) return override
  if (item.mode === 'fixed-loss') return item.amount ?? 0
  if (item.mode === 'set-zero') return token.currentHp
  if (!item.percent) return 0
  const base = item.mode === 'lose-percent-current' ? token.currentHp : token.maxHp
  return Math.max(0, Math.round(base * item.percent / 100))
}
