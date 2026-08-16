import type { EncounterActionGroup } from '../encounterPresentation/catalog'
import type { EncounterActionOffer } from '../encounterPresentation/contracts'

export const ENCOUNTER_ACTION_DOCK_RECENT_LIMIT = 12 as const

const GROUP_LABELS: Readonly<Record<EncounterActionGroup, string>> = Object.freeze({
  attack: 'Attacks',
  support: 'Support',
  movement: 'Movement',
  reaction: 'Reactions',
  inventory: 'Inventory',
  capture: 'Capture',
  participant: 'Participant',
  field: 'Field',
  initiative: 'Initiative',
  scene: 'Scene',
  campaign: 'Campaign',
  administration: 'Administration',
})

export const encounterActionGroupLabel = (group: EncounterActionGroup): string => GROUP_LABELS[group]

/** Stable only within local presentation memory; unlike offer IDs it survives map revision refreshes. */
export const encounterActionRecencyKey = (offer: EncounterActionOffer): string => [
  offer.actor.participantId,
  offer.source.sourceKind,
  offer.source.canonicalId,
  offer.source.instanceId ?? '',
  offer.intent.actionId,
  offer.presentation.label,
].join('\u0000')

export interface EncounterActionDockFilters {
  readonly query: string
  readonly group: EncounterActionGroup | 'all'
  readonly availability: 'all' | 'available' | 'unavailable'
}

export interface EncounterActionDockGroup {
  readonly group: EncounterActionGroup
  readonly offers: readonly EncounterActionOffer[]
}

const searchableText = (offer: EncounterActionOffer): string => [
  offer.presentation.label,
  offer.presentation.description ?? '',
  offer.source.displayName,
  offer.source.sourceKind,
  offer.sourceContextLabel ?? '',
  offer.group,
  offer.timing.label,
  ...offer.roles,
  ...offer.costs.map(cost => cost.label),
  ...offer.targeting.flatMap(target => [target.rangeLabel ?? '', target.relationshipLabel ?? '']),
  ...offer.availability.reasons.flatMap(reason => [reason.label, reason.diagnosticDetail ?? '']),
  ...(offer.selectionOptions ?? []).flatMap(option => [
    option.label,
    option.description ?? '',
    option.unavailableReason?.label ?? '',
    ...(option.costs ?? []).map(cost => cost.label),
  ]),
].join('\u0000').toLocaleLowerCase('en-US')

export const filterEncounterActionOffers = (input: {
  readonly offers: readonly EncounterActionOffer[]
  readonly actorParticipantId: string | null
  readonly filters: EncounterActionDockFilters
}): EncounterActionOffer[] => {
  const query = input.filters.query.trim().toLocaleLowerCase('en-US')
  return input.offers
    .filter(offer => input.actorParticipantId === null || offer.actor.participantId === input.actorParticipantId)
    .filter(offer => input.filters.group === 'all' || offer.group === input.filters.group)
    .filter(offer => input.filters.availability === 'all' || offer.availability.status === input.filters.availability)
    .filter(offer => !query || searchableText(offer).includes(query))
    .sort((left, right) => left.groupOrder - right.groupOrder
      || left.offerOrder - right.offerOrder
      || left.presentation.label.localeCompare(right.presentation.label)
      || left.offerId.localeCompare(right.offerId))
}

export const groupEncounterActionOffers = (
  offers: readonly EncounterActionOffer[],
): EncounterActionDockGroup[] => {
  const groups = new Map<EncounterActionGroup, EncounterActionOffer[]>()
  for (const offer of offers) {
    const values = groups.get(offer.group) ?? []
    values.push(offer)
    groups.set(offer.group, values)
  }
  return [...groups.entries()].map(([group, values]) => ({ group, offers: values }))
}

export const recordRecentEncounterAction = (
  recentOfferIds: readonly string[],
  offerId: string,
): string[] => [offerId, ...recentOfferIds.filter(value => value !== offerId)]
  .slice(0, ENCOUNTER_ACTION_DOCK_RECENT_LIMIT)

export const orderEncounterActionsByRecency = (
  offers: readonly EncounterActionOffer[],
  recentActionKeys: readonly string[],
): EncounterActionOffer[] => {
  const rank = new Map(recentActionKeys.map((id, index) => [id, index]))
  const recentRank = (offer: EncounterActionOffer): number => rank.get(encounterActionRecencyKey(offer))
    // Backward-compatible for ephemeral callers that still hold one offer ID.
    ?? rank.get(offer.offerId)
    ?? Number.MAX_SAFE_INTEGER
  return [...offers].sort((left, right) => (
    recentRank(left) - recentRank(right)
    || left.groupOrder - right.groupOrder
    || left.offerOrder - right.offerOrder
    || left.offerId.localeCompare(right.offerId)
  ))
}

export const encounterActionCostLabel = (offer: EncounterActionOffer): string => (
  offer.costs.length ? offer.costs.map(cost => cost.label).join(' · ') : 'No projected cost'
)

export const encounterActionUsageLabel = (offer: EncounterActionOffer): string => {
  const usage = offer.usage
  if (offer.source.sourceKind === 'item' && usage.remaining !== null) return `${usage.remaining} available`
  if (usage.remaining !== null && usage.maximum !== null) return `${usage.remaining}/${usage.maximum} ${usage.frequencyLabel ?? 'uses'}`
  return usage.cooldownLabel ?? usage.frequencyLabel ?? usage.resetLabel ?? 'No usage limit projected'
}

export const encounterActionTargetLabel = (offer: EncounterActionOffer): string => {
  if (offer.targeting.length === 0 || offer.targeting.every(target => target.kind === 'none')) return 'No target'
  return offer.targeting.map(target => [
    target.kind,
    target.rangeLabel,
    target.relationshipLabel,
    target.requiresSpatialInput ? 'exact geometry' : null,
  ].filter(Boolean).join(' · ')).join('; ')
}
