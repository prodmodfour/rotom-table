import { createHash } from 'node:crypto'
import { AA078_LUNCHBOX_TEMP_HP_REASON } from '#shared/abilityAutomation/aa078'
import { moveEffectBranchPaths, type MoveConditionEffectOperation, type MoveTemporaryEffectOperation } from '#shared/moveAutomation/effects'
import {
  parseMoveResolutionAuditTrace,
  type MoveResolutionAuditTrace,
  type MoveResolutionTraceAncestryEntry,
  type MoveResolutionTraceJsonValue,
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
import {
  createMoveStateChangePlan,
  type MoveStateChangeInput,
  type MoveStateChangePlan,
} from './plan'
import { mergeDisjointMoveSheetStateChanges } from './mergeSheetStateChanges'
import type {
  AuthoritativeMoveRulesContext,
  AuthoritativeMoveSheetRead,
} from './context'
import { deduplicateAuthoritativeMoveSheetReads } from './context'
import {
  interpretMoveItemEffects,
  isMoveItemEffectEmission,
  type InterpretedMoveItemEffects,
} from './itemEffectInterpreter'
import {
  KNOCK_OFF_ITEM_CHOICE_OPERATION,
  KNOCK_OFF_ITEM_EFFECT_OPERATION,
  KNOCK_OFF_ITEM_REQUEST_ID,
  planKnockOffItemOutcome,
  type KnockOffResolvedCombatOutcome,
} from './knockOff'
import type { MoveContextualDamageBaseResolution } from './damageBase'
import type { MoveDamageTypeResolution } from './damageTypes'
import { resolveMoveSpecDamageCalculation } from './damageStats'
import {
  deriveNestedMoveRulesContext,
  executeMoveSpec,
  type MoveSpecAuthoritativeTargetEvaluation,
  type MoveSpecChildExecution,
  type MoveSpecEmittedOperation,
  type MoveSpecExecutionCompleteResult,
  type MoveSpecExecutionPendingResult,
  type MoveSpecResolvedRoll,
} from './executeSpec'
import type { MoveSpecV2Runtime } from './registry'
import { resolveMoveSpecTargetingRule } from './targetingBranches'
import {
  isMoveCoreTokenEffectEmission,
  reduceMoveCoreTokenEffects,
  type MoveCoreTokenEffectReduction,
} from './reducers/coreTokenEffects'
import {
  isMovePermanentMoveListEmission,
  reducePermanentMoveListOperations,
} from './reducers/permanentMoveLists'
import {
  applyMoveSpatialEffectResultsToTrace,
  isMoveSpatialEffectEmission,
  reduceMoveSpatialEffects,
  type MoveReducedSpatialMovement,
  type MoveSpatialEffectOperationResult,
} from './reducers/spatial'
import type {
  MoveCombatStageAccuracyRollQueries,
  MoveConditionAccuracyRollQueries,
  MoveCoreTokenDamageQuery,
  MoveCoreTokenDynamicRecipientSets,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectOperationResult,
  MoveDamageResolutionQueryInput,
  MoveResolvedCoreTokenEffectOperation,
} from './reducers/coreTokenEffectTypes'
import { createStandardMoveCoreTokenEffectImmunityQueries } from './reducers/immunities'
import {
  expectedMoveCoreTokenRecipientIds,
  resolveMoveCoreTokenDynamicRecipients,
} from './reducers/coreTokenRecipients'
import { reduceMoveResolutionTrace } from './trace'
import { aa060MoveMarkId, hasAa060MoveMark } from '../abilityAutomation/mechanics/aa060MoveIntegration'
import { aa060TriggeredMoveOverlayOperations } from '../abilityAutomation/mechanics/aa060TriggeredMoveIntegration'
import { aa061TriggeredMoveOverlayOperations } from '../abilityAutomation/mechanics/aa061TriggeredMoveIntegration'
import { aa062BoneLordEmpowersMove, aa062MoveOverlayOperations } from '../abilityAutomation/mechanics/aa062MoveIntegration'
import { aa063MoveOverlayOperations } from '../abilityAutomation/mechanics/aa063MoveIntegration'
import { aa064MoveOverlayOperations } from '../abilityAutomation/mechanics/aa064MoveIntegration'
import { aa065MoveOverlayOperations } from '../abilityAutomation/mechanics/aa065MoveIntegration'
import { aa066MoveOverlayOperations } from '../abilityAutomation/mechanics/aa066MoveIntegration'
import { aa067MoveOverlayOperations } from '../abilityAutomation/mechanics/aa067MoveIntegration'
import { aa068MoveOverlayOperations } from '../abilityAutomation/mechanics/aa068MoveIntegration'
import { aa069MoveOverlayOperations } from '../abilityAutomation/mechanics/aa069MoveIntegration'
import { aa070MoveOverlayOperations } from '../abilityAutomation/mechanics/aa070MoveIntegration'
import { aa071MoveOverlayOperations } from '../abilityAutomation/mechanics/aa071MoveIntegration'
import { aa072MoveOverlayOperations } from '../abilityAutomation/mechanics/aa072MoveIntegration'
import { aa073MoveOverlayOperations } from '../abilityAutomation/mechanics/aa073MoveIntegration'
import {
  AA074_HONEY_THIEF_TEMP_HP_REASON,
  aa074MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa074MoveIntegration'
import {
  AA075_ILLUSION_BREAK_REASON,
  AA075_INNARDS_OUT_HP_REASON,
  aa075MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa075MoveIntegration'
import {
  AA076_IRON_BARBS_HP_REASON,
  aa076MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa076MoveIntegration'
import { aa077MoveOverlayOperations } from '../abilityAutomation/mechanics/aa077MoveIntegration'
import {
  AA078_LIQUID_OOZE_RECOIL_REASON,
  aa078IsDrainMove,
  aa078MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa078MoveIntegration'
import {
  AA079_MAGICIAN_ITEM_REASON,
  aa079MoveOverlayOperations,
} from '../abilityAutomation/mechanics/aa079MoveIntegration'
import {
  AA068_DUST_CLOUD_TARGETING_OVERRIDE,
  aa068DrySkinCancelsRecipientEffect,
  aa068DustCloudBurstEnabled,
} from '../abilityAutomation/mechanics/aa068StaticIntegration'
import { aa075InfiltratorBypassesTemporaryHp } from '../abilityAutomation/mechanics/aa075StaticIntegration'
import {
  AA078_LONG_REACH_TARGETING_OVERRIDE,
  aa078LongReachSelected,
} from '../abilityAutomation/mechanics/aa078StaticIntegration'

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
  readonly childExecutions: readonly MoveSpecChildExecution[]
  readonly dynamicRecipients: MoveCoreTokenDynamicRecipientSets
  /** Every server-resolved KO recipient, including a self-KO actor. */
  readonly faintedPlacementIds: readonly string[]
  readonly coreStateChanges: MoveStateChangePlan
  readonly permanentMoveListStateChanges: MoveStateChangePlan
  readonly itemEffects: InterpretedMoveItemEffects
  /** Collision-checked forced/voluntary displacements in reviewed operation order. */
  readonly spatialMovements: readonly MoveReducedSpatialMovement[]
  readonly spatialOperationResults: readonly MoveSpatialEffectOperationResult[]
  readonly resolvedHazardCells: MoveSpecExecutionCompleteResult['resolvedHazardCells']
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

const createCombatStageAccuracyRollQueries = (options: {
  readonly resolvedRolls: readonly MoveSpecResolvedRoll[]
  readonly rollLedger: ImmediateMoveSpecResolution['rollLedger']
}): MoveCombatStageAccuracyRollQueries => ({
  resolve: ({ operation, recipient }) => {
    const trigger = operation.payload.trigger
    if (!trigger || trigger.kind !== 'accuracy-roll') {
      return fail(
        'condition-roll-missing',
        `Combat-stage operation ${operation.id} has no accuracy-roll trigger.`,
      )
    }
    const resolved = options.resolvedRolls.filter(roll => (
      roll.purpose === 'accuracy'
      && roll.referenceId === trigger.rollId
      && (
        trigger.scope === 'resolution'
        || roll.recipientId === recipient.placement.id
      )
      && roll.recipientId !== null
    ))
    return resolved.map((roll) => {
      const ledger = options.rollLedger.find(entry => entry.rollId === roll.rollId)
        ?? fail('condition-roll-missing', `Roll ledger entry ${roll.rollId} is missing.`)
      if (
        ledger.formula.kind !== 'dice'
        || ledger.formula.count !== 1
        || ledger.formula.sides !== 20
        || ledger.formula.modifier !== 0
        || !Number.isSafeInteger(ledger.naturalResult)
        || ledger.naturalResult < 1
        || ledger.naturalResult > 20
        || roll.recipientId === null
      ) {
        return fail(
          'condition-roll-invalid',
          `Accuracy roll ${roll.rollId} is not a recipient-owned unmodified natural d20.`,
        )
      }
      return {
        rollId: roll.rollId,
        recipientId: roll.recipientId,
        naturalResult: ledger.naturalResult,
      }
    })
  },
})

const createDamageQuery = (options: {
  readonly contextForOperation: (
    operation: string | { readonly id: string },
  ) => AuthoritativeMoveRulesContext
  readonly scriptForOperation: (operationId: string) => MoveAutomationScript
  readonly resolvedRolls: readonly MoveSpecResolvedRoll[]
  readonly rollLedger: ImmediateMoveSpecResolution['rollLedger']
  readonly resolvedDamageTypes: readonly MoveDamageTypeResolution[]
  readonly resolvedDamageBases: readonly MoveContextualDamageBaseResolution[]
  readonly dynamicRecipientsForOperation: (
    operation: string | { readonly id: string },
  ) => MoveCoreTokenDynamicRecipientSets
  readonly gorillaTacticsTriggeringDamage: boolean
  readonly ignitionBoostTriggeringDamage: boolean
}): MoveCoreTokenDamageQuery => {
  return {
    resolve: ({ operation, recipient }: MoveDamageResolutionQueryInput) => {
      const context = options.contextForOperation(operation.id)
      const selectedTargets = context.selectedPlacements.flatMap((placement) => {
        const token = context.queries.tokens.get(placement.id)
        return token ? [token] : []
      })
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
      const script = options.scriptForOperation(operation.id)
      const dynamicRecipients = options.dynamicRecipientsForOperation(operation)
      const accuracyWasResolved = dynamicRecipients.hitTargetIds.includes(recipient.placement.id)
        || dynamicRecipients.missedTargetIds.includes(recipient.placement.id)
      const state: MoveAutomationTargetResolutionState = {
        accuracyRoll: accuracyEntry ? String(accuracyEntry.naturalResult) : '',
        // A reviewed Smite damage operation addresses attacked targets so a
        // known miss can retain damage while remaining absent from hit identity.
        // Compatibility reductions without an accuracy projection keep their
        // prior hit assumption rather than becoming an implicit miss.
        hit: !script.requiresAccuracy
          || !accuracyWasResolved
          || dynamicRecipients.hitTargetIds.includes(recipient.placement.id),
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
        context,
        operation,
        script,
        recipient: recipient.token,
        resolution: state,
        fieldEffects: context.queries.weather.projectFieldEffects(),
        selectedTargets,
        resolvedMoveType,
        naturalCriticalRoll: criticalEntry?.naturalResult ?? null,
        ...(options.gorillaTacticsTriggeringDamage || options.ignitionBoostTriggeringDamage
          ? { responseDamageModifiers: [
              ...(options.gorillaTacticsTriggeringDamage ? [{
                id: 'ability.gorilla-tactics.triggering-damage',
                stage: 'pre-type-modifiers' as const, priority: 40,
                source: { kind: 'ability' as const, id: 'Gorilla Tactics' },
                stackingGroup: 'aa072-gorilla-tactics-triggering',
                reasonCode: 'ability.gorilla-tactics.triggering-damage',
                operation: 'add' as const, value: 10,
              }] : []),
              ...(options.ignitionBoostTriggeringDamage ? [{
                id: 'ability.ignition-boost.triggering-damage',
                stage: 'pre-type-modifiers' as const, priority: 41,
                source: { kind: 'ability' as const, id: 'Ignition Boost' },
                stackingGroup: 'aa075-ignition-boost-triggering',
                reasonCode: 'ability.ignition-boost.triggering-damage',
                operation: 'add' as const, value: 5,
              }] : []),
            ] } : {}),
        ...(contextualDamageBase ? { contextualDamageBase } : {}),
      })
      return {
        hpLoss: calculation.breakdown.hpLoss,
        preventedBy: calculation.moveType.immunitySource,
        moveType: calculation.moveType.moveType,
        ...(aa075InfiltratorBypassesTemporaryHp({
          context,
          recipientId: recipient.placement.id,
        }) ? { bypassTemporaryHp: true } : {}),
        consultedPlacementIds: [],
        details: {
          moveType: calculation.moveType,
          damageClass: calculation.damageClass,
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
          terrain: calculation.terrain.trace,
          weather: calculation.weather.trace,
          sideDamageResistance: calculation.sideDamageResistance,
        } as unknown as MoveResolutionTraceJsonValue,
      }
    },
  }
}

const childContextByOperationId = (input: {
  readonly root: AuthoritativeMoveRulesContext
  readonly children: readonly MoveSpecChildExecution[]
}): ReadonlyMap<string, AuthoritativeMoveRulesContext> => {
  const contexts = new Map<string, AuthoritativeMoveRulesContext>()
  for (const child of input.children) {
    const context = deriveNestedMoveRulesContext({
      parent: input.root,
      actorPlacementId: child.actorPlacementId,
      canonicalId: child.canonicalId,
      targetIds: child.targetIds,
      resolutionId: child.resolutionId,
      ancestry: child.trace.ancestry,
    })
    for (const operationId of child.operationIds) contexts.set(operationId, context)
  }
  return contexts
}

export const createMoveSpecOperationContextResolver = (input: {
  readonly root: AuthoritativeMoveRulesContext
  readonly children: readonly MoveSpecChildExecution[]
}): ((operation: string | { readonly id: string }) => AuthoritativeMoveRulesContext) => {
  const childContexts = childContextByOperationId(input)
  return operation => childContexts.get(
    typeof operation === 'string' ? operation : operation.id,
  ) ?? input.root
}

const childMechanicsByOperationId = (
  children: readonly MoveSpecChildExecution[],
): ReadonlyMap<string, MoveAutomationScript> => {
  const mechanics = new Map<string, MoveAutomationScript>()
  for (const child of children) {
    for (const operationId of child.operationIds) mechanics.set(operationId, child.mechanics)
  }
  return mechanics
}

const operationMechanicsResolver = (input: {
  readonly root: MoveAutomationScript
  readonly children: readonly MoveSpecChildExecution[]
}): ((operationId: string) => MoveAutomationScript) => {
  const childMechanics = childMechanicsByOperationId(input.children)
  return operationId => childMechanics.get(operationId) ?? input.root
}

const createOperationAwareImmunityQueries = (input: {
  readonly contextForOperation: (
    operation: string | { readonly id: string },
  ) => AuthoritativeMoveRulesContext
  readonly root: MoveAutomationScript
  readonly children: readonly MoveSpecChildExecution[]
}): MoveCoreTokenEffectImmunityQueries => {
  const scriptFor = operationMechanicsResolver(input)
  const queries = new Map<string, MoveCoreTokenEffectImmunityQueries>()
  const forOperation = (operationId: string): MoveCoreTokenEffectImmunityQueries => {
    const moveScript = scriptFor(operationId)
    const moveType = moveScript.type ?? null
    let query = queries.get(operationId)
    if (!query) {
      query = createStandardMoveCoreTokenEffectImmunityQueries({
        moveType,
        moveScript,
        context: input.contextForOperation(operationId),
      })
      queries.set(operationId, query)
    }
    return query
  }
  return {
    directHp: query => forOperation(query.operation.id).directHp(query),
    condition: query => forOperation(query.operation.id).condition(query),
    combatStage: query => forOperation(query.operation.id).combatStage(query),
  }
}

const createMoveSpecOperationDynamicRecipientsResolver = (input: {
  readonly root: MoveCoreTokenDynamicRecipientSets
  readonly children: readonly MoveSpecChildExecution[]
}) => {
  const childDynamic = new Map<string, MoveCoreTokenDynamicRecipientSets>()
  for (const child of input.children) {
    const dynamic: MoveCoreTokenDynamicRecipientSets = {
      attackedTargetIds: child.rootTargetIds,
      hitTargetIds: child.rootHitTargetIds,
      missedTargetIds: child.rootMissedTargetIds,
      damagedTargetIds: child.rootDamagedTargetIds,
      faintedTargetIds: child.rootFaintedTargetIds,
    }
    for (const operationId of child.operationIds) childDynamic.set(operationId, dynamic)
  }
  return (operation: string | { readonly id: string }): MoveCoreTokenDynamicRecipientSets => (
    childDynamic.get(typeof operation === 'string' ? operation : operation.id) ?? input.root
  )
}

const branchControlledOperationIds = (
  operations: readonly MoveSpecEmittedOperation[],
): ReadonlySet<string> => new Set(operations.flatMap(({ operation }) => (
  operation.kind === 'branch' && operation.payload.scope === 'recipient'
    ? moveEffectBranchPaths(operation.payload).flatMap(path => path.operationIds)
    : []
)))

const nestedRecipientResolver = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly operations: readonly MoveSpecEmittedOperation[]
  readonly dynamicRecipients: MoveCoreTokenDynamicRecipientSets
}) => {
  const nestedRecipients = new Map(input.operations.flatMap(emission => (
    emission.childResolutionId
      ? [[emission.operation.id, emission.recipientIds] as const]
      : []
  )))
  if (nestedRecipients.size === 0) return undefined
  const dynamic = resolveMoveCoreTokenDynamicRecipients(
    input.context,
    input.dynamicRecipients,
  )
  return (operation: Parameters<typeof expectedMoveCoreTokenRecipientIds>[1]) => (
    nestedRecipients.get(operation.id)
    ?? expectedMoveCoreTokenRecipientIds(input.context, operation, dynamic)
  )
}

const traceValueRecord = (
  value: MoveResolutionTraceJsonValue | undefined,
): Readonly<Record<string, MoveResolutionTraceJsonValue>> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, MoveResolutionTraceJsonValue>>
    : null
)

const knockOffCriticalHit = (
  recipient: MoveCoreTokenEffectOperationResult['recipients'][number] | undefined,
): boolean => {
  const details = traceValueRecord(recipient?.details)
  const calculation = traceValueRecord(details?.calculation) ?? details
  const critical = traceValueRecord(calculation?.criticalHit)
  return critical?.critical === true
}

const knockOffEffectiveDamage = (
  recipient: MoveCoreTokenEffectOperationResult['recipients'][number] | undefined,
): number => {
  const details = traceValueRecord(recipient?.details)
  const reported = details?.effectiveHpLost
  if (typeof reported === 'number' && Number.isSafeInteger(reported) && reported >= 0) {
    return reported
  }
  if (recipient?.previous.kind !== 'hp' || recipient.current.kind !== 'hp') return 0
  return Math.max(
    0,
    recipient.previous.currentHp
      + recipient.previous.temporaryHp
      - recipient.current.currentHp
      - recipient.current.temporaryHp,
  )
}

const knockOffCombatOutcome = (input: {
  readonly targetPlacementId: string
  readonly hitTargetIds: readonly string[]
  readonly missedTargetIds: readonly string[]
  readonly coreResults: readonly MoveCoreTokenEffectOperationResult[]
}): KnockOffResolvedCombatOutcome => {
  if (
    input.missedTargetIds.includes(input.targetPlacementId)
    || !input.hitTargetIds.includes(input.targetPlacementId)
  ) {
    return { kind: 'miss', targetPlacementId: input.targetPlacementId }
  }
  const damage = input.coreResults.find(result => (
    result.operationId === 'knock-off.damage'
  ))?.recipients.find(recipient => recipient.recipientId === input.targetPlacementId)
  if (damage?.outcome === 'prevented' && damage.reasonCode === 'damage-immunity') {
    return { kind: 'immune', targetPlacementId: input.targetPlacementId }
  }
  return {
    kind: 'hit',
    targetPlacementId: input.targetPlacementId,
    damageDealt: knockOffEffectiveDamage(damage),
    criticalHit: knockOffCriticalHit(damage),
  }
}

const replaceKnockOffChoiceTrace = (input: {
  readonly trace: MoveResolutionAuditTrace
  readonly replacement: ReturnType<typeof planKnockOffItemOutcome>['traceEntries'][number]
}): MoveResolutionAuditTrace => parseMoveResolutionAuditTrace({
  ...input.trace,
  events: input.trace.events.map(event => (
    event.kind === 'operation'
    && event.operationId === KNOCK_OFF_ITEM_CHOICE_OPERATION.id
      ? { ...input.replacement, sequence: event.sequence }
      : event
  )),
})

const reduceKnockOffItemOutcome = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly runtime: MoveSpecV2Runtime
  readonly execution: MoveSpecExecutionCompleteResult
  readonly coreResults: readonly MoveCoreTokenEffectOperationResult[]
  readonly trace: MoveResolutionAuditTrace
  readonly fallback: InterpretedMoveItemEffects
}): { readonly itemEffects: InterpretedMoveItemEffects; readonly trace: MoveResolutionAuditTrace } => {
  if (input.runtime.canonicalId !== 'Knock Off') {
    return { itemEffects: input.fallback, trace: input.trace }
  }
  const targetPlacementId = input.execution.targetIds[0]
    ?? fail('unsupported-operation', 'Knock Off completed without its authoritative target.')
  const selected = input.execution.resolvedItemChoices.find(choice => (
    choice.requestId === KNOCK_OFF_ITEM_REQUEST_ID
  ))
  const outcome = planKnockOffItemOutcome({
    context: input.context,
    combat: knockOffCombatOutcome({
      targetPlacementId,
      hitTargetIds: input.execution.hitTargetIds,
      missedTargetIds: input.execution.missedTargetIds,
      coreResults: input.coreResults,
    }),
    ...(selected ? { selectedOptionId: selected.optionId } : {}),
  })
  if (outcome.kind === 'pending-choice') {
    return fail(
      'execution-pending',
      'Knock Off completed without resolving its required durable item choice.',
    )
  }
  const replacement = outcome.traceEntries[0]
    ?? fail('unsupported-operation', 'Knock Off item outcome omitted its trace evidence.')
  return {
    itemEffects: outcome.kind === 'item-plan'
      ? outcome.itemEffects
      : Object.freeze({
          mutations: Object.freeze([]),
          results: Object.freeze([Object.freeze({
            operationId: KNOCK_OFF_ITEM_EFFECT_OPERATION.id,
            action: KNOCK_OFF_ITEM_EFFECT_OPERATION.payload.action,
            outcome: 'no-op' as const,
            outcomeCode: 'selection-unavailable' as const,
            mutationIds: Object.freeze([]),
            itemCount: 0,
            reasonCode: KNOCK_OFF_ITEM_EFFECT_OPERATION.reasonCode,
          })]),
        }),
    trace: replaceKnockOffChoiceTrace({ trace: input.trace, replacement }),
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
  readonly trace: MoveResolutionAuditTrace
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
  const cancelled = options.trace.events.some((event) => {
    if (event.kind !== 'operation' || event.operationKind !== 'reaction-request') return false
    const input = traceValueRecord(event.input)
    const cancellation = traceValueRecord(input?.cancellation)
    return event.outcome === 'applied' && cancellation?.kind === 'cancel-move'
  })
  if (cancelled) {
    lines.push(`${options.script.moveName} was cancelled before its accuracy check.`)
    return lines
  }
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
    lines.push(options.script.requiresAccuracy
      ? `${target?.species ?? targetId}: accuracy ${roll?.naturalResult ?? '?'} (${hits.has(targetId) ? 'hit' : 'miss'}).`
      : `${target?.species ?? targetId}: automatic hit.`)
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
    'temporary-effect',
    'field',
    'hazard',
    'movement-request',
    'switch-request',
    'nested-move',
    'item',
    'permanent-move-list',
    'usage',
    'history',
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
}

export interface ResolveMoveSpecOptions {
  readonly context: AuthoritativeMoveRulesContext
  readonly runtime: MoveSpecV2Runtime
  readonly entry: ResolvedCanonicalMoveEntry
  readonly authoritativeTargetIds: readonly string[]
  readonly targetBranchId?: string | null
  readonly authoritativeTargetEvaluations?: readonly MoveSpecAuthoritativeTargetEvaluation[]
  /** Complete server-derived geometry for reviewed area-relative movement. */
  readonly authoritativeAreaCells?: readonly { readonly x: number; readonly y: number; readonly z: number }[]
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
  const script = compatibilityScript(options.entry, options.runtime)
  const moveSourceId = options.runtime.definition.spec.phases
    .flatMap(phase => phase.operations)
    .find(operation => operation.source.kind === 'move')?.source.id
    ?? `move.${options.runtime.canonicalId}`
  const overlayInput = {
    context: options.context,
    script,
    moveSourceId,
    authoritativeTargetIds: options.authoritativeTargetIds,
  }
  const abilityOverlays = [
    ...aa060TriggeredMoveOverlayOperations(overlayInput),
    ...aa061TriggeredMoveOverlayOperations(overlayInput),
    ...aa062MoveOverlayOperations(overlayInput),
    ...aa063MoveOverlayOperations(overlayInput),
    ...aa064MoveOverlayOperations(overlayInput),
    ...aa065MoveOverlayOperations(overlayInput),
    ...aa066MoveOverlayOperations(overlayInput),
    ...aa067MoveOverlayOperations(overlayInput),
    ...aa068MoveOverlayOperations(overlayInput),
    ...aa069MoveOverlayOperations(overlayInput),
    ...aa070MoveOverlayOperations(overlayInput),
    ...aa071MoveOverlayOperations(overlayInput),
    ...aa072MoveOverlayOperations(overlayInput),
    ...aa073MoveOverlayOperations(overlayInput),
    ...aa074MoveOverlayOperations(overlayInput),
    ...aa075MoveOverlayOperations(overlayInput),
    ...aa076MoveOverlayOperations(overlayInput),
    ...aa077MoveOverlayOperations(overlayInput),
    ...aa078MoveOverlayOperations(overlayInput),
    ...aa079MoveOverlayOperations(overlayInput),
  ]
  const boneLordLine = script.moveName === 'Bonemerang'
    && aa062BoneLordEmpowersMove(options.context, 'Bonemerang')
  const dustCloudBurst = aa068DustCloudBurstEnabled({
    context: options.context,
    script,
    targetBranchId: options.targetBranchId,
  })
  const longReach = aa078LongReachSelected({
    context: options.context,
    script,
    targetBranchId: options.targetBranchId ?? undefined,
  })
  const execution = executeMoveSpec({
    serverAbilityOverlayOperations: abilityOverlays,
    ...(boneLordLine || dustCloudBurst || longReach ? {
      serverAbilityTargetingOverride: dustCloudBurst
        ? AA068_DUST_CLOUD_TARGETING_OVERRIDE
        : longReach
          ? AA078_LONG_REACH_TARGETING_OVERRIDE
          : {
              kind: 'area' as const, minTargets: 0, maxTargets: 32,
              selector: { kind: 'area-targets' as const },
              predicate: { relationship: 'any' as const, willingness: 'any' as const, excludeActor: true },
            },
    } : {}),
    definition: options.runtime.definition,
    context: options.context,
    targetBranchId: options.targetBranchId,
    authoritativeTargetIds: options.authoritativeTargetIds,
    authoritativeTargetEvaluations: options.authoritativeTargetEvaluations,
    ancestry: options.ancestry,
    resolutionId: options.context.resolutionId ?? undefined,
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

const aa060AmbushOperations = (input: {
  readonly context: AuthoritativeMoveRulesContext
  readonly script: MoveAutomationScript
  readonly execution: MoveSpecExecutionCompleteResult
  readonly authored: readonly MoveSpecEmittedOperation[]
}): readonly MoveSpecEmittedOperation[] => {
  if (!hasAa060MoveMark(input.context, 'Ambush', input.script.moveName)
    || input.execution.hitTargetIds.length === 0) return []
  const damageSourceId = input.authored.find(emission => emission.operation.kind === 'damage')?.operation.id
  if (!damageSourceId) return []
  const mark = input.context.map.encounterState?.abilityOwnedState?.entries.find(entry => (
    entry.ownerPlacementId === input.context.actor.placement.id
    && entry.canonicalId === 'Ambush'
    && entry.payload.kind === 'mark'
    && entry.payload.markId === aa060MoveMarkId('Ambush', input.script.moveName)
  ))
  if (!mark) return []
  const suffix = createHash('sha256')
    .update(`${input.context.resolutionId ?? input.script.moveName}\u0000${mark.stateId}`)
    .digest('hex').slice(0, 24)
  const condition: MoveConditionEffectOperation = {
    id: `ability.ambush.flinch.${suffix}`, kind: 'condition',
    source: { kind: 'operation', id: damageSourceId }, recipients: { kind: 'hit-targets' },
    phase: 'cleanup', reasonCode: 'ability.ambush.flinched',
    payload: {
      action: 'apply', conditionId: 'flinched', conditionSource: null,
      filter: null, randomChoice: null,
      duration: {
        effectId: `ability.ambush.flinch.${suffix}`,
        duration: { kind: 'turns', subject: 'target', boundary: 'end', remaining: 1 },
        transferPolicy: 'expire',
      },
      saveTiming: 'canonical', stackPolicy: { kind: 'refresh', maxStacks: null },
    },
  }
  const accuracy: MoveTemporaryEffectOperation = {
    id: `ability.ambush.accuracy.${suffix}`, kind: 'temporary-effect',
    source: { kind: 'operation', id: damageSourceId }, recipients: { kind: 'hit-targets' },
    phase: 'cleanup', reasonCode: 'ability.ambush.accuracy-penalty',
    payload: {
      action: 'add', effectId: `ability.ambush.accuracy.${suffix}`, recipientScope: 'placements',
      definition: {
        kind: 'numeric-modifier', duration: { kind: 'rounds', boundary: 'end', remaining: 1 },
        stacks: 1, charges: null, stackPolicy: { kind: 'refresh', maxStacks: null },
        chargePolicy: { kind: 'none', amount: null }, tags: ['aa060', 'ambush', 'accuracy-penalty'],
        payload: { attribute: 'accuracy', operation: 'add', value: -2, rounding: 'none' },
        dispel: { policy: 'matching-tags', tags: ['aa060', 'ambush'] }, transferPolicy: 'expire',
      },
    },
  }
  return Object.freeze([
    { operation: condition, recipientIds: Object.freeze([...input.execution.hitTargetIds]) },
    { operation: accuracy, recipientIds: Object.freeze([...input.execution.hitTargetIds]) },
  ])
}

/** Reduce one already completed interpreter result into the immediate planner projection. */
export const reduceCompletedMoveSpec = (
  options: ResolveMoveSpecOptions,
  execution: MoveSpecExecutionCompleteResult,
  alreadyCommittedOperationIds: ReadonlySet<string> = new Set(),
): ImmediateMoveSpecResolution => {
  const authoredOperations = execution.operations.filter(({ operation }) => (
    !alreadyCommittedOperationIds.has(operation.id)
  ))
  assertSupportedImmediateOperations(authoredOperations)

  const compatibility = compatibilityScript(options.entry, options.runtime)
  const childOperationIds = new Set(
    execution.childExecutions.flatMap(child => child.operationIds),
  )
  const rootDamageTypes = execution.resolvedDamageTypes.filter(resolution => (
    !childOperationIds.has(resolution.operationId)
  ))
  const resolvedTypes = [...new Set(rootDamageTypes.map(resolution => resolution.moveType))]
  const script: MoveAutomationScript = resolvedTypes.length === 1
    ? { ...compatibility, type: resolvedTypes[0]! }
    : compatibility
  const abilityOperations = aa060AmbushOperations({
    context: options.context,
    script,
    execution,
    authored: authoredOperations,
  })
  const uncommittedOperations = [...authoredOperations, ...abilityOperations]
  assertSupportedImmediateOperations(uncommittedOperations)
  const responseOwnerByOperationId = new Map<string, string>()
  const retainResponseOwner = (operationId: string, ownerIds: readonly string[]): void => {
    if (ownerIds.length !== 1) return
    const existing = responseOwnerByOperationId.get(operationId)
    if (existing && existing !== ownerIds[0]) {
      fail('execution-rejected', `Response operation ${operationId} changed its authoritative owner.`)
    }
    responseOwnerByOperationId.set(operationId, ownerIds[0]!)
  }
  for (const emission of uncommittedOperations) {
    if (emission.operation.kind !== 'reaction-request'
      && emission.operation.kind !== 'choice-request') continue
    retainResponseOwner(
      emission.operation.id,
      emission.operation.kind === 'reaction-request'
        ? emission.operation.payload.ownerPlacementIds ?? emission.recipientIds
        : emission.recipientIds,
    )
  }
  for (const event of execution.trace.events) {
    if (event.kind === 'operation'
      && (event.operationKind === 'reaction-request' || event.operationKind === 'choice-request')) {
      retainResponseOwner(event.operationId, event.recipientIds)
    }
  }
  let reductionTrace = execution.trace
  for (const emission of abilityOperations) {
    reductionTrace = reduceMoveResolutionTrace(reductionTrace, {
      kind: 'operation', phase: emission.operation.phase,
      operationId: emission.operation.id, operationKind: emission.operation.kind,
      recipientIds: emission.recipientIds, outcome: 'applied',
      reasonCode: emission.operation.reasonCode,
      input: emission.operation.payload as unknown as import('#shared/moveAutomation/trace').MoveResolutionTraceJsonValue,
      result: { status: 'emitted' },
    })
  }
  const baseContextForOperation = createMoveSpecOperationContextResolver({
    root: options.context,
    children: execution.childExecutions,
  })
  const contextForOperation: typeof baseContextForOperation = (operation) => {
    const context = baseContextForOperation(operation)
    if (typeof operation !== 'string') {
      const reasonCode = (operation as { readonly reasonCode?: unknown }).reasonCode
      if (reasonCode === 'ability.gooey.lower-speed') {
        // Gooey is paid by the struck responder but its effect targets the triggering Move's actor.
        return context
      }
      if (reasonCode === AA079_MAGICIAN_ITEM_REASON) {
        // The hit target owns the item choice, but Magician's transfer destination remains the Move actor.
        return options.context
      }
    }
    const sourced = typeof operation === 'string'
      ? null
      : operation as { readonly source?: { readonly kind?: unknown; readonly id?: unknown } }
    const ownerId = sourced?.source?.kind === 'operation' && typeof sourced.source.id === 'string'
      ? responseOwnerByOperationId.get(sourced.source.id)
      : undefined
    if (!ownerId || ownerId === context.actor.placement.id) return context
    const placement = context.queries.placements.get(ownerId)
    const token = context.queries.tokens.get(ownerId)
    const sheet = placement ? context.queries.sheets.forPlacement(placement) : null
    return placement && token && sheet
      ? Object.freeze({ ...context, actor: Object.freeze({ placement, token, sheet }) })
      : context
  }
  const interpretedItemEffects = interpretMoveItemEffects({
    context: options.context,
    operations: uncommittedOperations.filter(isMoveItemEffectEmission),
    resolvedItemChoices: execution.resolvedItemChoices,
    contextForOperation,
  })
  // A self target is explicit interpreter evidence, not an attacked-target wire
  // identity. Self-only operations must address the actor selector directly.
  const dustCloudBurst = aa068DustCloudBurstEnabled({
    context: options.context,
    script,
    targetBranchId: options.targetBranchId,
  })
  const longReach = aa078LongReachSelected({
    context: options.context,
    script,
    targetBranchId: options.targetBranchId ?? undefined,
  })
  const targeting = dustCloudBurst
    ? AA068_DUST_CLOUD_TARGETING_OVERRIDE
    : longReach
      ? AA078_LONG_REACH_TARGETING_OVERRIDE
      : resolveMoveSpecTargetingRule(
        options.runtime.definition.spec,
        options.targetBranchId,
      ) ?? fail('execution-rejected', 'The selected MoveSpec targeting branch is unavailable.')
  const exposesAttackedTargets = targeting.kind !== 'self'
  const attackedTargetIds = exposesAttackedTargets ? [...execution.rootTargetIds] : []
  const initialDynamic: MoveCoreTokenDynamicRecipientSets = {
    attackedTargetIds,
    hitTargetIds: exposesAttackedTargets ? [...execution.rootHitTargetIds] : [],
    missedTargetIds: exposesAttackedTargets ? [...execution.rootMissedTargetIds] : [],
    damagedTargetIds: exposesAttackedTargets ? [...execution.rootDamagedTargetIds] : [],
    faintedTargetIds: exposesAttackedTargets ? [...execution.rootFaintedTargetIds] : [],
  }

  const appliedItemOperationIds = new Set(interpretedItemEffects.results
    .filter(result => result.outcome === 'applied')
    .map(result => result.operationId))
  const appliedDigestionBuff = uncommittedOperations.some(({ operation }) => (
    operation.kind === 'item'
    && operation.payload.action === 'digest-buff'
    && appliedItemOperationIds.has(operation.id)
  ))
  const coreOperations = uncommittedOperations.filter(isMoveCoreTokenEffectEmission)
    .map((emission): MoveResolvedCoreTokenEffectOperation => (
      (emission.operation.reasonCode === AA074_HONEY_THIEF_TEMP_HP_REASON
        && emission.operation.source.kind === 'operation'
        && !appliedItemOperationIds.has(emission.operation.source.id))
      || (emission.operation.reasonCode === AA078_LUNCHBOX_TEMP_HP_REASON
        && !appliedDigestionBuff)
        ? { ...emission, recipientIds: Object.freeze([]) }
        : emission
    ))
  const scriptForOperation = operationMechanicsResolver({
    root: script,
    children: execution.childExecutions,
  })
  const recipientControlledOperationIds = new Set(
    branchControlledOperationIds(uncommittedOperations),
  )
  for (const { operation } of uncommittedOperations) {
    if (operation.reasonCode === 'ability.flame-body.burn-attacker'
      || operation.reasonCode.startsWith('ability.gulp-missile.retaliation-')
      || operation.reasonCode === AA074_HONEY_THIEF_TEMP_HP_REASON
      || operation.reasonCode === AA075_ILLUSION_BREAK_REASON
      || operation.reasonCode === AA075_INNARDS_OUT_HP_REASON
      || operation.reasonCode === AA076_IRON_BARBS_HP_REASON
      || operation.reasonCode === AA078_LIQUID_OOZE_RECOIL_REASON
      || operation.reasonCode === AA078_LUNCHBOX_TEMP_HP_REASON) {
      recipientControlledOperationIds.add(operation.id)
    }
    const operationContext = contextForOperation(operation)
    const operationScript = scriptForOperation(operation.id)
    if (operation.kind === 'heal'
      && operation.recipients.kind === 'actor'
      && aa078IsDrainMove(operationScript.moveName)) {
      recipientControlledOperationIds.add(operation.id)
    }
    if (operationContext.queries.placements.all().some(placement => (
      aa068DrySkinCancelsRecipientEffect({
        context: operationContext,
        script: operationScript,
        recipientId: placement.id,
        operationReasonCode: operation.reasonCode,
        operationKind: operation.kind,
      })
    ))) recipientControlledOperationIds.add(operation.id)
  }
  const multiHit = execution.multiHitExecutions[0] ?? null
  const postMultiReactionStages = coreOperations.every(({ operation }) => (
    (operation.kind === 'combat-stage'
      && (operation.phase === 'after-damage'
        || operation.reasonCode === 'ability.justified.raise-attack')
      && operation.source.kind === 'operation'
      && responseOwnerByOperationId.has(operation.source.id))
    || (operation.kind === 'direct-hp'
      && (operation.reasonCode === AA075_INNARDS_OUT_HP_REASON
        || operation.reasonCode === AA076_IRON_BARBS_HP_REASON)
      && operation.source.kind === 'operation'
      && responseOwnerByOperationId.has(operation.source.id))
  ))
  if (execution.multiHitExecutions.length > 1
    || (multiHit && coreOperations.length > 0 && !postMultiReactionStages)) {
    return fail(
      'multi-hit-operation-conflict',
      'An immediate MoveSpec may contain one pre-reduced multi-hit operation plus only disjoint reviewed post-damage reaction stages.',
    )
  }
  const nestedRecipients = nestedRecipientResolver({
    context: options.context,
    operations: coreOperations,
    dynamicRecipients: initialDynamic,
  })
  const dynamicRecipientsForOperation = createMoveSpecOperationDynamicRecipientsResolver({
    root: initialDynamic,
    children: execution.childExecutions,
  })
  const core: MoveCoreTokenEffectReduction = reduceMoveCoreTokenEffects({
    context: options.context,
    operations: coreOperations,
    dynamicRecipients: initialDynamic,
    ...(nestedRecipients ? { recipientIdsForOperation: nestedRecipients } : {}),
    contextForOperation,
    dynamicRecipientsForOperation,
    sourceOwnerIdForOperation: (operation) => {
      const owner = operation.source.kind === 'operation'
        ? responseOwnerByOperationId.get(operation.source.id) ?? null
        : null
      return owner
    },
    branchControlledOperationIds: recipientControlledOperationIds,
    damage: coreOperations.some(({ operation }) => operation.kind === 'damage')
      ? createDamageQuery({
          contextForOperation,
          scriptForOperation,
          resolvedRolls: execution.resolvedRolls,
          rollLedger: execution.rollLedger,
          resolvedDamageTypes: execution.resolvedDamageTypes,
          resolvedDamageBases: execution.resolvedDamageBases,
          dynamicRecipientsForOperation,
          gorillaTacticsTriggeringDamage: execution.trace.events.some(event => (
            event.kind === 'choice'
            && event.reasonCode === 'ability.gorilla-tactics.optional-lock'
            && event.optionId === 'ability.gorilla-tactics.use'
          )),
          ignitionBoostTriggeringDamage: execution.trace.events.some(event => (
            event.kind === 'choice'
            && event.reasonCode === 'ability.ignition-boost.optional-damage'
            && event.optionId === 'ability.ignition-boost.use'
          )),
        })
      : undefined,
    conditionAccuracyRolls: createConditionAccuracyRollQueries({
      resolvedRolls: execution.resolvedRolls,
      rollLedger: execution.rollLedger,
    }),
    combatStageAccuracyRolls: createCombatStageAccuracyRollQueries({
      resolvedRolls: execution.resolvedRolls,
      rollLedger: execution.rollLedger,
    }),
    immunities: createOperationAwareImmunityQueries({
      root: script,
      children: execution.childExecutions,
      contextForOperation,
    }),
    trace: reductionTrace,
  })
  const knockOffItems = reduceKnockOffItemOutcome({
    context: options.context,
    runtime: options.runtime,
    execution,
    coreResults: core.operationResults,
    trace: core.trace,
    fallback: interpretedItemEffects,
  })
  const permanentMoveLists = reducePermanentMoveListOperations({
    context: options.context,
    operations: uncommittedOperations.filter(isMovePermanentMoveListEmission),
    dynamicRecipients: initialDynamic,
    contextForOperation,
    dynamicRecipientsForOperation,
    trace: knockOffItems.trace,
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
  const spatialOperations = uncommittedOperations.filter(isMoveSpatialEffectEmission)
  const spatial = reduceMoveSpatialEffects({
    context: options.context,
    operations: spatialOperations,
    dynamicRecipients,
    branchControlledOperationIds: recipientControlledOperationIds,
    ...(options.authoritativeAreaCells
      ? { authoritativeAreaCells: options.authoritativeAreaCells }
      : {}),
  })
  const trace = applyMoveSpatialEffectResultsToTrace({
    trace: permanentMoveLists.trace,
    operations: spatialOperations,
    results: spatial.operationResults,
  })
  const transactionTargetIds = dynamicRecipients.attackedTargetIds
  const transactionHitTargetIds = dynamicRecipients.hitTargetIds
  const combinedCoreStateChanges = multiHit
    ? createMoveStateChangePlan(mergeDisjointMoveSheetStateChanges([
        ...multiHit.stateChanges.changes,
        ...core.stateChanges.changes,
      ].map((change): MoveStateChangeInput => {
        const { id: _id, order: _order, ...input } = change
        return structuredClone(input) as MoveStateChangeInput
      })))
    : core.stateChanges
  const transaction: MoveAutomationTransaction = {
    userId: options.context.actor.placement.id,
    userName: options.context.actor.token.species,
    moveName: options.runtime.canonicalId,
    scriptKind: 'explicit',
    scriptVersion: options.runtime.version,
    attackedTargetIds: [...transactionTargetIds],
    hitTargetIds: [...transactionHitTargetIds],
    hpUpdates: [
      ...(multiHit?.hpUpdates ?? []),
      ...hpUpdatesFromResults(core.operationResults),
    ],
    conditionUpdates: [
      ...(multiHit?.conditionUpdates ?? []),
      ...conditionUpdatesFromResults(core.operationResults),
    ],
    combatStageUpdates: [
      ...(multiHit?.combatStageUpdates ?? []),
      ...combatStageUpdatesFromResults(core.operationResults),
    ],
    // Native hazard mechanics persist as typed encounter zones, never as the
    // legacy free-form `hazards[]` compatibility lane.
    hazardsToAdd: [],
    fieldEffectsToApply: [],
    logLines: compatibilityLogLines({
      context: options.context,
      script,
      trace,
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
    ...permanentMoveLists.sheetReads,
    ...spatial.sheetReads,
  ])

  return Object.freeze({
    script: Object.freeze(script),
    transaction: Object.freeze(transaction),
    sheetReads: Object.freeze(sheetReads),
    rollLedger: execution.rollLedger,
    trace,
    native: Object.freeze({
      operations: uncommittedOperations,
      childExecutions: execution.childExecutions,
      dynamicRecipients: Object.freeze(dynamicRecipients),
      faintedPlacementIds: Object.freeze([...faintedSet]),
      coreStateChanges: combinedCoreStateChanges,
      permanentMoveListStateChanges: permanentMoveLists.stateChanges,
      itemEffects: knockOffItems.itemEffects,
      spatialMovements: spatial.movements,
      spatialOperationResults: spatial.operationResults,
      resolvedHazardCells: execution.resolvedHazardCells,
      trace,
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
  const corePreWindowOperations = preWindowOperations.filter(isMoveCoreTokenEffectEmission)
  const nestedRecipients = nestedRecipientResolver({
    context: options.resolve.context,
    operations: corePreWindowOperations,
    dynamicRecipients,
  })
  const contextForOperation = createMoveSpecOperationContextResolver({
    root: options.resolve.context,
    children: options.execution.childExecutions,
  })
  const dynamicRecipientsForOperation = createMoveSpecOperationDynamicRecipientsResolver({
    root: dynamicRecipients,
    children: options.execution.childExecutions,
  })
  const reduction = reduceMoveCoreTokenEffects({
    context: options.resolve.context,
    operations: corePreWindowOperations,
    dynamicRecipients,
    ...(nestedRecipients ? { recipientIdsForOperation: nestedRecipients } : {}),
    contextForOperation,
    dynamicRecipientsForOperation,
    branchControlledOperationIds: branchControlledOperationIds(preWindowOperations),
    immunities: createOperationAwareImmunityQueries({
      root: options.resolve.entry.script,
      children: options.execution.childExecutions,
      contextForOperation,
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
