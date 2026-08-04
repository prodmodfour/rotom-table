import type { EncounterActionGroup } from '../encounterPresentation/catalog'
import type { EncounterActionOffer } from '../encounterPresentation/contracts'

export const ENCOUNTER_ACTION_DOCK_RECENT_LIMIT = 12 as const

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
  offer.group,
  offer.timing.label,
  ...offer.roles,
  ...offer.costs.map(cost => cost.label),
  ...offer.targeting.flatMap(target => [target.rangeLabel ?? '', target.relationshipLabel ?? '']),
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
  recentOfferIds: readonly string[],
): EncounterActionOffer[] => {
  const rank = new Map(recentOfferIds.map((id, index) => [id, index]))
  return [...offers].sort((left, right) => (
    (rank.get(left.offerId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.offerId) ?? Number.MAX_SAFE_INTEGER)
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
