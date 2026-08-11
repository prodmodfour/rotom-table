export const CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATIONS = Object.freeze([
  Object.freeze({
    canonicalId: 'Egg Warmer' as const,
    actionId: 'warm-egg' as const,
    owner: 'breeding.v1' as const,
    productContext: 'breeding-workshop' as const,
    mapExecution: 'forbidden' as const,
  }),
] as const)

export const capabilityActionDelegatesToCampaignAggregate = (
  canonicalId: string,
  actionId: string,
): boolean => CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATIONS.some(delegation => (
  delegation.canonicalId === canonicalId && delegation.actionId === actionId
))

export const CAPABILITY_CAMPAIGN_AGGREGATE_DELEGATION_MESSAGE =
  'Egg Warmer incubation is owned by the Breeding Workshop and cannot execute through map metadata.' as const
