import { normalizeRevision } from '#shared/sessionRevisions'
import type { AbilityActionVariant } from '#shared/abilityAutomation/actionEconomy'
import {
  abilityReactionCheckpointDefinition,
  type AbilityReactionTiming,
} from '#shared/abilityAutomation/reactions'
import {
  ABILITY_REACTION_AVAILABILITY_LIMITS,
  ABILITY_REACTION_AVAILABILITY_POOL,
  advanceAbilityReactionAvailabilityRound,
  createEmptyAbilityReactionAvailabilityLedger,
  isAbilityReactionAvailabilityReady,
  parseAbilityReactionAvailabilityLedger,
  type AbilityReactionRoundCursor,
} from '#shared/abilityAutomation/reactionResources'
import type { AbilityEventCheckpoint } from '#shared/abilityAutomation/events'
import { createEmptyEncounterState, parseEncounterState } from '#shared/moveAutomation/encounterState'
import type { AuthoritativeAbilityContext } from './context'
import type { AbilitySubscriptionRoute } from './subscriptionRouter'
import {
  RESTORE_PREVIOUS_MOVE_STATE_VALUE,
  createMoveStateChangePlan,
  type MoveStateChangePlan,
} from '../moveAutomation/plan'

export interface AbilityReactionCandidate {
  readonly windowId: string
  readonly eventId: string
  readonly checkpoint: AbilityEventCheckpoint
  readonly timing: AbilityReactionTiming
  readonly priority: number
  readonly ownerPlacementId: string
  readonly canonicalId: string
  readonly abilityInstanceId: string
  readonly subscriptionId: string
  readonly modeId: string
  readonly availabilityPool: typeof ABILITY_REACTION_AVAILABILITY_POOL
  readonly runtimeVersion: number
  readonly definitionHash: string
  readonly sourceModule: string
}

export interface AbilityReactionArbitrationResult {
  readonly ordered: readonly AbilityReactionCandidate[]
  readonly unavailableWindowIds: readonly string[]
  readonly next: AbilityReactionCandidate | null
}

export interface AbilityReactionAvailabilitySpendResult {
  readonly status: 'spent' | 'duplicate'
  readonly plan: MoveStateChangePlan
}

export type AbilityReactionErrorCode =
  | 'invalid-candidate'
  | 'mixed-checkpoint'
  | 'duplicate-window'
  | 'owner-mismatch'
  | 'availability-uninitialized'
  | 'availability-spent'
  | 'operation-id-conflict'
  | 'limit-exceeded'

export class AbilityReactionError extends Error {
  constructor(readonly code: AbilityReactionErrorCode, detail: string) {
    super(detail)
    this.name = 'AbilityReactionError'
  }
}

const fail = (code: AbilityReactionErrorCode, detail: string): never => {
  throw new AbilityReactionError(code, detail)
}
const compareText = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1

export const createAbilityReactionCandidate = (input: {
  readonly windowId: string
  readonly route: AbilitySubscriptionRoute
  readonly actionVariant: AbilityActionVariant
}): AbilityReactionCandidate => {
  const { route, actionVariant } = input
  if ((actionVariant.timing !== 'interrupt' && actionVariant.timing !== 'reaction')
    || actionVariant.availabilityPool !== ABILITY_REACTION_AVAILABILITY_POOL
    || route.response !== 'optional') {
    fail('invalid-candidate', 'Reaction candidates require an optional reactive action variant and shared pool.')
  }
  abilityReactionCheckpointDefinition(route.checkpoint)
  const timing = actionVariant.timing as AbilityReactionTiming
  return Object.freeze({
    windowId: input.windowId,
    eventId: route.eventId,
    checkpoint: route.checkpoint,
    timing,
    priority: route.priority,
    ownerPlacementId: route.ownerPlacementId,
    canonicalId: route.canonicalId,
    abilityInstanceId: route.abilityInstanceId,
    subscriptionId: route.subscriptionId,
    modeId: route.modeId,
    availabilityPool: ABILITY_REACTION_AVAILABILITY_POOL,
    runtimeVersion: route.runtimeVersion,
    definitionHash: route.definitionHash,
    sourceModule: route.sourceModule,
  })
}

/** Interrupts precede Reactions at one exact checkpoint; stable source identity breaks priority ties. */
export const orderAbilityReactionCandidates = (
  candidates: readonly AbilityReactionCandidate[],
): readonly AbilityReactionCandidate[] => {
  if (candidates.length === 0) return Object.freeze([])
  const eventId = candidates[0]!.eventId
  const checkpoint = candidates[0]!.checkpoint
  if (candidates.some(candidate => candidate.eventId !== eventId || candidate.checkpoint !== checkpoint)) {
    fail('mixed-checkpoint', 'Reaction arbitration may cover only one exact event checkpoint.')
  }
  if (new Set(candidates.map(candidate => candidate.windowId)).size !== candidates.length) {
    fail('duplicate-window', 'Reaction arbitration cannot repeat window IDs.')
  }
  return Object.freeze([...candidates].sort((left, right) => (
    (left.timing === right.timing ? 0 : left.timing === 'interrupt' ? -1 : 1)
    || right.priority - left.priority
    || compareText(left.canonicalId, right.canonicalId)
    || compareText(left.ownerPlacementId, right.ownerPlacementId)
    || compareText(left.abilityInstanceId, right.abilityInstanceId)
    || compareText(left.subscriptionId, right.subscriptionId)
    || compareText(left.windowId, right.windowId)
  )))
}

export const arbitrateAbilityReactionCandidates = (input: {
  readonly candidates: readonly AbilityReactionCandidate[]
  readonly availabilityLedger: unknown
}): AbilityReactionArbitrationResult => {
  const ledger = parseAbilityReactionAvailabilityLedger(input.availabilityLedger)
  if (ledger.roundId === null) fail('availability-uninitialized', 'Reaction availability requires an active round.')
  const orderedAll = orderAbilityReactionCandidates(input.candidates)
  const ordered: AbilityReactionCandidate[] = []
  const unavailableWindowIds: string[] = []
  for (const candidate of orderedAll) {
    if (isAbilityReactionAvailabilityReady(ledger, candidate.ownerPlacementId)) ordered.push(candidate)
    else unavailableWindowIds.push(candidate.windowId)
  }
  return Object.freeze({
    ordered: Object.freeze(ordered),
    unavailableWindowIds: Object.freeze(unavailableWindowIds),
    next: ordered[0] ?? null,
  })
}

/** Spend the owner-wide Interrupt/Reaction pool atomically in encounter state. */
export const planAbilityReactionAvailabilitySpend = (input: {
  readonly context: AuthoritativeAbilityContext
  readonly cursor: AbilityReactionRoundCursor
  readonly ownerPlacementId: string
  readonly operationId: string
}): AbilityReactionAvailabilitySpendResult => {
  if (input.context.actor.placement.id !== input.ownerPlacementId) {
    fail('owner-mismatch', 'Only the authoritative ability owner can spend reaction availability.')
  }
  const previous = parseEncounterState(
    input.context.map.encounterState ?? createEmptyEncounterState(),
  )
  const ledger = advanceAbilityReactionAvailabilityRound(
    previous.abilityReactionAvailability ?? createEmptyAbilityReactionAvailabilityLedger(),
    input.cursor,
  )
  const operationReceipts = ledger.receipts.filter(receipt => receipt.operationId === input.operationId)
  const duplicate = operationReceipts.find(receipt => (
    receipt.ownerPlacementId === input.ownerPlacementId
    && receipt.sceneId === input.cursor.sceneId
    && receipt.roundId === input.cursor.roundId
    && receipt.roundSequence === input.cursor.roundSequence
  ))
  if (duplicate) return Object.freeze({ status: 'duplicate', plan: createMoveStateChangePlan([]) })
  if (operationReceipts.length > 0) {
    fail('operation-id-conflict', 'Reaction operation ID already belongs to another availability spend.')
  }
  if (!isAbilityReactionAvailabilityReady(ledger, input.ownerPlacementId)) {
    fail('availability-spent', 'Interrupt/Reaction availability is already spent this round.')
  }
  if (ledger.entries.length >= ABILITY_REACTION_AVAILABILITY_LIMITS.entries
    || ledger.receipts.length >= ABILITY_REACTION_AVAILABILITY_LIMITS.receipts) {
    fail('limit-exceeded', 'Reaction availability ledger budget is exhausted.')
  }
  const abilityReactionAvailability = parseAbilityReactionAvailabilityLedger({
    ...ledger,
    entries: [...ledger.entries, {
      ownerPlacementId: input.ownerPlacementId,
      pool: ABILITY_REACTION_AVAILABILITY_POOL,
      spentByOperationId: input.operationId,
    }],
    receipts: [...ledger.receipts, {
      operationId: input.operationId,
      ownerPlacementId: input.ownerPlacementId,
      pool: ABILITY_REACTION_AVAILABILITY_POOL,
      sceneId: input.cursor.sceneId,
      roundId: input.cursor.roundId,
      roundSequence: input.cursor.roundSequence,
    }],
  })
  const current = parseEncounterState({ ...previous, abilityReactionAvailability })
  return Object.freeze({
    status: 'spent',
    plan: createMoveStateChangePlan([{
      kind: 'encounter-state',
      scope: { kind: 'encounter', mapSlug: input.context.map.slug },
      expectedRevision: normalizeRevision(input.context.map.revision),
      sourceOperationId: input.operationId,
      reasonCode: 'ability-action.interrupt-reaction-spent',
      previous,
      current,
      compensation: RESTORE_PREVIOUS_MOVE_STATE_VALUE,
    }]),
  })
}
