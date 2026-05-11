import { normalizeCombatStages } from '~/utils/combatStages'
import { fieldEffectDamageBonus, type DamageRollResult } from '~/utils/moveAutomation'
import { createMoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import {
  addCombatStageDeltas,
  applyHpSuggestion,
  nonZeroStageDeltas,
  parsePositiveInt,
} from '~/utils/moveAutomationDialog'
import { normalizeConditionNames } from '~/utils/statusConditions'
import { computeMultiplier, formatMultiplier } from '~/utils/typeChart'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import type { MapFieldEffects, MapHazardV2 } from '~/types/map'
import type {
  MoveAutomationConditionSuggestion,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'

export type MoveAutomationSuggestionKind = 'condition' | 'stage' | 'hp' | 'field' | 'hazard'

export interface MoveAutomationTargetResolutionState {
  accuracyRoll: string
  hit: boolean
  crit: boolean
  damageRoll: DamageRollResult | null
  manualHpLoss: string
  applyDamage: boolean
}

export interface BuildMoveAutomationTransactionInput {
  script: MoveAutomationScript | null
  user: SpawnedPokemon
  selectedTargets: SpawnedPokemon[]
  targetResolutions: Readonly<Record<string, MoveAutomationTargetResolutionState | undefined>>
  enabledSuggestions: Readonly<Record<string, boolean | undefined>>
  hpSuggestionAmounts: Readonly<Record<string, string | undefined>>
  manualUserConditions: readonly string[]
  manualTargetConditions: readonly string[]
  manualUserStageDeltas: Readonly<Record<CombatStageKey, number>>
  manualTargetStageDeltas: Readonly<Record<CombatStageKey, number>>
  hazardCells: GridAnchor[]
  manualNote: string
  fieldEffects?: MapFieldEffects
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
  const offense = physical ? user.atk : user.satk
  const defense = physical ? target.def : target.sdef
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

const conditionSetForToken = (updates: Map<string, Set<string>>, token: SpawnedPokemon): Set<string> => {
  const existing = updates.get(token.id)
  if (existing) return existing
  const set = new Set(normalizeConditionNames(token.conditions))
  updates.set(token.id, set)
  return set
}

const mergeConditionUpdate = (
  updates: Map<string, Set<string>>,
  token: SpawnedPokemon,
  conditions: readonly string[],
) => {
  const normalized = normalizeConditionNames(conditions)
  if (!normalized.length) return
  const set = conditionSetForToken(updates, token)
  for (const condition of normalized) set.add(condition)
}

const applyConditionSuggestion = (
  updates: Map<string, Set<string>>,
  token: SpawnedPokemon,
  item: MoveAutomationConditionSuggestion,
) => {
  const set = conditionSetForToken(updates, token)
  if (item.action === 'clear') {
    set.clear()
    return
  }
  const normalized = normalizeConditionNames([item.condition])
  for (const condition of normalized) {
    if (item.action === 'remove') set.delete(condition)
    else set.add(condition)
  }
}

const unknownMoveTransaction = (user: SpawnedPokemon): MoveAutomationTransaction => ({
  userId: user.id,
  userName: user.species,
  moveName: 'Unknown Move',
  scriptKind: 'manual-fallback',
  scriptVersion: 0,
  hpUpdates: [],
  conditionUpdates: [],
  combatStageUpdates: [],
  hazardsToAdd: [],
  fieldEffectsToApply: [],
  logLines: [],
})

export const buildMoveAutomationTransaction = ({
  script,
  user,
  selectedTargets,
  targetResolutions,
  enabledSuggestions,
  hpSuggestionAmounts,
  manualUserConditions,
  manualTargetConditions,
  manualUserStageDeltas,
  manualTargetStageDeltas,
  hazardCells,
  manualNote,
  fieldEffects,
}: BuildMoveAutomationTransactionInput): MoveAutomationTransaction => {
  if (!script) return unknownMoveTransaction(user)

  const hpAccumulator = createMoveAutomationHpUpdateAccumulator()

  const conditionById = new Map<string, Set<string>>()
  const stagesById = new Map<string, CombatStageMap>()
  const logLines: string[] = [
    `${user.species} used ${script.moveName}.`,
    script.kind === 'manual-fallback'
      ? 'Manual fallback resolver used: no explicit reviewed automation script exists for this move.'
      : `Explicit move script v${script.version} used.`,
  ]

  for (const target of selectedTargets) {
    const loss = resolveMoveAutomationTargetDamageLoss(script, user, target, targetResolutions[target.id], fieldEffects)
    if (loss > 0) {
      hpAccumulator.set(target, hpAccumulator.get(target) - loss)
      logLines.push(`${target.species}: ${loss} HP damage${targetResolutions[target.id]?.crit ? ' (critical flagged)' : ''}.`)
    }
  }

  script.hpSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'hp', index)) return
    const recipients = item.recipient === 'user' ? [user] : selectedTargets
    for (const token of recipients) {
      const amount = resolveHpSuggestionAmount(script, hpSuggestionAmounts, index, token)
      if (amount <= 0 && item.mode !== 'set-zero') continue
      const next = applyHpSuggestion(hpAccumulator.get(token), token.maxHp, amount, item.mode)
      hpAccumulator.set(token, next)
      logLines.push(`${token.species}: ${item.label}${amount > 0 ? ` (${amount} HP)` : ''}.`)
    }
  })

  script.conditionSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'condition', index)) return
    const recipients = item.recipient === 'user' ? [user] : selectedTargets
    for (const token of recipients) applyConditionSuggestion(conditionById, token, item)
    if (recipients.length) {
      logLines.push(`${item.label} ${item.action === 'remove' ? 'removed from' : 'applied to'} ${recipients.map((token) => token.species).join(', ')}.`)
    }
  })
  mergeConditionUpdate(conditionById, user, manualUserConditions)
  for (const target of selectedTargets) mergeConditionUpdate(conditionById, target, manualTargetConditions)

  const addStageDelta = (token: SpawnedPokemon, delta: Partial<Record<CombatStageKey, number>>) => {
    stagesById.set(token.id, addCombatStageDeltas(stagesById.get(token.id) ?? normalizeCombatStages(token.combatStages), delta))
  }
  script.stageSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'stage', index)) return
    const recipients = item.recipient === 'user' ? [user] : selectedTargets
    for (const token of recipients) addStageDelta(token, { [item.key]: item.delta })
    if (recipients.length) logLines.push(`${item.label} on ${recipients.map((token) => token.species).join(', ')}.`)
  })
  const userManualStages = nonZeroStageDeltas(manualUserStageDeltas)
  const targetManualStages = nonZeroStageDeltas(manualTargetStageDeltas)
  if (Object.keys(userManualStages).length) addStageDelta(user, userManualStages)
  if (Object.keys(targetManualStages).length) {
    for (const target of selectedTargets) addStageDelta(target, targetManualStages)
  }

  const hazardsToAdd: MapHazardV2[] = []
  script.hazardSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'hazard', index)) return
    for (const cell of hazardCells.slice(0, item.squares || hazardCells.length)) {
      hazardsToAdd.push({ kind: item.kind, ...cell, layer: item.kind === 'toxic-spikes' ? 1 : undefined, owner: user.species })
    }
    if (hazardCells.length) logLines.push(`${item.label}: ${Math.min(hazardCells.length, item.squares || hazardCells.length)} square(s).`)
  })

  const fieldEffectsToApply = script.fieldSuggestions
    .filter((_item, index) => suggestionIsEnabled(script, enabledSuggestions, 'field', index))
    .map((item) => ({ kind: item.kind, value: item.value, source: script.moveName }))
  for (const item of fieldEffectsToApply) logLines.push(`Field effect: ${item.source} applies ${item.value}.`)

  if (manualNote.trim()) logLines.push(`Manual note: ${manualNote.trim()}`)
  if (script.automationNotes.length) logLines.push(...script.automationNotes.map((note) => `Note: ${note}`))

  return {
    userId: user.id,
    userName: user.species,
    moveName: script.moveName,
    scriptKind: script.kind,
    scriptVersion: script.version,
    hpUpdates: hpAccumulator.toUpdates(),
    conditionUpdates: Array.from(conditionById.entries()).map(([id, set]) => ({ id, conditions: normalizeConditionNames(Array.from(set)) })),
    combatStageUpdates: Array.from(stagesById.entries()).map(([id, stages]) => ({ id, stages })),
    hazardsToAdd,
    fieldEffectsToApply,
    logLines,
  }
}
