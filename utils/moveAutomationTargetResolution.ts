import { applyCombatStageToStat } from '~/utils/combatStageStats'
import { fieldEffectDamageBonus, type DamageRollResult } from '~/utils/moveAutomation'
import { parsePositiveInt } from '~/utils/moveAutomationDialog'
import { computeMultiplier, formatMultiplier } from '~/utils/typeChart'
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
): number => computeMultiplier(script?.type ?? 'Normal', target.defenderTypes)

export const moveAutomationMultiplierLabel = (
  script: MoveAutomationScript | null | undefined,
  target: SpawnedPokemon,
): string => formatMultiplier(moveAutomationTargetDamageMultiplier(script, target))

export const resolveMoveAutomationTargetDamageLoss = (
  script: MoveAutomationScript | null | undefined,
  user: SpawnedPokemon,
  target: SpawnedPokemon,
  resolution: MoveAutomationTargetResolutionState | undefined,
  fieldEffects?: MapFieldEffects,
): number => {
  if (!script?.damaging) return 0
  const state = resolution ?? defaultTargetResolutionState(script)
  if (!state.applyDamage || !state.hit) return 0
  const manual = parsePositiveInt(state.manualHpLoss)
  if (manual != null) return manual
  const raw = state.damageRoll?.total ?? 0
  if (raw <= 0) return 0
  const physical = script.damageClass === 'Physical'
  const offense = physical
    ? applyCombatStageToStat(user.atk, user.combatStages.atk)
    : applyCombatStageToStat(user.satk, user.combatStages.satk)
  const defense = physical
    ? applyCombatStageToStat(target.def, target.combatStages.def)
    : applyCombatStageToStat(target.sdef, target.combatStages.sdef)
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
