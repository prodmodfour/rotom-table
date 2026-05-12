import type { PtuFeature } from '~/types/ptuReference'

export interface SiblingFeatureOptions {
  limit?: number
}

export const siblingFeaturesInClass = (
  current: PtuFeature | null | undefined,
  features: readonly PtuFeature[],
  options: SiblingFeatureOptions = {},
): PtuFeature[] => {
  if (!current?.className) return []

  const limit = options.limit ?? 30
  return features
    .filter((feature) => feature.className === current.className && feature.name !== current.name)
    .slice(0, limit)
}
