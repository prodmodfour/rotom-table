import type {
  MoveAutomationRandomRoller,
  MoveAutomationRollRequestMetadata,
} from '#shared/moveAutomation/random'
import { buildMoveAutomationTransaction } from '~/utils/moveAutomationTransaction'
import {
  defaultTargetResolutionState,
  moveAutomationSuggestionKey,
  moveAutomationTargetDamageMultiplier,
  type MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'
import {
  randomD20,
  resolveMoveAutomationAccuracyRoll,
  type MoveAutomationAccuracyRollResult,
  type MoveAutomationAccuracyRule,
} from '~/utils/moveAutomationResolution'
import { formatDamageBase, rollDamageFormula } from '~/utils/moveAutomation'
import {
  parseMoveDamageFormula,
  rollMoveDamageFormulaWithRoller,
  type MoveDamageRollResult,
} from '~/utils/moveDamageBase'
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
import { moveAutomationScriptWithPoisonTouch } from '~/utils/moveAutomationPoisonTouch'
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
  fieldEffectsForTarget?: (target: SpawnedPokemon) => MapFieldEffects
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
  accuracyRule?: MoveAutomationAccuracyRule | null
  random?: () => number
  randomRoller?: MoveAutomationRandomRoller
}

export interface ResolveInstantMultiTargetMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  /** Selected target tokens. `selectedTargets` is accepted as a call-site readability alias. */
  targets?: readonly SpawnedPokemon[]
  selectedTargets?: readonly SpawnedPokemon[]
  damageFormula?: string | null
  fieldEffects?: MapFieldEffects
  fieldEffectsForTarget?: (target: SpawnedPokemon) => MapFieldEffects
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
  accuracyRule?: MoveAutomationAccuracyRule | null
  random?: () => number
  randomRoller?: MoveAutomationRandomRoller
}

export interface ResolveInstantMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  target: SpawnedPokemon
  damageFormula: string | null | undefined
  fieldEffects?: MapFieldEffects
  fieldEffectsForTarget?: (target: SpawnedPokemon) => MapFieldEffects
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
  accuracyRule?: MoveAutomationAccuracyRule | null
  random?: () => number
  randomRoller?: MoveAutomationRandomRoller
  idFactory?: () => string
}

export interface ResolveInstantTargetMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  target: SpawnedPokemon
  damageFormula?: string | null
  fieldEffects?: MapFieldEffects
  fieldEffectsForTarget?: (target: SpawnedPokemon) => MapFieldEffects
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
  accuracyRule?: MoveAutomationAccuracyRule | null
  random?: () => number
  randomRoller?: MoveAutomationRandomRoller
}

export interface ResolveInstantSelfMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  fieldEffects?: MapFieldEffects
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
  random?: () => number
  randomRoller?: MoveAutomationRandomRoller
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

type LegacyRollPurpose =
  | 'accuracy'
  | 'damage'
  | 'critical-damage'
  | 'hit-count'
  | 'random-stage'

const legacyRollMetadata = (options: {
  readonly script: MoveAutomationScript
  readonly purpose: LegacyRollPurpose
  readonly target?: SpawnedPokemon
  readonly ordinal?: number
}): MoveAutomationRollRequestMetadata => {
  const ordinal = options.ordinal ?? 1
  const ordinalLabel = options.ordinal == null ? '' : ` ${ordinal}`
  const target = options.target ? ` against ${options.target.id}` : ''
  return {
    rollId: `legacy-v1.${options.purpose}.${ordinal}`,
    parentEffectId: `legacy-v1.${options.purpose}`,
    reason: `${options.script.moveName} ${options.purpose}${ordinalLabel}${target}`,
  }
}

const recordedAccuracyD20 = (options: {
  readonly script: MoveAutomationScript
  readonly target: SpawnedPokemon
  readonly userAccuracy: number
  readonly ordinal?: number
  readonly random?: () => number
  readonly randomRoller?: MoveAutomationRandomRoller
}): number => options.randomRoller?.roll({
  ...legacyRollMetadata({
    script: options.script,
    purpose: 'accuracy',
    target: options.target,
    ordinal: options.ordinal,
  }),
  formula: { kind: 'dice', count: 1, sides: 20, modifier: 0 },
  modifiers: [{ sourceId: 'user-accuracy', reason: 'User Accuracy', value: options.userAccuracy }],
}).naturalResult ?? randomD20(options.random)

const damageRollResultFromTable = (
  formula: string,
  roller: MoveAutomationRandomRoller,
  metadata: MoveAutomationRollRequestMetadata,
  entries: readonly { readonly roll: number; readonly multiplier: number }[],
): MoveDamageRollResult | null => {
  const parsed = parseMoveDamageFormula(formula)
  if (!parsed) return null
  const result = roller.rollTable({
    ...metadata,
    formula: { kind: 'table', tableId: 'legacy-v1.direct-hp-loss' },
    drawFormula: {
      kind: 'dice',
      count: parsed.count,
      sides: parsed.sides,
      modifier: parsed.mod,
    },
    entries: entries.map((entry) => ({
      minimum: entry.roll,
      maximum: entry.roll,
      value: entry.multiplier,
    })),
  })
  return {
    formula: `${parsed.count}d${parsed.sides}${parsed.mod >= 0 ? '+' : ''}${parsed.mod}`,
    count: parsed.count,
    sides: parsed.sides,
    mod: parsed.mod,
    rolls: [...result.naturalResults],
    total: result.modifiedResult,
  }
}

const recordedDamageFormula = (options: {
  readonly script: MoveAutomationScript
  readonly target: SpawnedPokemon
  readonly formula: string
  readonly purpose?: Extract<LegacyRollPurpose, 'damage' | 'critical-damage'>
  readonly ordinal?: number
  readonly random?: () => number
  readonly randomRoller?: MoveAutomationRandomRoller
}): MoveDamageRollResult | null => {
  if (!options.randomRoller) return rollDamageFormula(options.formula, options.random)
  const metadata = legacyRollMetadata({
    script: options.script,
    purpose: options.purpose ?? 'damage',
    target: options.target,
    ordinal: options.ordinal,
  })
  const directHpRule = options.purpose !== 'critical-damage'
    && options.script.directHpLoss?.kind === 'user-level-roll-table'
    ? options.script.directHpLoss
    : null
  return directHpRule
    ? damageRollResultFromTable(
        options.formula,
        options.randomRoller,
        metadata,
        directHpRule.rollTable,
      )
    : rollMoveDamageFormulaWithRoller(options.formula, options.randomRoller, metadata)
}

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

    if (suggestion.optional && !suggestion.threshold) return

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

const resolveTargetGroupConditionApplications = (
  script: MoveAutomationScript,
  targets: readonly SpawnedPokemon[],
  targetResolutions: Readonly<Record<string, MoveAutomationTargetResolutionState | undefined>>,
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
    const canAutoEnable = !suggestion.optional || Boolean(suggestion.threshold)
    if (isTargetConditionAddition(suggestion) && canAutoEnable) filteredSuggestionIndexes.add(index)
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

const resolveTargetGroupStageApplications = (
  script: MoveAutomationScript,
  targets: readonly SpawnedPokemon[],
  targetResolutions: Readonly<Record<string, MoveAutomationTargetResolutionState | undefined>>,
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
  fieldEffectsForTarget,
  conditionImmunityContext,
  accuracyRule,
  random,
  randomRoller,
  idFactory,
}: ResolveInstantMoveAutomationInput): InstantMoveAutomationResult => {
  const targetEvasion = resolveMoveAutomationTargetEvasion(script, target, {
    attacker: user,
    fieldEffects: fieldEffectsForTarget?.(target) ?? fieldEffects,
  })
  const userAccuracy = moveAutomationUserAccuracy(user, { fieldEffects })
  const accuracyRolls = [1, 2].map((ordinal) =>
    resolveMoveAutomationAccuracyRoll(script, recordedAccuracyD20({
      script,
      target,
      userAccuracy,
      ordinal,
      random,
      randomRoller,
    }), {
      userAccuracy,
      targetEvasion: targetEvasion.value,
      accuracyRule,
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
    ? recordedDamageFormula({ script, target, formula: resolvedDamageFormula, random, randomRoller })
    : null
  const criticalFormula = baseDamageBase > 0 ? damageFormulaForDamageBase(baseDamageBase) : null
  let criticalBonusDamage = 0
  for (let index = 0; index < critCount; index += 1) {
    if (!criticalFormula) continue
    criticalBonusDamage += recordedDamageFormula({
      script,
      target,
      formula: criticalFormula,
      purpose: 'critical-damage',
      ordinal: index + 1,
      random,
      randomRoller,
    })?.total ?? 0
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
    fieldEffectsForTarget,
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
  fieldEffectsForTarget,
  conditionImmunityContext,
  accuracyRule,
  random,
  randomRoller,
  idFactory,
}: ResolveInstantMoveAutomationInput): InstantMoveAutomationResult => {
  script = moveAutomationScriptWithPoisonTouch(script, user)

  if (script.dynamicDamageBase?.kind === 'double-strike') {
    return resolveInstantDoubleStrikeMoveAutomation({
      script,
      user,
      target,
      damageFormula,
      fieldEffects,
      fieldEffectsForTarget,
      conditionImmunityContext,
      accuracyRule,
      random,
      randomRoller,
      idFactory,
    })
  }

  const targetEvasion = resolveMoveAutomationTargetEvasion(script, target, {
    attacker: user,
    fieldEffects: fieldEffectsForTarget?.(target) ?? fieldEffects,
  })
  const userAccuracy = moveAutomationUserAccuracy(user, { fieldEffects })
  const naturalRoll = recordedAccuracyD20({
    script,
    target,
    userAccuracy,
    random,
    randomRoller,
  })
  const accuracy = resolveMoveAutomationAccuracyRoll(script, naturalRoll, {
    userAccuracy,
    targetEvasion: targetEvasion.value,
    accuracyRule,
  })
  const runtimeDamage = accuracy.hit && script.damaging
    ? resolveMoveAutomationRuntimeDamageFormula({
        script,
        user,
        fallbackFormula: damageFormula,
        random,
        randomRoller,
        rollMetadata: legacyRollMetadata({ script, purpose: 'hit-count', target }),
      })
    : { formula: damageFormula ?? null, note: null }
  const damageRoll = accuracy.hit && script.damaging && runtimeDamage.formula
    ? recordedDamageFormula({ script, target, formula: runtimeDamage.formula, random, randomRoller })
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
    ? resolveMoveAutomationRandomStageSuggestion({
        script,
        enabledSuggestions,
        random,
        randomRoller,
        rollMetadata: legacyRollMetadata({ script, purpose: 'random-stage', target }),
      })
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
    fieldEffectsForTarget,
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
  fieldEffectsForTarget,
  conditionImmunityContext,
  random,
  randomRoller,
}: ResolveInstantTargetMoveAutomationInput): MoveAutomationTransaction => {
  script = moveAutomationScriptWithPoisonTouch(script, user)

  const state = defaultTargetResolutionState(script)
  const runtimeDamage = script.damaging && state.hit
    ? resolveMoveAutomationRuntimeDamageFormula({
        script,
        user,
        fallbackFormula: damageFormula,
        random,
        randomRoller,
        rollMetadata: legacyRollMetadata({ script, purpose: 'hit-count', target }),
      })
    : { formula: damageFormula ?? null, note: null }
  if (script.damaging && state.hit && runtimeDamage.formula) {
    state.damageRoll = recordedDamageFormula({
      script,
      target,
      formula: runtimeDamage.formula,
      random,
      randomRoller,
    })
  }
  const targetResolutions = { [target.id]: state }
  const enabledSuggestions: Record<string, boolean> = {}
  enableDefaultSuggestions(script, enabledSuggestions)
  const randomStageNote = resolveMoveAutomationRandomStageSuggestion({
    script,
    enabledSuggestions,
    random,
    randomRoller,
    rollMetadata: legacyRollMetadata({ script, purpose: 'random-stage', target }),
  })
  const conditionApplications = resolveTargetGroupConditionApplications(script, [target], targetResolutions, conditionImmunityContext)
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
    fieldEffectsForTarget,
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
  conditionImmunityContext,
  random,
  randomRoller,
}: ResolveInstantSelfMoveAutomationInput): MoveAutomationTransaction => {
  script = moveAutomationScriptWithPoisonTouch(script, user)

  const enabledSuggestions: Record<string, boolean> = {}
  enableDefaultSuggestions(script, enabledSuggestions)
  const randomStageNote = resolveMoveAutomationRandomStageSuggestion({
    script,
    enabledSuggestions,
    random,
    randomRoller,
    rollMetadata: legacyRollMetadata({ script, purpose: 'random-stage' }),
  })
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
    conditionImmunityContext,
  })
}

const formatTargetGroupAccuracyLogLines = (
  targets: readonly SpawnedPokemon[],
  targetResolutions: Record<string, { accuracyRoll: string; hit: boolean }>,
  emptyTargetsMessage?: string,
): string[] => {
  if (!targets.length) return emptyTargetsMessage ? [emptyTargetsMessage] : []
  return targets.map((target) => {
    const resolution = targetResolutions[target.id]
    if (!resolution?.accuracyRoll) return `${target.species}: ${resolution?.hit ? 'hit' : 'miss'}.`
    return `${target.species}: accuracy ${resolution.accuracyRoll} (${resolution.hit ? 'hit' : 'miss'}).`
  })
}

const formatAreaAccuracyLogLines = (
  targets: readonly SpawnedPokemon[],
  targetResolutions: Record<string, { accuracyRoll: string; hit: boolean }>,
): string[] => formatTargetGroupAccuracyLogLines(targets, targetResolutions, 'No legal targets in the confirmed area.')

const formatMultiTargetAccuracyLogLines = (
  targets: readonly SpawnedPokemon[],
  targetResolutions: Record<string, { accuracyRoll: string; hit: boolean }>,
): string[] => formatTargetGroupAccuracyLogLines(targets, targetResolutions, 'No selected targets.')

interface ResolveInstantTargetGroupMoveAutomationInput {
  script: MoveAutomationScript
  user: SpawnedPokemon
  targets: readonly SpawnedPokemon[]
  damageFormula?: string | null
  fieldEffects?: MapFieldEffects
  fieldEffectsForTarget?: (target: SpawnedPokemon) => MapFieldEffects
  conditionImmunityContext?: MoveAutomationConditionImmunityContext
  accuracyRule?: MoveAutomationAccuracyRule | null
  random?: () => number
  randomRoller?: MoveAutomationRandomRoller
}

interface InstantTargetGroupMoveAutomationResolution {
  transaction: MoveAutomationTransaction
  targetResolutions: Record<string, MoveAutomationTargetResolutionState>
}

const resolveInstantTargetGroupMoveAutomation = ({
  script,
  user,
  targets,
  damageFormula,
  fieldEffects,
  fieldEffectsForTarget,
  conditionImmunityContext,
  accuracyRule,
  random,
  randomRoller,
}: ResolveInstantTargetGroupMoveAutomationInput): InstantTargetGroupMoveAutomationResolution => {
  script = moveAutomationScriptWithPoisonTouch(script, user)

  const targetResolutions: Record<string, MoveAutomationTargetResolutionState> = {}
  const userAccuracy = moveAutomationUserAccuracy(user, { fieldEffects })
  for (const [targetIndex, target] of targets.entries()) {
    const state = defaultTargetResolutionState(script)
    if (script.requiresAccuracy) {
      const targetEvasion = resolveMoveAutomationTargetEvasion(script, target, {
        attacker: user,
        fieldEffects: fieldEffectsForTarget?.(target) ?? fieldEffects,
      })
      const accuracy = resolveMoveAutomationAccuracyRoll(script, recordedAccuracyD20({
        script,
        target,
        userAccuracy,
        ordinal: targetIndex + 1,
        random,
        randomRoller,
      }), {
        userAccuracy,
        targetEvasion: targetEvasion.value,
        accuracyRule,
      })
      state.accuracyRoll = accuracy.accuracyRoll
      state.hit = accuracy.hit
      state.crit = accuracy.crit
    }
    if (script.damaging && state.hit && damageFormula) {
      state.damageRoll = recordedDamageFormula({
        script,
        target,
        formula: damageFormula,
        ordinal: targetIndex + 1,
        random,
        randomRoller,
      })
    }
    targetResolutions[target.id] = state
  }

  const enabledSuggestions: Record<string, boolean> = {}
  enableDefaultSuggestions(script, enabledSuggestions)
  const conditionApplications = resolveTargetGroupConditionApplications(script, targets, targetResolutions, conditionImmunityContext)
  conditionApplications.targetIdsBySuggestion.forEach((targetIds, index) => {
    if (targetIds.size) enabledSuggestions[moveAutomationSuggestionKey(script, 'condition', index)] = true
  })
  const stageApplications = resolveTargetGroupStageApplications(script, targets, targetResolutions)
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
    fieldEffectsForTarget,
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

  return { transaction, targetResolutions }
}

export const resolveInstantMultiTargetMoveAutomation = ({
  script,
  user,
  targets,
  selectedTargets,
  damageFormula,
  fieldEffects,
  fieldEffectsForTarget,
  conditionImmunityContext,
  accuracyRule,
  random,
  randomRoller,
}: ResolveInstantMultiTargetMoveAutomationInput): MoveAutomationTransaction => {
  const resolvedTargets = selectedTargets ?? targets ?? []
  const { transaction, targetResolutions } = resolveInstantTargetGroupMoveAutomation({
    script,
    user,
    targets: resolvedTargets,
    damageFormula,
    fieldEffects,
    fieldEffectsForTarget,
    conditionImmunityContext,
    accuracyRule,
    random,
    randomRoller,
  })

  transaction.logLines.push(...formatMultiTargetAccuracyLogLines(resolvedTargets, targetResolutions))
  return transaction
}

export const resolveInstantAreaMoveAutomation = ({
  script,
  user,
  targets,
  damageFormula,
  fieldEffects,
  fieldEffectsForTarget,
  conditionImmunityContext,
  accuracyRule,
  random,
  randomRoller,
}: ResolveInstantAreaMoveAutomationInput): MoveAutomationTransaction => {
  const { transaction, targetResolutions } = resolveInstantTargetGroupMoveAutomation({
    script,
    user,
    targets,
    damageFormula,
    fieldEffects,
    fieldEffectsForTarget,
    conditionImmunityContext,
    accuracyRule,
    random,
    randomRoller,
  })

  transaction.logLines.push(...formatAreaAccuracyLogLines(targets, targetResolutions))
  return transaction
}
