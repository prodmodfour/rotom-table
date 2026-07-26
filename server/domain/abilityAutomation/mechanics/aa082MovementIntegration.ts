import type { GridAnchor } from '~/types/map'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'

interface Aa082MovementFootprint {
  readonly id: string
  readonly sideId: string | null
  readonly position: GridAnchor
  readonly base: number
  readonly clearance?: number
  readonly speciesId: string
  readonly currentHp: number
  readonly effectiveAbilityIds: readonly string[]
}

/**
 * Enforces the Baby Kangaskhan's voluntary 10-metre Parental Bond tether.
 * The nearest conscious allied Kangaskhan is the deterministic mother link,
 * matching the lifecycle trigger's live-play projection. Movement from an
 * already-illegal position remains allowed when it reduces the distance.
 */
export const aa082ParentalBondTetherViolation = (input: {
  readonly placementId: string
  readonly origin: GridAnchor
  readonly path: readonly GridAnchor[]
  readonly footprints: readonly Aa082MovementFootprint[]
}): boolean => {
  const baby = input.footprints.find(candidate => candidate.id === input.placementId)
  if (!baby || !baby.effectiveAbilityIds.includes('Parental Bond')) return false
  const mothers = input.footprints
    .filter(candidate => candidate.id !== baby.id)
    .filter(candidate => candidate.sideId !== null && candidate.sideId === baby.sideId)
    .filter(candidate => candidate.speciesId === 'kangaskhan' && candidate.currentHp > 0)
    .map(candidate => ({
      candidate,
      distance: ptuGridDistanceBetweenFootprints(candidate, { ...baby, position: input.origin }),
    }))
    .sort((left, right) => left.distance - right.distance
      || left.candidate.id.localeCompare(right.candidate.id))
  const mother = mothers[0]?.candidate
  if (!mother) return false
  const originDistance = ptuGridDistanceBetweenFootprints(mother, { ...baby, position: input.origin })
  return input.path.some(position => {
    const distance = ptuGridDistanceBetweenFootprints(mother, { ...baby, position })
    return distance > 10 && distance > originDistance
  })
}
