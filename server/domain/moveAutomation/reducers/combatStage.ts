import type {
  MoveCombatStageEffectOperation,
  MoveEffectCombatStageAction,
  MoveEffectRoundingPolicy,
} from '#shared/moveAutomation/effects'
import type { MoveResolutionTraceJsonValue } from '#shared/moveAutomation/trace'
import {
  COMBAT_STAGE_KEYS,
  COMBAT_STAT_STAGE_KEYS,
  clampCombatStage,
  normalizeCombatStages,
} from '~/utils/combatStages'
import type { MoveAutomationCombatStageUpdateAccumulator } from '~/utils/moveAutomationStatusUpdates'
import type { CombatStageKey, CombatStageMap } from '~/types/combatStages'
import {
  aa064ApplyCompetitive,
  aa064ContraryRequestedValue,
  type Aa064StageAbilityQueries,
} from '../../abilityAutomation/mechanics/aa064StageIntegration'
import { failMoveCoreTokenEffectReduction } from './coreTokenEffectError'
import type {
  MoveCombatStageAccuracyRollQueries,
  MoveCoreCombatStageStateSnapshot,
  MoveCoreTokenEffectBlocker,
  MoveCoreTokenEffectImmunityQueries,
  MoveCoreTokenEffectOperationResult,
  MoveCoreTokenEffectRecipient,
  MoveCoreTokenEffectRecipientResult,
} from './coreTokenEffectTypes'

interface CombatStageChangeAudit {
  readonly stage: CombatStageKey
  readonly previous: number
  readonly unboundedRequested: number
  readonly requested: number
  readonly current: number
  readonly requestedDelta: number
  readonly appliedDelta: number
  readonly capped: boolean
  readonly outcome: 'applied' | 'prevented' | 'no-op'
  readonly blockedBy: {
    readonly recipientId: string
    readonly source: string
  } | null
}

interface CombatStageTriggerAudit {
  readonly kind: 'accuracy-roll' | 'operation-outcome'
  readonly matched: boolean
  readonly applicationCount: number
  readonly rollId: string | null
  readonly naturalResults: readonly number[]
  readonly operationId: string | null
  readonly operationOutcome: string | null
}

interface CombatStageRecipientWork {
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly previous: MoveCoreCombatStageStateSnapshot
  readonly next: CombatStageMap
  readonly blockers: MoveCoreTokenEffectBlocker[]
  readonly consultedPlacementIds: Set<string>
  readonly changes: CombatStageChangeAudit[]
  trigger: CombatStageTriggerAudit | null
  redistributionPrevented: boolean
  competitiveDelta: number
  readonly sourceOwnerId: string | null
  readonly abilityRules?: Aa064StageAbilityQueries
}

interface CombatStageRequest {
  readonly work: CombatStageRecipientWork
  readonly stage: CombatStageKey
  readonly previous: number
  readonly unboundedRequested: number
  readonly requested: number
  readonly delta: number
}

const REDISTRIBUTION_ACTIONS = new Set<MoveEffectCombatStageAction>([
  'swap',
  'split',
  'transfer',
])

const combatStageSnapshot = (
  accumulator: MoveAutomationCombatStageUpdateAccumulator,
  recipient: MoveCoreTokenEffectRecipient,
): MoveCoreCombatStageStateSnapshot => ({
  kind: 'combat-stages',
  stages: normalizeCombatStages(accumulator.get(recipient.token)),
})

const operationStages = (
  operation: MoveCombatStageEffectOperation,
): readonly CombatStageKey[] => {
  if (operation.payload.stage === 'all') return COMBAT_STAGE_KEYS
  if (operation.payload.stage === 'all-stats') return COMBAT_STAT_STAGE_KEYS
  if (operation.payload.stage === 'selected-stat') {
    const selected = operation.payload.selectedStage
      ?? failMoveCoreTokenEffectReduction(
        'invalid-stage-source',
        `Combat-stage operation ${operation.id} has no selected Stat.`,
      )
    return [selected]
  }
  return [operation.payload.stage]
}

const createWork = (
  accumulator: MoveAutomationCombatStageUpdateAccumulator,
  recipient: MoveCoreTokenEffectRecipient,
  options: {
    readonly sourceOwnerId: string | null
    readonly abilityRules?: Aa064StageAbilityQueries
  },
): CombatStageRecipientWork => {
  const previous = combatStageSnapshot(accumulator, recipient)
  return {
    recipient,
    previous,
    next: { ...previous.stages },
    blockers: [],
    consultedPlacementIds: new Set<string>(),
    changes: [],
    trigger: null,
    redistributionPrevented: false,
    competitiveDelta: 0,
    sourceOwnerId: options.sourceOwnerId,
    ...(options.abilityRules ? { abilityRules: options.abilityRules } : {}),
  }
}

const rounded = (value: number, policy: MoveEffectRoundingPolicy): number => {
  if (policy === 'ceil') return Math.ceil(value)
  if (policy === 'round') return Math.round(value)
  return Math.floor(value)
}

const request = (
  work: CombatStageRecipientWork,
  stage: CombatStageKey,
  originalUnboundedRequested: number,
): CombatStageRequest => {
  const previous = work.previous.stages[stage]
  const unboundedRequested = aa064ContraryRequestedValue({
    recipientId: work.recipient.placement.id,
    current: previous,
    unboundedRequested: originalUnboundedRequested,
    abilities: work.abilityRules,
  })
  const requested = clampCombatStage(unboundedRequested)
  return {
    work,
    stage,
    previous,
    unboundedRequested,
    requested,
    delta: requested - previous,
  }
}

const recordConsultedPlacements = (
  work: CombatStageRecipientWork,
  placementIds: readonly string[],
): void => {
  for (const placementId of placementIds) work.consultedPlacementIds.add(placementId)
}

const recordChange = (
  item: CombatStageRequest,
  options: {
    readonly outcome: CombatStageChangeAudit['outcome']
    readonly blockedBy?: CombatStageChangeAudit['blockedBy']
  },
): void => {
  item.work.changes.push({
    stage: item.stage,
    previous: item.previous,
    unboundedRequested: item.unboundedRequested,
    requested: item.requested,
    current: item.work.next[item.stage],
    requestedDelta: item.delta,
    appliedDelta: item.work.next[item.stage] - item.previous,
    capped: item.unboundedRequested !== item.requested,
    outcome: options.outcome,
    blockedBy: options.blockedBy ?? null,
  })
}

const immunityFor = (
  operation: MoveCombatStageEffectOperation,
  item: CombatStageRequest,
  immunities: MoveCoreTokenEffectImmunityQueries,
) => {
  const decision = immunities.combatStage({
    operation,
    stage: item.stage,
    delta: item.delta,
    recipient: item.work.recipient,
  })
  recordConsultedPlacements(item.work, decision.consultedPlacementIds)
  return decision
}

const applyIndependentRequest = (
  operation: MoveCombatStageEffectOperation,
  item: CombatStageRequest,
  immunities: MoveCoreTokenEffectImmunityQueries,
): void => {
  if (item.delta === 0) {
    recordChange(item, { outcome: 'no-op' })
    return
  }

  const immunity = immunityFor(operation, item, immunities)
  if (immunity.blockedBy) {
    item.work.blockers.push({ subject: item.stage, source: immunity.blockedBy })
    recordChange(item, {
      outcome: 'prevented',
      blockedBy: {
        recipientId: item.work.recipient.placement.id,
        source: immunity.blockedBy,
      },
    })
    return
  }

  item.work.next[item.stage] = item.requested
  recordChange(item, { outcome: 'applied' })
}

/**
 * Apply one coupled redistribution stage atomically. If any recipient prevents
 * its requested delta, every value for that stage remains at the operation-entry
 * snapshot so a swap/split/transfer cannot duplicate or discard a source value.
 */
const applyCoupledRequests = (
  operation: MoveCombatStageEffectOperation,
  items: readonly CombatStageRequest[],
  immunities: MoveCoreTokenEffectImmunityQueries,
): void => {
  const decisions = items.map(item => item.delta === 0
    ? { blockedBy: null, consultedPlacementIds: [] as readonly string[] }
    : immunityFor(operation, item, immunities))
  const blockerIndex = decisions.findIndex(decision => decision.blockedBy !== null)

  if (blockerIndex >= 0) {
    const blockingItem = items[blockerIndex]!
    const blockingSource = decisions[blockerIndex]!.blockedBy!
    const coupledBlocker = {
      recipientId: blockingItem.work.recipient.placement.id,
      source: blockingSource,
    }
    for (const [index, item] of items.entries()) {
      const blockedBy = decisions[index]!.blockedBy
      if (blockedBy) {
        item.work.blockers.push({ subject: item.stage, source: blockedBy })
      }
      item.work.redistributionPrevented = true
      recordChange(item, {
        outcome: blockedBy ? 'prevented' : 'no-op',
        blockedBy: blockedBy
          ? {
              recipientId: item.work.recipient.placement.id,
              source: blockedBy,
            }
          : coupledBlocker,
      })
    }
    return
  }

  for (const item of items) {
    if (item.delta === 0) {
      recordChange(item, { outcome: 'no-op' })
      continue
    }
    item.work.next[item.stage] = item.requested
    recordChange(item, { outcome: 'applied' })
  }
}

const naturalRollMatches = (
  trigger: Extract<NonNullable<MoveCombatStageEffectOperation['payload']['trigger']>, {
    readonly kind: 'accuracy-roll'
  }>['trigger'],
  naturalResult: number,
): boolean => trigger.kind === 'range'
  ? naturalResult >= trigger.minimum
  : trigger.values.includes(naturalResult)

const resolveCombatStageTrigger = (options: {
  readonly operation: MoveCombatStageEffectOperation
  readonly work: CombatStageRecipientWork
  readonly accuracyRolls?: MoveCombatStageAccuracyRollQueries
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
}): CombatStageTriggerAudit | null => {
  const trigger = options.operation.payload.trigger
  if (!trigger) return null
  if (trigger.kind === 'operation-outcome') {
    const prior = options.priorOperationResults.find(result => (
      result.operationId === trigger.operationId
    )) ?? failMoveCoreTokenEffectReduction(
      'invalid-stage-source',
      `Combat-stage operation ${options.operation.id} cannot find prior operation ${trigger.operationId}.`,
    )
    const matched = prior.outcome === trigger.outcome
    return {
      kind: trigger.kind,
      matched,
      applicationCount: matched ? 1 : 0,
      rollId: null,
      naturalResults: [],
      operationId: prior.operationId,
      operationOutcome: prior.outcome,
    }
  }

  const queries = options.accuracyRolls
    ?? failMoveCoreTokenEffectReduction(
      'invalid-stage-source',
      `Combat-stage operation ${options.operation.id} has no authoritative accuracy-roll query.`,
    )
  const rolls = queries.resolve({
    operation: options.operation,
    recipient: options.work.recipient,
  })
  if (trigger.scope === 'recipient' && rolls.length !== 1) {
    return failMoveCoreTokenEffectReduction(
      'invalid-stage-source',
      `Combat-stage operation ${options.operation.id} requires exactly one recipient accuracy roll.`,
    )
  }
  for (const roll of rolls) {
    if (
      !Number.isSafeInteger(roll.naturalResult)
      || roll.naturalResult < 1
      || roll.naturalResult > 20
    ) {
      return failMoveCoreTokenEffectReduction(
        'invalid-stage-source',
        `Combat-stage operation ${options.operation.id} resolved invalid natural d20 result ${roll.naturalResult}.`,
      )
    }
  }
  const matching = rolls.filter(roll => naturalRollMatches(trigger.trigger, roll.naturalResult))
  const applicationCount = trigger.application === 'per-match'
    ? matching.length
    : matching.length > 0 ? 1 : 0
  return {
    kind: trigger.kind,
    matched: applicationCount > 0,
    applicationCount,
    rollId: trigger.rollId,
    naturalResults: rolls.map(roll => roll.naturalResult),
    operationId: null,
    operationOutcome: null,
  }
}

const unaryRequestedValue = (
  operation: MoveCombatStageEffectOperation,
  current: number,
  applicationCount = 1,
): number => {
  switch (operation.payload.action) {
    case 'modify': return current + (operation.payload.value ?? 0) * applicationCount
    case 'set': return operation.payload.value ?? current
    case 'reset': return 0
    case 'invert': return -current
    case 'clear-positive': return current > 0 ? 0 : current
    case 'clear-negative': return current < 0 ? 0 : current
    default:
      return failMoveCoreTokenEffectReduction(
        'invalid-stage-source',
        `Combat-stage operation ${operation.id} requires grouped reduction for ${operation.payload.action}.`,
      )
  }
}

const applyUnaryOperation = (options: {
  readonly operation: MoveCombatStageEffectOperation
  readonly works: readonly CombatStageRecipientWork[]
  readonly stages: readonly CombatStageKey[]
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  readonly accuracyRolls?: MoveCombatStageAccuracyRollQueries
  readonly priorOperationResults: readonly MoveCoreTokenEffectOperationResult[]
}): void => {
  for (const work of options.works) {
    const trigger = resolveCombatStageTrigger({
      operation: options.operation,
      work,
      ...(options.accuracyRolls ? { accuracyRolls: options.accuracyRolls } : {}),
      priorOperationResults: options.priorOperationResults,
    })
    work.trigger = trigger
    if (trigger && !trigger.matched) continue
    for (const stage of options.stages) {
      applyIndependentRequest(
        options.operation,
        request(
          work,
          stage,
          unaryRequestedValue(
            options.operation,
            work.previous.stages[stage],
            trigger?.applicationCount ?? 1,
          ),
        ),
        options.immunities,
      )
    }
  }
}

const applyCopyOperation = (options: {
  readonly operation: MoveCombatStageEffectOperation
  readonly works: readonly CombatStageRecipientWork[]
  readonly source: MoveCoreTokenEffectRecipient
  readonly sourceStages: CombatStageMap
  readonly stages: readonly CombatStageKey[]
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): void => {
  for (const work of options.works) {
    if (work.recipient.placement.id !== options.source.placement.id) {
      work.consultedPlacementIds.add(options.source.placement.id)
    }
    for (const stage of options.stages) {
      applyIndependentRequest(
        options.operation,
        request(work, stage, options.sourceStages[stage]),
        options.immunities,
      )
    }
  }
}

const assertRedistributionRecipients = (options: {
  readonly operation: MoveCombatStageEffectOperation
  readonly works: readonly CombatStageRecipientWork[]
  readonly source: MoveCoreTokenEffectRecipient | undefined
}): void => {
  const { operation, works, source } = options
  if (operation.payload.action === 'split') {
    if (works.length >= 2) return
    failMoveCoreTokenEffectReduction(
      'invalid-stage-recipient-count',
      `Split combat-stage operation ${operation.id} requires at least two recipients.`,
    )
  }
  if (works.length !== 2) {
    failMoveCoreTokenEffectReduction(
      'invalid-stage-recipient-count',
      `${operation.payload.action} combat-stage operation ${operation.id} requires exactly two recipients.`,
    )
  }
  if (operation.payload.action !== 'transfer') return
  if (!source || !works.some(work => work.recipient.placement.id === source.placement.id)) {
    failMoveCoreTokenEffectReduction(
      'invalid-stage-source',
      `Transfer combat-stage operation ${operation.id} requires its source to be one of its two recipients.`,
    )
  }
}

const applyRedistributionOperation = (options: {
  readonly operation: MoveCombatStageEffectOperation
  readonly works: readonly CombatStageRecipientWork[]
  readonly source: MoveCoreTokenEffectRecipient | undefined
  readonly stages: readonly CombatStageKey[]
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): void => {
  assertRedistributionRecipients(options)
  const { operation, works } = options

  for (const stage of options.stages) {
    let requests: readonly CombatStageRequest[]
    if (operation.payload.action === 'swap') {
      requests = [
        request(works[0]!, stage, works[1]!.previous.stages[stage]),
        request(works[1]!, stage, works[0]!.previous.stages[stage]),
      ]
    }
    else if (operation.payload.action === 'split') {
      const rounding = operation.payload.rounding
        ?? failMoveCoreTokenEffectReduction(
          'invalid-stage-source',
          `Split combat-stage operation ${operation.id} has no rounding policy.`,
        )
      const total = works.reduce((sum, work) => sum + work.previous.stages[stage], 0)
      const average = rounded(total / works.length, rounding)
      requests = works.map(work => request(work, stage, average))
    }
    else {
      const sourceId = options.source!.placement.id
      const sourceWork = works.find(work => work.recipient.placement.id === sourceId)!
      const transferred = sourceWork.previous.stages[stage]
      requests = works.map(work => work === sourceWork
        ? request(work, stage, 0)
        : request(work, stage, work.previous.stages[stage] + transferred))
    }
    applyCoupledRequests(operation, requests, options.immunities)
  }
}

const combatStageDetails = (
  operation: MoveCombatStageEffectOperation,
  sourcePlacementId: string | null,
  work: CombatStageRecipientWork,
): MoveResolutionTraceJsonValue => ({
  action: operation.payload.action,
  sourcePlacementId,
  trigger: work.trigger ? {
    kind: work.trigger.kind,
    matched: work.trigger.matched,
    applicationCount: work.trigger.applicationCount,
    rollId: work.trigger.rollId,
    naturalResults: [...work.trigger.naturalResults],
    operationId: work.trigger.operationId,
    operationOutcome: work.trigger.operationOutcome,
  } : null,
  competitiveDelta: work.competitiveDelta,
  changes: work.changes.map(change => ({
    stage: change.stage,
    previous: change.previous,
    unboundedRequested: change.unboundedRequested,
    requested: change.requested,
    current: change.current,
    requestedDelta: change.requestedDelta,
    appliedDelta: change.appliedDelta,
    capped: change.capped,
    outcome: change.outcome,
    blockedBy: change.blockedBy,
  })),
})

const finalizeWork = (options: {
  readonly operation: MoveCombatStageEffectOperation
  readonly work: CombatStageRecipientWork
  readonly accumulator: MoveAutomationCombatStageUpdateAccumulator
  readonly sourcePlacementId: string | null
}): MoveCoreTokenEffectRecipientResult => {
  const { operation, work, accumulator } = options
  const competitive = aa064ApplyCompetitive({
    recipientId: work.recipient.placement.id,
    sourceOwnerId: work.sourceOwnerId,
    previous: work.previous.stages,
    next: work.next,
    abilities: work.abilityRules,
  })
  if (competitive.appliedDelta !== 0) {
    for (const stage of COMBAT_STAGE_KEYS) work.next[stage] = competitive.stages[stage]
    work.competitiveDelta = competitive.appliedDelta
  }
  const changed = COMBAT_STAGE_KEYS.some(stage => (
    work.next[stage] !== work.previous.stages[stage]
  ))
  if (changed) accumulator.set(work.recipient.token, work.next)
  const current = changed
    ? combatStageSnapshot(accumulator, work.recipient)
    : work.previous
  const details = combatStageDetails(operation, options.sourcePlacementId, work)

  if (!changed) {
    const prevented = work.blockers.length > 0
    return {
      recipientId: work.recipient.placement.id,
      outcome: prevented ? 'prevented' : 'no-op',
      reasonCode: prevented
        ? 'combat-stage-immunity'
        : work.trigger && !work.trigger.matched
          ? 'combat-stage-trigger-not-met'
          : work.redistributionPrevented
            ? 'combat-stage-redistribution-prevented'
            : 'combat-stage-unchanged',
      blockers: work.blockers,
      details,
      consultedPlacementIds: [...work.consultedPlacementIds],
      previous: work.previous,
      current,
      changedFields: [],
    }
  }

  return {
    recipientId: work.recipient.placement.id,
    outcome: 'applied',
    reasonCode: operation.reasonCode,
    blockers: work.blockers,
    details,
    consultedPlacementIds: [...work.consultedPlacementIds],
    previous: work.previous,
    current,
    changedFields: ['combatStages'],
  }
}

/** Reduce one complete combat-stage operation from operation-entry snapshots. */
export const reduceCombatStageEffect = (options: {
  readonly operation: MoveCombatStageEffectOperation
  readonly recipients: readonly MoveCoreTokenEffectRecipient[]
  readonly sourceRecipient?: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationCombatStageUpdateAccumulator
  readonly immunities: MoveCoreTokenEffectImmunityQueries
  readonly accuracyRolls?: MoveCombatStageAccuracyRollQueries
  readonly priorOperationResults?: readonly MoveCoreTokenEffectOperationResult[]
  /** Owner of the Move/Ability that authored this operation; null is an external system source. */
  readonly sourceOwnerId?: string | null
  readonly abilityRules?: Aa064StageAbilityQueries
}): readonly MoveCoreTokenEffectRecipientResult[] => {
  const { operation, recipients, accumulator } = options
  const works = recipients.map(recipient => createWork(accumulator, recipient, {
    sourceOwnerId: options.sourceOwnerId ?? null,
    ...(options.abilityRules ? { abilityRules: options.abilityRules } : {}),
  }))
  const stages = operationStages(operation)
  const action = operation.payload.action

  if (action === 'copy') {
    const source = options.sourceRecipient
      ?? failMoveCoreTokenEffectReduction(
        'invalid-stage-source',
        `Copy combat-stage operation ${operation.id} has no source.`,
      )
    const sourceStages = combatStageSnapshot(accumulator, source).stages
    applyCopyOperation({
      operation,
      works,
      source,
      sourceStages,
      stages,
      immunities: options.immunities,
    })
  }
  else if (REDISTRIBUTION_ACTIONS.has(action)) {
    applyRedistributionOperation({
      operation,
      works,
      source: options.sourceRecipient,
      stages,
      immunities: options.immunities,
    })
  }
  else {
    applyUnaryOperation({
      operation,
      works,
      stages,
      immunities: options.immunities,
      ...(options.accuracyRolls ? { accuracyRolls: options.accuracyRolls } : {}),
      priorOperationResults: options.priorOperationResults ?? [],
    })
  }

  const sourcePlacementId = options.sourceRecipient?.placement.id ?? null
  return works.map(work => finalizeWork({
    operation,
    work,
    accumulator,
    sourcePlacementId,
  }))
}

/** Recipient-local compatibility seam used by bounded multi-hit follow-ups. */
export const reduceCombatStageEffectForRecipient = (options: {
  readonly operation: MoveCombatStageEffectOperation
  readonly recipient: MoveCoreTokenEffectRecipient
  readonly accumulator: MoveAutomationCombatStageUpdateAccumulator
  readonly immunities: MoveCoreTokenEffectImmunityQueries
}): MoveCoreTokenEffectRecipientResult => {
  if (options.operation.payload.action === 'copy' || REDISTRIBUTION_ACTIONS.has(
    options.operation.payload.action,
  )) {
    return failMoveCoreTokenEffectReduction(
      'invalid-stage-recipient-count',
      `Combat-stage action ${options.operation.payload.action} cannot be reduced as a recipient-local follow-up.`,
    )
  }
  return reduceCombatStageEffect({
    operation: options.operation,
    recipients: [options.recipient],
    accumulator: options.accumulator,
    immunities: options.immunities,
  })[0]!
}
