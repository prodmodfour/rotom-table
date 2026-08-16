import {
  MOVE_EFFECT_OPERATION_LIMITS,
  type MoveCheckEffectOperation,
  type MoveCheckResolvedRollSource,
  type MoveCheckRollDefinition,
  type MoveCheckRollFormula,
  type MoveEffectCheckOutcome,
  type MoveEffectCheckRerollKeepPolicy,
} from '#shared/moveAutomation/effects'
import {
  MOVE_AUTOMATION_ROLL_LEDGER_LIMITS,
  type MoveAutomationRollLedgerEntry,
  type MoveAutomationRollModifier,
} from '#shared/moveAutomation/random'
import type { MoveRuleScalar } from '#shared/moveAutomation/ast'
import type { CharacterSheet } from '~/types/characterSheet'
import type { TrainerSheet } from '~/types/trainerSheet'
import { parseSkillDiceValue } from '~/utils/skillRanks'
import { resolveSkills } from '~/utils/sheets/pokemonDerived'
import { resolveTrainerSkills } from '~/utils/sheets/trainerDerived'
import type { AuthoritativeMoveRulesContext } from './context'
import type { MoveSpecResponseResolver } from './responses'
import {
  evaluateMoveExpression,
  type MoveRuleEvaluationTraceEntry,
  type MoveRuleSelectorState,
} from './evaluateExpression'
import { applyEncounterNumericModifiers } from './encounterNumericModifiers'
import { aa075InfiltratorStealthBonus } from '../abilityAutomation/mechanics/aa075StaticIntegration'
import { aa076JustifiedInterceptCheckBonus } from '../abilityAutomation/mechanics/aa076StaticIntegration'

export type MoveCheckExecutionErrorCode =
  | 'check-recipient-required'
  | 'check-recipient-unavailable'
  | 'check-skill-unavailable'
  | 'check-stat-unavailable'
  | 'check-expression-not-numeric'
  | 'check-roll-budget-exceeded'
  | 'check-roll-id-too-long'
  | 'check-resource-reroll-spend-unsupported'

export class MoveCheckExecutionError extends Error {
  readonly code: MoveCheckExecutionErrorCode

  constructor(code: MoveCheckExecutionErrorCode, message: string) {
    super(message)
    this.name = 'MoveCheckExecutionError'
    this.code = code
  }
}

export type MoveCheckParticipantRole = 'actor' | 'target'

export interface MoveCheckResolvedSource {
  readonly kind: MoveCheckResolvedRollSource['kind']
  readonly skill: string | null
  readonly stat: string | null
  readonly formula: MoveCheckRollFormula
  /** Sheet-owned skill modifier or resolved stat contribution; null for fixed rolls. */
  readonly basisModifier: number | null
}

export interface MoveCheckModifierResolution {
  readonly sourceId: string
  readonly reasonCode: string
  readonly value: number
  readonly evaluationTrace: readonly MoveRuleEvaluationTraceEntry[]
}

export interface MoveCheckRollAttempt {
  readonly rollId: string
  /** One-based comparison round; values above one follow a tied comparison. */
  readonly tieRound: number
  /** Zero is the initial roll; positive values are automatic rerolls. */
  readonly rerollIndex: number
  readonly naturalResults: readonly number[]
  readonly naturalResult: number
  readonly finalValue: number
}

export interface MoveCheckParticipantResolution {
  readonly role: MoveCheckParticipantRole
  readonly placementId: string
  readonly referenceId: string
  readonly source: MoveCheckResolvedSource
  readonly modifiers: readonly MoveCheckModifierResolution[]
  readonly attempts: readonly MoveCheckRollAttempt[]
  readonly selectedRollId: string
  readonly finalValue: number
}

export interface MoveCheckDcResolution {
  readonly value: number
  readonly evaluationTrace: readonly MoveRuleEvaluationTraceEntry[]
}

export interface MoveCheckResolution {
  readonly operationId: string
  readonly checkId: string
  readonly kind: 'opposed' | 'save'
  /** The recipient against whom the actor rolls, or who attempts the save. */
  readonly recipientId: string
  readonly actor: MoveCheckParticipantResolution | null
  readonly target: MoveCheckParticipantResolution
  readonly dc: MoveCheckDcResolution | null
  readonly tieRerolls: number
  readonly outcome: MoveEffectCheckOutcome
  readonly status: 'resolved' | 'provisional'
  /** Null while an optional resource reroll awaits a durable human response. */
  readonly selectedBranchId: string | null
}

export interface MoveCheckResolvedRollReference {
  readonly referenceId: string
  readonly role: MoveCheckParticipantRole
  readonly recipientId: string
  readonly checkRecipientId: string
  readonly rollId: string
  readonly attemptIndex: number
}

interface MoveCheckPendingBase {
  readonly checkId: string
  readonly role: MoveCheckParticipantRole
  readonly requestId: string
  readonly promptKey: string
  readonly ownerPlacementIds: readonly string[]
  readonly options: readonly {
    readonly id: string
    readonly labelKey: string
  }[]
}

export interface MoveCheckPendingSelection extends MoveCheckPendingBase {
  readonly kind: 'selection'
}

export interface MoveCheckPendingResourceReroll extends MoveCheckPendingBase {
  readonly kind: 'resource-reroll'
  readonly resourceId: string
  readonly amount: number
  readonly checkRecipientId: string
}

export type MoveCheckPendingRequest =
  | MoveCheckPendingSelection
  | MoveCheckPendingResourceReroll

export interface MoveCheckResolvedResponse {
  readonly requestId: string
  readonly optionId: string
}

interface MoveCheckExecutionBase {
  readonly resolutions: readonly MoveCheckResolution[]
  readonly rollReferences: readonly MoveCheckResolvedRollReference[]
  readonly rollLedgerEntries: readonly MoveAutomationRollLedgerEntry[]
  readonly resolvedResponses: readonly MoveCheckResolvedResponse[]
}

export interface MoveCheckExecutionComplete extends MoveCheckExecutionBase {
  readonly kind: 'complete'
}

export interface MoveCheckExecutionPending extends MoveCheckExecutionBase {
  readonly kind: 'pending'
  readonly request: MoveCheckPendingRequest
}

export type MoveCheckExecution = MoveCheckExecutionComplete | MoveCheckExecutionPending

export interface ExecuteMoveCheckOperationInput {
  readonly context: AuthoritativeMoveRulesContext
  readonly operation: MoveCheckEffectOperation
  readonly recipientIds: readonly string[]
  readonly selectorState: MoveRuleSelectorState
  readonly canonicalMoveId: string
  readonly responseResolver?: MoveSpecResponseResolver
}

interface PreparedCheckRoll {
  readonly role: MoveCheckParticipantRole
  readonly placementId: string
  readonly definition: MoveCheckRollDefinition
  readonly source: MoveCheckResolvedSource
  readonly modifiers: readonly MoveCheckModifierResolution[]
  readonly ledgerModifiers: readonly MoveAutomationRollModifier[]
}

const fail = (code: MoveCheckExecutionErrorCode, message: string): never => {
  throw new MoveCheckExecutionError(code, message)
}

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const numericExpressionValue = (
  value: MoveRuleScalar,
  description: string,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail('check-expression-not-numeric', `${description} must resolve to a finite number.`)
  }
  return value
}

const resolvedSkillSource = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  source: Extract<MoveCheckResolvedRollSource, { readonly kind: 'skill' }>,
): MoveCheckResolvedSource => {
  const placement = context.queries.placements.get(placementId)
    ?? fail('check-recipient-unavailable', `Check participant ${placementId} does not exist.`)
  const resolvedSheet = context.queries.sheets.forPlacement(placement)
    ?? fail('check-recipient-unavailable', `Check participant ${placementId} has no resolved sheet.`)
  context.reads.recordPlacement(placement)

  let dice: number
  let modifier: number
  if (resolvedSheet.kind === 'pokemon') {
    const row = resolveSkills(resolvedSheet.sheet as CharacterSheet)
      .find(skill => skill.key === source.skill)
    const parsed = parseSkillDiceValue(row?.value)
      ?? fail(
        'check-skill-unavailable',
        `${placementId} has no valid authoritative ${source.skill} skill dice.`,
      )
    dice = parsed.dice
    modifier = parsed.modifier
  }
  else {
    const row = resolveTrainerSkills(resolvedSheet.sheet as TrainerSheet)
      .find(skill => skill.key === source.skill)
      ?? fail(
        'check-skill-unavailable',
        `${placementId} has no authoritative ${source.skill} skill.`,
      )
    dice = row.rankValue
    modifier = row.modifier
  }

  const viralLink = (context.map.encounterState?.capabilityRuntime?.links ?? []).find(link => (
    link.kind === 'viral-fusion' && link.ownerPlacementId === placementId && link.participantPlacementIds.length === 1
  ))
  if (viralLink
    && context.queries.creatureRules.hasCapabilityInstance(
      placementId,
      viralLink.capabilityInstanceId,
      viralLink.canonicalId,
    )
    && ['athletics', 'acrobatics', 'combat', 'stealth', 'perception'].includes(source.skill)) {
    const bondedPlacement = context.queries.placements.get(viralLink.participantPlacementIds[0]!)
    const bondedSheet = bondedPlacement ? context.queries.sheets.forPlacement(bondedPlacement) : null
    if (bondedPlacement && bondedSheet) {
      context.reads.recordPlacement(bondedPlacement)
      if (bondedSheet.kind === 'pokemon') {
        const parsed = parseSkillDiceValue(resolveSkills(bondedSheet.sheet as CharacterSheet)
          .find(skill => skill.key === source.skill)?.value)
        if (parsed) {
          dice = Math.min(6, parsed.dice + 1)
          modifier = parsed.modifier
        }
      }
      else {
        const row = resolveTrainerSkills(bondedSheet.sheet as TrainerSheet).find(skill => skill.key === source.skill)
        if (row) {
          dice = Math.min(6, row.rankValue + 1)
          modifier = row.modifier
        }
      }
    }
  }

  modifier = context.queries.equipment.metric({
    placementId,
    metric: 'skill-check-modifier',
    targetId: source.skill,
    base: modifier,
  })?.final ?? modifier

  if (
    !Number.isSafeInteger(dice)
    || dice < 1
    || dice > MOVE_EFFECT_OPERATION_LIMITS.diceCount
    || !Number.isFinite(modifier)
    || Math.abs(modifier) > MOVE_EFFECT_OPERATION_LIMITS.numericMagnitude
  ) {
    return fail(
      'check-skill-unavailable',
      `${placementId}'s ${source.skill} skill exceeds the bounded roll limits.`,
    )
  }
  return deepFreeze({
    kind: source.kind,
    skill: source.skill,
    stat: null,
    formula: { kind: 'dice', count: dice, sides: 6, modifier: 0 },
    basisModifier: modifier,
  })
}

const resolvedStatSource = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  source: Extract<MoveCheckResolvedRollSource, { readonly kind: 'stat' }>,
): MoveCheckResolvedSource => {
  const resolution = context.queries.stats.resolve(placementId, {
    stat: source.stat,
    combatStagePolicy: source.combatStagePolicy,
    stageModifierPolicy: source.stageModifierPolicy,
  }) ?? fail(
    'check-stat-unavailable',
    `${placementId} has no authoritative ${source.stat} stat for this check.`,
  )
  return deepFreeze({
    kind: source.kind,
    skill: null,
    stat: source.stat,
    formula: { ...source.formula },
    basisModifier: resolution.value,
  })
}

const resolvedRollSource = (
  context: AuthoritativeMoveRulesContext,
  placementId: string,
  source: MoveCheckResolvedRollSource,
): MoveCheckResolvedSource => {
  if (source.kind === 'skill') return resolvedSkillSource(context, placementId, source)
  if (source.kind === 'stat') return resolvedStatSource(context, placementId, source)
  return deepFreeze({
    kind: source.kind,
    skill: null,
    stat: null,
    formula: { ...source.formula },
    basisModifier: null,
  })
}

const expressionSelectorState = (
  input: ExecuteMoveCheckOperationInput,
  recipientId: string,
): MoveRuleSelectorState => ({
  ...input.selectorState,
  targetIds: [recipientId],
})

const prepareRoll = (options: {
  readonly input: ExecuteMoveCheckOperationInput
  readonly definition: MoveCheckRollDefinition
  readonly source: MoveCheckResolvedRollSource
  readonly role: MoveCheckParticipantRole
  readonly placementId: string
  readonly recipientId: string
  readonly recipientOrdinal: number
}): PreparedCheckRoll => {
  const source = resolvedRollSource(
    options.input.context,
    options.placementId,
    options.source,
  )
  const selectorState = expressionSelectorState(options.input, options.recipientId)
  const modifiers = options.definition.modifiers.map((modifier, modifierIndex) => {
    const evaluation = evaluateMoveExpression({
      context: options.input.context,
      selectorState,
      canonicalMoveId: options.input.canonicalMoveId,
      rootNodeId: `${options.input.operation.id}.${options.role}.${options.recipientOrdinal}.modifier.${modifierIndex + 1}`,
      expression: modifier.value,
    })
    return deepFreeze({
      sourceId: modifier.sourceId,
      reasonCode: modifier.reasonCode,
      value: numericExpressionValue(
        evaluation.value,
        `Check modifier ${modifier.sourceId}`,
      ),
      evaluationTrace: [...evaluation.trace],
    })
  })
  const skillCheck = source.kind === 'skill'
    ? applyEncounterNumericModifiers({
        map: options.input.context.map,
        placementId: options.placementId,
        attribute: 'skill-check',
        baseValue: 0,
        now: options.input.context.time,
        isCapabilityEffective: canonicalId => options.input.context.queries.creatureRules.hasCapability(options.placementId, canonicalId),
        isCapabilityInstanceEffective: (instanceId, canonicalId) => options.input.context.queries.creatureRules
          .hasCapabilityInstance(options.placementId, instanceId, canonicalId),
      })
    : { value: 0, steps: [] as const }
  const shadowMeldStealthBonus = source.kind === 'skill'
    && source.skill?.trim().toLowerCase() === 'stealth'
    && options.input.context.queries.creatureRules.hasCapability(options.placementId, 'Shadow Meld')
    && (options.input.context.map.encounterState?.capabilityRuntime?.modes ?? []).some(mode => (
      mode.actorPlacementId === options.placementId && mode.mode === 'shadow-melded'
      && options.input.context.queries.creatureRules.hasCapabilityInstance(
        options.placementId,
        mode.capabilityInstanceId,
        mode.canonicalId,
      )
      && (mode.expiresAt === null || mode.expiresAt > options.input.context.time)
    )) ? 4 : 0
  const infiltratorBonus = source.kind === 'skill'
    ? aa075InfiltratorStealthBonus({
        context: options.input.context,
        placementId: options.placementId,
        skill: source.skill ?? '',
      })
    : 0
  const justifiedBonus = aa076JustifiedInterceptCheckBonus({
    context: options.input.context,
    placementId: options.placementId,
    canonicalMoveId: options.input.canonicalMoveId,
    participantRole: options.role,
  })
  const resolvedModifiers: readonly MoveCheckModifierResolution[] = [
    ...modifiers,
    ...skillCheck.steps.map(step => deepFreeze({
      sourceId: step.effectId,
      reasonCode: 'encounter.skill-check-modifier',
      value: step.delta,
      evaluationTrace: [] as const,
    })),
    ...(shadowMeldStealthBonus === 0 ? [] : [deepFreeze({
      sourceId: 'capability.shadow-meld',
      reasonCode: 'capability.shadow-meld.stealth-bonus',
      value: shadowMeldStealthBonus,
      evaluationTrace: [] as const,
    })]),
    ...(infiltratorBonus === 0 ? [] : [deepFreeze({
      sourceId: 'ability.infiltrator',
      reasonCode: 'ability.infiltrator.stealth-bonus',
      value: infiltratorBonus,
      evaluationTrace: [] as const,
    })]),
    ...(justifiedBonus === 0 ? [] : [deepFreeze({
      sourceId: 'ability.justified',
      reasonCode: 'ability.justified.intercept-check-bonus',
      value: justifiedBonus,
      evaluationTrace: [] as const,
    })]),
  ]
  const ledgerModifiers: MoveAutomationRollModifier[] = [
    ...(source.basisModifier === null
      ? []
      : [{
          sourceId: 'check-basis',
          reason: source.kind === 'skill'
            ? `check.skill.${source.skill}`
            : `check.stat.${source.stat}`,
          value: source.basisModifier,
        }]),
    ...resolvedModifiers.map(modifier => ({
      sourceId: modifier.sourceId,
      reason: modifier.reasonCode,
      value: modifier.value,
    })),
  ]
  return deepFreeze({
    role: options.role,
    placementId: options.placementId,
    definition: options.definition,
    source,
    modifiers: resolvedModifiers,
    ledgerModifiers,
  })
}

const selectedAttempt = (
  attempts: readonly MoveCheckRollAttempt[],
  keep: MoveEffectCheckRerollKeepPolicy,
): MoveCheckRollAttempt => {
  if (keep === 'latest') return attempts.at(-1)!
  return attempts.slice(1).reduce((selected, attempt) => {
    if (keep === 'highest') return attempt.finalValue > selected.finalValue ? attempt : selected
    return attempt.finalValue < selected.finalValue ? attempt : selected
  }, attempts[0]!)
}

const boundedRollId = (
  baseId: string,
  recipientOrdinal: number,
  tieRound: number,
  rerollIndex: number,
): string => {
  const id = `${baseId}.t${recipientOrdinal}.r${tieRound}.a${rerollIndex + 1}`
  if (id.length > MOVE_EFFECT_OPERATION_LIMITS.identifierLength) {
    return fail(
      'check-roll-id-too-long',
      `Resolved check roll ID ${id} exceeds ${MOVE_EFFECT_OPERATION_LIMITS.identifierLength} characters.`,
    )
  }
  return id
}

const executePreparedRoll = (options: {
  readonly input: ExecuteMoveCheckOperationInput
  readonly prepared: PreparedCheckRoll
  readonly checkRecipientId: string
  readonly recipientOrdinal: number
  readonly tieRound: number
  readonly rollReferences: MoveCheckResolvedRollReference[]
  readonly previousAttempts: readonly MoveCheckRollAttempt[]
}): MoveCheckParticipantResolution => {
  const roundAttempts: MoveCheckRollAttempt[] = []
  for (
    let rerollIndex = 0;
    rerollIndex <= options.prepared.definition.reroll.count;
    rerollIndex += 1
  ) {
    const rollId = boundedRollId(
      options.prepared.definition.rollId,
      options.recipientOrdinal,
      options.tieRound,
      rerollIndex,
    )
    const result = options.input.context.random.roll({
      rollId,
      parentEffectId: options.input.operation.id,
      formula: options.prepared.source.formula,
      reason: `${options.input.operation.reasonCode}.${options.prepared.role}.round-${options.tieRound}`,
      modifiers: options.prepared.ledgerModifiers,
    })
    roundAttempts.push(deepFreeze({
      rollId,
      tieRound: options.tieRound,
      rerollIndex,
      naturalResults: [...result.naturalResults],
      naturalResult: result.naturalResult,
      finalValue: result.finalValue,
    }))
    options.rollReferences.push(deepFreeze({
      referenceId: options.prepared.definition.rollId,
      role: options.prepared.role,
      recipientId: options.prepared.placementId,
      checkRecipientId: options.checkRecipientId,
      rollId,
      attemptIndex: options.previousAttempts.length + roundAttempts.length,
    }))
  }
  const selected = selectedAttempt(
    roundAttempts,
    options.prepared.definition.reroll.keep,
  )
  return deepFreeze({
    role: options.prepared.role,
    placementId: options.prepared.placementId,
    referenceId: options.prepared.definition.rollId,
    source: options.prepared.source,
    modifiers: options.prepared.modifiers,
    attempts: [...options.previousAttempts, ...roundAttempts],
    selectedRollId: selected.rollId,
    finalValue: selected.finalValue,
  })
}

const dcForRecipient = (
  input: ExecuteMoveCheckOperationInput,
  recipientId: string,
  recipientOrdinal: number,
): MoveCheckDcResolution => {
  if (input.operation.payload.kind !== 'save') {
    return fail('check-expression-not-numeric', 'Opposed checks do not have a DC expression.')
  }
  const evaluation = evaluateMoveExpression({
    context: input.context,
    selectorState: expressionSelectorState(input, recipientId),
    canonicalMoveId: input.canonicalMoveId,
    rootNodeId: `${input.operation.id}.target.${recipientOrdinal}.dc`,
    expression: input.operation.payload.dc,
  })
  return deepFreeze({
    value: numericExpressionValue(evaluation.value, `Check ${input.operation.payload.checkId} DC`),
    evaluationTrace: [...evaluation.trace],
  })
}

const maximumTieRounds = (operation: MoveCheckEffectOperation): number => (
  operation.payload.tie.kind === 'reroll'
    ? operation.payload.tie.maximumRerolls + 1
    : 1
)

const maximumLedgerEntries = (
  operation: MoveCheckEffectOperation,
  recipients: number,
): number => {
  const rolls = operation.payload.kind === 'opposed'
    ? [operation.payload.actorRoll, operation.payload.targetRoll]
    : [operation.payload.roll]
  const perRound = rolls.reduce((total, roll) => total + roll.reroll.count + 1, 0)
  return recipients * perRound * maximumTieRounds(operation)
}

const assertRollBudget = (
  input: ExecuteMoveCheckOperationInput,
): void => {
  const used = input.context.random.snapshot().length
  const requested = maximumLedgerEntries(input.operation, input.recipientIds.length)
  if (used + requested > MOVE_AUTOMATION_ROLL_LEDGER_LIMITS.entries) {
    fail(
      'check-roll-budget-exceeded',
      `Check ${input.operation.payload.checkId} may require ${requested} rolls after ${used} existing ledger entries.`,
    )
  }
}

interface MoveCheckRollCandidate {
  readonly role: MoveCheckParticipantRole
  readonly roll: MoveCheckRollDefinition
  readonly owners: readonly string[]
}

const checkRollCandidates = (
  input: ExecuteMoveCheckOperationInput,
): readonly MoveCheckRollCandidate[] => {
  const payload = input.operation.payload
  return payload.kind === 'opposed'
    ? [
        {
          role: 'actor',
          roll: payload.actorRoll,
          owners: [input.context.actor.placement.id],
        },
        {
          role: 'target',
          roll: payload.targetRoll,
          owners: input.recipientIds,
        },
      ]
    : [{ role: 'target', roll: payload.roll, owners: input.recipientIds }]
}

const isLegalChoiceSource = (options: {
  readonly input: ExecuteMoveCheckOperationInput
  readonly placementIds: readonly string[]
  readonly source: MoveCheckResolvedRollSource
}): boolean => {
  try {
    for (const placementId of options.placementIds) {
      resolvedRollSource(options.input.context, placementId, options.source)
    }
    return true
  }
  catch (error) {
    if (
      error instanceof MoveCheckExecutionError
      && (error.code === 'check-skill-unavailable' || error.code === 'check-stat-unavailable')
    ) return false
    throw error
  }
}

const legalChoiceOptions = (
  input: ExecuteMoveCheckOperationInput,
  candidate: MoveCheckRollCandidate,
) => {
  const source = candidate.roll.source
  if (source.kind !== 'choice') return []
  const options = source.options.filter(option => isLegalChoiceSource({
    input,
    placementIds: candidate.owners,
    source: option.source,
  }))
  if (options.length === 0) {
    fail(
      'check-skill-unavailable',
      `Check ${input.operation.payload.checkId} has no legal ${candidate.role} roll source.`,
    )
  }
  return options
}

const pendingSelection = (
  input: ExecuteMoveCheckOperationInput,
): MoveCheckPendingSelection | null => {
  const payload = input.operation.payload
  for (const candidate of checkRollCandidates(input)) {
    const source = candidate.roll.source
    if (source.kind !== 'choice') continue
    const response = input.responseResolver?.resolve({
      requestId: source.requestId,
      options: source.options,
      allowPass: false,
    }) ?? null
    if (response !== null) continue
    return deepFreeze({
      kind: 'selection',
      checkId: payload.checkId,
      role: candidate.role,
      requestId: source.requestId,
      promptKey: source.promptKey,
      ownerPlacementIds: [...candidate.owners],
      options: legalChoiceOptions(input, candidate).map(option => ({
        id: option.id,
        labelKey: option.labelKey,
      })),
    })
  }
  return null
}

const resolvedCheckRollSource = (
  input: ExecuteMoveCheckOperationInput,
  definition: MoveCheckRollDefinition,
): MoveCheckResolvedRollSource => {
  const source = definition.source
  if (source.kind !== 'choice') return source
  const response = input.responseResolver?.resolve({
    requestId: source.requestId,
    options: source.options,
    allowPass: false,
  }) ?? fail(
    'check-expression-not-numeric',
    `Check ${input.operation.payload.checkId} has no durable source response.`,
  )
  const option = source.options.find(candidate => candidate.id === response.optionId)
    ?? fail(
      'check-expression-not-numeric',
      `Check ${input.operation.payload.checkId} received an unavailable source response.`,
    )
  return option.source
}

const outcomeForComparison = (
  difference: number,
): MoveEffectCheckOutcome | null => (
  difference > 0 ? 'success' : difference < 0 ? 'failure' : null
)

const tieOutcome = (
  operation: MoveCheckEffectOperation,
  tieRerolls: number,
): MoveEffectCheckOutcome | null => {
  const tie = operation.payload.tie
  if (tie.kind !== 'reroll') return tie.kind
  return tieRerolls >= tie.maximumRerolls ? tie.exhaustedOutcome : null
}

const resolvedBranch = (
  operation: MoveCheckEffectOperation,
  outcome: MoveEffectCheckOutcome,
): string => operation.payload.branches[outcome]

const pendingResourceReroll = (
  input: ExecuteMoveCheckOperationInput,
  resolutions: readonly MoveCheckResolution[],
): MoveCheckPendingResourceReroll | null => {
  const payload = input.operation.payload
  const candidates = payload.kind === 'opposed'
    ? [
        { role: 'actor' as const, roll: payload.actorRoll },
        { role: 'target' as const, roll: payload.targetRoll },
      ]
    : [{ role: 'target' as const, roll: payload.roll }]
  const candidate = candidates.find(entry => entry.roll.resourceReroll !== null)
  const request = candidate?.roll.resourceReroll
  if (!candidate || !request) return null
  const resolution = resolutions.find((entry) => {
    if (request.trigger === 'always') return true
    return candidate.role === 'actor'
      ? entry.outcome === 'failure'
      : payload.kind === 'opposed'
        ? entry.outcome === 'success'
        : entry.outcome === 'failure'
  })
  if (!resolution) return null
  const ownerPlacementId = candidate.role === 'actor'
    ? input.context.actor.placement.id
    : resolution.recipientId
  return deepFreeze({
    kind: 'resource-reroll',
    checkId: payload.checkId,
    role: candidate.role,
    requestId: request.requestId,
    promptKey: request.promptKey,
    ownerPlacementIds: [ownerPlacementId],
    options: [
      { ...request.spendOption },
      { ...request.declineOption },
    ],
    resourceId: request.resourceId,
    amount: request.amount,
    checkRecipientId: resolution.recipientId,
  })
}

/**
 * Resolve one bounded check operation without mutating authoritative state.
 * Human-selected sources suspend before draws; optional resource rerolls
 * suspend after recording the provisional server-owned result.
 */
export const executeMoveCheckOperation = (
  input: ExecuteMoveCheckOperationInput,
): MoveCheckExecution => {
  if (input.recipientIds.length === 0) {
    return fail(
      'check-recipient-required',
      `Check ${input.operation.payload.checkId} requires at least one authoritative recipient.`,
    )
  }
  const ledgerStart = input.context.random.snapshot().length
  const resolvedResponses: MoveCheckResolvedResponse[] = checkRollCandidates(input).flatMap((candidate) => {
    const source = candidate.roll.source
    if (source.kind !== 'choice') return []
    const response = input.responseResolver?.resolve({
      requestId: source.requestId,
      options: source.options,
      allowPass: false,
    }) ?? null
    return response?.optionId
      ? [{ requestId: source.requestId, optionId: response.optionId }]
      : []
  })
  const selection = pendingSelection(input)
  if (selection) {
    return deepFreeze({
      kind: 'pending',
      resolutions: [],
      rollReferences: [],
      rollLedgerEntries: [],
      resolvedResponses,
      request: selection,
    })
  }
  assertRollBudget(input)

  const rollReferences: MoveCheckResolvedRollReference[] = []
  const resolutions: MoveCheckResolution[] = []
  for (const [recipientIndex, recipientId] of input.recipientIds.entries()) {
    if (!input.context.queries.placements.get(recipientId)) {
      return fail(
        'check-recipient-unavailable',
        `Check recipient ${recipientId} does not exist.`,
      )
    }
    const recipientOrdinal = recipientIndex + 1
    const payload = input.operation.payload
    const actorPrepared = payload.kind === 'opposed'
      ? prepareRoll({
          input,
          definition: payload.actorRoll,
          source: resolvedCheckRollSource(input, payload.actorRoll),
          role: 'actor',
          placementId: input.context.actor.placement.id,
          recipientId,
          recipientOrdinal,
        })
      : null
    const targetDefinition = payload.kind === 'opposed' ? payload.targetRoll : payload.roll
    const targetPrepared = prepareRoll({
      input,
      definition: targetDefinition,
      source: resolvedCheckRollSource(input, targetDefinition),
      role: 'target',
      placementId: recipientId,
      recipientId,
      recipientOrdinal,
    })
    const dc = payload.kind === 'save'
      ? dcForRecipient(input, recipientId, recipientOrdinal)
      : null

    let tieRound = 1
    let actor: MoveCheckParticipantResolution | null = null
    let target: MoveCheckParticipantResolution | null = null
    let actorAttempts: readonly MoveCheckRollAttempt[] = []
    let targetAttempts: readonly MoveCheckRollAttempt[] = []
    let outcome: MoveEffectCheckOutcome | null = null
    while (true) {
      actor = actorPrepared
        ? executePreparedRoll({
            input,
            prepared: actorPrepared,
            checkRecipientId: recipientId,
            recipientOrdinal,
            tieRound,
            rollReferences,
            previousAttempts: actorAttempts,
          })
        : null
      actorAttempts = actor?.attempts ?? []
      target = executePreparedRoll({
        input,
        prepared: targetPrepared,
        checkRecipientId: recipientId,
        recipientOrdinal,
        tieRound,
        rollReferences,
        previousAttempts: targetAttempts,
      })
      targetAttempts = target.attempts
      const difference = actor
        ? actor.finalValue - target.finalValue
        : target.finalValue - dc!.value
      const compared = outcomeForComparison(difference)
      if (compared) {
        outcome = compared
        break
      }
      const resolvedTie = tieOutcome(input.operation, tieRound - 1)
      if (resolvedTie) {
        outcome = resolvedTie
        break
      }
      tieRound += 1
    }

    resolutions.push(deepFreeze({
      operationId: input.operation.id,
      checkId: payload.checkId,
      kind: payload.kind,
      recipientId,
      actor,
      target: target ?? fail(
        'check-recipient-unavailable',
        `Check ${payload.checkId} did not resolve its target roll.`,
      ),
      dc,
      tieRerolls: tieRound - 1,
      outcome: outcome ?? fail(
        'check-expression-not-numeric',
        `Check ${payload.checkId} did not resolve an outcome.`,
      ),
      status: 'resolved',
      selectedBranchId: resolvedBranch(
        input.operation,
        outcome ?? fail(
          'check-expression-not-numeric',
          `Check ${payload.checkId} did not select a branch.`,
        ),
      ),
    }))
  }

  const resourceRequest = pendingResourceReroll(input, resolutions)
  const resourceResponse = resourceRequest
    ? input.responseResolver?.resolve({
        requestId: resourceRequest.requestId,
        options: resourceRequest.options,
        allowPass: false,
      }) ?? null
    : null
  if (resourceRequest && resourceResponse === null) {
    const provisionalResolutions = resolutions.map(resolution => deepFreeze({
      ...resolution,
      status: 'provisional' as const,
      selectedBranchId: null,
    }))
    return deepFreeze({
      kind: 'pending',
      resolutions: provisionalResolutions,
      rollReferences,
      rollLedgerEntries: input.context.random.snapshot().slice(ledgerStart),
      resolvedResponses,
      request: resourceRequest,
    })
  }
  if (resourceRequest && resourceResponse?.optionId === resourceRequest.options[0]?.id) {
    return fail(
      'check-resource-reroll-spend-unsupported',
      `Check ${resourceRequest.checkId} cannot spend ${resourceRequest.resourceId} until typed resource-cost planning is enabled.`,
    )
  }
  return deepFreeze({
    kind: 'complete',
    resolutions,
    rollReferences,
    rollLedgerEntries: input.context.random.snapshot().slice(ledgerStart),
    resolvedResponses: [
      ...resolvedResponses,
      ...(resourceRequest && resourceResponse?.optionId
        ? [{ requestId: resourceRequest.requestId, optionId: resourceResponse.optionId }]
        : []),
    ],
  })
}
