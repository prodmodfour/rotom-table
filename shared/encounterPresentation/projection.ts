import { deepFreezeStrictJson } from '../automation/strictJson'
import {
  ENCOUNTER_AVAILABILITY_REASON_DEFINITIONS,
  ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  type EncounterAvailabilityReasonCode,
  type EncounterProjectionAudience,
} from './catalog'
import { encounterPresentationStableId } from './identity'
import type {
  AcceptedEncounterPresentation,
  EncounterActionOffer,
  EncounterAvailability,
  EncounterAvailabilityReason,
  EncounterContributionExplanation,
  EncounterContributionRow,
  EncounterContextualAffordance,
  EncounterPassiveSummary,
  EncounterPendingInteractionPublicView,
  EncounterPendingInteractionView,
  EncounterPresentationProjection,
  RuleSourceRef,
} from './contracts'
import { parseEncounterPresentationProjection } from './validation'

export interface EncounterProjectionPolicy {
  readonly audience: EncounterProjectionAudience
  readonly controlledParticipantIds?: readonly string[]
  readonly authorizedInteractionIds?: readonly string[]
  readonly visibleParticipantIds?: readonly string[]
  /** Source identities hidden from this viewer after server-side policy evaluation. */
  readonly hiddenSourceKeys?: readonly string[]
}

export const encounterRuleSourceKey = (
  source: Pick<RuleSourceRef, 'sourceKind' | 'canonicalId' | 'instanceId'>,
): string => `${source.sourceKind}:${source.canonicalId}:${source.instanceId ?? ''}`

export const encounterAvailabilityReason = (
  code: EncounterAvailabilityReasonCode,
  options: {
    readonly sources?: readonly RuleSourceRef[]
    readonly diagnosticDetail?: string | null
  } = {},
): EncounterAvailabilityReason => ({
  code,
  label: ENCOUNTER_AVAILABILITY_REASON_DEFINITIONS[code].label,
  sources: options.sources ?? [],
  diagnosticDetail: options.diagnosticDetail ?? null,
})

export const encounterAvailable = (): EncounterAvailability => ({
  status: 'available',
  reasons: [],
})

export const encounterUnavailable = (
  ...reasons: readonly EncounterAvailabilityReason[]
): EncounterAvailability => {
  if (reasons.length === 0) throw new Error('Unavailable encounter actions require a reason.')
  return { status: 'unavailable', reasons }
}

const privateRuleSource = (): RuleSourceRef => ({
  sourceKind: 'system',
  canonicalId: 'private-rule',
  instanceId: null,
  displayName: 'Private rule',
  referenceHref: null,
})

const redactReason = (
  reason: EncounterAvailabilityReason,
  hiddenSourceKeys: ReadonlySet<string>,
  diagnostic: boolean,
): EncounterAvailabilityReason => ({
  ...reason,
  sources: reason.sources.map(source => hiddenSourceKeys.has(encounterRuleSourceKey(source))
    ? privateRuleSource()
    : source),
  diagnosticDetail: diagnostic ? reason.diagnosticDetail : null,
})

const redactAvailability = (
  availability: EncounterAvailability,
  hiddenSourceKeys: ReadonlySet<string>,
  diagnostic: boolean,
): EncounterAvailability => ({
  ...availability,
  reasons: availability.reasons.map(reason => redactReason(reason, hiddenSourceKeys, diagnostic)),
})

const redactContribution = (
  row: EncounterContributionRow,
  hiddenSourceKeys: ReadonlySet<string>,
  diagnostic: boolean,
): EncounterContributionRow | null => {
  const sourceHidden = row.source !== null && hiddenSourceKeys.has(encounterRuleSourceKey(row.source))
  if (diagnostic) return row
  if (row.private || sourceHidden) return null
  return {
    ...row,
    preventionReason: row.preventionReason
      ? redactReason(row.preventionReason, hiddenSourceKeys, false)
      : null,
  }
}

const redactExplanation = (
  explanation: EncounterContributionExplanation,
  hiddenSourceKeys: ReadonlySet<string>,
  diagnostic: boolean,
): EncounterContributionExplanation => {
  if (diagnostic) return explanation
  const redacted = explanation.contributions.filter(row => (
    row.private || (row.source !== null && hiddenSourceKeys.has(encounterRuleSourceKey(row.source)))
  ))
  const visible = explanation.contributions.flatMap(row => {
    const projected = redactContribution(row, hiddenSourceKeys, false)
    return projected ? [projected] : []
  })
  const genericRows: EncounterContributionRow[] = redacted.length === 0 ? [] : [{
    contributionId: encounterPresentationStableId('contribution', explanation.explanationId, 'private'),
    order: Math.max(0, ...redacted.map(row => row.order)),
    kind: 'override',
    source: null,
    label: redacted.some(row => row.kind === 'prevent' || row.kind === 'immunity')
      ? 'A private rule affected or prevented this result'
      : 'A private rule affected this result',
    value: null,
    applied: redacted.some(row => row.applied),
    private: false,
    preventionReason: null,
  }]
  return {
    ...explanation,
    contributions: [...visible, ...genericRows].sort((left, right) => left.order - right.order),
  }
}

const pendingPublicView = (
  pending: EncounterPendingInteractionView,
): EncounterPendingInteractionPublicView => {
  if (pending.projection === 'public') return pending
  return {
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    projection: 'public',
    interactionId: pending.interactionId,
    mapSlug: pending.mapSlug,
    mapRevision: pending.mapRevision,
    status: pending.status,
    source: pending.source,
    actor: pending.actor,
    prompt: 'Waiting for an authorised response.',
    outstandingChoiceCount: pending.choices.length,
    allowPass: pending.allowPass,
    allowCancel: pending.allowCancel,
    expiresAt: pending.expiresAt,
    announcement: {
      ...pending.announcement,
      priority: 'polite',
      message: 'The encounter is waiting for an authorised response.',
    },
  }
}

const projectPending = (
  pending: EncounterPendingInteractionView,
  policy: EncounterProjectionPolicy,
  authorizedInteractions: ReadonlySet<string>,
): EncounterPendingInteractionView => {
  if (policy.audience === 'diagnostic') return pending
  if (policy.audience === 'gm') {
    if (pending.projection === 'gm') return pending
    if (pending.projection === 'diagnostic') return pendingPublicView(pending)
    return pending
  }
  if ((policy.audience === 'actor-owner' || policy.audience === 'responder-owner')
    && authorizedInteractions.has(pending.interactionId)
    && (pending.projection === policy.audience || pending.projection === 'public')) {
    return pending
  }
  return pendingPublicView(pending)
}

const redactPending = (
  pending: EncounterPendingInteractionView,
  hiddenSourceKeys: ReadonlySet<string>,
  diagnostic: boolean,
): EncounterPendingInteractionView => {
  const source = pending.source !== null && hiddenSourceKeys.has(encounterRuleSourceKey(pending.source))
    ? privateRuleSource()
    : pending.source
  if (pending.projection === 'public') return { ...pending, source }
  return {
    ...pending,
    source,
    choices: pending.choices.map(choice => ({
      ...choice,
      options: choice.options.map(option => ({
        ...option,
        unavailableReason: option.unavailableReason
          ? redactReason(option.unavailableReason, hiddenSourceKeys, diagnostic)
          : null,
      })),
    })),
    recoveryActions: pending.recoveryActions.map(action => ({
      ...action,
      unavailableReason: action.unavailableReason
        ? redactReason(action.unavailableReason, hiddenSourceKeys, diagnostic)
        : null,
    })),
  }
}

const redactAccepted = (
  accepted: AcceptedEncounterPresentation,
  hiddenSourceKeys: ReadonlySet<string>,
  diagnostic: boolean,
): AcceptedEncounterPresentation => ({
  ...accepted,
  source: hiddenSourceKeys.has(encounterRuleSourceKey(accepted.source))
    ? privateRuleSource()
    : accepted.source,
  outcomes: accepted.outcomes.map(outcome => ({
    ...outcome,
    preventedBy: outcome.preventedBy.map(source => (
      hiddenSourceKeys.has(encounterRuleSourceKey(source)) ? privateRuleSource() : source
    )),
  })),
  explanations: accepted.explanations.map(explanation => (
    redactExplanation(explanation, hiddenSourceKeys, diagnostic)
  )),
})

const offerVisible = (
  offer: EncounterActionOffer,
  policy: EncounterProjectionPolicy,
  controlledParticipantIds: ReadonlySet<string>,
): boolean => {
  if (policy.audience === 'gm' || policy.audience === 'diagnostic') return true
  if (policy.audience === 'public') return false
  return controlledParticipantIds.has(offer.actor.participantId)
}

const passiveVisible = (
  passive: EncounterPassiveSummary,
  visibleParticipantIds: ReadonlySet<string> | null,
  hiddenSourceKeys: ReadonlySet<string>,
): boolean => (
  (visibleParticipantIds === null || visibleParticipantIds.has(passive.participant.participantId))
  && !hiddenSourceKeys.has(encounterRuleSourceKey(passive.source))
)

const redactPassive = (
  passive: EncounterPassiveSummary,
  hiddenSourceKeys: ReadonlySet<string>,
  diagnostic: boolean,
): EncounterPassiveSummary => ({
  ...passive,
  explanation: passive.explanation
    ? redactExplanation(passive.explanation, hiddenSourceKeys, diagnostic)
    : null,
})

const affordanceVisible = (
  affordance: EncounterContextualAffordance,
  policy: EncounterProjectionPolicy,
  controlledParticipantIds: ReadonlySet<string>,
  hiddenSourceKeys: ReadonlySet<string>,
): boolean => {
  if (hiddenSourceKeys.has(encounterRuleSourceKey(affordance.source))) return false
  if (policy.audience === 'gm' || policy.audience === 'diagnostic') return true
  if (affordance.actor === null) return true
  return policy.audience !== 'public' && controlledParticipantIds.has(affordance.actor.participantId)
}

/**
 * Apply one explicit role/privacy policy to an already server-built projection.
 * The result is re-parsed so privacy and size invariants fail closed.
 */
export const projectEncounterPresentation = (input: {
  readonly source: EncounterPresentationProjection
  readonly policy: EncounterProjectionPolicy
}): EncounterPresentationProjection => {
  const policy = input.policy
  const diagnostic = policy.audience === 'diagnostic'
  const controlledParticipantIds = new Set(policy.controlledParticipantIds ?? [])
  const authorizedInteractions = new Set(policy.authorizedInteractionIds ?? [])
  const visibleParticipantIds = policy.visibleParticipantIds
    ? new Set(policy.visibleParticipantIds)
    : null
  const hiddenSourceKeys = new Set(policy.hiddenSourceKeys ?? [])
  const offers = input.source.offers
    .filter(offer => offerVisible(offer, policy, controlledParticipantIds))
    .map(offer => ({
      ...offer,
      availability: redactAvailability(offer.availability, hiddenSourceKeys, diagnostic),
    }))
  const offerIds = new Set(offers.map(offer => offer.offerId))
  const passives = input.source.passives
    .filter(passive => passiveVisible(passive, visibleParticipantIds, hiddenSourceKeys))
    .map(passive => redactPassive(passive, hiddenSourceKeys, diagnostic))
  const affordances = input.source.affordances
    .filter(affordance => affordanceVisible(affordance, policy, controlledParticipantIds, hiddenSourceKeys))
    .map(affordance => ({
      ...affordance,
      linkedOfferId: affordance.linkedOfferId && offerIds.has(affordance.linkedOfferId)
        ? affordance.linkedOfferId
        : null,
      availability: redactAvailability(affordance.availability, hiddenSourceKeys, diagnostic),
    }))
  const pendingByKey = new Map<string, EncounterPendingInteractionView>()
  for (const pending of input.source.pending) {
    const projected = projectPending(pending, policy, authorizedInteractions)
    const redacted = redactPending(projected, hiddenSourceKeys, diagnostic)
    pendingByKey.set(`${redacted.projection}:${redacted.interactionId}`, redacted)
  }
  const accepted = input.source.accepted.map(value => redactAccepted(value, hiddenSourceKeys, diagnostic))
  const projection: EncounterPresentationProjection = {
    schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
    projectionId: encounterPresentationStableId('projection', input.source.projectionId, policy.audience),
    audience: policy.audience,
    mapSlug: input.source.mapSlug,
    mapRevision: input.source.mapRevision,
    generatedAt: input.source.generatedAt,
    offers,
    passives,
    affordances,
    pending: [...pendingByKey.values()],
    accepted,
    diagnostics: diagnostic ? input.source.diagnostics : [],
  }
  return parseEncounterPresentationProjection(projection)
}

export const emptyEncounterPresentationProjection = (input: {
  readonly mapSlug: string
  readonly mapRevision: number
  readonly audience: EncounterProjectionAudience
  readonly generatedAt?: number
}): EncounterPresentationProjection => parseEncounterPresentationProjection({
  schemaVersion: ENCOUNTER_PRESENTATION_SCHEMA_VERSION,
  projectionId: `projection:${input.mapSlug}:${input.mapRevision}:${input.audience}`,
  audience: input.audience,
  mapSlug: input.mapSlug,
  mapRevision: input.mapRevision,
  generatedAt: input.generatedAt ?? 0,
  offers: [],
  passives: [],
  affordances: [],
  pending: [],
  accepted: [],
  diagnostics: [],
})

export const freezeEncounterPresentationProjection = (
  value: EncounterPresentationProjection,
): EncounterPresentationProjection => deepFreezeStrictJson(value)
