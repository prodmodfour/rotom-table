import { createHash } from 'node:crypto'
import { stableJsonStringify } from '#shared/automation/stableJson'
import {
  BREEDING_WORKSHOP_ACTIVITY_API_PATH,
  BREEDING_WORKSHOP_ACTIVITY_HISTORY_LIMIT,
  BREEDING_WORKSHOP_ACTIVITY_SECURITY_POLICY_DEFINITION_SHA256,
  parseBreedingWorkshopActivityProjectionV1,
  type BreedingWorkshopActivityProjectionV1,
  type BreedingWorkshopEggProgressV1,
  type BreedingWorkshopEggStage,
  type BreedingWorkshopEggTransferV1,
  type BreedingWorkshopHistoryEntryV1,
  type BreedingWorkshopProjectProgressV1,
  type BreedingWorkshopProjectStage,
  type BreedingWorkshopRecoverySummaryV1,
} from '#shared/breeding/workshopActivity'
import type { PokemonEggDocumentV1, PokemonEggStatus } from '#shared/breeding/egg'
import type { PokemonEggTransferConsentV1 } from '#shared/breeding/eggTransfer'
import type { BreedingProjectDocumentV1, BreedingProjectStatus } from '#shared/breeding/project'

const sha256 = (value: unknown): string => createHash('sha256')
  .update(stableJsonStringify(value))
  .digest('hex')
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0

export const BREEDING_WORKSHOP_ACTIVITY_PRESENTATION_POLICY_DEFINITION = Object.freeze({
  schemaVersion: 1 as const,
  policyId: 'breeding-workshop-activity-presentation-v1' as const,
  apiPath: BREEDING_WORKSHOP_ACTIVITY_API_PATH,
  authority: 'current-selected-trainer-storage' as const,
  cardLimit: 50 as const,
  historyLimit: BREEDING_WORKSHOP_ACTIVITY_HISTORY_LIMIT,
  progressAuthority: 'campaign-clock-aggregate-facts-only' as const,
  historyAuthority: 'immutable-aggregate-milestones-and-consumed-transfer-settlements' as const,
  recoveryAuthority: 'current-pending-operation-scopes' as const,
  transferAuthority: 'current-egg-status-revision-and-durable-consents' as const,
  playerPrivacy: 'owner-aggregates-with-cross-owner-parent-identity-redaction' as const,
  gmPrivacy: 'selected-owner-aggregate-cards-with-current-parent-identity-access' as const,
  browserAuthority: 'none' as const,
})
export const BREEDING_WORKSHOP_ACTIVITY_PRESENTATION_POLICY_DEFINITION_SHA256 = sha256(
  BREEDING_WORKSHOP_ACTIVITY_PRESENTATION_POLICY_DEFINITION,
)

export class BreedingWorkshopActivityProjectionAuthorityError extends Error {
  readonly code:
    | 'breeding.workshop-activity.hash-mismatch'
    | 'breeding.workshop-activity.invalid-definition'
  constructor(code: BreedingWorkshopActivityProjectionAuthorityError['code'], message: string) {
    super(message)
    this.name = 'BreedingWorkshopActivityProjectionAuthorityError'
    this.code = code
  }
}

const withoutHash = (
  value: BreedingWorkshopActivityProjectionV1,
): Omit<BreedingWorkshopActivityProjectionV1, 'projectionDefinitionSha256'> => {
  const { projectionDefinitionSha256: _hash, ...definition } = value
  return definition
}
export const parseAuthoritativeBreedingWorkshopActivityProjectionV1 = (
  value: unknown,
  path = 'activity',
): BreedingWorkshopActivityProjectionV1 => {
  const projection = parseBreedingWorkshopActivityProjectionV1(value, path)
  if (projection.securityPolicyDefinitionSha256
    !== BREEDING_WORKSHOP_ACTIVITY_SECURITY_POLICY_DEFINITION_SHA256) {
    throw new BreedingWorkshopActivityProjectionAuthorityError(
      'breeding.workshop-activity.invalid-definition',
      'Breeding Workshop activity does not use the current security policy.',
    )
  }
  if (sha256(withoutHash(projection)) !== projection.projectionDefinitionSha256) {
    throw new BreedingWorkshopActivityProjectionAuthorityError(
      'breeding.workshop-activity.hash-mismatch',
      'Breeding Workshop activity hash does not match its exact audience definition.',
    )
  }
  return projection
}
export const createBreedingWorkshopActivityProjectionV1 = (
  value: Omit<
    BreedingWorkshopActivityProjectionV1,
    'schemaVersion' | 'securityPolicyDefinitionSha256' | 'projectionDefinitionSha256'
  >,
): BreedingWorkshopActivityProjectionV1 => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length > 0) {
    throw new BreedingWorkshopActivityProjectionAuthorityError(
      'breeding.workshop-activity.invalid-definition',
      'Breeding Workshop activity definition must be one exact plain object.',
    )
  }
  const expected = [
    'audience', 'trainer', 'generatedAtCampaignMinute', 'projectsTruncated',
    'eggsTruncated', 'projects', 'eggs',
  ].sort()
  const fields = Object.getOwnPropertyNames(value)
  if (fields.length !== expected.length
    || [...fields].sort().some((field, index) => field !== expected[index])
    || fields.some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return descriptor?.enumerable !== true || !('value' in descriptor)
    })) {
    throw new BreedingWorkshopActivityProjectionAuthorityError(
      'breeding.workshop-activity.invalid-definition',
      'Breeding Workshop activity definition must contain exactly the declared fields.',
    )
  }
  const candidate = parseBreedingWorkshopActivityProjectionV1({
    schemaVersion: 1,
    ...value,
    securityPolicyDefinitionSha256: BREEDING_WORKSHOP_ACTIVITY_SECURITY_POLICY_DEFINITION_SHA256,
    projectionDefinitionSha256: '0'.repeat(64),
  })
  const definition = withoutHash(candidate)
  return parseAuthoritativeBreedingWorkshopActivityProjectionV1({
    ...definition,
    projectionDefinitionSha256: sha256(definition),
  })
}

export const breedingWorkshopProjectStage = (status: BreedingProjectStatus): BreedingWorkshopProjectStage => {
  if (status === 'draft') return 'planning'
  if (status === 'awaiting-parent-consent') return 'awaiting-consent'
  if (status === 'initial-time-in-progress') return 'initial-time'
  if (status === 'check-ready') return 'check'
  if (status === 'additional-time-in-progress') return 'additional-time'
  if (status === 'ready-to-produce') return 'production-ready'
  if (status === 'egg-produced') return 'completed'
  return 'ended'
}
export const breedingWorkshopEggStage = (status: PokemonEggStatus): BreedingWorkshopEggStage => {
  if (status === 'incubating') return 'incubating'
  if (status === 'ready') return 'ready'
  if (status === 'awaiting-special-adjudication') return 'decision-required'
  if (status === 'hatching') return 'hatching'
  if (status === 'hatched') return 'completed'
  return 'ended'
}
const percent = (accumulated: number, target: number): number => target <= 0
  ? 100
  : Math.min(100, Math.floor((accumulated * 100) / target))
export const breedingWorkshopProjectProgress = (
  project: BreedingProjectDocumentV1,
): BreedingWorkshopProjectProgressV1 => {
  const accumulated = project.timeline.initialAccumulatedCampaignMinutes
    + project.timeline.additionalAccumulatedCampaignMinutes
  return Object.freeze({
    stage: breedingWorkshopProjectStage(project.status),
    accumulatedCampaignMinutes: accumulated,
    targetCampaignMinutes: 480,
    percent: percent(accumulated, 480),
  })
}
export const breedingWorkshopEggProgress = (
  egg: PokemonEggDocumentV1,
): BreedingWorkshopEggProgressV1 => Object.freeze({
  stage: breedingWorkshopEggStage(egg.status),
  accumulatedCampaignMinutes: egg.incubation.accumulatedCampaignMinutes,
  targetCampaignMinutes: egg.incubation.targetCampaignMinutes,
  percent: percent(egg.incubation.accumulatedCampaignMinutes, egg.incubation.targetCampaignMinutes),
  paused: egg.incubation.paused,
})
const history = (
  values: readonly BreedingWorkshopHistoryEntryV1[],
): readonly BreedingWorkshopHistoryEntryV1[] => {
  const sorted = [...values]
    .sort((left, right) => left.campaignMinute - right.campaignMinute || compare(left.kind, right.kind))
    .filter((entry, index, all) => index === 0
      || entry.campaignMinute !== all[index - 1]!.campaignMinute
      || entry.kind !== all[index - 1]!.kind)
  const bounded = sorted.length <= BREEDING_WORKSHOP_ACTIVITY_HISTORY_LIMIT
    ? sorted
    : [sorted[0]!, ...sorted.slice(-(BREEDING_WORKSHOP_ACTIVITY_HISTORY_LIMIT - 1))]
  return Object.freeze(bounded.map(entry => Object.freeze(entry)))
}
export const breedingWorkshopProjectHistory = (
  project: BreedingProjectDocumentV1,
): readonly BreedingWorkshopHistoryEntryV1[] => {
  const entries: BreedingWorkshopHistoryEntryV1[] = [
    { kind: 'created', campaignMinute: project.createdAtCampaignMinute },
  ]
  if (project.timeline.initialStartedAtCampaignMinute !== null) entries.push({ kind: 'initial-time-started', campaignMinute: project.timeline.initialStartedAtCampaignMinute })
  if (project.timeline.checkReadyAtCampaignMinute !== null) entries.push({ kind: 'check-ready', campaignMinute: project.timeline.checkReadyAtCampaignMinute })
  if (project.check) entries.push({ kind: project.check.outcome === 'success' ? 'check-succeeded' : 'check-failed', campaignMinute: project.check.resolvedAtCampaignMinute })
  if (project.timeline.additionalStartedAtCampaignMinute !== null) entries.push({ kind: 'additional-time-started', campaignMinute: project.timeline.additionalStartedAtCampaignMinute })
  if (project.timeline.readyToProduceAtCampaignMinute !== null) entries.push({ kind: 'production-ready', campaignMinute: project.timeline.readyToProduceAtCampaignMinute })
  if (project.timeline.eggProducedAtCampaignMinute !== null) entries.push({ kind: 'egg-produced', campaignMinute: project.timeline.eggProducedAtCampaignMinute })
  if (project.terminal && project.status !== 'check-failed') entries.push({ kind: 'project-ended', campaignMinute: project.terminal.atCampaignMinute })
  return history(entries)
}
export const breedingWorkshopEggHistory = (
  egg: PokemonEggDocumentV1,
  transferSettlementMinutes: readonly number[],
): readonly BreedingWorkshopHistoryEntryV1[] => {
  const entries: BreedingWorkshopHistoryEntryV1[] = [
    { kind: 'created', campaignMinute: egg.createdAtCampaignMinute },
    ...transferSettlementMinutes.map(campaignMinute => ({
      kind: 'ownership-transferred' as const,
      campaignMinute,
    })),
  ]
  if (egg.incubation.readyAtCampaignMinute !== null) entries.push({ kind: 'egg-ready', campaignMinute: egg.incubation.readyAtCampaignMinute })
  if (egg.status === 'awaiting-special-adjudication') entries.push({ kind: 'egg-special-required', campaignMinute: egg.statusChangedAtCampaignMinute })
  else if (egg.status === 'hatching') entries.push({ kind: 'egg-status-changed', campaignMinute: egg.statusChangedAtCampaignMinute })
  else if (egg.status === 'hatched') entries.push({ kind: 'egg-hatched', campaignMinute: egg.statusChangedAtCampaignMinute })
  else if (egg.status === 'cancelled' || egg.status === 'invalidated-by-gm') entries.push({ kind: 'egg-cancelled', campaignMinute: egg.statusChangedAtCampaignMinute })
  return history(entries)
}
export const breedingWorkshopRecoverySummary = (
  pendingCreatedAtCampaignMinutes: readonly number[],
): BreedingWorkshopRecoverySummaryV1 => {
  const earliest = pendingCreatedAtCampaignMinutes.length
    ? Math.min(...pendingCreatedAtCampaignMinutes)
    : null
  return Object.freeze({
    state: earliest === null ? 'none' : 'pending',
    pendingSinceCampaignMinute: earliest,
    canRefresh: earliest !== null,
  })
}
export const breedingWorkshopEggTransfer = (input: {
  readonly egg: PokemonEggDocumentV1
  readonly sourceConsent: PokemonEggTransferConsentV1 | null
  readonly recipientConsent: PokemonEggTransferConsentV1 | null
  readonly generatedAtCampaignMinute: number
  readonly recovery: BreedingWorkshopRecoverySummaryV1
}): BreedingWorkshopEggTransferV1 => {
  if (input.recovery.state === 'pending') return Object.freeze({
    state: 'unavailable', action: 'none',
    reasonId: 'breeding.workshop-transfer.pending-recovery',
    counterpartyTrainerSlug: null, expiresAtCampaignMinute: null,
  })
  const source = input.sourceConsent
  if (source) {
    const recipient = input.recipientConsent
    const state = input.generatedAtCampaignMinute >= source.expiresAtCampaignMinute
      ? 'expired' as const
      : recipient?.status === 'active'
        ? 'accepted' as const
        : 'offered' as const
    return Object.freeze({
      state,
      action: 'review',
      reasonId: 'breeding.workshop-transfer.active-offer',
      counterpartyTrainerSlug: source.destinationTrainerSlug,
      expiresAtCampaignMinute: source.expiresAtCampaignMinute,
    })
  }
  if ((input.egg.status === 'incubating' || input.egg.status === 'ready')
    && input.egg.hatchOperationId === null) return Object.freeze({
    state: 'available', action: 'start', reasonId: null,
    counterpartyTrainerSlug: null, expiresAtCampaignMinute: null,
  })
  return Object.freeze({
    state: 'unavailable', action: 'none',
    reasonId: 'breeding.workshop-transfer.status-unavailable',
    counterpartyTrainerSlug: null, expiresAtCampaignMinute: null,
  })
}
