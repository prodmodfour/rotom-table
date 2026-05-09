import type { PtuFeature } from '~/types/ptuReference'
import { matchesReferenceSearch, normalizeReferenceSearch } from '~/utils/reference/search'

export interface FeatureTagCount {
  tag: string
  count: number
}

export interface FeatureFilterOptions {
  searchTerm?: string
  tag?: string | null
}

export const buildFeatureTagCounts = (features: readonly PtuFeature[]): FeatureTagCount[] => {
  const counts = new Map<string, number>()
  for (const feature of features) {
    for (const tag of feature.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }))
}

export const featureMatchesSearch = (feature: PtuFeature, normalizedQuery: string): boolean => {
  const haystacks = [
    feature.name,
    feature.prerequisites ?? '',
    feature.frequency ?? '',
    feature.trigger ?? '',
    feature.target ?? '',
    feature.effect ?? '',
    feature.className ?? '',
  ]
  return matchesReferenceSearch(haystacks, normalizedQuery)
}

export const filterFeaturesForIndex = (
  features: readonly PtuFeature[],
  options: FeatureFilterOptions,
): PtuFeature[] => {
  const query = normalizeReferenceSearch(options.searchTerm ?? '')
  return features.filter((feature) => {
    if (options.tag && !feature.tags?.includes(options.tag)) return false
    return featureMatchesSearch(feature, query)
  })
}

export const toggledFeatureTag = (currentTag: string | null, nextTag: string): string | null =>
  currentTag === nextTag ? null : nextTag
