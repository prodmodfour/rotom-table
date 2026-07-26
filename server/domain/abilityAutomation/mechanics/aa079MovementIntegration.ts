import type { EncounterCapabilityEffect } from '#shared/moveAutomation/encounterEffects'
import type { GridAnchor, TabletopMap } from '~/types/map'
import { ptuGridDistanceBetweenFootprints } from '~/utils/ptuGridDistance'

export type Aa079MagnetPullConstraintKind = 'maximum' | 'minimum'

interface PositionedFootprint {
  readonly id: string
  readonly position: GridAnchor
  readonly base: number
  readonly clearance?: number
}

const constraintKind = (
  effect: EncounterCapabilityEffect,
): Aa079MagnetPullConstraintKind | null => {
  if (!effect.tags.includes('magnet-pull')
    || effect.suppression.sources.length > 0
    || (effect.duration.remaining !== null && effect.duration.remaining <= 0)
    || effect.payload.action !== 'grant') return null
  if (effect.tags.includes('magnet-pull-maximum')
    && effect.payload.capabilityId === 'movement.constraint.magnet-pull-maximum') return 'maximum'
  if (effect.tags.includes('magnet-pull-minimum')
    && effect.payload.capabilityId === 'movement.constraint.magnet-pull-minimum') return 'minimum'
  return null
}

/**
 * Reject only voluntary paths that cross a server-owned Magnet Pull boundary.
 * If the target starts beyond a boundary, movement toward legality remains
 * possible while movement farther into the prohibited region fails closed.
 */
export const aa079MagnetPullConstraintViolation = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
  readonly origin: GridAnchor
  readonly path: readonly GridAnchor[]
  readonly footprints: readonly PositionedFootprint[]
}): Aa079MagnetPullConstraintKind | null => {
  const mover = input.footprints.find(candidate => candidate.id === input.placementId)
  if (!mover) return null
  const effects = (input.map.encounterState?.effects ?? []).filter(
    (effect): effect is EncounterCapabilityEffect => effect.kind === 'capability'
      && effect.affected.placementIds.includes(input.placementId),
  )
  for (const effect of effects) {
    const kind = constraintKind(effect)
    if (!kind || !effect.source.placementId) continue
    const source = input.footprints.find(candidate => candidate.id === effect.source.placementId)
    if (!source || source.id === mover.id) continue
    const atOrigin = { ...mover, position: input.origin }
    const originDistance = ptuGridDistanceBetweenFootprints(source, atOrigin)
    for (const position of input.path) {
      const distance = ptuGridDistanceBetweenFootprints(source, { ...mover, position })
      if (kind === 'maximum' && distance > 6 && distance > originDistance) return kind
      if (kind === 'minimum' && distance < 3 && distance < originDistance) return kind
    }
  }
  return null
}
