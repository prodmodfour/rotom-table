import type { GridAnchor, TabletopMap } from '~/types/map'
import { ptuGridVectorDistance } from '~/utils/ptuGridDistance'

const distance = (left: GridAnchor, right: GridAnchor): number => ptuGridVectorDistance({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
})

/** Shadow Tag's pinned origin constrains voluntary and forced paths alike. */
export const aa085to100ShadowTagPathViolation = (input: {
  readonly map: Pick<TabletopMap, 'encounterState'>
  readonly placementId: string
  readonly path: readonly GridAnchor[]
}): boolean => {
  const marker = input.map.encounterState?.effects.find(effect => (
    effect.tags.includes('aa089-shadow-tag')
    && effect.affected.placementIds.includes(input.placementId)
    && effect.affected.cells.length === 1
    && effect.suppression.sources.length === 0
    && (effect.duration.remaining === null || effect.duration.remaining > 0)
  ))
  const origin = marker?.affected.cells[0]
  return origin ? input.path.some(step => distance(origin, step) > 5) : false
}
