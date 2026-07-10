import type {
  MoveResolutionAuditTrace,
  MoveResolutionTraceJsonValue,
} from '#shared/moveAutomation/trace'
import type {
  MoveAutomationHpUpdate,
  MoveAutomationScript,
  MoveAutomationTransaction,
} from '~/types/moveAutomation'
import type { MoveDamageRollResult } from '~/utils/moveDamageBase'
import { formatMoveAutomationDamageLogLine } from '~/utils/moveAutomationLogLines'
import { moveAutomationMoveImmunitySource } from '~/utils/moveAutomationMoveImmunity'
import { resolveMoveAutomationTargetEvasion } from '~/utils/moveAutomationAccuracy'
import {
  resolveMoveAutomationAccuracyRoll,
} from '~/utils/moveAutomationResolution'
import type {
  MoveAutomationTargetResolutionState,
} from '~/utils/moveAutomationTargetResolution'
import type { ResolvedCanonicalMoveEntry } from '~/utils/authoritativeMoveEntries'
import { deepCloneJson } from '~/utils/serialization'
import type { MoveStateChangePlan } from './plan'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from './context'
import { deduplicateAuthoritativeMoveSheetReads } from './context'
import type { MoveContextualDamageBaseResolution } from './damageBase'
import { resolveMoveSpecDamageCalculation } from './damageStats'
import {
  executeMoveSpec,
  type MoveSpecAuthoritativeTargetEvaluation,
  type MoveSpecEmittedOperation,
  type MoveSpecResolvedRoll,
} from './executeSpec'
import type { MoveSpecV2Runtime } from './registry'
import {
  isMoveCoreTokenEffectEmission,
  reduceMoveCoreTokenEffects,
  type MoveCoreTokenEffectReduction,
} from './reducers/coreTokenEffects'
import type {
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
  | 'damage-base-resolution-missing'

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

const accuracyOperationId = (
  operations: readonly MoveSpecEmittedOperation[],
  accuracyRollId: string | null,
): string | null => {
  if (accuracyRollId === null) return null
  return operations.find(({ operation }) => (
    operation.kind === 'roll' && operation.payload.rollId === accuracyRollId
  ))?.operation.id ?? null
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

const createDamageQuery = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly operations: readonly MoveSpecEmittedOperation[]
  readonly resolvedRolls: readonly MoveSpecResolvedRoll[]
  readonly rollLedger: ImmediateMoveSpecResolution['rollLedger']
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
      const accuracyId = accuracyOperationId(options.operations, operation.payload.accuracyRollId)
      const accuracyEntry = accuracyId
        ? rollLedgerEntry(
            options.rollLedger,
            options.resolvedRolls,
            'accuracy',
            accuracyId,
            recipient.placement.id,
          )
        : null
      const accuracy = accuracyEntry
        ? resolveMoveAutomationAccuracyRoll(options.script, accuracyEntry.naturalResult)
        : null
      const state: MoveAutomationTargetResolutionState = {
        accuracyRoll: accuracyEntry ? String(accuracyEntry.naturalResult) : '',
        hit: true,
        crit: accuracy?.crit ?? false,
        damageRoll: damageRollResult(damageEntry),
        manualHpLoss: '',
        applyDamage: true,
      }
      const preventedBy = moveAutomationMoveImmunitySource(options.script, recipient.token)
      if (preventedBy) {
        return { hpLoss: 0, preventedBy, consultedPlacementIds: [] }
      }
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
        ...(contextualDamageBase ? { contextualDamageBase } : {}),
      })
      return {
        hpLoss: calculation.breakdown.hpLoss,
        preventedBy: null,
        consultedPlacementIds: [],
        ...(calculation.evaluationTrace.length > 0 ? {
          details: {
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
          } as unknown as MoveResolutionTraceJsonValue,
        } : {}),
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

const compatibilityLogLines = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly targetIds: readonly string[]
  readonly hitTargetIds: readonly string[]
  readonly executionRolls: readonly MoveSpecResolvedRoll[]
  readonly rollLedger: ImmediateMoveSpecResolution['rollLedger']
  readonly coreResults: readonly MoveCoreTokenEffectOperationResult[]
}): string[] => {
  const lines = [
    `${options.context.actor.token.species} used ${options.script.moveName}.`,
    `MoveSpec v${options.script.version} used.`,
  ]
  const hits = new Set(options.hitTargetIds)
  for (const targetId of options.targetIds) {
    const target = options.context.queries.tokens.get(targetId)
    const resolved = options.executionRolls.find(roll => (
      roll.purpose === 'accuracy' && roll.recipientId === targetId
    ))
    const roll = resolved
      ? options.rollLedger.find(entry => entry.rollId === resolved.rollId)
      : null
    lines.push(`${target?.species ?? targetId}: accuracy ${roll?.naturalResult ?? '?'} (${hits.has(targetId) ? 'hit' : 'miss'}).`)
  }
  for (const operation of options.coreResults) {
    for (const recipient of operation.recipients) {
      if (recipient.previous.kind !== 'hp' || recipient.current.kind !== 'hp') continue
      const details = recipient.details && typeof recipient.details === 'object' && !Array.isArray(recipient.details)
        ? recipient.details as Readonly<Record<string, unknown>>
        : null
      const requested = Number(details?.requestedHpLoss ?? 0)
      if (requested <= 0) continue
      const target = options.context.queries.tokens.get(recipient.recipientId)
      lines.push(formatMoveAutomationDamageLogLine(
        target?.species ?? recipient.recipientId,
        requested,
        false,
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
    'damage',
    'movement-request',
    'usage',
    'log',
  ])
  const unsupported = operations.find(({ operation }) => !supported.has(operation.kind))
  if (unsupported) {
    fail(
      'unsupported-operation',
      `Immediate MoveSpec operation ${unsupported.operation.kind} is not reducible.`,
    )
  }
}

/** Execute and reduce the immediate core-token portion of one native MoveSpec. */
export const resolveImmediateMoveSpec = (options: {
  readonly context: AuthoritativeMoveRulesContext
  readonly runtime: MoveSpecV2Runtime
  readonly entry: ResolvedCanonicalMoveEntry
  readonly authoritativeTargetIds: readonly string[]
  readonly authoritativeTargetEvaluations?: readonly MoveSpecAuthoritativeTargetEvaluation[]
}): ImmediateMoveSpecResolution => {
  const execution = executeMoveSpec({
    definition: options.runtime.definition,
    context: options.context,
    authoritativeTargetIds: options.authoritativeTargetIds,
    authoritativeTargetEvaluations: options.authoritativeTargetEvaluations,
    handlerRegistry: options.context.handlerRegistry,
  })
  if (execution.kind === 'rejected') {
    return fail(
      'execution-rejected',
      `MoveSpec ${options.runtime.canonicalId} rejected: ${execution.rejection.reasonCode}.`,
    )
  }
  if (execution.kind === 'pending-request') {
    return fail(
      'execution-pending',
      `MoveSpec ${options.runtime.canonicalId} unexpectedly requires ${execution.request.requestId}.`,
    )
  }
  assertSupportedImmediateOperations(execution.operations)

  const script = compatibilityScript(options.entry, options.runtime)
  const attackedTargetIds = [...execution.targetIds]
  const hitTargetIds = execution.resolvedRolls
    .filter(roll => roll.purpose === 'accuracy' && roll.recipientId !== null)
    .filter((roll) => {
      const entry = execution.rollLedger.find(item => item.rollId === roll.rollId)
      const target = roll.recipientId
        ? options.context.queries.tokens.get(roll.recipientId)
        : null
      if (!entry || !target) return false
      const evasion = resolveMoveAutomationTargetEvasion(
        script,
        target,
        { attacker: options.context.actor.token },
      )
      return resolveMoveAutomationAccuracyRoll(script, entry.naturalResult, {
        userAccuracy: entry.modifiers.reduce((total, modifier) => total + modifier.value, 0),
        targetEvasion: evasion.value,
      }).hit
    })
    .map(roll => roll.recipientId!)
  const hitSet = new Set(hitTargetIds)
  const initialDynamic: MoveCoreTokenDynamicRecipientSets = {
    attackedTargetIds,
    hitTargetIds,
    missedTargetIds: attackedTargetIds.filter(id => !hitSet.has(id)),
    damagedTargetIds: [],
    faintedTargetIds: [],
  }

  const coreOperations = execution.operations.filter(isMoveCoreTokenEffectEmission)
  const core: MoveCoreTokenEffectReduction = reduceMoveCoreTokenEffects({
    context: options.context,
    operations: coreOperations,
    dynamicRecipients: initialDynamic,
    damage: coreOperations.some(({ operation }) => operation.kind === 'damage')
      ? createDamageQuery({
          context: options.context,
          script,
          operations: execution.operations,
          resolvedRolls: execution.resolvedRolls,
          rollLedger: execution.rollLedger,
          resolvedDamageBases: execution.resolvedDamageBases,
          selectedTargetIds: execution.targetIds,
        })
      : undefined,
    immunities: createStandardMoveCoreTokenEffectImmunityQueries({ moveType: script.type }),
    trace: execution.trace,
  })
  const terminalRecipients = damagedAndFaintedRecipients(core.operationResults)
  const dynamicRecipients: MoveCoreTokenDynamicRecipientSets = {
    ...initialDynamic,
    ...terminalRecipients,
  }
  const transaction: MoveAutomationTransaction = {
    userId: options.context.actor.placement.id,
    userName: options.context.actor.token.species,
    moveName: options.runtime.canonicalId,
    scriptKind: 'explicit',
    scriptVersion: options.runtime.version,
    attackedTargetIds: [...dynamicRecipients.attackedTargetIds],
    hitTargetIds: [...dynamicRecipients.hitTargetIds],
    hpUpdates: hpUpdatesFromResults(core.operationResults),
    conditionUpdates: [],
    combatStageUpdates: [],
    hazardsToAdd: [],
    fieldEffectsToApply: [],
    logLines: compatibilityLogLines({
      context: options.context,
      script,
      targetIds: dynamicRecipients.attackedTargetIds,
      hitTargetIds: dynamicRecipients.hitTargetIds,
      executionRolls: execution.resolvedRolls,
      rollLedger: execution.rollLedger,
      coreResults: core.operationResults,
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
      operations: execution.operations,
      dynamicRecipients: Object.freeze(dynamicRecipients),
      coreStateChanges: core.stateChanges,
      trace: core.trace,
    }),
  })
}
