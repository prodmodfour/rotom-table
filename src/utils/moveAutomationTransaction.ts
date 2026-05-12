import { createMoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import {
  applyHpSuggestion,
  nonZeroStageDeltas,
} from '~/utils/moveAutomationDialog'
import {
  createMoveAutomationCombatStageUpdateAccumulator,
  createMoveAutomationConditionUpdateAccumulator,
} from '~/utils/moveAutomationStatusUpdates'
import {
  buildMoveAutomationFieldEffects,
  buildMoveAutomationHazards,
} from '~/utils/moveAutomationMapEffects'
import {
  buildMoveAutomationStartLogLines,
  formatMoveAutomationAutomationNoteLogLines,
  formatMoveAutomationConditionSuggestionLogLine,
  formatMoveAutomationDamageLogLine,
  formatMoveAutomationHpSuggestionLogLine,
  formatMoveAutomationManualNoteLogLine,
  formatMoveAutomationStageSuggestionLogLine,
} from '~/utils/moveAutomationLogLines'
import {
  resolveHpSuggestionAmount,
  resolveMoveAutomationTargetDamageLoss,
  suggestionIsEnabled,
  type MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'
import type { CombatStageKey } from '~/types/combatStages'
import type { MapFieldEffects } from '~/types/map'
import type {
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'

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

  const conditionAccumulator = createMoveAutomationConditionUpdateAccumulator()
  const stageAccumulator = createMoveAutomationCombatStageUpdateAccumulator()
  const logLines = buildMoveAutomationStartLogLines(script, user.species)

  for (const target of selectedTargets) {
    const loss = resolveMoveAutomationTargetDamageLoss(script, user, target, targetResolutions[target.id], fieldEffects)
    if (loss > 0) {
      hpAccumulator.set(target, hpAccumulator.get(target) - loss)
      logLines.push(formatMoveAutomationDamageLogLine(target.species, loss, targetResolutions[target.id]?.crit))
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
      logLines.push(formatMoveAutomationHpSuggestionLogLine(token.species, item, amount))
    }
  })

  script.conditionSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'condition', index)) return
    const recipients = item.recipient === 'user' ? [user] : selectedTargets
    for (const token of recipients) conditionAccumulator.applySuggestion(token, item)
    const logLine = formatMoveAutomationConditionSuggestionLogLine(item, recipients)
    if (logLine) logLines.push(logLine)
  })
  conditionAccumulator.merge(user, manualUserConditions)
  for (const target of selectedTargets) conditionAccumulator.merge(target, manualTargetConditions)

  const addStageDelta = (token: SpawnedPokemon, delta: Partial<Record<CombatStageKey, number>>) => {
    stageAccumulator.addDeltas(token, delta)
  }
  script.stageSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'stage', index)) return
    const recipients = item.recipient === 'user' ? [user] : selectedTargets
    for (const token of recipients) addStageDelta(token, { [item.key]: item.delta })
    const logLine = formatMoveAutomationStageSuggestionLogLine(item, recipients)
    if (logLine) logLines.push(logLine)
  })
  const userManualStages = nonZeroStageDeltas(manualUserStageDeltas)
  const targetManualStages = nonZeroStageDeltas(manualTargetStageDeltas)
  if (Object.keys(userManualStages).length) addStageDelta(user, userManualStages)
  if (Object.keys(targetManualStages).length) {
    for (const target of selectedTargets) addStageDelta(target, targetManualStages)
  }

  const mapSuggestionEnabled = (kind: 'field' | 'hazard', index: number): boolean =>
    suggestionIsEnabled(script, enabledSuggestions, kind, index)
  const hazardResult = buildMoveAutomationHazards({
    script,
    ownerName: user.species,
    hazardCells,
    suggestionEnabled: mapSuggestionEnabled,
  })
  const fieldEffectResult = buildMoveAutomationFieldEffects({
    script,
    suggestionEnabled: mapSuggestionEnabled,
  })
  const hazardsToAdd = hazardResult.hazardsToAdd
  const fieldEffectsToApply = fieldEffectResult.fieldEffectsToApply
  logLines.push(...hazardResult.logLines, ...fieldEffectResult.logLines)

  const manualNoteLogLine = formatMoveAutomationManualNoteLogLine(manualNote)
  if (manualNoteLogLine) logLines.push(manualNoteLogLine)
  logLines.push(...formatMoveAutomationAutomationNoteLogLines(script.automationNotes))

  return {
    userId: user.id,
    userName: user.species,
    moveName: script.moveName,
    scriptKind: script.kind,
    scriptVersion: script.version,
    hpUpdates: hpAccumulator.toUpdates(),
    conditionUpdates: conditionAccumulator.toUpdates(),
    combatStageUpdates: stageAccumulator.toUpdates(),
    hazardsToAdd,
    fieldEffectsToApply,
    logLines,
  }
}
