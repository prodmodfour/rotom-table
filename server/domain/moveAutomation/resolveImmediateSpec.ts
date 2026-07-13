import type {
  MoveResolutionAuditTrace,
  MoveResolutionTraceAncestryEntry,
  MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationHpUpdate,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { MoveDamageRollResult } from '~/utils/moveDamageBase'
import { formatMoveAutomationDamageLogLine } from '~/utils/moveAutomationLogLines'
import type {
  MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'
import type { ResolvedCanonicalMoveEntry } from '~/utils/authoritativeMoveEntries'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { createMoveStateChangePlan, type MoveStateChangePlan } from './plan'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from './context'
import { deduplicateAuthoritativeMoveSheetReads } from './context'
import type { MoveContextualDamageBaseResolution } from './damageBase'
import type { MoveDamageTypeResolution } from './damageTypes'
import { resolveMoveSpecDamageCalculation } from './damageStats'
import {
  executeMoveSpec,
  type MoveSpecAuthoritativeTargetEvaluation,
  type MoveSpecEmittedOperation,
  type MoveSpecExecutionCompleteResult,
  type MoveSpecExecutionPendingResult,
  type MoveSpecResolvedRoll,
} from './executeSpec'
import type { MoveSpecV2Runtime } from './registry'
import {
  isMoveCoreTokenEffectEmission,
  reduceMoveCoreTokenEffects,
  type MoveCoreTokenEffectReduction,
} from './reducers/coreTokenEffects'
import type {
  MoveConditionAccuracyRollQueries,
  MoveCoreTokenDamageQuery,
  MoveCoreTokenDynamicRecipientSets,
  MoveCoreTokenEffectOperationResult,
  MoveDamageResolutionQueryInput,
} from './reducers/coreTokenEffectTypes'
import { createStandardMoveCoreTokenEffectImmunityQueries } from './reducers/immunities'

export type ImmediateMoveSpecResolutionErrorCode =
  | 'execution-rejected'
  | 'execution-pending'
  | 'unsupported-operation'
  | 'damage-roll-missing'
  | 'damage-roll-invalid'
  | 'damage-type-resolution-missing'
  | 'damage-base-resolution-missing'
  | 'condition-roll-missing'
  | 'condition-roll-invalid'
  | 'multi-hit-operation-conflict'

export class ImmediateMoveSpecResolutionError extends Error {
  readonly code: ImmediateMoveSpecResolutionErrorCode

  constructor(code: ImmediateMoveSpecResolutionErrorCode, message: string) {
    super(message)
    this.name = 'ImmediateMoveSpecResolutionError'
    this.code = code
  }
}

export interface NativeMoveSpecResolutionProjection {
  readonly operations: readonly MoveSpecEmittedOperation[]
  readonly dynamicRecipients: MoveCoreTokenDynamicRecipientSets
  readonly coreStateChanges: MoveStateChangePlan
  readonly trace: MoveResolutionAuditTrace
}

export interface ImmediateMoveSpecResolution {
  readonly script: MoveAutomationScript
  readonly transaction: MoveAutomationTransaction
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  readonly rollLedger: ReturnType<typeof executeMoveSpec>['rollLedger']
  readonly trace: MoveResolutionAuditTrace
  readonly native: NativeMoveSpecResolutionProjection
}

const fail = (
  code: ImmediateMoveSpecResolutionErrorCode,
  message: string,
): never => {
  throw new ImmediateMoveSpecResolutionError(code, message)
}

const compatibilityScript = (
  entry: ResolvedCanonicalMoveEntry,
  runtime: MoveSpecV2Runtime,
): MoveAutomationScript => ({
  ...deepCloneJson(entry.script),
  kind: 'explicit',
  moveName: runtime.canonicalId,
  version: runtime.version,
  automationNotes: [],
})

const rollLedgerEntry = (
  ledger: ImmediateMoveSpecResolution['rollLedger'],
  rolls: readonly MoveSpecResolvedRoll[],
  purpose: MoveSpecResolvedRoll['purpose'],
  operationId: string,
  recipientId: string,
) => {
  const resolved = rolls.find(roll => (
    roll.purpose === purpose
    && roll.operationId === operationId
    && roll.recipientId === recipientId
  )) ?? fail(
    'damage-roll-missing',
    `${purpose} roll for operation ${operationId} and recipient ${recipientId} is missing.`,
  )
  return ledger.find(entry => entry.rollId === resolved.rollId)
    ?? fail('damage-roll-missing', `Roll ledger entry ${resolved.rollId} is missing.`)
}

const referencedRollLedgerEntry = (
  ledger: ImmediateMoveSpecResolution['rollLedger'],
  rolls: readonly MoveSpecResolvedRoll[],
  referenceId: string,
  recipientId: string,
) => {
  const resolved = rolls.find(roll => (
    roll.referenceId === referenceId && roll.recipientId === recipientId
  )) ?? rolls.find(roll => (
    roll.referenceId === referenceId && roll.recipientId === null
  )) ?? fail(
    'damage-roll-missing',
    `Referenced roll ${referenceId} for recipient ${recipientId} is missing.`,
  )
  return ledger.find(entry => entry.rollId === resolved.rollId)
    ?? fail('damage-roll-missing', `Roll ledger entry ${resolved.rollId} is missing.`)
}

const damageRollResult = (
  entry: ReturnType<typeof rollLedgerEntry>,
): MoveDamageRollResult => {
  if (entry.formula.kind !== 'dice') {
    return fail('damage-roll-invalid', `Damage roll ${entry.rollId} is not a dice formula.`)
  }
  return {
    formula: `${entry.formula.count}d${entry.formula.sides}${entry.formula.modifier >= 0 ? '+' : ''}${entry.formula.modifier}`,
    count: entry.formula.count,
    sides: entry.formula.sides,
    mod: entry.formula.modifier,
    rolls: [...entry.naturalResults],
    total: entry.finalValue,
  }
}

const createConditionAccuracyRollQueries = (options: {
  readonly resolvedRolls: readonly MoveSpecResolvedRoll[]
  readonly rollLedger: ImmediateMoveSpecResolution['rollLedger']
}): MoveConditionAccuracyRollQueries => ({
  resolve: ({ operation, recipient }) => {
    const trigger = operation.payload.accuracyRollTrigger
      ?? fail(
        'condition-roll-missing',
        `Condition operation ${operation.id} has no accuracy-roll trigger.`,
      )
    const resolved = options.resolvedRolls.find(roll => (
      roll.purpose === 'accuracy'
      && roll.referenceId === trigger.rollId
      && roll.recipientId === recipient.placement.id
    )) ?? fail(
      'condition-roll-missing',
      `Accuracy roll ${trigger.rollId} for condition operation ${operation.id} and recipient ${recipient.placement.id} is missing.`,
    )
    const ledger = options.rollLedger.find(entry => entry.rollId === resolved.rollId)
      ?? fail('condition-roll-missing', `Roll ledger entry ${resolved.rollId} is missing.`)
    if (
      ledger.formula.kind !== 'dice'
      || ledger.formula.count !== 1
      || ledger.formula.sides !== 20
      || ledger.formula.modifier !== 0
      || !Number.isSafeInteger(ledger.naturalResult)
      || ledger.naturalResult < 1
      || ledger.naturalResult > 20
    ) {
      return fail(
        'condition-roll-invalid',
        `Accuracy roll ${resolved.rollId} is not an unmodified natural d20.`,
      )
    }
    return {
      rollId: resolved.rollId,
      naturalResult: ledger.naturalResult,
    }
  },
})

const createDamageQuery = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly resolvedRolls: readonly MoveSpecResolvedRoll[]
  readonly rollLedger: ImmediateMoveSpecResolution['rollLedger']
  readonly resolvedDamageTypes: readonly MoveDamageTypeResolution[]
  readonly resolvedDamageBases: readonly MoveContextualDamageBaseResolution[]
  readonly selectedTargetIds: readonly string[]
}): MoveCoreTokenDamageQuery => {
  const selectedTargets = options.selectedTargetIds.flatMap((placementId) => {
    const token = options.context.queries.tokens.get(placementId)
    return token ? [token] : []
  })

  return {
    resolve: ({ operation, recipient }: MoveDamageResolutionQueryInput) => {
      const damageEntry = rollLedgerEntry(
        options.rollLedger,
        options.resolvedRolls,
        'damage',
        operation.id,
        recipient.placement.id,
      )
      const accuracyEntry = operation.payload.accuracyRollId
        ? referencedRollLedgerEntry(
            options.rollLedger,
            options.resolvedRolls,
            operation.payload.accuracyRollId,
            recipient.placement.id,
          )
        : null
      const criticalReferenceId = operation.payload.criticalRollId
        ?? operation.payload.accuracyRollId
      const criticalEntry = criticalReferenceId
        ? referencedRollLedgerEntry(
            options.rollLedger,
            options.resolvedRolls,
            criticalReferenceId,
            recipient.placement.id,
          )
        : null
      const state: MoveAutomationTargetResolutionState = {
        accuracyRoll: accuracyEntry ? String(accuracyEntry.naturalResult) : '',
        hit: true,
        crit: false,
        damageRoll: damageRollResult(damageEntry),
        manualHpLoss: '',
        applyDamage: true,
      }
      const resolvedMoveType = options.resolvedDamageTypes.find(resolution => (
        resolution.operationId === operation.id
        && resolution.recipientId === recipient.placement.id
      )) ?? fail(
        'damage-type-resolution-missing',
        `Damage type for operation ${operation.id} and recipient ${recipient.placement.id} is missing.`,
      )
      const contextualDamageBase = typeof operation.payload.damageBase === 'number'
        ? null
        : options.resolvedDamageBases.find(resolution => (
            resolution.operationId === operation.id
            && resolution.recipientId === recipient.placement.id
          )) ?? fail(
            'damage-base-resolution-missing',
            `Contextual Damage Base for operation ${operation.id} and recipient ${recipient.placement.id} is missing.`,
          )
      const calculation = resolveMoveSpecDamageCalculation({
        context: options.context,
        operation,
        script: options.script,
        recipient: recipient.token,
        resolution: state,
        fieldEffects: options.context.map.fieldEffects,
        selectedTargets,
        resolvedMoveType,
        naturalCriticalRoll: criticalEntry?.naturalResult ?? null,
        ...(contextualDamageBase ? { contextualDamageBase } : {}),
      })
      return {
        hpLoss: calculation.breakdown.hpLoss,
        preventedBy: calculation.moveType.immunitySource,
        moveType: calculation.moveType.moveType,
        consultedPlacementIds: [],
        details: {
          moveType: calculation.moveType,
          criticalHit: calculation.criticalHit,
          contextualDamageBase: calculation.contextualDamageBase
            ? {
                expressionValue: calculation.contextualDamageBase.expressionValue,
                rounding: calculation.contextualDamageBase.rounding,
                roundedExpressionValue: calculation.contextualDamageBase.roundedExpressionValue,
                stabTiming: calculation.contextualDamageBase.stabTiming,
                stabBonus: calculation.contextualDamageBase.stabBonus,
                valueBeforeBounds: calculation.contextualDamageBase.valueBeforeBounds,
                minimum: calculation.contextualDamageBase.minimum,
                maximum: calculation.contextualDamageBase.maximum,
                boundedValue: calculation.contextualDamageBase.boundedValue,
                finalDamageBase: calculation.contextualDamageBase.finalDamageBase,
              }
            : null,
          attackStat: calculation.stats.attackStat ?? null,
          defenseStat: calculation.stats.defenseStat ?? null,
          evaluationTrace: calculation.evaluationTrace,
          damagePipeline: calculation.damagePipeline,
        } as unknown as MoveResolutionTraceJsonValue,
      }
    },
  }
}

const damagedAndFaintedRecipients = (
  results: readonly MoveCoreTokenEffectOperationResult[],
): Pick<MoveCoreTokenDynamicRecipientSets, 'damagedTargetIds' | 'faintedTargetIds'> => {
  const damaged = new Set<string>()
  const fainted = new Set<string>()
  for (const operation of results) {
    for (const recipient of operation.recipients) {
      if (recipient.previous.kind !== 'hp' || recipient.current.kind !== 'hp') continue
      const previousTotal = recipient.previous.currentHp + recipient.previous.temporaryHp
      const currentTotal = recipient.current.currentHp + recipient.current.temporaryHp
      if (currentTotal < previousTotal) damaged.add(recipient.recipientId)
      if (recipient.previous.currentHp > 0 && recipient.current.currentHp <= 0) {
        fainted.add(recipient.recipientId)
      }
    }
  }
  return {
    damagedTargetIds: [...damaged],
    faintedTargetIds: [...fainted],
  }
}

const hpUpdatesFromResults = (
  results: readonly MoveCoreTokenEffectOperationResult[],
): MoveAutomationHpUpdate[] => {
  const updates = new Map<string, MoveAutomationHpUpdate>()
  for (const operation of results) {
    for (const recipient of operation.recipients) {
      if (recipient.current.kind !== 'hp' || recipient.changedFields.length === 0) continue
      updates.set(recipient.recipientId, {
        id: recipient.recipientId,
        currentHp: recipient.current.currentHp,
        injuries: recipient.current.injuries,
        ...(recipient.changedFields.includes('temporaryHitPoints')
          ? { temporaryHp: recipient.current.temporaryHp }
          : {}),
      })
    }
  }
  return [...updates.values()]
}

const conditionUpdatesFromResults = (
  results: readonly MoveCoreTokenEffectOperationResult[],
): MoveAutomationConditionUpdate[] => {
  const states = new Map<string, {
    readonly previous: readonly string[]
    current: readonly string[]
  }>()
  for (const operation of results) {
    for (const recipient of operation.recipients) {
      if (recipient.previous.kind !== 'conditions' || recipient.current.kind !== 'conditions') {
        continue
      }
      const state = states.get(recipient.recipientId)
      if (state) state.current = recipient.current.conditions
      else {
        states.set(recipient.recipientId, {
          previous: recipient.previous.conditions,
          current: recipient.current.conditions,
        })
      }
    }
  }
  return [...states].flatMap(([id, state]) => sameJsonValue(state.previous, state.current)
    ? []
    : [{ id, conditions: [...state.current] }])
}

const combatStageUpdatesFromResults = (
  results: readonly MoveCoreTokenEffectOperationResult[],
): MoveAutomationCombatStageUpdate[] => {
  const states = new Map<string, {
    readonly previous: MoveAutomationCombatStageUpdate['stages']
    current: MoveAutomationCombatStageUpdate['stages']
  }>()
  for (const operation of results) {
    for (const recipient of operation.recipients) {
      if (
        recipient.previous.kind !== 'combat-stages'
        || recipient.current.kind !== 'combat-stages'
      ) {
        continue
      }
      const state = states.get(recipient.recipientId)
      if (state) state.current = recipient.current.stages
      else {
        states.set(recipient.recipientId, {
          previous: recipient.previous.stages,
          current: recipient.current.stages,
        })
      }
    }
  }
  return [...states].flatMap(([id, state]) => sameJsonValue(state.previous, state.current)
    ? []
    : [{ id, stages: deepCloneJson(state.current) }])
}

const compatibilityLogLines = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly targetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly executionRolls: readonly MoveSpecResolvedRoll[]
  readonly rollLedger: ImmediateMoveSpecResolution['rollLedger']
  readonly coreResults: readonly MoveCoreTokenEffectOperationResult[]
  readonly multiHitExecutions: ReturnType<typeof executeMoveSpec>['multiHitExecutions']
}): string[] => {
  const lines = [
    `${options.context.actor.token.species} used ${options.script.moveName}.`,
    `MoveSpec v${options.script.version} used.`,
  ]
  const hits = new Set(options.hitTargetIds)
  const multiHitTargetIds = new Set(
    options.multiHitExecutions.flatMap(execution => execution.recipientIds),
  )
  for (const targetId of options.targetIds) {
    if (multiHitTargetIds.has(targetId)) continue
    const target = options.context.queries.tokens.get(targetId)
    const resolved = options.executionRolls.find(roll => (
      roll.purpose === 'accuracy' && roll.recipientId === targetId
    ))
    const roll = resolved
      ? options.rollLedger.find(entry => entry.rollId === resolved.rollId)
      : null
    lines.push(`${target?.species ?? targetId}: accuracy ${roll?.naturalResult ?? '?'} (${hits.has(targetId) ? 'hit' : 'miss'}).`)
  }
  for (const execution of options.multiHitExecutions) {
    for (const targetResult of execution.resolution.targets) {
      const target = options.context.queries.tokens.get(targetResult.targetId)
      const planned = targetResult.plannedHitCount === null
        ? 'no scheduled'
        : `${targetResult.plannedHitCount} scheduled`
      lines.push(
        `${target?.species ?? targetResult.targetId}: ${targetResult.successfulHitCount} hit, ${targetResult.missedHitCount} missed (${planned}); ${targetResult.totalEffectiveHpLost} total HP lost; ${targetResult.stopReason}.`,
      )
    }
  }
  for (const operation of options.coreResults) {
    for (const recipient of operation.recipients) {
      if (recipient.previous.kind !== 'hp' || recipient.current.kind !== 'hp') continue
      const details = recipient.details && typeof recipient.details === 'object' && !Array.isArray(recipient.details)
        ? recipient.details as Readonly<Record<string, unknown>>
        : null
      const requested = Number(details?.requestedHpLoss ?? 0)
      if (requested <= 0) continue
      const calculation = details?.calculation
        && typeof details.calculation === 'object'
        && !Array.isArray(details.calculation)
        ? details.calculation as Readonly<Record<string, unknown>>
        : null
      const criticalHit = calculation?.criticalHit
        && typeof calculation.criticalHit === 'object'
        && !Array.isArray(calculation.criticalHit)
        ? calculation.criticalHit as Readonly<Record<string, unknown>>
        : null
      const target = options.context.queries.tokens.get(recipient.recipientId)
      lines.push(formatMoveAutomationDamageLogLine(
        target?.species ?? recipient.recipientId,
        requested,
        criticalHit?.critical === true,
      ))
    }
  }
  return lines
}

const assertSupportedImmediateOperations = (
  operations: readonly MoveSpecEmittedOperation[],
): void => {
  const supported = new Set([
    'roll',
    'check',
    'branch',
    'damage',
    'multi-hit',
    'direct-hp',
    'heal',
    'condition',
    'combat-stage',
    'movement-request',
    'usage',
    'log',
    'choice-request',
    'reaction-request',
  ])
  const unsupported = operations.find(({ operation }) => !supported.has(operation.kind))
  if (unsupported) {
    fail(
      'unsupported-operation',
      `Immediate MoveSpec operation ${unsupported.operation.kind} is not reducible.`,
    )
  }
  const unvalidatedSpatialOperation = operations.find(({ operation }) => (
    operation.kind === 'movement-request'
    && (
      operation.payload.displacement !== undefined
      || operation.payload.mode === 'teleport'
      || operation.payload.mode === 'swap'
    )
  ))
  if (unvalidatedSpatialOperation) {
    fail(
      'unsupported-operation',
      `Spatial operation ${unvalidatedSpatialOperation.operation.id} has not passed authoritative collision planning.`,
    )
  }
}

export interface ResolveMoveSpecOptions {
  readonly context: AuthoritativeMoveRulesContext
  readonly runtime: MoveSpecV2Runtime
  readonly entry: ResolvedCanonicalMoveEntry
  readonly authoritativeTargetIds: readonly string[]
  readonly authoritativeTargetEvaluations?: readonly MoveSpecAuthoritativeTargetEvaluation[]
  readonly ancestry?: readonly MoveResolutionTraceAncestryEntry[]
}

export interface PendingMoveSpecResolution {
  readonly kind: 'pending'
  readonly execution: MoveSpecExecutionPendingResult
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
  /** Explicit typed plan containing only interpreter-approved pre-window operations. */
  readonly preWindowPlan: MoveStateChangePlan
}

export type MoveSpecResolutionOutcome =
  | { readonly kind: 'complete'; readonly resolution: ImmediateMoveSpecResolution }
  | PendingMoveSpecResolution

const executeReviewedMoveSpec = (
  options: ResolveMoveSpecOptions,
): MoveSpecExecutionCompleteResult | MoveSpecExecutionPendingResult => {
  const execution = executeMoveSpec({
    definition: options.runtime.definition,
    context: options.context,
    authoritativeTargetIds: options.authoritativeTargetIds,
    authoritativeTargetEvaluations: options.authoritativeTargetEvaluations,
    ancestry: options.ancestry,
    handlerRegistry: options.context.handlerRegistry,
  })
  if (execution.kind === 'rejected') {
    return fail(
      'execution-rejected',
      `MoveSpec ${options.runtime.canonicalId} rejected: ${execution.rejection.reasonCode}.`,
    )
  }
  return execution
}

/** Reduce one already completed interpreter result into the immediate planner projection. */
export const reduceCompletedMoveSpec = (
  options: ResolveMoveSpecOptions,
  execution: MoveSpecExecutionCompleteResult,
  alreadyCommittedOperationIds: ReadonlySet<string> = new Set(),
): ImmediateMoveSpecResolution => {
  const uncommittedOperations = execution.operations.filter(({ operation }) => (
    !alreadyCommittedOperationIds.has(operation.id)
  ))
  assertSupportedImmediateOperations(uncommittedOperations)

  const script = compatibilityScript(options.entry, options.runtime)
  // A self target is explicit interpreter evidence, not an attacked-target wire
  // identity. Self-only operations must address the actor selector directly.
  const exposesAttackedTargets = options.runtime.definition.spec.targeting.kind !== 'self'
  const attackedTargetIds = exposesAttackedTargets ? [...execution.targetIds] : []
  const initialDynamic: MoveCoreTokenDynamicRecipientSets = {
    attackedTargetIds,
    hitTargetIds: exposesAttackedTargets ? [...execution.hitTargetIds] : [],
    missedTargetIds: exposesAttackedTargets ? [...execution.missedTargetIds] : [],
    damagedTargetIds: exposesAttackedTargets ? [...execution.damagedTargetIds] : [],
    faintedTargetIds: exposesAttackedTargets ? [...execution.faintedTargetIds] : [],
  }

  const coreOperations = uncommittedOperations.filter(isMoveCoreTokenEffectEmission)
  const multiHit = execution.multiHitExecutions[0] ?? null
  if (execution.multiHitExecutions.length > 1 || (multiHit && coreOperations.length > 0)) {
    return fail(
      'multi-hit-operation-conflict',
      'An immediate MoveSpec may contain one pre-reduced multi-hit operation or ordinary core effects, not overlapping state reducers.',
    )
  }
  const core: MoveCoreTokenEffectReduction = reduceMoveCoreTokenEffects({
    context: options.context,
    operations: coreOperations,
    dynamicRecipients: initialDynamic,
    damage: coreOperations.some(({ operation }) => operation.kind === 'damage')
      ? createDamageQuery({
          context: options.context,
          script,
          resolvedRolls: execution.resolvedRolls,
          rollLedger: execution.rollLedger,
          resolvedDamageTypes: execution.resolvedDamageTypes,
          resolvedDamageBases: execution.resolvedDamageBases,
          selectedTargetIds: execution.targetIds,
        })
      : undefined,
    conditionAccuracyRolls: createConditionAccuracyRollQueries({
      resolvedRolls: execution.resolvedRolls,
      rollLedger: execution.rollLedger,
    }),
    immunities: createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: script.type,
      context: options.context,
    }),
    trace: execution.trace,
  })
  const terminalRecipients = damagedAndFaintedRecipients(core.operationResults)
  const damagedSet = new Set([
    ...initialDynamic.damagedTargetIds,
    ...terminalRecipients.damagedTargetIds,
  ])
  const faintedSet = new Set([
    ...initialDynamic.faintedTargetIds,
    ...terminalRecipients.faintedTargetIds,
  ])
  const dynamicRecipients: MoveCoreTokenDynamicRecipientSets = {
    ...initialDynamic,
    damagedTargetIds: attackedTargetIds.filter(id => damagedSet.has(id)),
    faintedTargetIds: attackedTargetIds.filter(id => faintedSet.has(id)),
  }
  const transactionTargetIds = dynamicRecipients.attackedTargetIds
  const transactionHitTargetIds = dynamicRecipients.hitTargetIds
  const transaction: MoveAutomationTransaction = {
    userId: options.context.actor.placement.id,
    userName: options.context.actor.token.species,
    moveName: options.runtime.canonicalId,
    scriptKind: 'explicit',
    scriptVersion: options.runtime.version,
    attackedTargetIds: [...transactionTargetIds],
    hitTargetIds: [...transactionHitTargetIds],
    hpUpdates: multiHit
      ? [...multiHit.hpUpdates]
      : hpUpdatesFromResults(core.operationResults),
    conditionUpdates: multiHit
      ? [...multiHit.conditionUpdates]
      : conditionUpdatesFromResults(core.operationResults),
    combatStageUpdates: multiHit
      ? [...multiHit.combatStageUpdates]
      : combatStageUpdatesFromResults(core.operationResults),
    hazardsToAdd: [],
    fieldEffectsToApply: [],
    logLines: compatibilityLogLines({
      context: options.context,
      script,
      targetIds: transactionTargetIds,
      hitTargetIds: transactionHitTargetIds,
      executionRolls: execution.resolvedRolls,
      rollLedger: execution.rollLedger,
      coreResults: core.operationResults,
      multiHitExecutions: execution.multiHitExecutions,
    }),
  }
  const sheetReads = deduplicateAuthoritativeMoveSheetReads([
    ...options.context.reads.snapshot(),
    ...core.sheetReads,
  ])

  return Object.freeze({
    script: Object.freeze(script),
    transaction: Object.freeze(transaction),
    sheetReads: Object.freeze(sheetReads),
    rollLedger: execution.rollLedger,
    trace: core.trace,
    native: Object.freeze({
      operations: uncommittedOperations,
      dynamicRecipients: Object.freeze(dynamicRecipients),
      coreStateChanges: multiHit?.stateChanges ?? core.stateChanges,
      trace: core.trace,
    }),
  })
}

const reducePreWindowPlan = (options: {
  readonly resolve: ResolveMoveSpecOptions
  readonly execution: MoveSpecExecutionPendingResult
}): {
  readonly execution: MoveSpecExecutionPendingResult
  readonly stateChanges: MoveStateChangePlan
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
} => {
  const preWindowOperations = options.execution.preWindowOperations
  if (preWindowOperations.length === 0) {
    return {
      execution: options.execution,
      stateChanges: createMoveStateChangePlan([]),
      sheetReads: options.execution.sheetReads,
    }
  }
  if (preWindowOperations.some(emission => !isMoveCoreTokenEffectEmission(emission))) {
    return fail(
      'unsupported-operation',
      'The interpreter approved a pre-window operation without a typed core-state reducer.',
    )
  }

  const exposesAttackedTargets = options.resolve.runtime.definition.spec.targeting.kind !== 'self'
  const dynamicRecipients: MoveCoreTokenDynamicRecipientSets = {
    attackedTargetIds: exposesAttackedTargets ? [...options.execution.targetIds] : [],
    hitTargetIds: exposesAttackedTargets ? [...options.execution.hitTargetIds] : [],
    missedTargetIds: exposesAttackedTargets ? [...options.execution.missedTargetIds] : [],
    damagedTargetIds: exposesAttackedTargets ? [...options.execution.damagedTargetIds] : [],
    faintedTargetIds: exposesAttackedTargets ? [...options.execution.faintedTargetIds] : [],
  }
  const reduction = reduceMoveCoreTokenEffects({
    context: options.resolve.context,
    operations: preWindowOperations.filter(isMoveCoreTokenEffectEmission),
    dynamicRecipients,
    immunities: createStandardMoveCoreTokenEffectImmunityQueries({
      moveType: options.resolve.entry.script.type,
      context: options.resolve.context,
    }),
    trace: options.execution.trace,
  })
  const execution = Object.freeze({
    ...options.execution,
    trace: reduction.trace,
    sheetReads: deduplicateAuthoritativeMoveSheetReads([
      ...options.execution.sheetReads,
      ...reduction.sheetReads,
    ]),
  })
  return {
    execution,
    stateChanges: reduction.stateChanges,
    sheetReads: execution.sheetReads,
  }
}

/** Execute a native MoveSpec and retain an unresolved request for saga orchestration. */
export const resolveMoveSpecOutcome = (
  options: ResolveMoveSpecOptions,
): MoveSpecResolutionOutcome => {
  const execution = executeReviewedMoveSpec(options)
  if (execution.kind === 'pending-request') {
    const preWindow = reducePreWindowPlan({ resolve: options, execution })
    return Object.freeze({
      kind: 'pending',
      execution: preWindow.execution,
      sheetReads: Object.freeze(deduplicateAuthoritativeMoveSheetReads([
        ...options.context.reads.snapshot(),
        ...preWindow.sheetReads,
      ])),
      preWindowPlan: preWindow.stateChanges,
    })
  }
  return Object.freeze({
    kind: 'complete',
    resolution: reduceCompletedMoveSpec(options, execution),
  })
}

/** Execute and reduce a MoveSpec that is required to finish without a response window. */
export const resolveImmediateMoveSpec = (
  options: ResolveMoveSpecOptions,
): ImmediateMoveSpecResolution => {
  const outcome = resolveMoveSpecOutcome(options)
  if (outcome.kind === 'pending') {
    return fail(
      'execution-pending',
      `MoveSpec ${options.runtime.canonicalId} unexpectedly requires ${outcome.execution.request.requestId}.`,
    )
  }
  return outcome.resolution
}
