import {
  encounterSettlementAudienceVisible,
  encounterSettlementDestinationProjectionKey,
  projectEncounterSettlementRewardPayload,
  type EncounterSettlementProjectedConsequence,
  type EncounterSettlementProjectedHistoryFact,
  type EncounterSettlementProjection,
  type EncounterSettlementProjectionContext,
} from '#shared/encounterSettlement/projection'
import {
  parseEncounterSettlementDocument,
  type EncounterSettlementDocument,
  type EncounterSettlementSnapshot,
} from '#shared/encounterSettlement/document'
import type { EncounterSettlementHistoryFact } from './atomicCommit'

export interface EncounterSettlementHistoryProjectionSource extends EncounterSettlementHistoryFact {
  readonly createdAtCampaignMinute: number
}

const emptySet = (): ReadonlySet<string> => new Set<string>()

export const publicEncounterSettlementProjectionContext = (): EncounterSettlementProjectionContext => ({
  audience: 'public',
  ownedParticipantIds: emptySet(),
  ownedDestinationKeys: emptySet(),
  ownedHistorySubjectIds: emptySet(),
})

export const gmEncounterSettlementProjectionContext = (): EncounterSettlementProjectionContext => ({
  audience: 'gm',
  ownedParticipantIds: emptySet(),
  ownedDestinationKeys: emptySet(),
  ownedHistorySubjectIds: emptySet(),
})

const snapshotValue = (
  snapshot: EncounterSettlementSnapshot,
  side: 'before' | 'after',
): number | boolean | string | readonly string[] | null => snapshot[side]

const destinationOwned = (
  settlement: EncounterSettlementDocument,
  rewardId: string,
  context: EncounterSettlementProjectionContext,
): boolean => settlement.allocations.some(allocation => (
  allocation.rewardId === rewardId
  && context.ownedDestinationKeys.has(encounterSettlementDestinationProjectionKey(
    allocation.destination.kind,
    allocation.destination.id,
  ))
))

const participantOwnedReward = (
  settlement: EncounterSettlementDocument,
  rewardId: string,
  context: EncounterSettlementProjectionContext,
): boolean => settlement.allocations.some(allocation => (
  allocation.rewardId === rewardId
  && allocation.destination.kind === 'participant'
  && context.ownedParticipantIds.has(allocation.destination.id)
))

const visibleAudience = (
  audience: 'public' | 'gm' | 'participant-owner' | 'destination-owner',
  context: EncounterSettlementProjectionContext,
  participantOwned = false,
  ownedDestination = false,
): boolean => encounterSettlementAudienceVisible({
  visibility: audience,
  context,
  participantOwned,
  destinationOwned: ownedDestination,
})

export const projectEncounterSettlement = (input: {
  readonly settlement: EncounterSettlementDocument
  readonly context: EncounterSettlementProjectionContext
}): EncounterSettlementProjection => {
  const settlement = parseEncounterSettlementDocument(input.settlement)
  const context = input.context
  const rewards = settlement.rewardPackage.lines.flatMap((line) => {
    const participantOwned = participantOwnedReward(settlement, line.rewardId, context)
    const ownedDestination = destinationOwned(settlement, line.rewardId, context)
    if (!visibleAudience(line.visibility, context, participantOwned, ownedDestination)) return []
    return [projectEncounterSettlementRewardPayload({
      payload: line.payload,
      disposition: line.disposition,
      exposeNarrative: line.visibility === 'public' || context.audience === 'gm',
    })]
  })
  const unresolvedGates = settlement.unresolvedGates.flatMap((gate) => {
    const participantOwned = gate.participantIds.some(id => context.ownedParticipantIds.has(id))
    if (!visibleAudience(gate.audience, context, participantOwned, false)) return []
    return [Object.freeze({ kind: gate.kind, resolutionKinds: Object.freeze([...gate.resolutionKinds]) })]
  })
  const consequences: EncounterSettlementProjectedConsequence[] = settlement.persistentConsequences.flatMap((row) => {
    const owned = row.participantId !== null && context.ownedParticipantIds.has(row.participantId)
    if (context.audience !== 'gm' && !owned) return []
    return [Object.freeze({
      kind: row.kind,
      behavior: row.behavior,
      state: row.state,
      ...(context.audience === 'gm'
        ? {
            field: row.field,
            before: snapshotValue(row.snapshot, 'before'),
            after: snapshotValue(row.snapshot, 'after'),
          }
        : {}),
    })]
  })
  const cleanup = settlement.temporaryCleanup.map(row => Object.freeze({
    kind: row.kind,
    behavior: row.behavior,
    state: row.state,
  }))
  const visibleDecisions = settlement.decisions.filter((decision) => {
    const participantOwned = decision.subjects.some(subject => (
      subject.kind === 'consequence'
      && settlement.persistentConsequences.some(consequence => (
        consequence.consequenceId === subject.id
        && consequence.participantId !== null
        && context.ownedParticipantIds.has(consequence.participantId)
      ))
    ))
    const ownedDestination = decision.subjects.some(subject => (
      subject.kind === 'allocation'
      && settlement.allocations.some(allocation => (
        allocation.allocationId === subject.id
        && context.ownedDestinationKeys.has(encounterSettlementDestinationProjectionKey(
          allocation.destination.kind,
          allocation.destination.id,
        ))
      ))
    ))
    return visibleAudience(decision.audience, context, participantOwned, ownedDestination)
  })
  return Object.freeze({
    schemaVersion: 1,
    encounterId: settlement.encounter.encounterId,
    revision: settlement.revision,
    status: settlement.status,
    audience: context.audience,
    participantCount: settlement.participants.filter(row => row.disposition !== 'excluded').length,
    unresolvedGateCount: unresolvedGates.length,
    unresolvedGates: Object.freeze(unresolvedGates),
    rewards: Object.freeze(rewards),
    consequences: Object.freeze(consequences),
    cleanup: Object.freeze(cleanup),
    decisionCounts: Object.freeze({
      open: visibleDecisions.filter(row => row.status === 'open').length,
      accepted: visibleDecisions.filter(row => row.status === 'accepted').length,
    }),
    completion: Object.freeze({
      state: settlement.completion.state,
      completedEncounterRevision: settlement.completion.completedEncounterRevision,
      completedAtCampaignMinute: settlement.completion.completedAtCampaignMinute,
    }),
  })
}

const historyVisible = (
  fact: EncounterSettlementHistoryProjectionSource,
  context: EncounterSettlementProjectionContext,
): boolean => {
  if (context.audience === 'gm' || fact.audience === 'public') return true
  if (context.audience !== 'owner') return false
  if (fact.audience === 'gm') return false
  return context.ownedHistorySubjectIds.has(fact.subjectId)
}

const record = (value: unknown): Readonly<Record<string, unknown>> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {}
)

const boolean = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined
const number = (value: unknown): number | undefined => Number.isSafeInteger(value) && Number(value) >= 0
  ? Number(value)
  : undefined
const string = (value: unknown, maximum = 400): string | undefined => (
  typeof value === 'string' && value.length >= 1 && value.length <= maximum ? value : undefined
)
const compact = (value: Record<string, unknown>): Readonly<Record<string, unknown>> => Object.freeze(
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)),
)

const projectHistoryDetail = (
  fact: EncounterSettlementHistoryProjectionSource,
): Readonly<Record<string, unknown>> => {
  const payload = record(fact.payload)
  if (fact.kind === 'experience-award') return compact({
    amount: number(payload.amount),
    levelBefore: number(payload.levelBefore),
    levelAfter: number(payload.levelAfter),
  })
  if (fact.kind === 'loot-award') return compact({
    amount: number(payload.amount),
    canonicalItemId: string(payload.canonicalItemId, 200),
    serialized: boolean(payload.serialized),
  })
  if (fact.kind === 'capture-settled') return compact({
    caughtBallPreserved: boolean(payload.caughtBallPreserved),
  })
  if (fact.kind === 'outcome') return compact({
    kind: string(payload.kind, 100),
    mechanicalEffect: string(payload.mechanicalEffect, 100),
    summary: string(payload.summary, 1_000),
  })
  if (fact.kind === 'cleanup') return compact({
    sourceKind: string(payload.sourceKind, 100),
    action: string(payload.action, 100),
    changed: boolean(payload.changed),
  })
  return Object.freeze({})
}

export const projectEncounterSettlementHistory = (input: {
  readonly facts: readonly EncounterSettlementHistoryProjectionSource[]
  readonly context: EncounterSettlementProjectionContext
  readonly limit?: number
}): readonly EncounterSettlementProjectedHistoryFact[] => {
  const limit = input.limit ?? 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Encounter settlement history limit must be from 1 through 50.')
  }
  return Object.freeze(input.facts
    .filter(fact => historyVisible(fact, input.context))
    .sort((left, right) => (
      right.createdAtCampaignMinute - left.createdAtCampaignMinute
      || right.factId.localeCompare(left.factId)
    ))
    .slice(0, limit)
    .map(fact => Object.freeze({
      kind: fact.kind,
      resultCode: fact.resultCode,
      detail: projectHistoryDetail(fact),
      createdAtCampaignMinute: fact.createdAtCampaignMinute,
    })))
}
