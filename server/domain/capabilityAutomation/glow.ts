import type { GridAnchor, TabletopMap } from '~/types/map'
import { deepCloneJson } from '~/utils/serialization'

const GLOW_LIGHT_ID_PREFIX = 'capability.glow:'

export const capabilityGlowLightId = (placementId: string): string => (
  `${GLOW_LIGHT_ID_PREFIX}${placementId}`
)

/** Project one source-owned Glow mode into the map's authoritative light list. */
export const mapWithCapabilityGlowLight = (input: {
  readonly map: TabletopMap
  readonly placementId: string
  readonly active: boolean
}): TabletopMap => {
  const id = capabilityGlowLightId(input.placementId)
  const retained = (input.map.lights ?? []).filter(light => light.id !== id)
  if (!input.active) {
    if (retained.length === (input.map.lights ?? []).length) return input.map
    return { ...input.map, lights: retained }
  }
  const placement = input.map.placements.find(candidate => candidate.id === input.placementId)
  if (!placement) throw new Error(`Glow placement ${input.placementId} is unavailable.`)
  return {
    ...input.map,
    lights: [
      ...retained,
      {
        id,
        kind: 'emissive',
        position: deepCloneJson(placement.position),
      },
    ],
  }
}

/** Keep body-emitted light attached to every placement moved by one transition. */
export const relocateCapabilityGlowLights = (input: {
  readonly lights: TabletopMap['lights']
  readonly placementIds: ReadonlySet<string>
  readonly destination: GridAnchor
}): TabletopMap['lights'] => input.lights?.map(light => {
  for (const placementId of input.placementIds) {
    if (light.id === capabilityGlowLightId(placementId)) {
      return { ...light, position: deepCloneJson(input.destination) }
    }
  }
  return deepCloneJson(light)
})
