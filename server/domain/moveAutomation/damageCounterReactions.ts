import type { MoveDirectHpEffectOperation } from '#shared/moveAutomation/effects'
import { moveCounterReactionDefinition } from './counterReactionDefinitions'
import {
  MOVE_COUNTER_REACTION_LIMITS,
  assertCounterPlacement,
  assertCounterStableId,
  createCounterDirectHpOperation,
  createReactionAncestryLink,
  createReactionUsageSpend,
  deepFreezeCounterReaction,
  failCounterReaction,
  safeAddCounterHp,
  safeMultiplyCounterHp,
  uniqueRecordedDamage,
  type MoveCounterReactionAuthority,
  type MoveReactionResolutionLink,
  type MoveReactionUsageSpend,
  type MoveRecordedEffectiveDamage,
} from './counterReactionCore'

export interface MoveCounterDamageAdjustment {
  readonly triggeringResolutionId: string
  readonly targetPlacementId: string
  readonly resistanceSteps: 1
  readonly reasonCode: string
}

export interface MoveCounterRetaliationPlan {
  readonly operation: MoveDirectHpEffectOperation
  readonly recipientIds: readonly string[]
  readonly damageClass: 'physical' | 'special'
  readonly moveType: 'fighting' | 'psychic'
  readonly triggeringResolutionId: string
  readonly reactionResolutionId: string
}

export interface MoveDamageCounterApplication {
  readonly reactionOperationId: string
  readonly canonicalMoveId: 'Counter' | 'Mirror Coat'
  readonly reactorPlacementId: string
  readonly triggeringResolutionId: string
  readonly reactionResolutionId: string
  readonly ancestry: MoveReactionResolutionLink
  readonly triggerDamageClass: 'physical' | 'special'
  readonly triggerMoveType: string | null
  readonly damageEventIds: readonly string[]
  readonly recordedEffectiveHpLoss: number
  readonly responseHpLoss: number
  readonly outcome: 'applied' | 'reactor-fainted' | 'target-immune'
  readonly reasonCode: string
  readonly retaliationOperationId: string | null
}

export interface MoveDamageCounterLedger {
  readonly adjustments: readonly MoveCounterDamageAdjustment[]
  readonly usageSpends: readonly MoveReactionUsageSpend[]
  readonly retaliationPlans: readonly MoveCounterRetaliationPlan[]
  readonly applications: readonly MoveDamageCounterApplication[]
}

export type ApplyMoveDamageCounterResult =
  | {
      readonly status: 'applied' | 'prevented'
      readonly reasonCode: string
      readonly ledger: MoveDamageCounterLedger
      readonly application: MoveDamageCounterApplication
    }
  | {
      readonly status: 'duplicate'
      readonly reasonCode: 'counter-reaction-duplicate'
      readonly ledger: MoveDamageCounterLedger
      readonly application: MoveDamageCounterApplication
    }
  | {
      readonly status: 'ineligible'
      readonly reasonCode: 'counter-trigger-class-mismatch'
      readonly ledger: MoveDamageCounterLedger
      readonly application: null
    }

const counterDamageEvidence = (input: {
  readonly records: readonly MoveRecordedEffectiveDamage[]
  readonly reactorPlacementId: string
}): {
  readonly records: readonly MoveRecordedEffectiveDamage[]
  readonly triggeringResolutionId: string
  readonly sourcePlacementId: string
  readonly damageClass: 'physical' | 'special' | 'direct'
  readonly moveType: string | null
  readonly effectiveHpLoss: number
} => {
  const records = uniqueRecordedDamage(input.records)
  const first = records[0]!
  let effectiveHpLoss = 0
  for (const record of records) {
    if (
      record.resolutionId !== first.resolutionId
      || record.sourcePlacementId !== first.sourcePlacementId
      || record.targetPlacementId !== input.reactorPlacementId
      || record.damageClass !== first.damageClass
      || record.moveType !== first.moveType
    ) {
      return failCounterReaction(
        'invalid-damage-record',
        'Counter damage records must belong to one triggering move, source, recipient, class, and type.',
      )
    }
    effectiveHpLoss = safeAddCounterHp(
      effectiveHpLoss,
      record.effectiveHpLoss,
      `Triggering resolution ${first.resolutionId}`,
    )
  }
  return {
    records,
    triggeringResolutionId: first.resolutionId,
    sourcePlacementId: first.sourcePlacementId,
    damageClass: first.damageClass,
    moveType: first.moveType,
    effectiveHpLoss,
  }
}

export const createMoveDamageCounterLedger = (): MoveDamageCounterLedger => (
  deepFreezeCounterReaction({
    adjustments: [],
    usageSpends: [],
    retaliationPlans: [],
    applications: [],
  })
)

const existingDamageCounterApplication = (input: {
  readonly ledger: MoveDamageCounterLedger
  readonly reactionOperationId: string
  readonly canonicalMoveId: 'Counter' | 'Mirror Coat'
  readonly reactorPlacementId: string
  readonly triggeringResolutionId: string
  readonly reactionResolutionId: string
}): MoveDamageCounterApplication | null => {
  const byOperation = input.ledger.applications.find(
    application => application.reactionOperationId === input.reactionOperationId,
  )
  if (byOperation) {
    if (
      byOperation.canonicalMoveId !== input.canonicalMoveId
      || byOperation.reactorPlacementId !== input.reactorPlacementId
      || byOperation.triggeringResolutionId !== input.triggeringResolutionId
      || byOperation.reactionResolutionId !== input.reactionResolutionId
    ) {
      return failCounterReaction(
        'reaction-identity-conflict',
        `Reaction operation ${input.reactionOperationId} was reused with different ancestry.`,
      )
    }
    return byOperation
  }
  const alreadyCountered = input.ledger.applications.find(application => (
    application.canonicalMoveId === input.canonicalMoveId
    && application.reactorPlacementId === input.reactorPlacementId
    && application.triggeringResolutionId === input.triggeringResolutionId
  ))
  if (alreadyCountered) {
    return failCounterReaction(
      'reaction-identity-conflict',
      `Triggering resolution ${input.triggeringResolutionId} was already claimed by ${alreadyCountered.reactionOperationId}.`,
    )
  }
  const childConflict = input.ledger.applications.find(
    application => application.reactionResolutionId === input.reactionResolutionId,
  )
  if (childConflict) {
    return failCounterReaction(
      'reaction-identity-conflict',
      `Reaction resolution ${input.reactionResolutionId} already has another parent.`,
    )
  }
  return null
}

/**
 * Resolve Counter or Mirror Coat from actual post-resistance damage evidence.
 * Damage event identity and response operation identity make retries harmless.
 */
export const applyMoveDamageCounterReaction = (input: {
  readonly authority: MoveCounterReactionAuthority
  readonly ledger: MoveDamageCounterLedger
  readonly canonicalMoveId: 'Counter' | 'Mirror Coat'
  readonly reactorPlacementId: string
  readonly reactionOperationId: string
  readonly reactionResolutionId: string
  readonly damageRecords: readonly MoveRecordedEffectiveDamage[]
  readonly reactorFainted: boolean
}): ApplyMoveDamageCounterResult => {
  assertCounterPlacement(input.authority, input.reactorPlacementId, 'Counter reactor')
  const reactionOperationId = assertCounterStableId(
    input.reactionOperationId,
    'reaction operation ID',
  )
  const reactionResolutionId = assertCounterStableId(
    input.reactionResolutionId,
    'reaction resolution ID',
  )
  const definition = moveCounterReactionDefinition(input.canonicalMoveId)
  const evidence = counterDamageEvidence({
    records: input.damageRecords,
    reactorPlacementId: input.reactorPlacementId,
  })
  assertCounterPlacement(input.authority, evidence.sourcePlacementId, 'Triggering source')

  const existing = existingDamageCounterApplication({
    ledger: input.ledger,
    reactionOperationId,
    canonicalMoveId: input.canonicalMoveId,
    reactorPlacementId: input.reactorPlacementId,
    triggeringResolutionId: evidence.triggeringResolutionId,
    reactionResolutionId,
  })
  if (existing) {
    return Object.freeze({
      status: 'duplicate',
      reasonCode: 'counter-reaction-duplicate',
      ledger: input.ledger,
      application: existing,
    })
  }
  if (input.ledger.applications.length >= MOVE_COUNTER_REACTION_LIMITS.applications) {
    return failCounterReaction(
      'limit-exceeded',
      'Counter reaction application bound was exceeded.',
    )
  }
  if (evidence.damageClass !== definition.triggerDamageClass) {
    return Object.freeze({
      status: 'ineligible',
      reasonCode: 'counter-trigger-class-mismatch',
      ledger: input.ledger,
      application: null,
    })
  }

  const responseHpLoss = safeMultiplyCounterHp(
    evidence.effectiveHpLoss,
    definition.effectiveHpLossMultiplier,
    `${definition.canonicalId} response HP loss`,
  )
  const targetImmune = input.authority.isTypeImmune(
    evidence.sourcePlacementId,
    definition.responseType,
  )
  const outcome: MoveDamageCounterApplication['outcome'] = input.reactorFainted
    ? 'reactor-fainted'
    : targetImmune
      ? 'target-immune'
      : 'applied'
  const reasonCode = outcome === 'reactor-fainted'
    ? `${definition.definitionId}.reactor-fainted`
    : outcome === 'target-immune'
      ? `${definition.definitionId}.${definition.responseType}-immunity`
      : `${definition.definitionId}.counter-applied`
  const retaliation = outcome === 'applied'
    ? createCounterDirectHpOperation({
        operationId: reactionOperationId,
        definitionId: definition.definitionId,
        amount: responseHpLoss,
        recipients: 'selected-targets',
        applyTypeImmunity: true,
      })
    : null
  const ancestry = createReactionAncestryLink(
    evidence.triggeringResolutionId,
    reactionResolutionId,
  )
  const application: MoveDamageCounterApplication = deepFreezeCounterReaction({
    reactionOperationId,
    canonicalMoveId: definition.canonicalId,
    reactorPlacementId: input.reactorPlacementId,
    triggeringResolutionId: evidence.triggeringResolutionId,
    reactionResolutionId,
    ancestry,
    triggerDamageClass: definition.triggerDamageClass,
    triggerMoveType: evidence.moveType,
    damageEventIds: evidence.records.map(record => record.eventId),
    recordedEffectiveHpLoss: evidence.effectiveHpLoss,
    responseHpLoss,
    outcome,
    reasonCode,
    retaliationOperationId: retaliation?.id ?? null,
  })
  const ledger: MoveDamageCounterLedger = deepFreezeCounterReaction({
    adjustments: [
      ...input.ledger.adjustments,
      {
        triggeringResolutionId: evidence.triggeringResolutionId,
        targetPlacementId: input.reactorPlacementId,
        resistanceSteps: definition.resistanceSteps,
        reasonCode: `${definition.definitionId}.resist-trigger-one-step`,
      },
    ],
    usageSpends: [
      ...input.ledger.usageSpends,
      createReactionUsageSpend({
        reactionOperationId,
        ownerPlacementId: input.reactorPlacementId,
        canonicalMoveId: definition.canonicalId,
      }),
    ],
    retaliationPlans: retaliation
      ? [
          ...input.ledger.retaliationPlans,
          {
            operation: retaliation,
            recipientIds: [evidence.sourcePlacementId],
            damageClass: definition.responseDamageClass,
            moveType: definition.responseType,
            triggeringResolutionId: evidence.triggeringResolutionId,
            reactionResolutionId,
          },
        ]
      : [...input.ledger.retaliationPlans],
    applications: [...input.ledger.applications, application],
  })
  return Object.freeze({
    status: outcome === 'applied' ? 'applied' : 'prevented',
    reasonCode,
    ledger,
    application,
  })
}
