import type { MoveResolutionAuditTrace } from '#shared/moveAutomation/trace'
import type { EncounterState } from '#shared/moveAutomation/encounterState'
import { deepCloneJson, sameJsonValue } from '~/utils/serialization'
import { createMoveAutomationHpUpdateAccumulator } from '~/utils/moveAutomationHpUpdates'
import {
  createMoveAutomationCombatStageUpdateAccumulator,
  createMoveAutomationConditionUpdateAccumulator,
} from '~/utils/moveAutomationStatusUpdates'
import type {
  MoveAutomationCombatStageUpdate,
  MoveAutomationConditionUpdate,
  MoveAutomationHpUpdate,
} from '~/types/moveAutomation'
import {
  deduplicateAuthoritativeMoveSheetReads,
  type AuthoritativeMoveRulesContext,
  type AuthoritativeMoveSheetRead,
} from '../context'
import type { MoveSpecEmittedOperation } from '../executeSpec'
import type { MoveStateChangePlan } from '../plan'
import { applyAa062BerserkCoreTriggers } from '../../abilityAutomation/mechanics/aa062TriggeredIntegration'
import {
  expandSourceEffectiveAsOneFaintedPlacements,
  removeCrownedCapabilityModesForFaintedPlacements,
} from '../../capabilityAutomation/hpInvariants'
import {
  reduceCombatStageEffect,
  reduceCombatStageEffectForRecipient,
} from './combatStage'
import {
  createMoveConditionEncounterStateAccumulator,
  reduceConditionEffect,
} from './condition'
import {
  MoveCoreTokenEffectReductionError,
  failMoveCoreTokenEffectReduction,
} from './coreTokenEffectError'
import {
  buildMoveCoreTokenStateChanges,
  recordMoveCoreTokenEffectTouches,
  type MoveCoreTokenEffectTouches,
} from './coreTokenPlan'
import {
  canonicalMoveCoreTokenPlacementIds,
  expectedMoveCoreTokenRecipientIds,
  moveCoreTokenRecipientIdsEqual,
  recordMoveCoreTokenRecipientRead,
  resolveMoveCoreTokenDynamicRecipients,
  resolveMoveCoreTokenRecipient,
} from './coreTokenRecipients'
import { applyMoveCoreTokenEffectResultsToTrace } from './coreTokenTrace'
import { evaluateMoveSelector, type MoveRuleSelectorState } from '../evaluateExpression'
import type { MoveSelector } from '#shared/moveAutomation/selectors'
import {
  reduceDamageEffectForRecipient,
  reduceDirectHpEffectForRecipient,
  reduceHealEffectForRecipient,
  reduceRedistributionDirectHpEffectForRecipients,
} from './hp'
import type {
  MoveCombatStageAccuracyRollQueries,
  MoveConditionAccuracyRollQueries,
  MoveCoreTokenDamageQuery,
  MoveCoreTokenDynamicRecipientSets,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectOperationResult,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
  MoveResolvedCoreTokenEffectOperation,
} from './coreTokenEffectTypes'

const CORE_TOKEN_EFFECT_KINDS = new Set<string>([
  'damage',
  'direct-hp',
  'heal',
  'condition',
  'combat-stage',
])

export { MoveCoreTokenEffectReductionError }
export type { MoveCoreTokenEffectReductionErrorCode } from './coreTokenEffectError'
export { applyMoveCoreTokenEffectResultsToTrace } from './coreTokenTrace'

export interface ReduceMoveCoreTokenOperationStateInput {
  readonly context: AuthoritativeMoveRulesContext
  /** Exact server-emitted operations, retained in canonical phase/operation order. */
  readonly operations: readonly MoveResolvedCoreTokenEffectOperation[]
  readonly dynamicRecipients: MoveCoreTokenDynamicRecipientSets
  /** Required only when a `damage` operation is present. */
  readonly damage?: MoveCoreTokenDamageQuery
  /** Required only by a condition with an explicit accuracy-roll trigger. */
  readonly conditionAccuracyRolls?: MoveConditionAccuracyRollQueries
  /** Required only by a combat-stage operation with an accuracy-roll trigger. */
  readonly combatStageAccuracyRolls?: MoveCombatStageAccuracyRollQueries
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  /** Child operations retain their explicitly selected actor/source context. */
  readonly contextForOperation?: (
    operation: MoveResolvedCoreTokenEffectOperation['operation'],
  ) => AuthoritativeMoveRulesContext
  readonly dynamicRecipientsForOperation?: (
    operation: MoveResolvedCoreTokenEffectOperation['operation'],
  ) => MoveCoreTokenDynamicRecipientSets
  /** Server-owned source owner for response-emitted Ability operations. */
  readonly sourceOwnerIdForOperation?: (
    operation: MoveResolvedCoreTokenEffectOperation['operation'],
  ) => string | null
  /**
   * Optional server-owned recipient query for non-MoveSpec orchestration such
   * as lifecycle facts. Emitted IDs must still match this canonical result.
   */
  readonly recipientIdsForOperation?: (
    operation: MoveResolvedCoreTokenEffectOperation['operation'],
  ) => readonly string[]
  /**
   * Operations selected by a reviewed recipient-scoped branch may address an
   * ordered subset of their declared selector. IDs still come from the
   * interpreter and may never widen or reorder the authoritative set.
   */
  readonly branchControlledOperationIds?: ReadonlySet<string>
  /** State already reduced by a bounded multi-hit operation earlier in this resolution. */
  readonly initialState?: {
    readonly hpUpdates: readonly MoveAutomationHpUpdate[]
    readonly conditionUpdates: readonly MoveAutomationConditionUpdate[]
    readonly combatStageUpdates: readonly MoveAutomationCombatStageUpdate[]
    readonly encounterState?: EncounterState
  }
}

export interface ReduceMoveCoreTokenEffectsInput
  extends ReduceMoveCoreTokenOperationStateInput {
  readonly trace: MoveResolutionAuditTrace
}

export interface MoveCoreTokenOperationStateReduction {
  readonly stateChanges: MoveStateChangePlan
  readonly operationResults: readonly MoveCoreTokenEffectOperationResult[]
  readonly sheetReads: readonly AuthoritativeMoveSheetRead[]
}

export interface MoveCoreTokenEffectReduction
  extends MoveCoreTokenOperationStateReduction {
  readonly trace: MoveResolutionAuditTrace
}

export const isMoveCoreTokenEffectEmission = (
  value: MoveSpecEmittedOperation,
): value is MoveResolvedCoreTokenEffectOperation => CORE_TOKEN_EFFECT_KINDS.has(value.operation.kind)

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

const orderedRecipientSubset = (
  subset: readonly string[],
  complete: readonly string[],
): boolean => {
  let subsetIndex = 0
  for (const recipientId of complete) {
    if (recipientId === subset[subsetIndex]) subsetIndex += 1
  }
  return subsetIndex === subset.length
}

const aggregateOutcome = (
  recipients: readonly MoveCoreTokenEffectRecipientResult[],
): MoveCoreTokenEffectOperationResult['outcome'] => {
  if (recipients.some(result => result.outcome === 'applied')) return 'applied'
  if (recipients.some(result => result.outcome === 'prevented')) return 'prevented'
  return 'no-op'
}

const authoritativeSourceRecipient = (options: {
  readonly selector: MoveSelector | null
  readonly operationId: string
  readonly label: 'Combat-stage' | 'Condition'
  readonly errorCode: 'invalid-stage-source' | 'invalid-condition-source'
  readonly context: AuthoritativeMoveRulesContext
  readonly dynamic: Readonly<Record<
    | 'attacked-targets'
    | 'hit-targets'
    | 'missed-targets'
    | 'damaged-targets'
    | 'fainted-targets',
    readonly string[]
  >>
  readonly recipientsById: Map<string, MoveCoreTokenEffectRecipient>
  readonly sheetReads: AuthoritativeMoveSheetRead[]
  readonly sheetReadsByKey: Map<string, AuthoritativeMoveSheetRead>
}): MoveCoreTokenEffectRecipient | undefined => {
  if (!options.selector) return undefined
  const selectorState: MoveRuleSelectorState = {
    targetIds: options.dynamic['attacked-targets'],
    hitTargetIds: options.dynamic['hit-targets'],
    missedTargetIds: options.dynamic['missed-targets'],
    damagedTargetIds: options.dynamic['damaged-targets'],
    faintedTargetIds: options.dynamic['fainted-targets'],
  }
  const sourceIds = evaluateMoveSelector({
    selector: options.selector,
    context: options.context,
    selectorState,
  })
  if (sourceIds.length !== 1) {
    return failMoveCoreTokenEffectReduction(
      options.errorCode,
      `${options.label} operation ${options.operationId} must resolve exactly one authoritative source.`,
    )
  }
  const sourceId = sourceIds[0]!
  const source = options.recipientsById.get(sourceId)
    ?? resolveMoveCoreTokenRecipient(options.context, sourceId)
  options.recipientsById.set(sourceId, source)
  recordMoveCoreTokenRecipientRead(
    options.sheetReads,
    options.sheetReadsByKey,
    source,
  )
  return source
}

const reduceRecipient = (options: {
  readonly emission: MoveResolvedCoreTokenEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly hpAccumulator: ReturnType<typeof createMoveAutomationHpUpdateAccumulator>
  readonly conditionAccumulator: ReturnType<typeof createMoveAutomationConditionUpdateAccumulator>
  readonly stageAccumulator: ReturnType<typeof createMoveAutomationCombatStageUpdateAccumulator>
  readonly temporaryHpAvailable: boolean
  readonly damage: MoveCoreTokenDamageQuery | undefined
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  readonly context: AuthoritativeMoveRulesContext
  readonly hitTargetIds: readonly string[]
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
}): MoveCoreTokenEffectRecipientResult => {
  const { operation } = options.emission
  if (operation.kind === 'damage') {
    if (!options.damage) {
      return failMoveCoreTokenEffectReduction(
        'damage-resolution-missing',
        `Damage operation ${operation.id} requires an authoritative damage resolver.`,
      )
    }
    return reduceDamageEffectForRecipient({
      operation,
      recipient: options.recipient,
      accumulator: options.hpAccumulator,
      damage: options.damage,
      context: options.context,
    })
  }
  const temporaryHpAvailable = options.temporaryHpAvailable
    && !options.context.queries.creatureRules.hasCapability(options.recipient.placement.id, 'Soulless')
  if (operation.kind === 'direct-hp') {
    return reduceDirectHpEffectForRecipient({
      operation,
      recipient: options.recipient,
      accumulator: options.hpAccumulator,
      temporaryHpAvailable,
      immunities: options.immunities,
      context: options.context,
      hitTargetIds: options.hitTargetIds,
      priorOperationResults: options.priorOperationResults,
    })
  }
  if (operation.kind === 'heal') {
    return reduceHealEffectForRecipient({
      operation,
      recipient: options.recipient,
      accumulator: options.hpAccumulator,
      temporaryHpAvailable,
      context: options.context,
      priorOperationResults: options.priorOperationResults,
    })
  }
  if (operation.kind === 'condition') {
    return failMoveCoreTokenEffectReduction(
      'invalid-condition-recipient-count',
      `Condition operation ${operation.id} requires grouped condition reduction.`,
    )
  }
  return reduceCombatStageEffectForRecipient({
    operation,
    recipient: options.recipient,
    accumulator: options.stageAccumulator,
    immunities: options.immunities,
  })
}

/**
 * Purely reduce authoritative core-token operations. All mutation is confined
 * to local accumulators; map/sheets/context and emitted operations stay intact.
 */
export const reduceMoveCoreTokenOperationState = (
  input: ReduceMoveCoreTokenOperationStateInput,
): MoveCoreTokenOperationStateReduction => {
  const dynamic = resolveMoveCoreTokenDynamicRecipients(
    input.context,
    input.dynamicRecipients,
  )
  const hpAccumulator = createMoveAutomationHpUpdateAccumulator()
  const conditionAccumulator = createMoveAutomationConditionUpdateAccumulator()
  const conditionEncounterAccumulator = createMoveConditionEncounterStateAccumulator(
    input.context,
    input.initialState?.encounterState,
  )
  const stageAccumulator = createMoveAutomationCombatStageUpdateAccumulator()
  for (const update of input.initialState?.hpUpdates ?? []) {
    const token = input.context.queries.tokens.get(update.id)
      ?? failMoveCoreTokenEffectReduction(
        'recipient-not-found',
        `Initial multi-hit HP recipient ${update.id} was not resolved.`,
      )
    const currentInjuries = hpAccumulator.getInjuries(token)
    const nextInjuries = update.injuries ?? currentInjuries
    if (nextInjuries > currentInjuries) hpAccumulator.addInjuries(token, nextInjuries - currentInjuries)
    else if (nextInjuries < currentInjuries) hpAccumulator.removeInjuries(token, currentInjuries - nextInjuries)
    hpAccumulator.set(token, update.currentHp)
    if (update.temporaryHp !== undefined) hpAccumulator.setTemporaryHp(token, update.temporaryHp)
  }
  for (const update of input.initialState?.conditionUpdates ?? []) {
    const token = input.context.queries.tokens.get(update.id)
      ?? failMoveCoreTokenEffectReduction(
        'recipient-not-found',
        `Initial multi-hit condition recipient ${update.id} was not resolved.`,
      )
    conditionAccumulator.set(token, update.conditions)
  }
  for (const update of input.initialState?.combatStageUpdates ?? []) {
    const token = input.context.queries.tokens.get(update.id)
      ?? failMoveCoreTokenEffectReduction(
        'recipient-not-found',
        `Initial multi-hit stage recipient ${update.id} was not resolved.`,
      )
    stageAccumulator.set(token, update.stages)
  }
  const temporaryHpAvailable = Boolean(input.context.map.activeScene)
  const operationIds = new Set<string>()
  const operationResults: MoveCoreTokenEffectOperationResult[] = []
  const recipientsById = new Map<string, MoveCoreTokenEffectRecipient>()
  const touches: MoveCoreTokenEffectTouches = new Map()
  const sheetReads: AuthoritativeMoveSheetRead[] = []
  const sheetReadsByKey = new Map<string, AuthoritativeMoveSheetRead>()

  input.operations.forEach((emission, operationOrder) => {
    const { operation } = emission
    const operationContext = input.contextForOperation?.(operation) ?? input.context
    const operationDynamic = input.dynamicRecipientsForOperation
      ? resolveMoveCoreTokenDynamicRecipients(
          operationContext,
          input.dynamicRecipientsForOperation(operation),
        )
      : dynamic
    if (!CORE_TOKEN_EFFECT_KINDS.has(operation.kind)) {
      failMoveCoreTokenEffectReduction(
        'unsupported-operation',
        `Operation ${operation.id} is not a core token effect.`,
      )
    }
    if (operationIds.has(operation.id)) {
      failMoveCoreTokenEffectReduction(
        'duplicate-operation-id',
        `Core effect operation ${operation.id} is duplicated.`,
      )
    }
    operationIds.add(operation.id)

    const emittedIds = canonicalMoveCoreTokenPlacementIds(
      operationContext,
      emission.recipientIds,
      `operation ${operation.id} recipients`,
    )
    const expectedIds = operation.recipients.kind === 'response-owner'
      ? emittedIds
      : input.recipientIdsForOperation
        ? canonicalMoveCoreTokenPlacementIds(
            operationContext,
            input.recipientIdsForOperation(operation),
            `operation ${operation.id} authoritative recipients`,
          )
        : expectedMoveCoreTokenRecipientIds(operationContext, operation, operationDynamic)
    const branchControlled = input.branchControlledOperationIds?.has(operation.id) === true
    if (
      !moveCoreTokenRecipientIdsEqual(emission.recipientIds, emittedIds)
      || (
        branchControlled
          ? !orderedRecipientSubset(emittedIds, expectedIds)
          : !moveCoreTokenRecipientIdsEqual(emittedIds, expectedIds)
      )
    ) {
      failMoveCoreTokenEffectReduction(
        'recipient-set-mismatch',
        `Operation ${operation.id} recipients do not match selector ${operation.recipients.kind} (emitted ${emittedIds.join(',') || 'none'}; expected ${expectedIds.join(',') || 'none'}).`,
      )
    }

    const recipients = emittedIds.map((recipientId) => {
      const recipient = recipientsById.get(recipientId)
        ?? resolveMoveCoreTokenRecipient(input.context, recipientId)
      recipientsById.set(recipientId, recipient)
      recordMoveCoreTokenRecipientRead(sheetReads, sheetReadsByKey, recipient)
      return recipient
    })
    let recipientResults: readonly MoveCoreTokenEffectRecipientResult[]
    if (operation.kind === 'condition') {
      recipientResults = reduceConditionEffect({
        operation,
        recipients,
        sourceRecipient: authoritativeSourceRecipient({
          selector: operation.payload.conditionSource,
          operationId: operation.id,
          label: 'Condition',
          errorCode: 'invalid-condition-source',
          context: operationContext,
          dynamic: operationDynamic,
          recipientsById,
          sheetReads,
          sheetReadsByKey,
        }),
        accumulator: conditionAccumulator,
        encounter: conditionEncounterAccumulator,
        immunities: input.immunities,
        ...(input.conditionAccuracyRolls
          ? { accuracyRolls: input.conditionAccuracyRolls }
          : {}),
        context: operationContext,
        priorOperationResults: operationResults,
      })
    }
    else if (operation.kind === 'combat-stage') {
      const sourceRecipient = authoritativeSourceRecipient({
        selector: operation.payload.stageSource,
        operationId: operation.id,
        label: 'Combat-stage',
        errorCode: 'invalid-stage-source',
        context: operationContext,
        dynamic: operationDynamic,
        recipientsById,
        sheetReads,
        sheetReadsByKey,
      })
      recipientResults = reduceCombatStageEffect({
        operation,
        recipients,
        sourceRecipient,
        accumulator: stageAccumulator,
        immunities: input.immunities,
        ...(input.combatStageAccuracyRolls
          ? { accuracyRolls: input.combatStageAccuracyRolls }
          : {}),
        priorOperationResults: operationResults,
        sourceOwnerId: input.sourceOwnerIdForOperation?.(operation)
          ?? sourceRecipient?.placement.id
          ?? operationContext.actor.placement.id,
        abilityRules: {
          has: (placementId, canonicalId) => operationContext.queries.abilities.has(placementId, canonicalId),
        },
      })
    }
    else if (
      operation.kind === 'direct-hp'
      && (operation.payload.mode === 'split' || operation.payload.mode === 'swap')
    ) {
      recipientResults = reduceRedistributionDirectHpEffectForRecipients({
        operation,
        recipients,
        accumulator: hpAccumulator,
        temporaryHpAvailable: temporaryHpAvailable && recipients.every(recipient => (
          !operationContext.queries.creatureRules.hasCapability(recipient.placement.id, 'Soulless')
        )),
        immunities: input.immunities,
      })
    }
    else {
      recipientResults = recipients.map(recipient => reduceRecipient({
        emission,
        recipient,
        hpAccumulator,
        conditionAccumulator,
        stageAccumulator,
        temporaryHpAvailable,
        damage: input.damage,
        immunities: input.immunities,
        context: operationContext,
        hitTargetIds: operationDynamic['hit-targets'],
        priorOperationResults: operationResults,
      }))
    }
    for (const result of recipientResults) {
      const consultedIds = canonicalMoveCoreTokenPlacementIds(
        input.context,
        result.consultedPlacementIds,
        `operation ${operation.id} consulted placements`,
      )
      for (const consultedId of consultedIds) {
        const consulted = recipientsById.get(consultedId)
          ?? resolveMoveCoreTokenRecipient(input.context, consultedId)
        recipientsById.set(consultedId, consulted)
        recordMoveCoreTokenRecipientRead(sheetReads, sheetReadsByKey, consulted)
      }
      recordMoveCoreTokenEffectTouches(touches, result, operation, operationOrder)
    }
    operationResults.push({
      operationId: operation.id,
      operationKind: operation.kind,
      phase: operation.phase,
      reasonCode: operation.reasonCode,
      recipientIds: [...emittedIds],
      outcome: aggregateOutcome(recipientResults),
      recipients: recipientResults,
    })
  })

  const asOneEndpointTokens = new Map<string, MoveCoreTokenEffectRecipient['token']>()
  const mapPlacementIds = new Set(input.context.map.placements.map(placement => placement.id))
  const initiallyFaintedAsOnePlacements = new Set<string>([
    ...hpAccumulator.toUpdates().filter(update => (
      mapPlacementIds.has(update.id) && update.currentHp <= 0
    )).map(update => update.id),
    ...conditionAccumulator.toUpdates().filter(update => (
      mapPlacementIds.has(update.id) && update.conditions.some(
        condition => condition.trim().toLocaleLowerCase('en-US') === 'fainted',
      )
    )).map(update => update.id),
  ])
  for (const link of input.context.map.encounterState?.capabilityRuntime?.links ?? []) {
    if (link.kind !== 'as-one-mount' || link.canonicalId !== 'As One'
      || link.participantPlacementIds.length !== 1
      || !input.context.queries.creatureRules.hasCapabilityInstance(
        link.ownerPlacementId,
        link.capabilityInstanceId,
        'As One',
      )) continue
    for (const placementId of [link.ownerPlacementId, link.participantPlacementIds[0]!]) {
      const token = input.context.queries.tokens.get(placementId)
      if (!token) continue
      asOneEndpointTokens.set(placementId, token)
      if (hpAccumulator.get(token) <= 0 || conditionAccumulator.get(token).some(
        condition => condition.trim().toLocaleLowerCase('en-US') === 'fainted',
      )) initiallyFaintedAsOnePlacements.add(placementId)
    }
  }
  const coupledFaintedPlacements = new Set(initiallyFaintedAsOnePlacements)
  let faintClosureExpanded = true
  while (faintClosureExpanded) {
    faintClosureExpanded = false
    for (const placementId of [...coupledFaintedPlacements]) {
      const placement = input.context.queries.placements.get(placementId)
      if (!placement) continue
      for (const alias of input.context.map.placements) {
        if (alias.sheetKind !== placement.sheetKind || alias.sheetSlug !== placement.sheetSlug
          || coupledFaintedPlacements.has(alias.id)) continue
        coupledFaintedPlacements.add(alias.id)
        faintClosureExpanded = true
      }
    }
    for (const placementId of expandSourceEffectiveAsOneFaintedPlacements({
      map: input.context.map,
      faintedPlacementIds: coupledFaintedPlacements,
      sourceIsEffective: link => input.context.queries.creatureRules.hasCapabilityInstance(
        link.ownerPlacementId,
        link.capabilityInstanceId,
        'As One',
      ),
    })) {
      if (coupledFaintedPlacements.has(placementId)) continue
      coupledFaintedPlacements.add(placementId)
      faintClosureExpanded = true
    }
  }
  const hpUpdatesBeforeFaintClosure = new Map(hpAccumulator.toUpdates().map(update => [update.id, update]))
  const explicitlyUpdatedSheetKeys = new Set<string>()
  for (const placementId of hpUpdatesBeforeFaintClosure.keys()) {
    const placement = input.context.queries.placements.get(placementId)
    if (placement) explicitlyUpdatedSheetKeys.add(`${placement.sheetKind}:${placement.sheetSlug}`)
  }
  const synthesizedZeroSheetKeys = new Set<string>()
  for (const placementId of coupledFaintedPlacements) {
    const token = asOneEndpointTokens.get(placementId) ?? input.context.queries.tokens.get(placementId)
    if (!token) continue
    const placement = input.context.queries.placements.get(placementId)
    const sheetKey = placement ? `${placement.sheetKind}:${placement.sheetSlug}` : null
    const hasExplicitHpUpdate = hpUpdatesBeforeFaintClosure.has(placementId)

    // A shared-sheet alias observes the explicit or already-synthesized backing
    // write. Mutating its token accumulator as well could produce a second,
    // conflicting sheet state (for example exact overkill versus zero).
    const backingSheetAlreadyCovered = !hasExplicitHpUpdate && sheetKey !== null && (
      explicitlyUpdatedSheetKeys.has(sheetKey) || synthesizedZeroSheetKeys.has(sheetKey)
    )
    if (!backingSheetAlreadyCovered && hpAccumulator.get(token) > 0) {
      // A Fainted condition with positive HP is an authoritative faint and must
      // synthesize zero. Exact non-positive results, including overkill and the
      // explicit Self-Destruct/Explosion value, remain unchanged.
      hpAccumulator.set(token, 0)
      if (sheetKey) synthesizedZeroSheetKeys.add(sheetKey)
    }
    const recipient = recipientsById.get(token.id) ?? resolveMoveCoreTokenRecipient(input.context, token.id)
    recipientsById.set(token.id, recipient)
    recordMoveCoreTokenRecipientRead(sheetReads, sheetReadsByKey, recipient)
  }
  for (const recipient of recipientsById.values()) {
    if (!input.context.queries.creatureRules.hasCapability(recipient.placement.id, 'Soulless')) continue
    hpAccumulator.setTemporaryHp(recipient.token, 0)
    hpAccumulator.removeInjuries(recipient.token, 'all')
  }
  const hpUpdates = hpAccumulator.toUpdates()
  const conditionUpdates = conditionAccumulator.toUpdates()
  const berserk = applyAa062BerserkCoreTriggers({
    context: input.context,
    hpUpdates,
    conditionUpdates,
    stageAccumulator,
    encounterState: conditionEncounterAccumulator.current(),
  })
  const faintedPlacementIds = new Set([
    ...coupledFaintedPlacements,
    ...hpUpdates.filter(update => update.currentHp <= 0).map(update => update.id),
  ])
  const encounterAfterCapabilityFaint = removeCrownedCapabilityModesForFaintedPlacements(
    berserk.encounterState,
    faintedPlacementIds,
  )
  const encounterStateUpdate = sameJsonValue(conditionEncounterAccumulator.previous, encounterAfterCapabilityFaint)
    ? null
    : { previous: conditionEncounterAccumulator.previous, current: encounterAfterCapabilityFaint }
  const frozenResults = deepFreeze(deepCloneJson(operationResults))
  const stateChanges = buildMoveCoreTokenStateChanges({
    context: input.context,
    recipientsById,
    touches,
    hpUpdates,
    conditionUpdates,
    stageUpdates: stageAccumulator.toUpdates(),
    encounterStateUpdate,
  })
  return Object.freeze({
    stateChanges,
    operationResults: frozenResults,
    sheetReads: deepFreeze(deepCloneJson(deduplicateAuthoritativeMoveSheetReads([
      ...sheetReads,
      ...input.context.reads.snapshot(),
    ]))),
  })
}

/** Reduce MoveSpec core operations and project their outcomes into its audit trace. */
export const reduceMoveCoreTokenEffects = (
  input: ReduceMoveCoreTokenEffectsInput,
): MoveCoreTokenEffectReduction => {
  const reduction = reduceMoveCoreTokenOperationState({
    context: input.context,
    operations: input.operations,
    dynamicRecipients: input.dynamicRecipients,
    ...(input.damage === undefined ? {} : { damage: input.damage }),
    ...(input.conditionAccuracyRolls === undefined
      ? {}
      : { conditionAccuracyRolls: input.conditionAccuracyRolls }),
    ...(input.combatStageAccuracyRolls === undefined
      ? {}
      : { combatStageAccuracyRolls: input.combatStageAccuracyRolls }),
    immunities: input.immunities,
    ...(input.contextForOperation === undefined
      ? {}
      : { contextForOperation: input.contextForOperation }),
    ...(input.dynamicRecipientsForOperation === undefined
      ? {}
      : { dynamicRecipientsForOperation: input.dynamicRecipientsForOperation }),
    ...(input.sourceOwnerIdForOperation === undefined
      ? {}
      : { sourceOwnerIdForOperation: input.sourceOwnerIdForOperation }),
    ...(input.recipientIdsForOperation === undefined
      ? {}
      : { recipientIdsForOperation: input.recipientIdsForOperation }),
    ...(input.branchControlledOperationIds === undefined
      ? {}
      : { branchControlledOperationIds: input.branchControlledOperationIds }),
    ...(input.initialState === undefined ? {} : { initialState: input.initialState }),
  })
  return Object.freeze({
    ...reduction,
    trace: applyMoveCoreTokenEffectResultsToTrace(input.trace, reduction.operationResults),
  })
}
