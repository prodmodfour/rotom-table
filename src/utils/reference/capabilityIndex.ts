import type { PtuCapability } from '~/types/ptuReference'
import { matchesReferenceSearch, normalizeReferenceSearch } from '~/utils/reference/search'

export const capabilitySearchHaystack = (capability: PtuCapability): string[] => [
  capability.name,
  capability.effect ?? '',
]

export const matchesCapabilityQuery = (
  capability: PtuCapability,
  normalizedQuery: string,
): boolean => matchesReferenceSearch(capabilitySearchHaystack(capability), normalizedQuery)

export const filterCapabilities = (
  capabilities: readonly PtuCapability[],
  query: string,
): PtuCapability[] => {
  const normalizedQuery = normalizeReferenceSearch(query)
  if (!normalizedQuery) return [...capabilities]
  return capabilities.filter((capability) => matchesCapabilityQuery(capability, normalizedQuery))
}
