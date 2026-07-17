import { conditionSaveAutomationRule } from '#shared/conditionAutomation'
import type { EncounterEffectConditionSaveTiming } from '#shared/moveAutomation/encounterEffects'
import type {
  MoveConditionCleanseFilter,
  MoveConditionEffectOperation,
} from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import type { MoveAutomationConditionUpdateAccumulator } from '~/utils/moveAutomationStatusUpdates'
import {
  conditionBaseName,
  conditionLookupKey,
  formatDisabledCondition,
  formatInfatuationCondition,
  normalizeConditionNames,
} from '~/utils/statusConditions'
import { sameJsonValue } from '~/utils/serialization'
import { sheetConditionNames } from '~/utils/sheetConditions'
import type { AuthoritativeMoveRulesContext } from '../context'
import {
  createMistyProtectedMoveConditionEffects,
  createMoveConditionEncounterStateAccumulator,
  createSourceLinkedMoveConditionEffect,
  createTransferredMoveConditionEffect,
  directMoveConditionEffects,
  effectiveMoveConditions,
  type MoveConditionEncounterStateAccumulator,
} from './conditionEncounterState'
import {
  failMoveCoreConditionReduction,
  MoveCoreConditionReductionError,
  type MoveCoreConditionReductionErrorCode,
} from './conditionError'
import {
  applyPersistentMoveCondition,
  canonicalMoveCondition,
  conditionMatchesMoveCleanseFilter,
  removeMatchingPersistentConditions,
  removeOnePersistentMoveCondition,
  resolvedMoveConditionSaveTiming,
} from './conditionRules'
import { failMoveCoreTokenEffectReduction } from './coreTokenEffectError'
import type {
  MoveConditionAccuracyRollQueries,
  MoveCoreConditionStateSnapshot,
  MoveCoreTokenChangedField,
  MoveCoreTokenEffectImmunityDecision,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from './coreTokenEffectTypes'

export {
  createMoveConditionEncounterStateAccumulator,
  conditionMatchesMoveCleanseFilter,
  MoveCoreConditionReductionError,
}
export type {
  MoveConditionEncounterStateAccumulator,
  MoveCoreConditionReductionErrorCode,
}

const conditionSnapshot = (
  accumulator: MoveAutomationConditionUpdateAccumulator,
  recipient: MoveCoreTokenEffectRecipient,
): MoveCoreConditionStateSnapshot => {
  // Spawned tokens expose the effective sheet + encounter projection. Persistent
  // condition operations seed their accumulator from the sheet layer only, so
  // a timed encounter effect is never flattened into a sheet write.
  const persistentConditions = sheetConditionNames(recipient.sheet.kind, recipient.sheet.sheet)
  const sheetOwnedToken = {
    ...recipient.token,
    sheetConditions: persistentConditions,
    conditions: persistentConditions,
  }
  return {
    kind: 'conditions',
    conditions: normalizeConditionNames(accumulator.get(sheetOwnedToken)),
  }
}

interface ConditionAccuracyRollTriggerAudit {
  readonly requestedRollId: string
  readonly resolvedRollId: string
  readonly naturalResult: number
  readonly matched: boolean
}

const accuracyRollTriggerForRecipient = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accuracyRolls: MoveConditionAccuracyRollQueries | undefined
}): ConditionAccuracyRollTriggerAudit | null => {
  const trigger = options.operation.payload.accuracyRollTrigger
  if (!trigger) return null
  const queries = options.accuracyRolls
    ?? failMoveCoreConditionReduction(
      'invalid-condition-accuracy-roll-trigger',
      `Condition operation ${options.operation.id} has no authoritative accuracy-roll query.`,
    )
  const roll = queries.resolve({
    operation: options.operation,
    recipient: options.recipient,
  })
  if (
    !Number.isSafeInteger(roll.naturalResult)
    || roll.naturalResult < 1
    || roll.naturalResult > 20
  ) {
    return failMoveCoreConditionReduction(
      'invalid-condition-accuracy-roll-trigger',
      `Condition operation ${options.operation.id} resolved invalid natural d20 result ${roll.naturalResult}.`,
    )
  }
  const matched = trigger.trigger.kind === 'range'
    ? roll.naturalResult >= trigger.trigger.minimum
    : trigger.trigger.values.includes(roll.naturalResult)
  return {
    requestedRollId: trigger.rollId,
    resolvedRollId: roll.rollId,
    naturalResult: roll.naturalResult,
    matched,
  }
}

const randomChoiceForRecipient = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly context: AuthoritativeMoveRulesContext | undefined
  readonly recipientIndex: number
}): { readonly condition: string; readonly rollId: string } => {
  const choice = options.operation.payload.randomChoice
    ?? failMoveCoreConditionReduction(
      'invalid-condition-random-choice',
      `Condition operation ${options.operation.id} has no random-choice definition.`,
    )
  const context = options.context
    ?? failMoveCoreConditionReduction(
      'invalid-condition-random-choice',
      `Condition operation ${options.operation.id} has no authoritative random ledger.`,
    )
  const canonicalChoices = choice.conditionIds.map(canonicalMoveCondition)
  if (new Set(canonicalChoices).size !== canonicalChoices.length) {
    return failMoveCoreConditionReduction(
      'invalid-condition-random-choice',
      `Condition operation ${options.operation.id} contains duplicate canonical choices.`,
    )
  }
  const scopedRollId = `${choice.rollId}.${options.recipientIndex + 1}`
  const ledger = context.random.snapshot()
  const roll = ledger.find(entry => entry.rollId === scopedRollId)
    ?? ledger.find(entry => entry.rollId === choice.rollId)
    ?? failMoveCoreConditionReduction(
      'invalid-condition-random-choice',
      `Condition operation ${options.operation.id} cannot resolve roll ${choice.rollId}.`,
    )
  if (
    !Number.isSafeInteger(roll.finalValue)
    || roll.finalValue < 1
    || roll.finalValue > choice.conditionIds.length
  ) {
    return failMoveCoreConditionReduction(
      'invalid-condition-random-choice',
      `Condition roll ${roll.rollId} result ${roll.finalValue} is outside its reviewed choice table.`,
    )
  }
  return {
    condition: canonicalChoices[roll.finalValue - 1]!,
    rollId: roll.rollId,
  }
}

interface ConditionMutationAudit {
  readonly action: MoveConditionEffectOperation['payload']['action']
  readonly condition: string | null
  readonly sourcePlacementId: string | null
  readonly randomRollId: string | null
  readonly accuracyRollTrigger?: ConditionAccuracyRollTriggerAudit
  readonly removedConditions: readonly string[]
  readonly removedEffectIds: readonly string[]
  readonly appliedEffectId: string | null
  readonly lifecycleTransitions: readonly string[]
  readonly saveTiming: EncounterEffectConditionSaveTiming | null
  readonly stackPolicy: MoveConditionEffectOperation['payload']['stackPolicy']['kind']
  readonly firstTurnProtection?: {
    readonly terrainKind: 'misty'
    readonly zoneId: string
    readonly reasonCode: string
    readonly effectIds: readonly string[]
  } | null
}

const auditDetails = (audit: ConditionMutationAudit): MoveResolutionTraceJsonValue => ({
  action: audit.action,
  condition: audit.condition,
  sourcePlacementId: audit.sourcePlacementId,
  randomRollId: audit.randomRollId,
  ...(audit.accuracyRollTrigger
    ? { accuracyRollTrigger: { ...audit.accuracyRollTrigger } }
    : {}),
  removedConditions: [...audit.removedConditions],
  removedEffectIds: [...audit.removedEffectIds],
  appliedEffectId: audit.appliedEffectId,
  lifecycleTransitions: [...audit.lifecycleTransitions],
  saveTiming: audit.saveTiming,
  stackPolicy: audit.stackPolicy,
  ...(audit.firstTurnProtection
    ? { firstTurnProtection: {
        ...audit.firstTurnProtection,
        effectIds: [...audit.firstTurnProtection.effectIds],
      } }
    : {}),
})

const preventedResult = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly previous: MoveCoreConditionStateSnapshot
  readonly condition: string
  readonly immunity: MoveCoreTokenEffectImmunityDecision
  readonly details: MoveResolutionTraceJsonValue
}): MoveCoreTokenEffectRecipientResult => ({
  recipientId: options.recipient.placement.id,
  outcome: 'prevented',
  reasonCode: 'condition-immunity',
  blockers: [{ subject: options.condition, source: options.immunity.blockedBy! }],
  details: options.details,
  consultedPlacementIds: options.immunity.consultedPlacementIds,
  previous: options.previous,
  current: options.previous,
  changedFields: [],
})

const noOpReason = (
  action: MoveConditionEffectOperation['payload']['action'],
  capped: boolean,
): string => {
  if (capped) return 'condition-stack-capped'
  if (action === 'apply' || action === 'random-choice') return 'condition-already-applied'
  if (action === 'remove') return 'condition-absent'
  if (action === 'transfer') return 'condition-transfer-source-absent'
  if (action === 'replace') return 'condition-filter-empty'
  return 'conditions-empty'
}

const reduceUnaryCondition = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly recipientIndex: number
  readonly accumulator: MoveAutomationConditionUpdateAccumulator
  readonly encounter: MoveConditionEncounterStateAccumulator | undefined
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  readonly accuracyRolls: MoveConditionAccuracyRollQueries | undefined
  readonly context: AuthoritativeMoveRulesContext | undefined
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, recipient, accumulator, encounter } = options
  const previous = conditionSnapshot(accumulator, recipient)
  const random = operation.payload.action === 'random-choice'
    ? randomChoiceForRecipient(options)
    : null
  const canonicalCondition = random?.condition
    ?? (operation.payload.conditionId === null
      ? null
      : canonicalMoveCondition(operation.payload.conditionId))
  const condition = canonicalCondition === 'Disabled' && operation.payload.conditionDetail
    ? formatDisabledCondition(operation.payload.conditionDetail)
    : canonicalCondition === 'Infatuation' && operation.payload.conditionDetail
      ? formatInfatuationCondition(operation.payload.conditionDetail)
      : canonicalCondition
  const accuracyRollTrigger = accuracyRollTriggerForRecipient({
    operation,
    recipient,
    accuracyRolls: options.accuracyRolls,
  })
  const filter = operation.payload.action === 'remove'
    ? {
        groups: [],
        conditionIds: [conditionLookupKey(condition!)],
        excludedConditionIds: [],
      } satisfies MoveConditionCleanseFilter
    : operation.payload.filter
  const matches = (candidate: string): boolean => (
    conditionMatchesMoveCleanseFilter(candidate, filter)
  )
  const matchingPersistent = previous.conditions.filter(matches)
  const matchingEffects = directMoveConditionEffects({ recipient, encounter, matches })
  const applies = operation.payload.action === 'apply'
    || operation.payload.action === 'replace'
    || operation.payload.action === 'random-choice'

  if (accuracyRollTrigger && !accuracyRollTrigger.matched) {
    return {
      recipientId: recipient.placement.id,
      outcome: 'no-op',
      reasonCode: 'condition-accuracy-roll-trigger-not-met',
      blockers: [],
      details: auditDetails({
        action: operation.payload.action,
        condition,
        sourcePlacementId: null,
        randomRollId: random?.rollId ?? null,
        accuracyRollTrigger,
        removedConditions: [],
        removedEffectIds: [],
        appliedEffectId: null,
        lifecycleTransitions: [],
        saveTiming: condition ? resolvedMoveConditionSaveTiming(condition, operation) : null,
        stackPolicy: operation.payload.stackPolicy.kind,
      }),
      consultedPlacementIds: [],
      previous,
      current: previous,
      changedFields: [],
    }
  }

  if (operation.payload.action === 'replace' && matchingPersistent.length === 0 && matchingEffects.length === 0) {
    return {
      recipientId: recipient.placement.id,
      outcome: 'no-op',
      reasonCode: 'condition-filter-empty',
      blockers: [],
      details: auditDetails({
        action: operation.payload.action,
        condition,
        sourcePlacementId: null,
        randomRollId: random?.rollId ?? null,
        ...(accuracyRollTrigger ? { accuracyRollTrigger } : {}),
        removedConditions: [],
        removedEffectIds: [],
        appliedEffectId: null,
        lifecycleTransitions: [],
        saveTiming: condition ? resolvedMoveConditionSaveTiming(condition, operation) : null,
        stackPolicy: operation.payload.stackPolicy.kind,
      }),
      consultedPlacementIds: [],
      previous,
      current: previous,
      changedFields: [],
    }
  }

  const immunity = applies
    ? options.immunities.condition({ operation, condition: condition!, recipient })
    : { blockedBy: null, consultedPlacementIds: [] }
  const baseAudit: ConditionMutationAudit = {
    action: operation.payload.action,
    condition,
    sourcePlacementId: null,
    randomRollId: random?.rollId ?? null,
    ...(accuracyRollTrigger ? { accuracyRollTrigger } : {}),
    removedConditions: [],
    removedEffectIds: [],
    appliedEffectId: null,
    lifecycleTransitions: [],
    saveTiming: condition ? resolvedMoveConditionSaveTiming(condition, operation) : null,
    stackPolicy: operation.payload.stackPolicy.kind,
  }
  if (immunity.blockedBy) {
    return preventedResult({
      operation,
      recipient,
      previous,
      condition: condition!,
      immunity,
      details: auditDetails(baseAudit),
    })
  }

  let nextConditions: readonly string[] = previous.conditions
  let removedConditions: readonly string[] = []
  let removedEffectIds: readonly string[] = []
  let appliedEffectId: string | null = null
  const lifecycleTransitions: string[] = []
  let firstTurnProtection: ConditionMutationAudit['firstTurnProtection'] = null
  let conditionApplicationChanged = false
  let capped = false

  if (operation.payload.action === 'remove' || operation.payload.action === 'clear' || operation.payload.action === 'replace') {
    removedConditions = matchingPersistent
    nextConditions = removeMatchingPersistentConditions(previous.conditions, matches)
    removedEffectIds = encounter?.remove(matchingEffects.map(effect => effect.id)) ?? []
  }

  if (applies) {
    if (operation.payload.duration) {
      const context = options.context
        ?? failMoveCoreConditionReduction(
          'invalid-condition-effect-scope',
          `Condition operation ${operation.id} cannot store duration without an authoritative context.`,
        )
      const targetEncounter = encounter
        ?? failMoveCoreConditionReduction(
          'invalid-condition-effect-scope',
          `Condition operation ${operation.id} cannot store duration in this reducer scope.`,
        )
      const effect = createSourceLinkedMoveConditionEffect({
        operation,
        condition: condition!,
        recipient,
        context,
      })
      const lifecycle = targetEncounter.apply(effect)
      appliedEffectId = effect.id
      lifecycleTransitions.push(...lifecycle.transitions.map(transition => transition.kind))
      conditionApplicationChanged = lifecycle.changed
      capped = !lifecycle.changed && lifecycle.transitions.some(transition => transition.kind === 'stack-capped')
    }
    else {
      const applied = applyPersistentMoveCondition({
        conditions: nextConditions,
        condition: condition!,
        operation,
      })
      nextConditions = applied.conditions
      conditionApplicationChanged = !sameJsonValue(previous.conditions, nextConditions)
      capped = applied.capped
    }
  }

  if (
    applies
    && conditionApplicationChanged
    && immunity.firstTurnConditionProtection
  ) {
    const context = options.context
      ?? failMoveCoreConditionReduction(
        'invalid-condition-effect-scope',
        `Condition operation ${operation.id} cannot store terrain protection without an authoritative context.`,
      )
    const targetEncounter = encounter
      ?? failMoveCoreConditionReduction(
        'invalid-condition-effect-scope',
        `Condition operation ${operation.id} cannot store terrain protection in this reducer scope.`,
      )
    const effects = createMistyProtectedMoveConditionEffects({
      operation,
      condition: condition!,
      recipient,
      context,
      protection: immunity.firstTurnConditionProtection,
    })
    for (const effect of effects) {
      const lifecycle = targetEncounter.apply(effect)
      lifecycleTransitions.push(...lifecycle.transitions.map(transition => transition.kind))
    }
    firstTurnProtection = {
      terrainKind: immunity.firstTurnConditionProtection.terrainKind,
      zoneId: immunity.firstTurnConditionProtection.zoneId,
      reasonCode: immunity.firstTurnConditionProtection.reasonCode,
      effectIds: effects.map(effect => effect.id),
    }
  }

  if (!sameJsonValue(previous.conditions, nextConditions)) {
    accumulator.set(recipient.token, nextConditions)
  }
  const current = conditionSnapshot(accumulator, recipient)
  const persistentChanged = !sameJsonValue(previous.conditions, current.conditions)
  const encounterChanged = removedEffectIds.length > 0
    || lifecycleTransitions.some(kind => kind !== 'stack-capped')
  const changedFields: MoveCoreTokenChangedField[] = [
    ...(persistentChanged ? ['conditions' as const] : []),
    ...(encounterChanged ? ['encounterEffects' as const] : []),
  ]
  const details = auditDetails({
    ...baseAudit,
    removedConditions,
    removedEffectIds,
    appliedEffectId,
    lifecycleTransitions,
    firstTurnProtection,
  })

  if (changedFields.length === 0) {
    return {
      recipientId: recipient.placement.id,
      outcome: 'no-op',
      reasonCode: noOpReason(operation.payload.action, capped),
      blockers: [],
      details,
      consultedPlacementIds: immunity.consultedPlacementIds,
      previous,
      current,
      changedFields,
    }
  }
  return {
    recipientId: recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers: [],
    details,
    consultedPlacementIds: immunity.consultedPlacementIds,
    previous,
    current,
    changedFields,
  }
}

const transferConditionEffect = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly recipients: readonly MoveCoreTokenEffectRecipient[]
  readonly source: MoveCoreTokenEffectRecipient | undefined
  readonly accumulator: MoveAutomationConditionUpdateAccumulator
  readonly encounter: MoveConditionEncounterStateAccumulator | undefined
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  readonly context: AuthoritativeMoveRulesContext | undefined
}): readonly MoveCoreTokenEffectRecipientResult[] => {
  const { operation, recipients, source, accumulator, encounter } = options
  if (recipients.length !== 2) {
    return failMoveCoreTokenEffectReduction(
      'invalid-condition-recipient-count',
      `Transfer condition operation ${operation.id} requires exactly two recipients.`,
    )
  }
  if (!source || !recipients.some(recipient => recipient.placement.id === source.placement.id)) {
    return failMoveCoreTokenEffectReduction(
      'invalid-condition-source',
      `Transfer condition operation ${operation.id} requires its source among its recipients.`,
    )
  }
  const destination = recipients.find(recipient => recipient.placement.id !== source.placement.id)!
  const condition = canonicalMoveCondition(operation.payload.conditionId!)
  const works = recipients.map(recipient => ({
    recipient,
    previous: conditionSnapshot(accumulator, recipient),
  }))
  const sourceWork = works.find(work => work.recipient.placement.id === source.placement.id)!
  const destinationWork = works.find(work => work.recipient.placement.id === destination.placement.id)!
  const sourcePersistent = sourceWork.previous.conditions.some(entry => (
    conditionBaseName(entry) === condition
  ))
  const sourceEffects = directMoveConditionEffects({
    recipient: source,
    encounter,
    matches: candidate => candidate === condition,
  })
  const sourceEffect = sourceEffects[0] ?? null
  const destinationHasCondition = effectiveMoveConditions({
    recipient: destination,
    persistent: destinationWork.previous.conditions,
    encounter,
  }).some(entry => conditionBaseName(entry) === condition)

  const baseDetails = (recipientId: string): MoveResolutionTraceJsonValue => auditDetails({
    action: 'transfer',
    condition,
    sourcePlacementId: source.placement.id,
    randomRollId: null,
    removedConditions: [],
    removedEffectIds: [],
    appliedEffectId: null,
    lifecycleTransitions: [],
    saveTiming: sourceEffect?.payload.saveTiming ?? conditionSaveAutomationRule(condition)?.timing ?? null,
    stackPolicy: operation.payload.stackPolicy.kind,
  }) as MoveResolutionTraceJsonValue & { recipientId?: string }

  if (!sourcePersistent && !sourceEffect) {
    return works.map(work => ({
      recipientId: work.recipient.placement.id,
      outcome: 'no-op',
      reasonCode: 'condition-transfer-source-absent',
      blockers: [],
      details: baseDetails(work.recipient.placement.id),
      consultedPlacementIds: work.recipient.placement.id === destination.placement.id
        ? [source.placement.id]
        : [],
      previous: work.previous,
      current: work.previous,
      changedFields: [],
    }))
  }
  if (destinationHasCondition) {
    return works.map(work => ({
      recipientId: work.recipient.placement.id,
      outcome: 'no-op',
      reasonCode: 'condition-transfer-destination-present',
      blockers: [],
      details: baseDetails(work.recipient.placement.id),
      consultedPlacementIds: work.recipient.placement.id === destination.placement.id
        ? [source.placement.id]
        : [destination.placement.id],
      previous: work.previous,
      current: work.previous,
      changedFields: [],
    }))
  }

  const immunity = options.immunities.condition({ operation, condition, recipient: destination })
  if (immunity.blockedBy) {
    return works.map(work => work.recipient.placement.id === destination.placement.id
      ? preventedResult({
          operation,
          recipient: destination,
          previous: work.previous,
          condition,
          immunity: {
            ...immunity,
            consultedPlacementIds: [
              source.placement.id,
              ...immunity.consultedPlacementIds.filter(id => id !== source.placement.id),
            ],
          },
          details: baseDetails(work.recipient.placement.id),
        })
      : {
          recipientId: work.recipient.placement.id,
          outcome: 'no-op',
          reasonCode: 'condition-transfer-prevented',
          blockers: [],
          details: baseDetails(work.recipient.placement.id),
          consultedPlacementIds: [destination.placement.id],
          previous: work.previous,
          current: work.previous,
          changedFields: [],
        })
  }

  let destinationPersistent = destinationWork.previous.conditions
  let destinationEffectId: string | null = null
  let lifecycleTransitions: readonly string[] = []
  if (sourcePersistent) {
    const applied = applyPersistentMoveCondition({
      conditions: destinationPersistent,
      condition,
      operation,
    })
    if (applied.capped || sameJsonValue(applied.conditions, destinationPersistent)) {
      return works.map(work => ({
        recipientId: work.recipient.placement.id,
        outcome: 'no-op',
        reasonCode: applied.capped ? 'condition-stack-capped' : 'condition-transfer-destination-present',
        blockers: [],
        details: baseDetails(work.recipient.placement.id),
        consultedPlacementIds: work.recipient.placement.id === destination.placement.id
          ? [source.placement.id]
          : [destination.placement.id],
        previous: work.previous,
        current: work.previous,
        changedFields: [],
      }))
    }
    destinationPersistent = applied.conditions
  }
  else {
    const context = options.context
      ?? failMoveCoreConditionReduction(
        'invalid-condition-effect-scope',
        `Condition transfer ${operation.id} cannot transfer a source-linked effect without context.`,
      )
    const targetEncounter = encounter
      ?? failMoveCoreConditionReduction(
        'invalid-condition-effect-scope',
        `Condition transfer ${operation.id} cannot transfer a source-linked effect in this scope.`,
      )
    const transferred = createTransferredMoveConditionEffect({
      operation,
      sourceEffect: sourceEffect!,
      destination,
      context,
    })
    const lifecycle = targetEncounter.apply(transferred)
    if (!lifecycle.changed) {
      return works.map(work => ({
        recipientId: work.recipient.placement.id,
        outcome: 'no-op',
        reasonCode: 'condition-stack-capped',
        blockers: [],
        details: baseDetails(work.recipient.placement.id),
        consultedPlacementIds: work.recipient.placement.id === destination.placement.id
          ? [source.placement.id]
          : [destination.placement.id],
        previous: work.previous,
        current: work.previous,
        changedFields: [],
      }))
    }
    destinationEffectId = transferred.id
    lifecycleTransitions = lifecycle.transitions.map(transition => transition.kind)
  }

  const sourceRemovedConditions = sourcePersistent ? [condition] : []
  const sourceNext = sourcePersistent
    ? removeOnePersistentMoveCondition(sourceWork.previous.conditions, condition)
    : sourceWork.previous.conditions
  const removedSourceEffectIds = sourceEffect ? (encounter?.remove([sourceEffect.id]) ?? []) : []
  if (!sameJsonValue(sourceWork.previous.conditions, sourceNext)) {
    accumulator.set(source.token, sourceNext)
  }
  if (!sameJsonValue(destinationWork.previous.conditions, destinationPersistent)) {
    accumulator.set(destination.token, destinationPersistent)
  }

  return works.map((work): MoveCoreTokenEffectRecipientResult => {
    const isSource = work.recipient.placement.id === source.placement.id
    const current = conditionSnapshot(accumulator, work.recipient)
    const persistentChanged = !sameJsonValue(work.previous.conditions, current.conditions)
    const encounterChanged = isSource
      ? removedSourceEffectIds.length > 0
      : destinationEffectId !== null
    const changedFields: MoveCoreTokenChangedField[] = [
      ...(persistentChanged ? ['conditions' as const] : []),
      ...(encounterChanged ? ['encounterEffects' as const] : []),
    ]
    return {
      recipientId: work.recipient.placement.id,
      outcome: changedFields.length > 0 ? 'applied' : 'no-op',
      reasonCode: changedFields.length > 0 ? operation.reasonCode : 'condition-transfer-unchanged',
      blockers: [],
      details: auditDetails({
        action: 'transfer',
        condition,
        sourcePlacementId: source.placement.id,
        randomRollId: null,
        removedConditions: isSource ? sourceRemovedConditions : [],
        removedEffectIds: isSource ? removedSourceEffectIds : [],
        appliedEffectId: isSource ? null : destinationEffectId,
        lifecycleTransitions: isSource ? [] : lifecycleTransitions,
        saveTiming: sourceEffect?.payload.saveTiming ?? conditionSaveAutomationRule(condition)?.timing ?? null,
        stackPolicy: operation.payload.stackPolicy.kind,
      }),
      consultedPlacementIds: isSource
        ? [destination.placement.id]
        : [
            source.placement.id,
            ...immunity.consultedPlacementIds.filter(id => id !== source.placement.id),
          ],
      previous: work.previous,
      current,
      changedFields,
    }
  })
}

/** Reduce one complete typed condition operation from operation-entry state. */
export const reduceConditionEffect = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly recipients: readonly MoveCoreTokenEffectRecipient[]
  readonly sourceRecipient?: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationConditionUpdateAccumulator
  readonly encounter?: MoveConditionEncounterStateAccumulator
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  readonly accuracyRolls?: MoveConditionAccuracyRollQueries
  readonly context?: AuthoritativeMoveRulesContext
}): readonly MoveCoreTokenEffectRecipientResult[] => {
  if (options.operation.payload.action === 'transfer') {
    return transferConditionEffect({
      operation: options.operation,
      recipients: options.recipients,
      source: options.sourceRecipient,
      accumulator: options.accumulator,
      encounter: options.encounter,
      immunities: options.immunities,
      context: options.context,
    })
  }
  return options.recipients.map((recipient, recipientIndex) => reduceUnaryCondition({
    operation: options.operation,
    recipient,
    recipientIndex,
    accumulator: options.accumulator,
    encounter: options.encounter,
    immunities: options.immunities,
    accuracyRolls: options.accuracyRolls,
    context: options.context,
  }))
}

/** Recipient-local compatibility seam used by bounded multi-hit follow-ups. */
export const reduceConditionEffectForRecipient = (options: {
  readonly operation: MoveConditionEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationConditionUpdateAccumulator
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  readonly accuracyRolls?: MoveConditionAccuracyRollQueries
  readonly context?: AuthoritativeMoveRulesContext
}): MoveCoreTokenEffectRecipientResult => {
  if (options.operation.payload.action === 'transfer') {
    return failMoveCoreTokenEffectReduction(
      'invalid-condition-recipient-count',
      `Condition transfer ${options.operation.id} cannot be reduced as a recipient-local follow-up.`,
    )
  }
  if (options.operation.payload.duration !== null) {
    return failMoveCoreConditionReduction(
      'invalid-condition-effect-scope',
      `Source-linked condition ${options.operation.id} requires encounter-state orchestration.`,
    )
  }
  return reduceConditionEffect({
    operation: options.operation,
    recipients: [options.recipient],
    accumulator: options.accumulator,
    immunities: options.immunities,
    ...(options.accuracyRolls ? { accuracyRolls: options.accuracyRolls } : {}),
    ...(options.context ? { context: options.context } : {}),
  })[0]!
}
