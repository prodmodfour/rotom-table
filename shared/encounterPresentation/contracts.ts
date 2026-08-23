import type { SheetKind } from '../sheets'
import type {
  EncounterActionCostKind,
  EncounterActionGroup,
  EncounterActionTimingKind,
  EncounterAnnouncementPriority,
  EncounterAvailabilityReasonCode,
  EncounterChangeKind,
  EncounterChangeOperation,
  EncounterChoiceKind,
  EncounterChoiceOrdering,
  EncounterContributionKind,
  EncounterInteractionRole,
  EncounterOutcomeKind,
  EncounterPendingStatus,
  EncounterPresentationTone,
  EncounterProjectionAudience,
  EncounterRuleSourceKind,
  EncounterTargetingKind,
  EncounterVfxKind,
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
} from './catalog'

export interface EncounterGridCell {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface RuleSourceRef {
  readonly sourceKind: EncounterRuleSourceKind
  readonly canonicalId: string
  readonly instanceId: string | null
  readonly displayName: string
  readonly referenceHref: string | null
}

export interface EncounterParticipantPresentationRef {
  readonly participantId: string
  readonly displayName: string
  readonly portraitUrl: string | null
  readonly sideId: string | null
  readonly sideLabel: string | null
  readonly sideAccent: string | null
  readonly sheetKind: SheetKind | null
  readonly statusLabels: readonly string[]
}

export interface EncounterPresentationCopy {
  readonly label: string
  readonly description: string | null
  readonly iconKey: string | null
  readonly tone: EncounterPresentationTone
}

export interface EncounterAvailabilityReason {
  readonly code: EncounterAvailabilityReasonCode
  readonly label: string
  readonly sources: readonly RuleSourceRef[]
  /** Diagnostic evidence is omitted from every non-diagnostic projection. */
  readonly diagnosticDetail: string | null
}

export interface EncounterAvailability {
  readonly status: 'available' | 'unavailable'
  readonly reasons: readonly EncounterAvailabilityReason[]
}

export interface EncounterActionTiming {
  readonly kind: EncounterActionTimingKind
  readonly label: string
  readonly triggerLabel: string | null
  readonly priority: number | null
}

export interface EncounterActionCost {
  readonly kind: EncounterActionCostKind
  readonly resourceId: string | null
  readonly amount: number
  readonly label: string
}

export interface EncounterTargetingSummary {
  readonly requirementId: string
  readonly kind: EncounterTargetingKind
  readonly minSelections: number
  readonly maxSelections: number
  readonly rangeLabel: string | null
  readonly relationshipLabel: string | null
  readonly requiresLineOfSight: boolean
  readonly requiresSpatialInput: boolean
}

export interface EncounterUsageSummary {
  readonly frequencyLabel: string | null
  readonly remaining: number | null
  readonly maximum: number | null
  readonly cooldownLabel: string | null
  readonly resetLabel: string | null
}

export interface EncounterActionIntentDescriptor {
  /** Stable server dispatch identity. It is never an executable rules program. */
  readonly actionId: string
  readonly input: 'immediate' | 'choices' | 'spatial'
}

export interface EncounterActionSelectionOption {
  readonly kind: 'object' | 'device' | 'keystone' | 'egg' | 'trainer' | 'participant' | 'cell'
  /** Exact targeting/choice requirement this option satisfies. */
  readonly requirementId?: string
  readonly value: string
  readonly label: string
  /** Server-authored safe preview copy; never a client-computed mechanical value. */
  readonly description?: string | null
  /** Target-specific authoritative costs, when choosing the option changes settlement. */
  readonly costs?: readonly EncounterActionCost[]
  /** Server-owned option availability. Browsers must not infer this from preview text. */
  readonly disabled?: boolean
  readonly unavailableReason?: EncounterAvailabilityReason | null
}

export interface EncounterFormChangeStatDeltaPreview {
  readonly statId: 'atk' | 'def' | 'satk' | 'sdef' | 'spd'
  readonly label: string
  readonly delta: number
}

export interface EncounterFormChangePreview {
  readonly kind: 'item-form-change'
  readonly fromFormLabel: string
  readonly toFormLabel: string
  readonly fromTypes: readonly string[]
  readonly toTypes: readonly string[]
  readonly abilityLabel: string
  readonly abilityRequiresChoice: boolean
  readonly statDeltas: readonly EncounterFormChangeStatDeltaPreview[]
  readonly durationLabel: 'Scene'
  readonly reversalLabel: string
  readonly acceptanceBoundaryLabel: string
}

export interface EncounterActionOffer {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly offerId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly actor: EncounterParticipantPresentationRef
  readonly source: RuleSourceRef
  readonly roles: readonly EncounterInteractionRole[]
  readonly group: EncounterActionGroup
  readonly groupOrder: number
  readonly offerOrder: number
  readonly timing: EncounterActionTiming
  readonly costs: readonly EncounterActionCost[]
  readonly targeting: readonly EncounterTargetingSummary[]
  readonly usage: EncounterUsageSummary
  readonly availability: EncounterAvailability
  readonly presentation: EncounterPresentationCopy
  readonly intent: EncounterActionIntentDescriptor
  /** Safe server-authored source location/context; raw source IDs remain undisplayed. */
  readonly sourceContextLabel?: string | null
  /** Authorized bounded resource identities consumed by typed action controls. */
  readonly selectionOptions?: readonly EncounterActionSelectionOption[]
  /** Safe server-authored mechanical comparison for a form-change decision. */
  readonly formChangePreview?: EncounterFormChangePreview | null
}

export interface EncounterDerivedFactValue {
  readonly kind: 'number' | 'text' | 'boolean'
  readonly numberValue: number | null
  readonly textValue: string | null
  readonly booleanValue: boolean | null
  readonly unit: string | null
}

export interface EncounterPassiveFact {
  readonly factId: string
  readonly factKey: string
  readonly value: EncounterDerivedFactValue
  readonly label: string
}

export interface EncounterPassiveSummary {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly summaryId: string
  readonly participant: EncounterParticipantPresentationRef
  readonly source: RuleSourceRef
  readonly roles: readonly EncounterInteractionRole[]
  readonly active: boolean
  readonly facts: readonly EncounterPassiveFact[]
  readonly presentation: EncounterPresentationCopy
  readonly explanation: EncounterContributionExplanation | null
}

export interface EncounterContextualAffordance {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly affordanceId: string
  readonly contextKind: 'participant' | 'terrain' | 'object' | 'shop' | 'inventory' | 'campaign' | 'encounter'
  readonly contextId: string
  readonly source: RuleSourceRef
  readonly actor: EncounterParticipantPresentationRef | null
  readonly linkedOfferId: string | null
  readonly availability: EncounterAvailability
  readonly presentation: EncounterPresentationCopy
}

export type EncounterChoiceOptionPreview =
  | { readonly kind: 'none' }
  | { readonly kind: 'participant'; readonly participant: EncounterParticipantPresentationRef }
  | { readonly kind: 'reference'; readonly source: RuleSourceRef }
  | { readonly kind: 'item'; readonly source: RuleSourceRef; readonly quantity: number | null }
  | { readonly kind: 'side'; readonly sideId: string; readonly label: string; readonly accent: string | null }
  | {
      readonly kind: 'spatial'
      readonly cells: readonly EncounterGridCell[]
      readonly destination: EncounterGridCell | null
      readonly path: readonly EncounterGridCell[]
      readonly direction: string | null
    }

export interface EncounterChoiceOption {
  readonly optionId: string
  readonly label: string
  readonly description: string | null
  readonly disabled: boolean
  readonly unavailableReason: EncounterAvailabilityReason | null
  readonly preview: EncounterChoiceOptionPreview
}

export interface EncounterChoiceCardinality {
  readonly minimum: number
  readonly maximum: number
}

export interface EncounterChoiceOffer {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly choiceOfferId: string
  readonly interactionId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly choiceId: string
  readonly kind: EncounterChoiceKind
  readonly prompt: string
  readonly helpText: string | null
  readonly cardinality: EncounterChoiceCardinality
  readonly ordering: EncounterChoiceOrdering
  readonly options: readonly EncounterChoiceOption[]
  readonly defaultOptionIds: readonly string[]
  readonly requiresConfirmation: boolean
  readonly allowPass: boolean
  readonly allowCancel: boolean
  readonly expiresAt: number | null
}

export interface EncounterPendingInteractionPublicView {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly projection: 'public'
  readonly interactionId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly status: EncounterPendingStatus
  readonly source: RuleSourceRef | null
  readonly actor: EncounterParticipantPresentationRef | null
  readonly prompt: string
  readonly outstandingChoiceCount: number
  readonly allowPass: boolean
  readonly allowCancel: boolean
  readonly expiresAt: number | null
  readonly announcement: EncounterScreenReaderAnnouncement
}

export interface EncounterPendingResponseIdentity {
  readonly interactionId: string
  readonly resolutionId: string
  readonly windowId: string
  readonly retryKey: string
}

export interface EncounterPendingRecoveryAction {
  readonly action: 'force-pass' | 'cancel' | 'expire' | 'retry' | 'correct'
  readonly actionId: string
  readonly label: string
  readonly enabled: boolean
  readonly unavailableReason: EncounterAvailabilityReason | null
}

export interface EncounterPendingInteractionAuthorizedView {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly projection: 'actor-owner' | 'responder-owner' | 'gm' | 'diagnostic'
  readonly interactionId: string
  readonly mapSlug: string
  readonly mapRevision: number
  readonly status: EncounterPendingStatus
  readonly source: RuleSourceRef | null
  readonly actor: EncounterParticipantPresentationRef | null
  readonly prompt: string
  readonly choices: readonly EncounterChoiceOffer[]
  readonly responseIdentity: EncounterPendingResponseIdentity
  readonly allowPass: boolean
  readonly allowCancel: boolean
  readonly expiresAt: number | null
  readonly recoveryActions: readonly EncounterPendingRecoveryAction[]
  readonly announcement: EncounterScreenReaderAnnouncement
}

export type EncounterPendingInteractionView =
  | EncounterPendingInteractionPublicView
  | EncounterPendingInteractionAuthorizedView

export interface EncounterChoiceSelection {
  readonly choiceId: string
  readonly optionIds: readonly string[]
}

export interface EncounterActionDeclarationIntent {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly intentId: string
  readonly offerId: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly actorParticipantId: string
  readonly actionId: string
  readonly selections: readonly EncounterChoiceSelection[]
}

export interface EncounterInteractionResponseIntent {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly responseId: string
  readonly interactionId: string
  readonly resolutionId: string
  readonly windowId: string
  readonly retryKey: string
  readonly mapSlug: string
  readonly baseRevision: number
  readonly decision: 'choose' | 'pass' | 'cancel' | 'force-pass'
  readonly selections: readonly EncounterChoiceSelection[]
}

export interface EncounterContributionRow {
  readonly contributionId: string
  readonly order: number
  readonly kind: EncounterContributionKind
  readonly source: RuleSourceRef | null
  readonly label: string
  readonly value: EncounterDerivedFactValue | null
  readonly applied: boolean
  readonly private: boolean
  readonly preventionReason: EncounterAvailabilityReason | null
}

export interface EncounterContributionExplanation {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly explanationId: string
  readonly subjectId: string
  readonly label: string
  readonly result: EncounterDerivedFactValue
  readonly contributions: readonly EncounterContributionRow[]
}

export interface EncounterOutcomeFact {
  readonly outcomeId: string
  readonly kind: EncounterOutcomeKind
  readonly participantId: string | null
  readonly label: string
  readonly tone: EncounterPresentationTone
  readonly preventedBy: readonly RuleSourceRef[]
}

export interface EncounterChangeFact {
  readonly changeId: string
  readonly kind: EncounterChangeKind
  readonly operation: EncounterChangeOperation
  readonly participantId: string | null
  readonly subjectId: string
  readonly field: string
  readonly before: EncounterDerivedFactValue | null
  readonly after: EncounterDerivedFactValue | null
  readonly delta: number | null
  readonly label: string
}

export interface EncounterCausalPresentationGroup {
  readonly groupId: string
  readonly parentPresentationId: string | null
  readonly depth: number
  readonly sequence: number
}

export interface EncounterVfxHint {
  readonly vfxId: string
  readonly kind: EncounterVfxKind
  readonly sourceParticipantId: string | null
  readonly targetParticipantIds: readonly string[]
  readonly cells: readonly EncounterGridCell[]
  readonly tone: EncounterPresentationTone
  readonly duration: 'instant' | 'short' | 'normal' | 'long'
  readonly reducedMotionKind: 'none' | 'static' | 'fade' | 'shorten'
  readonly label: string
}

export interface EncounterScreenReaderAnnouncement {
  readonly announcementId: string
  readonly priority: EncounterAnnouncementPriority
  readonly message: string
  readonly dedupeKey: string
}

export interface EncounterHistoryEntry {
  readonly entryId: string
  readonly occurredAt: number
  readonly headline: string
  readonly detail: string | null
  readonly tone: EncounterPresentationTone
  readonly participantIds: readonly string[]
}

export interface EncounterCorrectionPresentation {
  readonly correctionId: string
  readonly correctsPresentationId: string
  readonly reasonLabel: string
  readonly rollbackChangeIds: readonly string[]
}

export interface AcceptedEncounterPresentation {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly presentationId: string
  readonly operationId: string
  readonly mapSlug: string
  readonly previousRevision: number
  readonly revision: number
  readonly source: RuleSourceRef
  readonly actor: EncounterParticipantPresentationRef | null
  readonly affectedParticipants: readonly EncounterParticipantPresentationRef[]
  readonly outcomes: readonly EncounterOutcomeFact[]
  readonly changes: readonly EncounterChangeFact[]
  readonly explanations: readonly EncounterContributionExplanation[]
  readonly causal: EncounterCausalPresentationGroup
  readonly headline: EncounterPresentationCopy
  readonly splash: EncounterPresentationCopy | null
  readonly vfx: readonly EncounterVfxHint[]
  readonly announcements: readonly EncounterScreenReaderAnnouncement[]
  readonly history: readonly EncounterHistoryEntry[]
  readonly correction: EncounterCorrectionPresentation | null
}

export interface EncounterProjectionDiagnostic {
  readonly diagnosticId: string
  readonly label: string
  readonly detail: string
  readonly source: RuleSourceRef | null
}

/** One role-specific, revision-bound client capability and presentation bundle. */
export interface EncounterPresentationProjection {
  readonly schemaVersion: typeof ENCOUNTER_PRESENTATION_SCHEMA_VERSION
  readonly projectionId: string
  readonly audience: EncounterProjectionAudience
  readonly mapSlug: string
  readonly mapRevision: number
  readonly generatedAt: number
  readonly offers: readonly EncounterActionOffer[]
  readonly passives: readonly EncounterPassiveSummary[]
  readonly affordances: readonly EncounterContextualAffordance[]
  readonly pending: readonly EncounterPendingInteractionView[]
  readonly accepted: readonly AcceptedEncounterPresentation[]
  readonly diagnostics: readonly EncounterProjectionDiagnostic[]
}

export type EncounterCapabilityBundle = EncounterPresentationProjection
