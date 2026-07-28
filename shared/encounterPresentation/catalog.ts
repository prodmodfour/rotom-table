export const ENCOUNTER_PRESENTATION_SCHEMA_VERSION = 1 as const

export const ENCOUNTER_RULE_SOURCE_KINDS = [
  'move',
  'maneuver',
  'ability',
  'capability',
  'edge',
  'feature',
  'order',
  'item',
  'capture',
  'movement',
  'initiative',
  'scene',
  'field-effect',
  'hazard',
  'terrain',
  'token',
  'shop',
  'system',
] as const
export type EncounterRuleSourceKind = (typeof ENCOUNTER_RULE_SOURCE_KINDS)[number]

export const ENCOUNTER_INTERACTION_ROLES = [
  'passive-provider',
  'activated-action',
  'contextual-affordance',
  'triggered-automatic',
  'triggered-optional',
  'interrupt-reaction',
  'choice-only',
  'spatial-choice',
  'campaign-operation',
  'diagnostic-only',
] as const
export type EncounterInteractionRole = (typeof ENCOUNTER_INTERACTION_ROLES)[number]

export const ENCOUNTER_PROJECTION_AUDIENCES = [
  'public',
  'actor-owner',
  'responder-owner',
  'gm',
  'diagnostic',
] as const
export type EncounterProjectionAudience = (typeof ENCOUNTER_PROJECTION_AUDIENCES)[number]

export const ENCOUNTER_ACTION_GROUPS = [
  'attack',
  'support',
  'movement',
  'reaction',
  'inventory',
  'capture',
  'participant',
  'field',
  'initiative',
  'scene',
  'campaign',
  'administration',
] as const
export type EncounterActionGroup = (typeof ENCOUNTER_ACTION_GROUPS)[number]

export const ENCOUNTER_ACTION_TIMINGS = [
  'standard',
  'shift',
  'swift',
  'free',
  'full',
  'extended',
  'priority',
  'interrupt',
  'reaction',
  'passive',
  'system',
] as const
export type EncounterActionTimingKind = (typeof ENCOUNTER_ACTION_TIMINGS)[number]

export const ENCOUNTER_ACTION_COST_KINDS = [
  'standard-action',
  'shift-action',
  'swift-action',
  'full-action',
  'action-points',
  'hit-points',
  'temporary-hit-points',
  'resource',
  'item',
  'use',
] as const
export type EncounterActionCostKind = (typeof ENCOUNTER_ACTION_COST_KINDS)[number]

export const ENCOUNTER_TARGETING_KINDS = [
  'none',
  'self',
  'participant',
  'side',
  'item',
  'move',
  'cell',
  'area',
  'direction',
  'destination',
  'path',
] as const
export type EncounterTargetingKind = (typeof ENCOUNTER_TARGETING_KINDS)[number]

export const ENCOUNTER_CHOICE_KINDS = [
  'participant',
  'side',
  'mode',
  'branch',
  'type',
  'stat',
  'skill',
  'move',
  'ability',
  'capability',
  'feature',
  'edge',
  'item',
  'cell',
  'area',
  'direction',
  'destination',
  'path',
] as const
export type EncounterChoiceKind = (typeof ENCOUNTER_CHOICE_KINDS)[number]

export const ENCOUNTER_CHOICE_ORDERINGS = [
  'server',
  'alphabetical',
  'initiative',
  'spatial',
] as const
export type EncounterChoiceOrdering = (typeof ENCOUNTER_CHOICE_ORDERINGS)[number]

export const ENCOUNTER_AVAILABILITY_REASON_CODES = [
  'action.available',
  'action.stale-projection',
  'action.pending-interaction',
  'action.unsupported',
  'action.runtime-drift',
  'action.parameters-required',
  'economy.standard-spent',
  'economy.shift-spent',
  'economy.swift-spent',
  'economy.full-action-unavailable',
  'economy.action-points-insufficient',
  'economy.resource-insufficient',
  'timing.no-active-scene',
  'timing.not-actors-turn',
  'timing.wrong-phase',
  'timing.trigger-not-met',
  'timing.priority-unavailable',
  'timing.reaction-window-closed',
  'usage.frequency-exhausted',
  'usage.scene-exhausted',
  'usage.daily-exhausted',
  'usage.once-exhausted',
  'usage.cooldown-active',
  'target.required',
  'target.invalid',
  'target.out-of-range',
  'target.relationship-invalid',
  'target.not-visible',
  'target.geometry-blocked',
  'target.path-blocked',
  'target.destination-occupied',
  'condition.fainted',
  'condition.unconscious',
  'condition.restrained',
  'condition.disabled',
  'source.suppressed',
  'source.missing',
  'source.form-required',
  'source.capability-required',
  'source.item-required',
  'source.item-unavailable',
  'permission.not-controlled',
  'permission.profile-required',
  'permission.side-restricted',
  'permission.owner-required',
  'permission.gm-only',
  'permission.not-authorized',
] as const
export type EncounterAvailabilityReasonCode = (typeof ENCOUNTER_AVAILABILITY_REASON_CODES)[number]

export const ENCOUNTER_CONTRIBUTION_KINDS = [
  'base',
  'add',
  'subtract',
  'multiply',
  'divide',
  'substitute',
  'minimum',
  'maximum',
  'cap',
  'floor',
  'prevent',
  'immunity',
  'override',
] as const
export type EncounterContributionKind = (typeof ENCOUNTER_CONTRIBUTION_KINDS)[number]

export const ENCOUNTER_OUTCOME_KINDS = [
  'used',
  'triggered',
  'accepted',
  'declined',
  'hit',
  'miss',
  'critical',
  'immune',
  'prevented',
  'redirected',
  'expired',
  'corrected',
  'abandoned',
  'no-op',
] as const
export type EncounterOutcomeKind = (typeof ENCOUNTER_OUTCOME_KINDS)[number]

export const ENCOUNTER_CHANGE_KINDS = [
  'hp',
  'temporary-hp',
  'injury',
  'condition',
  'stage',
  'movement',
  'resource',
  'usage',
  'item',
  'effect',
  'zone',
  'form',
  'side',
  'placement',
  'scene',
] as const
export type EncounterChangeKind = (typeof ENCOUNTER_CHANGE_KINDS)[number]

export const ENCOUNTER_CHANGE_OPERATIONS = [
  'set',
  'increase',
  'decrease',
  'add',
  'remove',
  'move',
  'create',
  'delete',
  'replace',
  'reset',
] as const
export type EncounterChangeOperation = (typeof ENCOUNTER_CHANGE_OPERATIONS)[number]

export const ENCOUNTER_PRESENTATION_TONES = [
  'neutral',
  'positive',
  'negative',
  'warning',
  'urgent',
  'informational',
] as const
export type EncounterPresentationTone = (typeof ENCOUNTER_PRESENTATION_TONES)[number]

export const ENCOUNTER_ANNOUNCEMENT_PRIORITIES = [
  'off',
  'polite',
  'assertive',
] as const
export type EncounterAnnouncementPriority = (typeof ENCOUNTER_ANNOUNCEMENT_PRIORITIES)[number]

export const ENCOUNTER_VFX_KINDS = [
  'none',
  'source-pulse',
  'projectile',
  'beam',
  'burst',
  'area',
  'movement',
  'impact',
  'status',
  'healing',
  'capture',
  'field',
] as const
export type EncounterVfxKind = (typeof ENCOUNTER_VFX_KINDS)[number]

export const ENCOUNTER_PENDING_STATUSES = [
  'pending',
  'resuming',
  'resolved',
  'declined',
  'cancelled',
  'expired',
  'conflicted',
  'abandoned',
] as const
export type EncounterPendingStatus = (typeof ENCOUNTER_PENDING_STATUSES)[number]

export const ENCOUNTER_PRESENTATION_LIMITS = Object.freeze({
  offers: 2_048,
  passiveSummaries: 2_048,
  contextualAffordances: 1_024,
  choicesPerInteraction: 64,
  optionsPerChoice: 512,
  selectedOptions: 64,
  pendingInteractions: 256,
  affectedParticipants: 512,
  changeFacts: 2_048,
  outcomeFacts: 1_024,
  contributions: 512,
  sourceEvidence: 64,
  spatialCells: 4_096,
  pathCells: 4_096,
  causalDepth: 16,
  identifierLength: 200,
  canonicalIdLength: 200,
  labelLength: 160,
  descriptionLength: 500,
  announcementLength: 300,
  diagnosticLength: 1_000,
  jsonDepth: 32,
  jsonNodes: 262_144,
  objectFields: 64,
  arrayEntries: 8_192,
  realtimeBytes: 1_048_576,
})

export interface EncounterAvailabilityReasonDefinition {
  readonly code: EncounterAvailabilityReasonCode
  readonly label: string
  readonly publicSafe: boolean
  readonly category: 'available' | 'action' | 'economy' | 'timing' | 'usage' | 'target' | 'condition' | 'source' | 'permission'
}

const reason = (
  code: EncounterAvailabilityReasonCode,
  label: string,
  publicSafe: boolean,
): EncounterAvailabilityReasonDefinition => Object.freeze({
  code,
  label,
  publicSafe,
  category: code.split('.')[0] as EncounterAvailabilityReasonDefinition['category'],
})

export const ENCOUNTER_AVAILABILITY_REASON_DEFINITIONS: Readonly<Record<EncounterAvailabilityReasonCode, EncounterAvailabilityReasonDefinition>> = Object.freeze({
  'action.available': reason('action.available', 'Available', true),
  'action.stale-projection': reason('action.stale-projection', 'Refresh encounter actions', true),
  'action.pending-interaction': reason('action.pending-interaction', 'Resolve the pending interaction first', true),
  'action.unsupported': reason('action.unsupported', 'This action is not automated yet', true),
  'action.runtime-drift': reason('action.runtime-drift', 'Action data needs a server refresh', true),
  'action.parameters-required': reason('action.parameters-required', 'Required action details are missing', true),
  'economy.standard-spent': reason('economy.standard-spent', 'Standard Action already spent', true),
  'economy.shift-spent': reason('economy.shift-spent', 'Shift Action already spent', true),
  'economy.swift-spent': reason('economy.swift-spent', 'Swift Action already spent', true),
  'economy.full-action-unavailable': reason('economy.full-action-unavailable', 'Full Action is unavailable', true),
  'economy.action-points-insufficient': reason('economy.action-points-insufficient', 'Not enough Action Points', true),
  'economy.resource-insufficient': reason('economy.resource-insufficient', 'Required resource is unavailable', true),
  'timing.no-active-scene': reason('timing.no-active-scene', 'Start a scene first', true),
  'timing.not-actors-turn': reason('timing.not-actors-turn', 'Wait for this participant’s turn', true),
  'timing.wrong-phase': reason('timing.wrong-phase', 'This action is unavailable at the current timing', true),
  'timing.trigger-not-met': reason('timing.trigger-not-met', 'The trigger has not occurred', true),
  'timing.priority-unavailable': reason('timing.priority-unavailable', 'Priority timing is unavailable', true),
  'timing.reaction-window-closed': reason('timing.reaction-window-closed', 'The response window has closed', true),
  'usage.frequency-exhausted': reason('usage.frequency-exhausted', 'No uses remain', true),
  'usage.scene-exhausted': reason('usage.scene-exhausted', 'Already used this scene', true),
  'usage.daily-exhausted': reason('usage.daily-exhausted', 'No daily uses remain', true),
  'usage.once-exhausted': reason('usage.once-exhausted', 'This one-time use is spent', true),
  'usage.cooldown-active': reason('usage.cooldown-active', 'This action is cooling down', true),
  'target.required': reason('target.required', 'Choose a target', true),
  'target.invalid': reason('target.invalid', 'That target is not eligible', true),
  'target.out-of-range': reason('target.out-of-range', 'Target is out of range', true),
  'target.relationship-invalid': reason('target.relationship-invalid', 'Target relationship is not eligible', true),
  'target.not-visible': reason('target.not-visible', 'Target is not visible', true),
  'target.geometry-blocked': reason('target.geometry-blocked', 'Targeting geometry is blocked', true),
  'target.path-blocked': reason('target.path-blocked', 'No legal path is available', true),
  'target.destination-occupied': reason('target.destination-occupied', 'Destination is occupied', true),
  'condition.fainted': reason('condition.fainted', 'Participant is fainted', true),
  'condition.unconscious': reason('condition.unconscious', 'Participant is unconscious', true),
  'condition.restrained': reason('condition.restrained', 'A condition prevents this action', true),
  'condition.disabled': reason('condition.disabled', 'This action is disabled by a condition', true),
  'source.suppressed': reason('source.suppressed', 'The source is suppressed', true),
  'source.missing': reason('source.missing', 'The source is no longer present', true),
  'source.form-required': reason('source.form-required', 'A different form is required', true),
  'source.capability-required': reason('source.capability-required', 'A required Capability is missing', true),
  'source.item-required': reason('source.item-required', 'A required item is missing', true),
  'source.item-unavailable': reason('source.item-unavailable', 'The item is unavailable', true),
  'permission.not-controlled': reason('permission.not-controlled', 'You do not control this participant', true),
  'permission.profile-required': reason('permission.profile-required', 'Select an authorised player profile', true),
  'permission.side-restricted': reason('permission.side-restricted', 'This action is restricted to another side', true),
  'permission.owner-required': reason('permission.owner-required', 'Only the owner can use this action', true),
  'permission.gm-only': reason('permission.gm-only', 'Only the GM can use this action', true),
  'permission.not-authorized': reason('permission.not-authorized', 'You are not authorised for this action', true),
})
