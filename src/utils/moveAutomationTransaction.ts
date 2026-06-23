import {
  moveAutomationCombatStageBlockSource,
  moveAutomationSecondaryEffectBlockSource,
} from '~/utils/moveAutomationAbilityProtection'
import {
  moveAutomationConditionImmunitySource,
  type MoveAutomationConditionImmunityContext,
} from '~/utils/moveAutomationConditionImmunity'
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
  formatMoveAutomationDamageBreakdownLogLine,
  formatMoveAutomationDamageLogLine,
  formatMoveAutomationDirectHpLossLogLine,
  formatMoveAutomationHpSuggestionLogLine,
  formatMoveAutomationInjuryLogLine,
  formatMoveAutomationManualNoteLogLine,
  formatMoveAutomationStageSuggestionLogLine,
} from '~/utils/moveAutomationLogLines'
import {
  resolveHpSuggestionAmount,
  resolveMoveAutomationTargetDamageBreakdown,
  suggestionIsEnabled,
  type MoveAutomationSuggestionKind,
  type MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'
import { accuracyRollMeetsMoveThreshold } from '~/utils/moveAutomationThresholds'
import { conditionBaseName, normalizeConditionNames } from '~/utils/statusConditions'
import { ELECTRIC_RESISTANT_COAT_CONDITION } from '~/utils/moveAutomationSpecialConditions'
import { moveAutomationMoveImmunitySource } from '~/utils/moveAutomationMoveImmunity'
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
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
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
  scriptKind: 'explicit',
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
  conditionImmunityContext,
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
    const damageBreakdown = resolveMoveAutomationTargetDamageBreakdown(
      script,
      user,
      target,
      targetResolutions[target.id],
      fieldEffects,
      selectedTargets,
    )
    const loss = damageBreakdown.hpLoss
    if (loss > 0) {
      const lossResult = hpAccumulator.applyLossWithInjuryAutomation(
        target,
        loss,
        damageBreakdown.kind === 'direct' ? 'hp-loss' : 'damage',
      )
      damageLossByTargetId.set(target.id, lossResult.effectiveHpLost)
      totalAppliedDamageLoss += lossResult.effectiveHpLost
      if (damageBreakdown.kind === 'direct') {
        logLines.push(formatMoveAutomationDirectHpLossLogLine(target.species, loss, damageBreakdown.label))
      } else {
        logLines.push(formatMoveAutomationDamageLogLine(target.species, loss, targetResolutions[target.id]?.crit))
        const breakdownLine = formatMoveAutomationDamageBreakdownLogLine(target.species, damageBreakdown)
        if (breakdownLine) logLines.push(breakdownLine)
      }
      const injuryLine = formatMoveAutomationInjuryLogLine(target.species, lossResult.injuryResult)
      if (injuryLine) logLines.push(injuryLine)
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
  const blockedSuggestionLogLines: string[] = []
  const blockSuggestion = (
    label: string,
    target: SpawnedPokemon,
    source: string,
    reason: 'immunity' | 'secondary-effect',
  ): false => {
    blockedSuggestionLogLines.push(reason === 'immunity'
      ? `${label} did not apply to ${target.species}: immune (${source}).`
      : `${label} did not apply to ${target.species}: blocked by ${source}.`)
    return false
  }
  const targetSuggestionLabel = (
    kind: MoveAutomationSuggestionKind,
    index: number,
  ): string | null => {
    if (kind === 'condition') {
      const suggestion = script.conditionSuggestions[index]
      return suggestion && suggestion.action !== 'remove' && suggestion.action !== 'clear' ? suggestion.label : null
    }
    if (kind === 'stage') return script.stageSuggestions[index]?.label ?? null
    if (kind === 'hp') return script.hpSuggestions[index]?.label ?? null
    return null
  }
  const targetSuggestionBlockSource = (
    kind: MoveAutomationSuggestionKind,
    index: number,
    target: SpawnedPokemon,
  ): { source: string; reason: 'immunity' | 'secondary-effect'; label: string } | null => {
    const moveImmunity = moveAutomationMoveImmunitySource(script, target)
    const label = targetSuggestionLabel(kind, index)
    if (moveImmunity && label) return { source: moveImmunity, reason: 'immunity', label }

    if (kind === 'condition') {
      const suggestion = script.conditionSuggestions[index]
      if (!suggestion || suggestion.action === 'remove' || suggestion.action === 'clear') return null
      const condition = conditionBaseName(suggestion.condition) ?? suggestion.condition
      const source = moveAutomationConditionImmunitySource(condition, target, script.type, conditionImmunityContext)
      if (source) return { source, reason: 'immunity', label: suggestion.label }
      const secondarySource = moveAutomationSecondaryEffectBlockSource({ script, target, threshold: suggestion.threshold })
      return secondarySource ? { source: secondarySource, reason: 'secondary-effect', label: suggestion.label } : null
    }

    if (kind === 'stage') {
      const suggestion = script.stageSuggestions[index]
      if (!suggestion) return null
      const stageBlockSource = moveAutomationCombatStageBlockSource({
        target,
        key: suggestion.key,
        delta: suggestion.delta,
      })
      if (stageBlockSource) return { source: stageBlockSource, reason: 'immunity', label: suggestion.label }
      const source = moveAutomationSecondaryEffectBlockSource({ script, target, threshold: suggestion.threshold })
      return source ? { source, reason: 'secondary-effect', label: suggestion.label } : null
    }

    return null
  }
  const suggestionRecipients = (
    kind: MoveAutomationSuggestionKind,
    index: number,
    recipient: MoveAutomationRecipient,
    threshold?: string,
  ): SpawnedPokemon[] => {
    const recipients = recipient === 'user'
      ? [user]
      : selectedTargets.filter((target) => targetMatchesSuggestionTiming(kind, index, target) && targetMeetsSuggestionThreshold(threshold, target))
    return recipients.filter((token) => {
      if (!(suggestionRecipientFilter?.({ kind, index, recipient, token }) ?? true)) return false
      if (recipient !== 'target') return true
      const block = targetSuggestionBlockSource(kind, index, token)
      return block ? blockSuggestion(block.label, token, block.source, block.reason) : true
    })
  }

  script.hpSuggestions.forEach((item, index) => {
    if (!suggestionIsEnabled(script, enabledSuggestions, 'hp', index)) return
    const recipients = suggestionRecipients('hp', index, item.recipient)
    for (const token of recipients) {
      const amount = resolveHpSuggestionAmount(script, hpSuggestionAmounts, index, token, {
        damageDealt: item.recipient === 'target'
          ? damageLossByTargetId.get(token.id) ?? 0
          : totalAppliedDamageLoss,
        fieldEffects,
      })
      if (amount <= 0 && item.mode !== 'set-zero') continue
      const beforeHp = hpAccumulator.get(token)
      const next = applyHpSuggestion(beforeHp, hpAccumulator.getMaxHp(token), amount, item.mode)
      const injuryResult = next < beforeHp
        ? hpAccumulator.setWithInjuryAutomation(token, next, 'hp-loss')
        : (hpAccumulator.set(token, next), null)
      logLines.push(formatMoveAutomationHpSuggestionLogLine(token.species, item, amount))
      const injuryLine = injuryResult ? formatMoveAutomationInjuryLogLine(token.species, injuryResult) : null
      if (injuryLine) logLines.push(injuryLine)
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
  logLines.push(...blockedSuggestionLogLines)

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
