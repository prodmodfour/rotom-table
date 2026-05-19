import { buildMoveAutomationTransaction } from '~/utils/moveAutomationTransaction'
import {
  defaultTargetResolutionState,
  moveAutomationSuggestionKey,
  moveAutomationTargetDamageMultiplier,
} from '~/utils/moveAutomationTargetResolution'
import {
  randomD20,
  resolveMoveAutomationAccuracyRoll,
  type MoveAutomationAccuracyRollResult,
} from '~/utils/moveAutomationResolution'
import { formatDamageBase, rollDamageFormula } from '~/utils/moveAutomation'
import {
  resolveMoveAutomationRandomStageSuggestion,
  resolveMoveAutomationRuntimeDamageFormula,
} from '~/utils/moveAutomationDynamicDamage'
import {
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import { moveAutomationSecondaryEffectBlockSource } from '~/utils/moveAutomationAbilityProtection'
import { moveAutomationMoveImmunitySource } from '~/utils/moveAutomationMoveImmunity'
import {
  moveAutomationConditionImmunitySource,
  type MoveAutomationConditionImmunityContext,
} from '~/utils/moveAutomationConditionImmunity'
import {
  naturalRollMeetsMoveThreshold,
  parseMoveAutomationNaturalRoll,
} from '~/utils/moveAutomationThresholds'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { CombatStageKey } from '~/types/combatStages'
import type { MapFieldEffects } from '~/types/map'
import type {
  MoveAutomationFeedbackCondition,
  MoveAutomationFeedbackEffectiveness,
  MoveAutomationFeedbackState,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { SpawnedPokemon } from '~/types/pokemon'

export interface InstantMoveAutomationResult {
  transaction: MoveAutomationTransaction
  feedback: MoveAutomationFeedbackState
}

export interface ResolveInstantAreaMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  targets: readonly SpawnedPokemon[]
  damageFormula?: string | null
  fieldEffects?: MapFieldEffects
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
  random?: () => number
}

export interface ResolveInstantMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  target: SpawnedPokemon
  damageFormula: string | null | undefined
  fieldEffects?: MapFieldEffects
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
  random?: () => number
  idFactory?: () => string
}

export interface ResolveInstantTargetMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  target: SpawnedPokemon
  damageFormula?: string | null
  fieldEffects?: MapFieldEffects
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
  random?: () => number
}

export interface ResolveInstantSelfMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  fieldEffects?: MapFieldEffects
}

const emptyStageDeltas = (): Record<CombatStageKey, number> => ({
  atk: 0,
  def: 0,
  satk: 0,
  sdef: 0,
  spd: 0,
  acc: 0,
})

const feedbackId = (factory: (() => string) | undefined): string =>
  factory?.() ?? `move-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const enableDefaultSuggestions = (
  script: MoveAutomationScript,
  enabledSuggestions: Record<string, boolean>,
): void => {
  script.hpSuggestions.forEach((suggestion, index) => {
    if (!suggestion.optional) enabledSuggestions[moveAutomationSuggestionKey(script, 'hp', index)] = true
  })
  script.conditionSuggestions.forEach((suggestion, index) => {
    if (!suggestion.optional) enabledSuggestions[moveAutomationSuggestionKey(script, 'condition', index)] = true
  })
  script.stageSuggestions.forEach((suggestion, index) => {
    if (!suggestion.optional) enabledSuggestions[moveAutomationSuggestionKey(script, 'stage', index)] = true
  })
}

const isTargetConditionAddition = (
  suggestion: MoveAutomationScript['conditionSuggestions'][number],
): boolean => suggestion.recipient === 'target' && suggestion.action !== 'remove' && suggestion.action !== 'clear'

const targetThresholdMatches = (
  threshold: string | undefined,
  naturalRoll: number | null,
): boolean => !threshold || (naturalRoll != null && naturalRollMeetsMoveThreshold(threshold, naturalRoll))

const targetConditionSuggestionApplies = (
  suggestion: MoveAutomationScript['conditionSuggestions'][number],
  hit: boolean,
  requiresAccuracy = true,
): boolean => {
  const applyWhen = suggestion.applyWhen ?? 'hit'
  if (applyWhen === 'always') return true
  if (applyWhen === 'miss') return requiresAccuracy && !hit
  return hit
}

const buildConditionFeedback = (options: {
  script: MoveAutomationScript
  target: SpawnedPokemon
  naturalRoll: number
  hit: boolean
  enabledSuggestions: Record<string, boolean>
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
}): MoveAutomationFeedbackCondition[] => {
  const feedback: MoveAutomationFeedbackCondition[] = []

  options.script.conditionSuggestions.forEach((suggestion, index) => {
    if (!isTargetConditionAddition(suggestion)) return
    const suggestionKey = moveAutomationSuggestionKey(options.script, 'condition', index)
    options.enabledSuggestions[suggestionKey] = false
    if (!targetThresholdMatches(suggestion.threshold, options.naturalRoll)) return
    if (!targetConditionSuggestionApplies(suggestion, options.hit, options.script.requiresAccuracy)) return

    const condition = normalizeConditionName(suggestion.condition) ?? suggestion.condition
    const blockedBy = moveAutomationMoveImmunitySource(options.script, options.target)
      ?? moveAutomationConditionImmunitySource(
        condition,
        options.target,
        options.script.type,
        options.conditionImmunityContext,
      )
      ?? moveAutomationSecondaryEffectBlockSource({
        script: options.script,
        target: options.target,
        threshold: suggestion.threshold,
      })
    const applied = !blockedBy
    if (applied) options.enabledSuggestions[suggestionKey] = true
    feedback.push({
      condition,
      applied,
      ...(blockedBy ? { blockedBy } : {}),
    })
  })

  return feedback
}

const addSuggestionTargetId = (
  targetIdsBySuggestion: Map<number, Set<string>>,
  index: number,
  targetId: string,
): void => {
  const ids = targetIdsBySuggestion.get(index) ?? new Set<string>()
  ids.add(targetId)
  targetIdsBySuggestion.set(index, ids)
}

const resolveAreaConditionApplications = (
  script: MoveAutomationScript,
  targets: readonly SpawnedPokemon[],
  targetResolutions: Readonly<Record<string, ReturnType<typeof defaultTargetResolutionState> | undefined>>,
  conditionImmunityContext?: MoveAutomationConditionImmunityContext,
): {
  filteredSuggestionIndexes: Set<number>
  targetIdsBySuggestion: Map<number, Set<string>>
  blockedNotes: string[]
} => {
  const filteredSuggestionIndexes = new Set<number>()
  const targetIdsBySuggestion = new Map<number, Set<string>>()
  const blockedNotes: string[] = []

  script.conditionSuggestions.forEach((suggestion, index) => {
    if (isTargetConditionAddition(suggestion)) filteredSuggestionIndexes.add(index)
  })
  if (!filteredSuggestionIndexes.size) return { filteredSuggestionIndexes, targetIdsBySuggestion, blockedNotes }

  for (const target of targets) {
    const resolution = targetResolutions[target.id]
    if (!resolution) continue
    const naturalRoll = parseMoveAutomationNaturalRoll(resolution.accuracyRoll)

    script.conditionSuggestions.forEach((suggestion, index) => {
      if (!filteredSuggestionIndexes.has(index)) return
      if (!targetConditionSuggestionApplies(suggestion, resolution.hit, script.requiresAccuracy)) return
      if (!targetThresholdMatches(suggestion.threshold, naturalRoll)) return

      const condition = normalizeConditionName(suggestion.condition) ?? suggestion.condition
      const blockedBy = moveAutomationMoveImmunitySource(script, target)
        ?? moveAutomationConditionImmunitySource(
          condition,
          target,
          script.type,
          conditionImmunityContext,
        )
        ?? moveAutomationSecondaryEffectBlockSource({ script, target, threshold: suggestion.threshold })
      if (blockedBy) {
        blockedNotes.push(`${condition} did not apply to ${target.species}: immune (${blockedBy}).`)
        return
      }
      addSuggestionTargetId(targetIdsBySuggestion, index, target.id)
    })
  }

  return { filteredSuggestionIndexes, targetIdsBySuggestion, blockedNotes }
}

const isTargetStageThresholdSuggestion = (
  suggestion: MoveAutomationScript['stageSuggestions'][number],
): boolean => suggestion.recipient === 'target' && Boolean(suggestion.threshold)

const enableSingleTargetStageThresholds = (options: {
  script: MoveAutomationScript
  naturalRoll: number
  hit: boolean
  enabledSuggestions: Record<string, boolean>
}): void => {
  if (!options.hit) return
  options.script.stageSuggestions.forEach((suggestion, index) => {
    if (!isTargetStageThresholdSuggestion(suggestion)) return
    if (!targetThresholdMatches(suggestion.threshold, options.naturalRoll)) return
    options.enabledSuggestions[moveAutomationSuggestionKey(options.script, 'stage', index)] = true
  })
}

const resolveAreaStageApplications = (
  script: MoveAutomationScript,
  targets: readonly SpawnedPokemon[],
  targetResolutions: Readonly<Record<string, ReturnType<typeof defaultTargetResolutionState> | undefined>>,
): {
  filteredSuggestionIndexes: Set<number>
  targetIdsBySuggestion: Map<number, Set<string>>
} => {
  const filteredSuggestionIndexes = new Set<number>()
  const targetIdsBySuggestion = new Map<number, Set<string>>()

  script.stageSuggestions.forEach((suggestion, index) => {
    if (isTargetStageThresholdSuggestion(suggestion)) filteredSuggestionIndexes.add(index)
  })
  if (!filteredSuggestionIndexes.size) return { filteredSuggestionIndexes, targetIdsBySuggestion }

  for (const target of targets) {
    const resolution = targetResolutions[target.id]
    if (!resolution?.hit) continue
    const naturalRoll = parseMoveAutomationNaturalRoll(resolution.accuracyRoll)

    script.stageSuggestions.forEach((suggestion, index) => {
      if (!filteredSuggestionIndexes.has(index)) return
      if (!targetThresholdMatches(suggestion.threshold, naturalRoll)) return
      addSuggestionTargetId(targetIdsBySuggestion, index, target.id)
    })
  }

  return { filteredSuggestionIndexes, targetIdsBySuggestion }
}

const addAccuracyToFeedback = (
  result: MoveAutomationAccuracyRollResult,
): Pick<MoveAutomationFeedbackState, 'modifiedRoll' | 'accuracyCheck' | 'userAccuracy' | 'targetEvasion'> => ({
  modifiedRoll: result.modifiedRoll ?? result.naturalRoll ?? 0,
  accuracyCheck: result.accuracyCheck ?? null,
  userAccuracy: result.userAccuracy ?? 0,
  targetEvasion: result.targetEvasion ?? 0,
})

const combineManualNotes = (...notes: Array<string | null | undefined>): string =>
  notes.map((note) => note?.trim() ?? '').filter(Boolean).join(' ')

const feedbackEffectiveness = (
  script: MoveAutomationScript,
  target: SpawnedPokemon,
  hit: boolean,
): MoveAutomationFeedbackEffectiveness => {
  if (!hit || !script.damaging || script.directHpLoss) return null
  const multiplier = moveAutomationTargetDamageMultiplier(script, target)
  if (multiplier > 1) return 'super-effective'
  if (multiplier > 0 && multiplier < 1) return 'resisted'
  return null
}

const damageFormulaForDamageBase = (damageBase: number): string | null => {
  const formula = formatDamageBase(damageBase)
  return /^DB\s+/i.test(formula) ? null : formula
}

const formatDoubleStrikeRollSummary = (rolls: readonly MoveAutomationAccuracyRollResult[]): string => rolls
  .map((roll, index) => `roll ${index + 1} ${roll.accuracyRoll} (${roll.hit ? 'hit' : 'miss'}${roll.hit && roll.crit ? ', critical' : ''})`)
  .join('; ')

const resolveInstantDoubleStrikeMoveAutomation = ({
  script,
  user,
  target,
  damageFormula,
  fieldEffects,
  conditionImmunityContext,
  random,
  idFactory,
}: ResolveInstantMoveAutomationInput): InstantMoveAutomationResult => {
  const targetEvasion = resolveMoveAutomationTargetEvasion(script, target)
  const userAccuracy = moveAutomationUserAccuracy(user)
  const accuracyRolls = [randomD20(random), randomD20(random)].map((naturalRoll) =>
    resolveMoveAutomationAccuracyRoll(script, naturalRoll, {
      userAccuracy,
      targetEvasion: targetEvasion.value,
    }),
  )
  const hitCount = accuracyRolls.filter((roll) => roll.hit).length
  const critCount = accuracyRolls.filter((roll) => roll.hit && roll.crit).length
  const baseDamageBase = script.damageBase ?? 0
  const strikeMultiplier = hitCount >= 2 ? 2 : 1
  const stabDamageBase = script.stabDamageBaseBonus ?? 0
  const finalDamageBase = hitCount > 0 && baseDamageBase > 0
    ? (baseDamageBase * strikeMultiplier) + stabDamageBase
    : null
  const resolvedDamageFormula = finalDamageBase != null
    ? damageFormulaForDamageBase(finalDamageBase) ?? damageFormula ?? null
    : damageFormula ?? null
  const damageRoll = hitCount > 0 && script.damaging && resolvedDamageFormula
    ? rollDamageFormula(resolvedDamageFormula, random)
    : null
  const criticalFormula = baseDamageBase > 0 ? damageFormulaForDamageBase(baseDamageBase) : null
  let criticalBonusDamage = 0
  for (let index = 0; index < critCount; index += 1) {
    if (!criticalFormula) continue
    criticalBonusDamage += rollDamageFormula(criticalFormula, random)?.total ?? 0
  }
  const targetResolutions = {
    [target.id]: {
      accuracyRoll: accuracyRolls.map((roll) => roll.accuracyRoll).join(', '),
      hit: hitCount > 0,
      crit: critCount > 0,
      damageRoll,
      criticalBonusDamage,
      manualHpLoss: '',
      applyDamage: true,
    },
  }
  const enabledSuggestions: Record<string, boolean> = {}
  enableDefaultSuggestions(script, enabledSuggestions)
  const dbNote = hitCount > 0 && finalDamageBase != null
    ? `DB ${baseDamageBase}${hitCount >= 2 ? ' × 2' : ''}${stabDamageBase ? ` + ${stabDamageBase} STAB` : ''} = DB ${finalDamageBase}`
    : 'no damage'
  const critNote = critCount > 0
    ? ` ${critCount} critical ${critCount === 1 ? 'hit adds' : 'hits add'} ${criticalBonusDamage} bonus damage before Stats and defenses.`
    : ''
  const doubleStrikeNote = `${script.moveName} Double Strike: ${formatDoubleStrikeRollSummary(accuracyRolls)}; ${hitCount} ${hitCount === 1 ? 'hit' : 'hits'} -> ${dbNote}.${critNote}`

  const transaction = buildMoveAutomationTransaction({
    script,
    user,
    selectedTargets: [target],
    targetResolutions,
    enabledSuggestions,
    hpSuggestionAmounts: {},
    manualUserConditions: [],
    manualTargetConditions: [],
    manualUserStageDeltas: emptyStageDeltas(),
    manualTargetStageDeltas: emptyStageDeltas(),
    hazardCells: [],
    manualNote: doubleStrikeNote,
    fieldEffects,
    conditionImmunityContext,
  })
  const targetHpUpdate = transaction.hpUpdates.find((update) => update.id === target.id)
  const damageLoss = targetHpUpdate
    ? Math.max(0, target.currentHp - targetHpUpdate.currentHp)
    : 0
  const feedbackAccuracy = accuracyRolls.find((roll) => roll.hit && roll.crit)
    ?? accuracyRolls.find((roll) => roll.hit)
    ?? accuracyRolls[0]

  return {
    transaction,
    feedback: {
      id: feedbackId(idFactory),
      userId: user.id,
      targetId: target.id,
      moveName: script.moveName,
      phase: 'rolling',
      naturalRoll: feedbackAccuracy?.naturalRoll ?? 0,
      modifiedRoll: feedbackAccuracy?.modifiedRoll ?? feedbackAccuracy?.naturalRoll ?? 0,
      accuracyCheck: feedbackAccuracy?.accuracyCheck ?? null,
      userAccuracy,
      targetEvasion: targetEvasion.value,
      targetEvasionLabel: targetEvasion.label,
      hit: hitCount > 0,
      crit: critCount > 0,
      effectiveness: feedbackEffectiveness(script, target, hitCount > 0),
      damageResolved: hitCount > 0 && script.damaging,
      damageLoss,
      conditions: [],
    },
  }
}

export const resolveInstantMoveAutomation = ({
  script,
  user,
  target,
  damageFormula,
  fieldEffects,
  conditionImmunityContext,
  random,
  idFactory,
}: ResolveInstantMoveAutomationInput): InstantMoveAutomationResult => {
  if (script.dynamicDamageBase?.kind === 'double-strike') {
    return resolveInstantDoubleStrikeMoveAutomation({
      script,
      user,
      target,
      damageFormula,
      fieldEffects,
      conditionImmunityContext,
      random,
      idFactory,
    })
  }

  const naturalRoll = randomD20(random)
  const targetEvasion = resolveMoveAutomationTargetEvasion(script, target)
  const userAccuracy = moveAutomationUserAccuracy(user)
  const accuracy = resolveMoveAutomationAccuracyRoll(script, naturalRoll, {
    userAccuracy,
    targetEvasion: targetEvasion.value,
  })
  const runtimeDamage = accuracy.hit && script.damaging
    ? resolveMoveAutomationRuntimeDamageFormula({ script, user, fallbackFormula: damageFormula, random })
    : { formula: damageFormula ?? null, note: null }
  const damageRoll = accuracy.hit && script.damaging && runtimeDamage.formula
    ? rollDamageFormula(runtimeDamage.formula, random)
    : null
  const targetResolutions = {
    [target.id]: {
      accuracyRoll: accuracy.accuracyRoll,
      hit: accuracy.hit,
      crit: accuracy.crit,
      damageRoll,
      manualHpLoss: '',
      applyDamage: true,
    },
  }
  const enabledSuggestions: Record<string, boolean> = {}
  enableDefaultSuggestions(script, enabledSuggestions)
  const conditions = buildConditionFeedback({
    script,
    target,
    naturalRoll,
    hit: accuracy.hit,
    enabledSuggestions,
    conditionImmunityContext,
  })
  enableSingleTargetStageThresholds({
    script,
    naturalRoll,
    hit: accuracy.hit,
    enabledSuggestions,
  })
  const randomStageNote = accuracy.hit
    ? resolveMoveAutomationRandomStageSuggestion({ script, enabledSuggestions, random })
    : null
  const blockedConditionNote = accuracy.hit
    ? conditions
      .filter((condition) => condition.blockedBy)
      .map((condition) => `${condition.condition} did not apply to ${target.species}: immune (${condition.blockedBy}).`)
      .join(' ')
    : ''

  const transaction = buildMoveAutomationTransaction({
    script,
    user,
    selectedTargets: [target],
    targetResolutions,
    enabledSuggestions,
    hpSuggestionAmounts: {},
    manualUserConditions: [],
    manualTargetConditions: [],
    manualUserStageDeltas: emptyStageDeltas(),
    manualTargetStageDeltas: emptyStageDeltas(),
    hazardCells: [],
    manualNote: combineManualNotes(runtimeDamage.note, randomStageNote, blockedConditionNote),
    fieldEffects,
    conditionImmunityContext,
  })
  const targetHpUpdate = transaction.hpUpdates.find((update) => update.id === target.id)
  const damageLoss = targetHpUpdate
    ? Math.max(0, target.currentHp - targetHpUpdate.currentHp)
    : 0

  return {
    transaction,
    feedback: {
      id: feedbackId(idFactory),
      userId: user.id,
      targetId: target.id,
      moveName: script.moveName,
      phase: 'rolling',
      naturalRoll,
      ...addAccuracyToFeedback(accuracy),
      targetEvasionLabel: targetEvasion.label,
      hit: accuracy.hit,
      crit: accuracy.crit,
      effectiveness: feedbackEffectiveness(script, target, accuracy.hit),
      damageResolved: accuracy.hit && script.damaging,
      damageLoss,
      conditions,
    },
  }
}

const buildNoRollTargetTransaction = ({
  script,
  user,
  target,
  damageFormula,
  fieldEffects,
  conditionImmunityContext,
  random,
}: ResolveInstantTargetMoveAutomationInput): MoveAutomationTransaction => {
  const state = defaultTargetResolutionState(script)
  const runtimeDamage = script.damaging && state.hit
    ? resolveMoveAutomationRuntimeDamageFormula({ script, user, fallbackFormula: damageFormula, random })
    : { formula: damageFormula ?? null, note: null }
  if (script.damaging && state.hit && runtimeDamage.formula) state.damageRoll = rollDamageFormula(runtimeDamage.formula, random)
  const targetResolutions = { [target.id]: state }
  const enabledSuggestions: Record<string, boolean> = {}
  enableDefaultSuggestions(script, enabledSuggestions)
  const randomStageNote = resolveMoveAutomationRandomStageSuggestion({ script, enabledSuggestions, random })
  const conditionApplications = resolveAreaConditionApplications(script, [target], targetResolutions, conditionImmunityContext)
  conditionApplications.targetIdsBySuggestion.forEach((targetIds, index) => {
    if (targetIds.size) enabledSuggestions[moveAutomationSuggestionKey(script, 'condition', index)] = true
  })

  return buildMoveAutomationTransaction({
    script,
    user,
    selectedTargets: [target],
    targetResolutions,
    enabledSuggestions,
    hpSuggestionAmounts: {},
    manualUserConditions: [],
    manualTargetConditions: [],
    manualUserStageDeltas: emptyStageDeltas(),
    manualTargetStageDeltas: emptyStageDeltas(),
    hazardCells: [],
    manualNote: combineManualNotes(runtimeDamage.note, randomStageNote, conditionApplications.blockedNotes.join(' ')),
    fieldEffects,
    conditionImmunityContext,
    suggestionRecipientFilter: ({ kind, index, recipient, token }) => {
      if (recipient !== 'target') return true
      if (kind === 'condition' && conditionApplications.filteredSuggestionIndexes.has(index)) {
        return conditionApplications.targetIdsBySuggestion.get(index)?.has(token.id) ?? false
      }
      return true
    },
  })
}

export const resolveInstantTargetMoveAutomation = (input: ResolveInstantTargetMoveAutomationInput): MoveAutomationTransaction =>
  buildNoRollTargetTransaction(input)

export const resolveInstantSelfMoveAutomation = ({
  script,
  user,
  fieldEffects,
}: ResolveInstantSelfMoveAutomationInput): MoveAutomationTransaction => {
  const enabledSuggestions: Record<string, boolean> = {}
  enableDefaultSuggestions(script, enabledSuggestions)
  const randomStageNote = resolveMoveAutomationRandomStageSuggestion({ script, enabledSuggestions })
  return buildMoveAutomationTransaction({
    script,
    user,
    selectedTargets: [],
    targetResolutions: {},
    enabledSuggestions,
    hpSuggestionAmounts: {},
    manualUserConditions: [],
    manualTargetConditions: [],
    manualUserStageDeltas: emptyStageDeltas(),
    manualTargetStageDeltas: emptyStageDeltas(),
    hazardCells: [],
    manualNote: combineManualNotes(randomStageNote),
    fieldEffects,
  })
}

const formatAreaAccuracyLogLines = (
  targets: readonly SpawnedPokemon[],
  targetResolutions: Record<string, { accuracyRoll: string; hit: boolean }>,
): string[] => {
  if (!targets.length) return ['No legal targets in the confirmed area.']
  return targets.map((target) => {
    const resolution = targetResolutions[target.id]
    if (!resolution?.accuracyRoll) return `${target.species}: ${resolution?.hit ? 'hit' : 'miss'}.`
    return `${target.species}: accuracy ${resolution.accuracyRoll} (${resolution.hit ? 'hit' : 'miss'}).`
  })
}

export const resolveInstantAreaMoveAutomation = ({
  script,
  user,
  targets,
  damageFormula,
  fieldEffects,
  conditionImmunityContext,
  random,
}: ResolveInstantAreaMoveAutomationInput): MoveAutomationTransaction => {
  const targetResolutions: Record<string, ReturnType<typeof defaultTargetResolutionState>> = {}
  const userAccuracy = moveAutomationUserAccuracy(user)
  for (const target of targets) {
    const state = defaultTargetResolutionState(script)
    if (script.requiresAccuracy) {
      const targetEvasion = resolveMoveAutomationTargetEvasion(script, target)
      const accuracy = resolveMoveAutomationAccuracyRoll(script, randomD20(random), {
        userAccuracy,
        targetEvasion: targetEvasion.value,
      })
      state.accuracyRoll = accuracy.accuracyRoll
      state.hit = accuracy.hit
      state.crit = accuracy.crit
    }
    if (script.damaging && state.hit && damageFormula) state.damageRoll = rollDamageFormula(damageFormula, random)
    targetResolutions[target.id] = state
  }

  const enabledSuggestions: Record<string, boolean> = {}
  enableDefaultSuggestions(script, enabledSuggestions)
  const conditionApplications = resolveAreaConditionApplications(script, targets, targetResolutions, conditionImmunityContext)
  conditionApplications.targetIdsBySuggestion.forEach((targetIds, index) => {
    if (targetIds.size) enabledSuggestions[moveAutomationSuggestionKey(script, 'condition', index)] = true
  })
  const stageApplications = resolveAreaStageApplications(script, targets, targetResolutions)
  stageApplications.targetIdsBySuggestion.forEach((targetIds, index) => {
    if (targetIds.size) enabledSuggestions[moveAutomationSuggestionKey(script, 'stage', index)] = true
  })
  const transaction = buildMoveAutomationTransaction({
    script,
    user,
    selectedTargets: [...targets],
    targetResolutions,
    enabledSuggestions,
    hpSuggestionAmounts: {},
    manualUserConditions: [],
    manualTargetConditions: [],
    manualUserStageDeltas: emptyStageDeltas(),
    manualTargetStageDeltas: emptyStageDeltas(),
    hazardCells: [],
    manualNote: conditionApplications.blockedNotes.join(' '),
    fieldEffects,
    conditionImmunityContext,
    suggestionRecipientFilter: ({ kind, index, recipient, token }) => {
      if (recipient !== 'target') return true
      if (kind === 'condition' && conditionApplications.filteredSuggestionIndexes.has(index)) {
        return conditionApplications.targetIdsBySuggestion.get(index)?.has(token.id) ?? false
      }
      if (kind === 'stage' && stageApplications.filteredSuggestionIndexes.has(index)) {
        return stageApplications.targetIdsBySuggestion.get(index)?.has(token.id) ?? false
      }
      return true
    },
  })

  transaction.logLines.push(...formatAreaAccuracyLogLines(targets, targetResolutions))
  return transaction
}
