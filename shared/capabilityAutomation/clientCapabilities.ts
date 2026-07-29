import type { CapabilityActionEconomy, CapabilityFrequency } from './manifest'
import type { CapabilityParameters } from './catalog'

export interface CapabilityClientSourceContribution {
  readonly kind: string
  readonly label: string
  readonly value: number | null
}

export interface CapabilityClientFact {
  readonly instanceId: string
  readonly canonicalId: string
  readonly displayName: string
  readonly active: boolean
  readonly value: number | null
  readonly parameters: CapabilityParameters
  readonly semanticTags: readonly string[]
  readonly sourceEffect: string
  /** Owner/GM-authorized current-world information produced by a passive provider. */
  readonly contextualSummary: string | null
  readonly sources: readonly CapabilityClientSourceContribution[]
  readonly suppressionReasons: readonly string[]
}

export interface CapabilityClientSelectionOption {
  readonly kind: 'object' | 'device' | 'keystone' | 'egg' | 'trainer'
  readonly value: string
  readonly label: string
}

export interface CapabilityClientActionOffer {
  readonly offerId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly actorPlacementId: string
  readonly capabilityInstanceId: string
  readonly canonicalId: string
  readonly actionId: string
  readonly label: string
  readonly economy: CapabilityActionEconomy
  readonly frequency: CapabilityFrequency
  readonly mechanic: string
  readonly contextPredicateId: string
  readonly requiresGmConfirmation: boolean
  readonly available: boolean
  readonly unavailableReasonCodes: readonly string[]
  /** Owner/GM-authorized exact world-resource choices for typed controls. */
  readonly selectionOptions?: readonly CapabilityClientSelectionOption[]
}

export interface CapabilityClientPendingAdjudication {
  readonly requestId: string
  readonly actorPlacementId: string
  readonly capabilityInstanceId: string
  readonly canonicalId: string
  readonly actionId: string
  readonly requestedAt: number
  readonly expiresAt: number
}

export interface CapabilityClientPrivateNotice {
  readonly noticeId: string
  readonly canonicalId: string
  readonly actionId: string
  readonly label: string
  readonly summary: string
  readonly sourcePlacementId: string
  readonly createdAt: number
}

export interface PlacementCapabilityClientBundle {
  readonly placementId: string
  readonly facts: readonly CapabilityClientFact[]
  readonly offers: readonly CapabilityClientActionOffer[]
  readonly unresolvedLabels: readonly string[]
  readonly pendingAdjudications: readonly CapabilityClientPendingAdjudication[]
  /** Participant-specific information derived before raw map authority is redacted. */
  readonly privateNotices: readonly CapabilityClientPrivateNotice[]
}

export interface CapabilityClientCapabilityBundle {
  readonly schemaVersion: 1
  readonly rulesetId: 'ptu-1.05-capability-automation'
  readonly mapSlug: string
  readonly mapRevision: number
  readonly placements: readonly PlacementCapabilityClientBundle[]
}
