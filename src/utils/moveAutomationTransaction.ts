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
  formatMoveAutomationDirectHpLossLogLine,
  formatMoveAutomationHpSuggestionLogLine,
  formatMoveAutomationManualNoteLogLine,
  formatMoveAutomationStageSuggestionLogLine,
} from '~/utils/moveAutomationLogLines'
import {
  resolveHpSuggestionAmount,
  resolveMoveAutomationTargetDamageLoss,
  suggestionIsEnabled,
  type MoveAutomationSuggestionKind,
  type MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'
import { accuracyRollMeetsMoveThreshold } from '~/utils/moveAutomationThresholds'
import { conditionBaseName, normalizeConditionNames } from '~/utils/statusConditions'
import { ELECTRIC_RESISTANT_COAT_CONDITION } from '~/utils/moveAutomationSpecialConditions'
import type { CombatStageKey } from '~/types/combatStages'
import type { MapFieldEffects } from '~/types/map'
import type {
  MoveAutomationRecipient,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { GridAnchor, SpawnedPokemon } from '~/types/pokemon'

export interface MoveAutomationSuggestionRecipientFilterContext {
  kind: MoveAutomationSuggestionKind
  index: number
  recipient: MoveAutomationRecipient
  token: SpawnedPokemon
}

export type MoveAutomationSuggestionRecipientFilter = (
  context: MoveAutomationSuggestionRecipientFilterContext,
) => boolean

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
  suggestionRecipientFilter?: MoveAutomationSuggestionRecipientFilter
}

const attachTargetIds = (
  transaction: MoveAutomationTransaction,
  targetIds: { attackedTargetIds: string[]; hitTargetIds: string[] },
): MoveAutomationTransaction => {
  Object.defineProperties(transaction, {
    attackedTargetIds: {
      value: targetIds.attackedTargetIds,
      enumerable: false,
      configurable: true,
      writable: true,
    },
    hitTargetIds: {
      value: targetIds.hitTargetIds,
      enumerable: false,
      configurable: true,
      writable: true,
    },
  })
  return transaction
}

const unknownMoveTransaction = (user: SpawnedPokemon): MoveAutomationTransaction => attachTargetIds({
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
}, { attackedTargetIds: [], hitTargetIds: [] })

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
  suggestionRecipientFilter,
}: BuildMoveAutomationTransactionInput): MoveAutomationTransaction => {
  if (!script) return unknownMoveTransaction(user)

  const hpAccumulator = createMoveAutomationHpUpdateAccumulator()

  const conditionAccumulator = createMoveAutomationConditionUpdateAccumulator()
  const stageAccumulator = createMoveAutomationCombatStageUpdateAccumulator()
  const logLines = buildMoveAutomationStartLogLines(script, user.species)
  const damageLossByTargetId = new Map<string, number>()
  let totalAppliedDamageLoss = 0

  for (const target of selectedTargets) {
    const loss = resolveMoveAutomationTargetDamageLoss(
      script,
      user,
      target,
      targetResolutions[target.id],
      fieldEffects,
      selectedTargets,
    )
    if (loss > 0) {
      const beforeHp = hpAccumulator.get(target)
      hpAccumulator.set(target, beforeHp - loss)
      const appliedLoss = Math.max(0, beforeHp - hpAccumulator.get(target))
      damageLossByTargetId.set(target.id, appliedLoss)
      totalAppliedDamageLoss += appliedLoss
      logLines.push(script.directHpLoss
        ? formatMoveAutomationDirectHpLossLogLine(target.species, loss, script.directHpLoss.label)
        : formatMoveAutomationDamageLogLine(target.species, loss, targetResolutions[target.id]?.crit))
    }
  }

  const attackedTargetIds = selectedTargets.map((target) => target.id)
  const hitTargetIds = selectedTargets
    .filter((target) => !script.requiresAccuracy || targetResolutions[target.id]?.hit === true)
    .map((target) => target.id)
  const targetEffectsApplyOnMiss = script.keywords.some((keyword) => /^Spirit Surge$/i.test(keyword))
  const targetWasHit = (target: SpawnedPokemon): boolean =>
    !script.requiresAccuracy || targetEffectsApplyOnMiss || targetResolutions[target.id]?.hit === true
  const targetMatchesSuggestionTiming = (
    kind: MoveAutomationSuggestionKind,
    index: number,
    target: SpawnedPokemon,
  ): boolean => {
    if (kind !== 'condition') return targetWasHit(target)
    const applyWhen = script.conditionSuggestions[index]?.applyWhen ?? 'hit'
    if (applyWhen === 'always') return true
    if (applyWhen === 'miss') return script.requiresAccuracy && targetResolutions[target.id]?.hit === false
    return targetWasHit(target)
  }
  const targetMeetsSuggestionThreshold = (
    threshold: string | undefined,
    target: SpawnedPokemon,
  ): boolean => accuracyRollMeetsMoveThreshold(threshold, targetResolutions[target.id]?.accuracyRoll)
  const suggestionRecipients = (
    kind: MoveAutomationSuggestionKind,
    index: number,
    recipient: MoveAutomationRecipient,
    threshold?: string,
  ): SpawnedPokemon[] => {
    const recipients = recipient === 'user'
      ? [user]
      : selectedTargets.filter((target) => targetMatchesSuggestionTiming(kind, index, target) && targetMeetsSuggestionThreshold(threshold, target))
    return recipients.filter((token) => suggestionRecipientFilter?.({ kind, index, recipient, token }) ?? true)
  }

  script.hpSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'hp', index)) return
    const recipients = suggestionRecipients('hp', index, item.recipient)
    for (const token of recipients) {
      const amount = resolveHpSuggestionAmount(script, hpSuggestionAmounts, index, token, {
        damageDealt: item.recipient === 'target'
          ? damageLossByTargetId.get(token.id) ?? 0
          : totalAppliedDamageLoss,
      })
      if (amount <= 0 && item.mode !== 'set-zero') continue
      const next = applyHpSuggestion(hpAccumulator.get(token), token.maxHp, amount, item.mode)
      hpAccumulator.set(token, next)
      logLines.push(formatMoveAutomationHpSuggestionLogLine(token.species, item, amount))
    }
  })

  script.conditionSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'condition', index)) return
    const recipients = suggestionRecipients('condition', index, item.recipient, item.threshold)
    for (const token of recipients) conditionAccumulator.applySuggestion(token, item)
    const logLine = formatMoveAutomationConditionSuggestionLogLine(item, recipients)
    if (logLine) logLines.push(logLine)
  })
  if (script.type === 'Electric' && script.damaging) {
    for (const target of selectedTargets) {
      if ((damageLossByTargetId.get(target.id) ?? 0) <= 0) continue
      const hasCoat = normalizeConditionNames(target.conditions)
        .some((condition) => (conditionBaseName(condition) ?? condition) === ELECTRIC_RESISTANT_COAT_CONDITION)
      if (!hasCoat) continue
      conditionAccumulator.applySuggestion(target, {
        recipient: 'target',
        condition: ELECTRIC_RESISTANT_COAT_CONDITION,
        action: 'remove',
        label: 'Electric-Resistant Coat consumed',
      })
      logLines.push(`${target.species}: Electric-Resistant Coat removed after Electric damage.`)
    }
  }
  conditionAccumulator.merge(user, manualUserConditions)
  for (const target of selectedTargets) conditionAccumulator.merge(target, manualTargetConditions)

  const addStageDelta = (token: SpawnedPokemon, delta: Partial<Record<CombatStageKey, number>>) => {
    stageAccumulator.addDeltas(token, delta)
  }
  script.stageSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'stage', index)) return
    const recipients = suggestionRecipients('stage', index, item.recipient, item.threshold)
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

  return attachTargetIds({
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
  }, { attackedTargetIds, hitTargetIds })
}
