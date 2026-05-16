import { buildMoveAutomationTransaction } from '~/utils/moveAutomationTransaction'
import {
  defaultTargetResolutionState,
  moveAutomationSuggestionKey,
} from '~/utils/moveAutomationTargetResolution'
import {
  randomD20,
  resolveMoveAutomationAccuracyRoll,
  type MoveAutomationAccuracyRollResult,
} from '~/utils/moveAutomationResolution'
import { rollDamageFormula } from '~/utils/moveAutomation'
import {
  resolveMoveAutomationRandomStageSuggestion,
  resolveMoveAutomationRuntimeDamageFormula,
} from '~/utils/moveAutomationDynamicDamage'
import {
  moveAutomationUserAccuracy,
  resolveMoveAutomationTargetEvasion,
} from '~/utils/moveAutomationAccuracy'
import { moveAutomationConditionImmunitySource } from '~/utils/moveAutomationConditionImmunity'
import {
  naturalRollMeetsMoveThreshold,
  parseMoveAutomationNaturalRoll,
} from '~/utils/moveAutomationThresholds'
import { normalizeConditionName } from '~/utils/statusConditions'
import type { CombatStageKey } from '~/types/combatStages'
import type { MapFieldEffects } from '~/types/map'
import type {
  MoveAutomationFeedbackCondition,
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
  random?: () => number
}

export interface ResolveInstantMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  target: SpawnedPokemon
  damageFormula: string | null | undefined
  fieldEffects?: MapFieldEffects
  random?: () => number
  idFactory?: () => string
}

export interface ResolveInstantTargetMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  target: SpawnedPokemon
  damageFormula?: string | null
  fieldEffects?: MapFieldEffects
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
}): MoveAutomationFeedbackCondition[] => {
  const feedback: MoveAutomationFeedbackCondition[] = []

  options.script.conditionSuggestions.forEach((suggestion, index) => {
    if (!isTargetConditionAddition(suggestion)) return
    const suggestionKey = moveAutomationSuggestionKey(options.script, 'condition', index)
    options.enabledSuggestions[suggestionKey] = false
    if (!targetThresholdMatches(suggestion.threshold, options.naturalRoll)) return
    if (!targetConditionSuggestionApplies(suggestion, options.hit, options.script.requiresAccuracy)) return

    const condition = normalizeConditionName(suggestion.condition) ?? suggestion.condition
    const blockedBy = moveAutomationConditionImmunitySource(condition, options.target, options.script.type)
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
      const blockedBy = moveAutomationConditionImmunitySource(condition, target, script.type)
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

export const resolveInstantMoveAutomation = ({
  script,
  user,
  target,
  damageFormula,
  fieldEffects,
  random,
  idFactory,
}: ResolveInstantMoveAutomationInput): InstantMoveAutomationResult => {
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
  const conditionApplications = resolveAreaConditionApplications(script, [target], targetResolutions)
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
  const conditionApplications = resolveAreaConditionApplications(script, targets, targetResolutions)
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
