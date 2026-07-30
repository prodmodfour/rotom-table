import type { TabletopMap } from '~/types/map'

export type CapabilityLightCondition = 'normal' | 'deep-darkness' | 'total-darkness'

const normalizedContexts = (map: Pick<TabletopMap, 'metadata'>): ReadonlySet<string> => new Set(
  Array.isArray(map.metadata?.capabilityContexts)
    ? map.metadata.capabilityContexts.flatMap(value => (
        typeof value === 'string' && value.trim()
          ? [value.trim().toLocaleLowerCase('en-US')]
          : []
      ))
    : [],
)

/** Bounded GM-authored darkness may be map-wide or scoped to one placement. */
export const capabilityLightConditionForPlacement = (input: {
  readonly map: Pick<TabletopMap, 'metadata'>
  readonly placementId: string
}): CapabilityLightCondition => {
  const contexts = normalizedContexts(input.map)
  const placementId = input.placementId.toLocaleLowerCase('en-US')
  const total = contexts.has('total-darkness') || contexts.has(`total-darkness:${placementId}`)
  const deep = contexts.has('deep-darkness') || contexts.has(`deep-darkness:${placementId}`)
  if (total && deep) throw new Error(`Placement ${input.placementId} has contradictory authoritative darkness contexts.`)
  return total ? 'total-darkness' : deep ? 'deep-darkness' : 'normal'
}

export const capabilityDarknessAccuracyPenalty = (input: {
  readonly condition: CapabilityLightCondition
  readonly hasDarkvision: boolean
  readonly hasBlindsense: boolean
  readonly hasKeenEye: boolean
}): number => {
  if (input.condition === 'normal' || input.hasDarkvision || input.hasBlindsense) return 0
  if (input.condition === 'deep-darkness' && input.hasKeenEye) return 0
  return input.condition === 'total-darkness' ? -10 : -6
}

export const capabilityTotalDarknessBlocksPriority = (input: {
  readonly condition: CapabilityLightCondition
  readonly hasDarkvision: boolean
  readonly hasBlindsense: boolean
}): boolean => input.condition === 'total-darkness' && !input.hasDarkvision && !input.hasBlindsense
