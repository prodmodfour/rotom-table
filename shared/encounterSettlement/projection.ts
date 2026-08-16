import type {
  EncounterSettlementAudience,
  EncounterSettlementBehavior,
  EncounterSettlementCleanupKind,
  EncounterSettlementConsequenceKind,
  EncounterSettlementEntryState,
  EncounterSettlementGateKind,
  EncounterSettlementGateResolution,
  EncounterSettlementRewardPayload,
  EncounterSettlementStatus,
} from './document'

export const ENCOUNTER_SETTLEMENT_PROJECTION_SCHEMA_VERSION = 1 as const

export type EncounterSettlementProjectionAudience = 'public' | 'owner' | 'gm'

export type EncounterSettlementProjectedReward =
  | {
      readonly kind: 'experience' | 'money'
      readonly amount: number
      readonly disposition: 'pending' | 'allocated' | 'excluded' | 'committed'
    }
  | {
      readonly kind: 'item'
      readonly canonicalItemId: string
      readonly quantity: number
      readonly serialized: boolean
      readonly disposition: 'pending' | 'allocated' | 'excluded' | 'committed'
    }
  | {
      readonly kind: 'capture'
      readonly disposition: 'pending' | 'allocated' | 'excluded' | 'committed'
    }
  | {
      readonly kind: 'narrative'
      readonly summary: string
      readonly disposition: 'pending' | 'allocated' | 'excluded' | 'committed'
    }

export interface EncounterSettlementProjectedGate {
  readonly kind: EncounterSettlementGateKind
  readonly resolutionKinds: readonly EncounterSettlementGateResolution[]
}

export interface EncounterSettlementProjectedConsequence {
  readonly kind: EncounterSettlementConsequenceKind
  readonly behavior: EncounterSettlementBehavior
  readonly state: EncounterSettlementEntryState
  readonly field?: string
  readonly before?: number | boolean | string | readonly string[] | null
  readonly after?: number | boolean | string | readonly string[] | null
}

export interface EncounterSettlementProjectedCleanup {
  readonly kind: EncounterSettlementCleanupKind
  readonly behavior: EncounterSettlementBehavior
  readonly state: EncounterSettlementEntryState
}

export interface EncounterSettlementProjection {
  readonly schemaVersion: typeof ENCOUNTER_SETTLEMENT_PROJECTION_SCHEMA_VERSION
  readonly encounterId: string
  readonly revision: number
  readonly status: EncounterSettlementStatus
  readonly audience: EncounterSettlementProjectionAudience
  readonly participantCount: number
  readonly unresolvedGateCount: number
  readonly unresolvedGates: readonly EncounterSettlementProjectedGate[]
  readonly rewards: readonly EncounterSettlementProjectedReward[]
  readonly consequences: readonly EncounterSettlementProjectedConsequence[]
  readonly cleanup: readonly EncounterSettlementProjectedCleanup[]
  readonly decisionCounts: {
    readonly open: number
    readonly accepted: number
  }
  readonly completion: {
    readonly state: 'open' | 'accepted' | 'cancelled'
    readonly completedEncounterRevision: number | null
    readonly completedAtCampaignMinute: number | null
  }
}

export interface EncounterSettlementProjectedHistoryFact {
  readonly kind: 'experience-award' | 'loot-award' | 'capture-settled' | 'outcome' | 'cleanup' | 'completion'
  readonly resultCode: string
  readonly detail: Readonly<Record<string, unknown>>
  readonly createdAtCampaignMinute: number
}

export interface EncounterSettlementProjectionContext {
  readonly audience: EncounterSettlementProjectionAudience
  readonly ownedParticipantIds: ReadonlySet<string>
  readonly ownedDestinationKeys: ReadonlySet<string>
  readonly ownedHistorySubjectIds: ReadonlySet<string>
}

export const encounterSettlementDestinationProjectionKey = (
  kind: 'group' | 'side' | 'participant' | 'trainer-inventory' | 'pokemon-sheet' | 'group-inventory' | 'profile',
  id: string,
): string => `${kind}:${id}`

export const encounterSettlementAudienceVisible = (input: {
  readonly visibility: EncounterSettlementAudience
  readonly context: EncounterSettlementProjectionContext
  readonly participantOwned: boolean
  readonly destinationOwned: boolean
}): boolean => {
  if (input.context.audience === 'gm') return true
  if (input.visibility === 'public') return true
  if (input.context.audience !== 'owner') return false
  if (input.visibility === 'participant-owner') return input.participantOwned
  if (input.visibility === 'destination-owner') return input.destinationOwned
  return false
}

export const projectEncounterSettlementRewardPayload = (input: {
  readonly payload: EncounterSettlementRewardPayload
  readonly disposition: 'pending' | 'allocated' | 'excluded' | 'committed'
  readonly exposeNarrative: boolean
}): EncounterSettlementProjectedReward => {
  const { payload, disposition } = input
  if (payload.kind === 'experience' || payload.kind === 'money') {
    return Object.freeze({ kind: payload.kind, amount: payload.amount, disposition })
  }
  if (payload.kind === 'item') {
    return Object.freeze({
      kind: 'item',
      canonicalItemId: payload.canonicalItemId,
      quantity: payload.quantity,
      serialized: payload.serialized,
      disposition,
    })
  }
  if (payload.kind === 'capture') return Object.freeze({ kind: 'capture', disposition })
  return Object.freeze({
    kind: 'narrative',
    summary: input.exposeNarrative ? payload.note : 'Private narrative outcome',
    disposition,
  })
}
